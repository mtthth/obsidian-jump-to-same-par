import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { alignLines, revealLine } from "./alignment";
import { Diff } from "./diff";
import { diffField } from "./diffMarks";
import { DiffSession } from "./diffSession";
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
const DIFF_TITLE = "Montrer les différences";

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

/** Ce que le plugin met en place sur deux notes à la fois : défilement simultané, différences montrées. */
interface PairSession {
	readonly views: readonly [EditorView, EditorView];
	involves(view: EditorView): boolean;
	stop(): void;
}

/** L'une de ces mises en place, en cours, et de quoi vérifier qu'elle vaut toujours. */
interface ActivePair<S extends PairSession> {
	session: S;
	notes: [MarkdownView, MarkdownView];
	files: [TFile | null, TFile | null];
	buttons: HTMLElement[];
}

/** Des deux notes, celle qui vient en premier à l'écran — à gauche, ou en haut — fait l'ancienne version. */
function inReadingOrder(a: NoteEditor, b: NoteEditor): [NoteEditor, NoteEditor] {
	const first = a.view.scrollDOM.getBoundingClientRect();
	const second = b.view.scrollDOM.getBoundingClientRect();
	const before = first.left !== second.left ? first.left < second.left : first.top <= second.top;
	return before ? [a, b] : [b, a];
}

/** « 8 paragraphes modifiés, 1 ajouté, 1 supprimé ». */
function summary(diff: Diff): string {
	const counts: [number, string][] = [
		[diff.changed, "modifié"],
		[diff.added, "ajouté"],
		[diff.removed, "supprimé"],
	];
	const parts = counts
		.filter(([count]) => count > 0)
		.map(([count, word], k) => {
			const plural = count > 1 ? "s" : "";
			// Le nom ne se dit qu'une fois, en tête : « 8 paragraphes modifiés, 1 ajouté ».
			return `${count}${k === 0 ? ` paragraphe${plural}` : ""} ${word}${plural}`;
		});
	return parts.length === 0 ? "Les deux textes sont identiques" : parts.join(", ");
}

export default class JumpToSameParPlugin extends Plugin {
	// Le clic droit ne déplace pas le curseur : on retient, par éditeur, la position cliquée pour aligner
	// le paragraphe visé plutôt que celui où se trouve le curseur.
	private rightClicks = new WeakMap<EditorView, { pos: number; time: number }>();
	private activeSync: ActivePair<ScrollSync> | null = null;
	private activeDiff: ActivePair<DiffSession> | null = null;

	onload() {
		const rightClicks = this.rightClicks;
		this.registerEditorExtension([
			highlightField,
			diffField,
			// Le texte change : les différences montrées ne valent plus, on les refait.
			EditorView.updateListener.of((update) => {
				const diff = this.activeDiff;
				if (update.docChanged && diff?.session.involves(update.view)) diff.session.textChanged();
			}),
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

		this.addCommand({
			id: "toggle-differences",
			name: `${DIFF_TITLE} (activer ou désactiver)`,
			editorCallback: (editor: Editor) => {
				const view = getCmView(editor);
				if (view) this.toggleDiff(view);
			},
		});

		this.addCommand({
			id: "next-difference",
			name: "Différence suivante",
			editorCallback: (editor: Editor) => {
				const view = getCmView(editor);
				if (view) void this.goToChange(view, 1);
			},
		});

		this.addCommand({
			id: "previous-difference",
			name: "Différence précédente",
			editorCallback: (editor: Editor) => {
				const view = getCmView(editor);
				if (view) void this.goToChange(view, -1);
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const view = getCmView(editor);
				if (!view) return;
				const syncing = this.activeSync?.session.involves(view) ?? false;
				const diffing = this.activeDiff?.session.involves(view) ?? false;
				if (!syncing && !diffing && this.otherNotes(view).length === 0) return;
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
				menu.addItem((item) =>
					item
						.setTitle(DIFF_TITLE)
						.setIcon("git-compare")
						.setChecked(diffing)
						.onClick(() => this.toggleDiff(view))
				);
			})
		);

		// Une note fermée, ou remplacée par une autre dans son volet : repères et différences ne valent plus.
		const check = () => {
			if (this.activeSync && !this.intact(this.activeSync)) {
				this.stopSync("Défilement simultané arrêté : l'une des deux notes a été fermée ou remplacée.");
			}
			if (this.activeDiff && !this.intact(this.activeDiff)) {
				this.stopDiff("Différences masquées : l'une des deux notes a été fermée ou remplacée.");
			}
		};
		this.registerEvent(this.app.workspace.on("layout-change", check));
		this.registerEvent(this.app.workspace.on("file-open", check));
	}

	onunload() {
		this.stopSync();
		this.stopDiff();
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

	/**
	 * La note voisine qui ressemble le plus à celle-ci ; null, avec un message, quand aucune n'en est assez
	 * proche. Avec plus de deux notes à l'écran, c'est ainsi qu'on choisit l'autre version.
	 */
	private closestNote(view: EditorView, tooFar: string): (NoteEditor & { anchors: Anchors }) | null {
		const editors = this.editorsBeside(view);
		if (!editors) return null;
		let best: (NoteEditor & { anchors: Anchors }) | null = null;
		for (const other of editors) {
			const anchors = anchorsBetween(view.state.doc, other.view.state.doc);
			if (!best || anchors.quality > best.anchors.quality) best = { ...other, anchors };
		}
		if (!best || best.anchors.quality < MIN_ALIGNMENT_QUALITY) {
			new Notice(tooFar);
			return null;
		}
		return best;
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
		await this.faceToFace(
			source,
			[sourceUnits[match.sourceFrom].line + 1, sourceUnits[match.sourceTo].line + 1],
			target,
			[units[match.targetFrom].line + 1, units[match.targetTo].line + 1],
			pos
		);
	}

	/**
	 * Amène les deux paragraphes face à face et les fait clignoter, sans que le défilement simultané s'en
	 * mêle. `reveal` : la position de la note de départ à ramener à l'écran avant de commencer.
	 */
	private async faceToFace(
		source: EditorView,
		sourceLines: readonly [number, number],
		target: EditorView,
		targetLines: readonly [number, number],
		reveal: number
	) {
		const sourcePos = source.state.doc.line(sourceLines[0]).from;
		const targetPos = target.state.doc.line(targetLines[0]).from;
		const align = async () => {
			// Lancée au clavier, la commande part du curseur, qui a pu sortir du volet : comme toute commande
			// d'édition, on le ramène d'abord à l'écran.
			await revealLine(source, reveal);
			await alignLines(source, sourcePos, target, targetPos);
		};
		// Le défilement simultané de ces deux volets ne doit pas défaire l'alignement pendant qu'il se fait.
		const session = this.activeSync?.session;
		await (session?.involves(source) && session.involves(target) ? session.suspend(align) : align());
		flashLines(source, sourceLines[0], sourceLines[1]);
		flashLines(target, targetLines[0], targetLines[1]);
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
		const best = this.closestNote(view, "Les deux textes se ressemblent trop peu pour défiler ensemble.");
		if (!best) return;

		this.stopSync();
		const session = new ScrollSync(view, best.view, best.anchors);
		// Dans l'en-tête des deux volets : montre que leur défilement est lié, et permet de le délier.
		this.activeSync = this.attach(session, [note, best.note], "arrow-up-down", "Arrêter le défilement simultané", () =>
			this.stopSync("Défilement simultané désactivé.")
		);
		session.start(view);
		new Notice("Défilement simultané activé.");
	}

	private toggleDiff(view: EditorView) {
		if (this.activeDiff?.session.involves(view)) {
			this.stopDiff("Différences masquées.");
			return;
		}
		const note = this.noteOf(view);
		if (!note) {
			new Notice("Les différences ne se montrent qu'entre deux notes ouvertes dans des volets.");
			return;
		}
		const best = this.closestNote(view, "Les deux textes se ressemblent trop peu pour être comparés.");
		if (!best) return;

		// À la git, il faut savoir laquelle des deux versions est l'ancienne : ce sera celle de gauche.
		const [older, newer] = inReadingOrder({ note, view }, best);
		this.stopDiff();
		const session = new DiffSession(older.view, newer.view);
		this.activeDiff = this.attach(session, [older.note, newer.note], "git-compare", "Masquer les différences", () =>
			this.stopDiff("Différences masquées.")
		);
		const diff = session.start();
		const reference = older.note.file?.basename ?? "la première";
		new Notice(
			`${summary(diff)}.\n« ${reference} » fait l'ancienne version : en rouge ce qui en disparaît, en vert ce qui apparaît dans l'autre.`,
			8000
		);
	}

	/** La différence suivante (`step` valant 1) ou précédente, amenée face à face dans les deux volets. */
	private async goToChange(view: EditorView, step: 1 | -1) {
		const active = this.activeDiff;
		if (!active?.session.involves(view)) {
			new Notice(`Activez d'abord « ${DIFF_TITLE} » sur les deux notes.`);
			return;
		}
		const doc = view.state.doc;
		const row = active.session.nextChange(view, doc.lineAt(view.state.selection.main.head).number - 1, step);
		if (!row) {
			new Notice(step === 1 ? "Dernière différence atteinte." : "Première différence atteinte.");
			return;
		}
		const [first, second] = active.session.views;
		const here: 0 | 1 = view === first ? 0 : 1;
		const other = here === 0 ? second : first;
		// Le diff compte les lignes à partir de 0, CodeMirror à partir de 1.
		const hereLine = Math.min(row.anchor[here] + 1, doc.lines);
		const otherLine = Math.min(row.anchor[1 - here] + 1, other.state.doc.lines);
		// Le curseur suit : la différence suivante repartira d'ici.
		const at = doc.line(hereLine).from;
		view.dispatch({ selection: { anchor: at } });
		await this.faceToFace(view, [hereLine, hereLine], other, [otherLine, otherLine], at);
	}

	/** Retient les deux notes concernées et met dans leur en-tête le bouton qui arrête tout. */
	private attach<S extends PairSession>(
		session: S,
		notes: [MarkdownView, MarkdownView],
		icon: string,
		tooltip: string,
		stop: () => void
	): ActivePair<S> {
		return {
			session,
			notes,
			files: [notes[0].file, notes[1].file],
			buttons: notes.map((note) => {
				const button = note.addAction(icon, tooltip, stop);
				button.addClass("jump-to-same-par-active-button");
				return button;
			}),
		};
	}

	/** Les deux notes sont-elles toujours là, avec le même fichier et le même éditeur ? */
	private intact(active: ActivePair<PairSession>): boolean {
		return active.notes.every(
			(note, k) =>
				note.containerEl.isConnected &&
				note.file === active.files[k] &&
				getCmView(note.editor) === active.session.views[k]
		);
	}

	private detach(active: ActivePair<PairSession> | null, message?: string) {
		if (!active) return;
		active.session.stop();
		for (const button of active.buttons) button.remove();
		if (message) new Notice(message);
	}

	private stopSync(message?: string) {
		this.detach(this.activeSync, message);
		this.activeSync = null;
	}

	private stopDiff(message?: string) {
		this.detach(this.activeDiff, message);
		this.activeDiff = null;
	}
}
