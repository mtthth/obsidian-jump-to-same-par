import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { alignLines, revealLine } from "./alignment";
import { flashLines, highlightField } from "./highlight";
import {
	extractUnits,
	findEquivalent,
	MIN_ALIGNMENT_QUALITY,
	MIN_SCORE,
	ParagraphMatch,
	TextUnit,
	unitIndexAt,
} from "./matching";
import { Anchors, anchorsBetween, ScrollSync } from "./scrollSync";

const ALIGN_TITLE = "Aligner les paragraphes";
const SYNC_TITLE = "Défilement simultané";

// Obsidian n'expose pas officiellement la vue CodeMirror 6 sous-jacente sur Editor, mais
// `editor.cm` est l'accès de fait stable utilisé par l'écosystème des plugins pour l'obtenir.
function getCmView(editor: Editor): EditorView | undefined {
	return (editor as unknown as { cm?: EditorView }).cm;
}

/** Une note en mode édition, avec son éditeur CodeMirror. */
interface NoteEditor {
	note: MarkdownView;
	view: EditorView;
}

/** Le défilement simultané en cours, et de quoi vérifier qu'il vaut toujours. */
interface ActiveSync {
	session: ScrollSync;
	notes: [MarkdownView, MarkdownView];
	files: [TFile | null, TFile | null];
	buttons: HTMLElement[];
}

export default class JumpToSameParPlugin extends Plugin {
	// Le clic droit ne déplace pas le curseur : on retient, par éditeur, la position cliquée pour aligner
	// le paragraphe visé plutôt que celui où se trouve le curseur.
	private rightClicks = new WeakMap<EditorView, { pos: number; time: number }>();
	private activeSync: ActiveSync | null = null;

	onload() {
		const rightClicks = this.rightClicks;
		this.registerEditorExtension([
			highlightField,
			ViewPlugin.define((view) => {
				const onContextMenu = (event: MouseEvent) => {
					const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
					rightClicks.set(view, { pos, time: Date.now() });
				};
				// En capture : passer avant le gestionnaire qui ouvre le menu de l'éditeur.
				view.dom.addEventListener("contextmenu", onContextMenu, true);
				return { destroy: () => view.dom.removeEventListener("contextmenu", onContextMenu, true) };
			}),
		]);

		this.addCommand({
			id: "align-paragraphs",
			name: ALIGN_TITLE,
			editorCallback: (editor: Editor) => {
				const view = getCmView(editor);
				if (view) void this.alignFrom(view, view.state.selection.main.head);
			},
		});

		this.addCommand({
			id: "toggle-scroll-sync",
			name: `${SYNC_TITLE} (activer ou désactiver)`,
			editorCallback: (editor: Editor) => {
				const view = getCmView(editor);
				if (view) this.toggleSync(view);
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const view = getCmView(editor);
				if (!view) return;
				const syncing = this.activeSync?.session.involves(view) ?? false;
				if (!syncing && this.otherNotes(view).length === 0) return;
				const openedAt = Date.now();
				menu.addItem((item) =>
					item
						.setTitle(ALIGN_TITLE)
						.setIcon("arrow-left-right")
						.onClick(() => void this.alignFrom(view, this.clickedPos(view, openedAt)))
				);
				menu.addItem((item) =>
					item
						.setTitle(SYNC_TITLE)
						.setIcon("arrow-up-down")
						.setChecked(syncing)
						.onClick(() => this.toggleSync(view))
				);
			})
		);

		// Une note fermée, ou remplacée par une autre dans son volet : les repères ne valent plus rien.
		const checkSync = () => {
			const active = this.activeSync;
			if (!active) return;
			const intact = active.notes.every(
				(note, k) =>
					note.containerEl.isConnected &&
					note.file === active.files[k] &&
					getCmView(note.editor) === active.session.views[k]
			);
			if (!intact) this.stopSync("Défilement simultané arrêté : l'une des deux notes a été fermée ou remplacée.");
		};
		this.registerEvent(this.app.workspace.on("layout-change", checkSync));
		this.registerEvent(this.app.workspace.on("file-open", checkSync));
	}

	onunload() {
		this.stopSync();
	}

	/** La position du clic droit qui a ouvert le menu, ou le curseur si le menu a été ouvert au clavier. */
	private clickedPos(view: EditorView, openedAt: number): number {
		const click = this.rightClicks.get(view);
		if (click && Math.abs(click.time - openedAt) < 1000) return Math.min(click.pos, view.state.doc.length);
		return view.state.selection.main.head;
	}

	/** Les autres notes affichées dans la même fenêtre (onglets en arrière-plan exclus), en édition ou en lecture. */
	private otherNotes(source: EditorView): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter(
				(note): note is MarkdownView =>
					note instanceof MarkdownView &&
					getCmView(note.editor) !== source &&
					note.containerEl.ownerDocument === source.dom.ownerDocument &&
					note.containerEl.clientWidth > 0 &&
					note.containerEl.clientHeight > 0
			);
	}

	/** Les éditeurs des autres notes à l'écran ; null, avec un message, s'il n'y en a aucun à faire défiler. */
	private editorsBeside(source: EditorView): NoteEditor[] | null {
		const others = this.otherNotes(source);
		if (others.length === 0) {
			new Notice("Ouvrez l'autre version du texte dans un volet voisin.");
			return null;
		}
		// En mode lecture, il n'y a pas d'éditeur CodeMirror à faire défiler.
		const editors: NoteEditor[] = [];
		for (const note of others) {
			const view = note.getMode() === "source" ? getCmView(note.editor) : undefined;
			if (view) editors.push({ note, view });
		}
		if (editors.length === 0) {
			new Notice("L'autre texte est en mode lecture : passez-le en mode édition.");
			return null;
		}
		return editors;
	}

	private noteOf(view: EditorView): MarkdownView | undefined {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && getCmView(leaf.view.editor) === view) return leaf.view;
		}
		return undefined;
	}

	private async alignFrom(source: EditorView, pos: number) {
		const sourceUnits = extractUnits(source.state.doc.toJSON());
		const index = unitIndexAt(sourceUnits, source.state.doc.lineAt(pos).number - 1);
		if (index < 0) {
			new Notice("Aucun paragraphe à aligner dans cette note.");
			return;
		}
		const editors = this.editorsBeside(source);
		if (!editors) return;

		// Avec plus de deux notes à l'écran, on retient celle où l'équivalent est le plus net.
		let best: { target: EditorView; units: TextUnit[]; match: ParagraphMatch } | null = null;
		for (const { view: target } of editors) {
			const units = extractUnits(target.state.doc.toJSON());
			const match = findEquivalent(sourceUnits, index, units);
			if (match && (!best || match.score > best.match.score)) best = { target, units, match };
		}
		if (!best || best.match.score < MIN_SCORE) {
			new Notice("Aucun paragraphe équivalent dans l'autre texte.");
			return;
		}

		const { target, units, match } = best;
		// Les unités comptent les lignes à partir de 0, CodeMirror à partir de 1.
		const sourceLine = sourceUnits[match.sourceFrom].line + 1;
		const targetLine = units[match.targetFrom].line + 1;
		const sourcePos = source.state.doc.line(sourceLine).from;
		const targetPos = target.state.doc.line(targetLine).from;
		const align = async () => {
			// Lancée au clavier, la commande part du curseur, qui a pu sortir du volet : comme toute commande
			// d'édition, on le ramène d'abord à l'écran.
			await revealLine(source, pos);
			await alignLines(source, sourcePos, target, targetPos);
		};
		// Le défilement simultané de ces deux volets ne doit pas défaire l'alignement pendant qu'il se fait.
		const session = this.activeSync?.session;
		await (session?.involves(source) && session.involves(target) ? session.suspend(align) : align());
		flashLines(source, sourceLine, sourceUnits[match.sourceTo].line + 1);
		flashLines(target, targetLine, units[match.targetTo].line + 1);
	}

	private toggleSync(view: EditorView) {
		if (this.activeSync?.session.involves(view)) {
			this.stopSync("Défilement simultané désactivé.");
			return;
		}
		const note = this.noteOf(view);
		if (!note) {
			new Notice("Le défilement simultané ne fonctionne qu'entre deux notes ouvertes dans des volets.");
			return;
		}
		const editors = this.editorsBeside(view);
		if (!editors) return;

		// Avec plus de deux notes à l'écran, on retient celle qui ressemble le plus à celle-ci.
		let best: (NoteEditor & { anchors: Anchors }) | null = null;
		for (const other of editors) {
			const anchors = anchorsBetween(view.state.doc, other.view.state.doc);
			if (!best || anchors.quality > best.anchors.quality) best = { ...other, anchors };
		}
		if (!best || best.anchors.quality < MIN_ALIGNMENT_QUALITY) {
			new Notice("Les deux textes se ressemblent trop peu pour défiler ensemble.");
			return;
		}

		this.stopSync();
		const session = new ScrollSync(view, best.view, best.anchors);
		const notes: [MarkdownView, MarkdownView] = [note, best.note];
		this.activeSync = {
			session,
			notes,
			files: [note.file, best.note.file],
			// Dans l'en-tête des deux volets : montre que leur défilement est lié, et permet de le délier.
			buttons: notes.map((synced) => {
				const button = synced.addAction("arrow-up-down", "Arrêter le défilement simultané", () =>
					this.stopSync("Défilement simultané désactivé.")
				);
				button.addClass("jump-to-same-par-sync-button");
				return button;
			}),
		};
		session.start(view);
		new Notice("Défilement simultané activé.");
	}

	private stopSync(message?: string) {
		const active = this.activeSync;
		if (!active) return;
		active.session.stop();
		for (const button of active.buttons) button.remove();
		this.activeSync = null;
		if (message) new Notice(message);
	}
}
