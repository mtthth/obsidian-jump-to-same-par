import { ChangeDesc, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { adjacentChange, buildDiff, Diff, DiffRow } from "./diff";
import { DiffMarks, showDiffMarks } from "./diffMarks";
import { alignUnits, commentSpans, extractUnits } from "./matching";

// Le diff est refait une fois la frappe arrêtée (et au moins dix fois la durée du dernier calcul, pour les
// très longs textes).
const RECOMPUTE_MS = 400;

/** Les différences entre deux textes, paragraphe par paragraphe. */
export function diffBetween(source: Text, target: Text): Diff {
	const sourceLines = source.toJSON();
	const targetLines = target.toJSON();
	const sourceUnits = extractUnits(sourceLines);
	const targetUnits = extractUnits(targetLines);
	return buildDiff({
		sourceLines,
		targetLines,
		sourceComments: commentSpans(sourceLines),
		targetComments: commentSpans(targetLines),
		sourceUnits: sourceUnits.map((unit) => unit.line),
		targetUnits: targetUnits.map((unit) => unit.line),
		pairs: alignUnits(sourceUnits, targetUnits),
	});
}

/**
 * Les différences de deux versions montrées dans leurs deux volets, et tenues à jour pendant qu'on les
 * modifie. Le premier volet fait l'ancienne version : ce qui n'y est plus est marqué supprimé, ce qui
 * n'est que dans le second, ajouté.
 */
export class DiffSession {
	readonly views: readonly [EditorView, EditorView];
	private diff: Diff = { rows: [], changed: 0, added: 0, removed: 0 };
	/** La différence montrée en dernier, pour passer à la voisine. */
	private shown: DiffRow | null = null;
	/**
	 * Où elle se trouve : début de sa ligne dans chaque version (-1 là où elle manque), suivi pendant la frappe pour
	 * la retrouver au calcul suivant. Sans quoi, retouchée, elle serait montrée une seconde fois.
	 */
	private shownAt: [number, number] = [-1, -1];
	/** Le texte a changé depuis le dernier calcul. */
	private outdated = false;
	private timer = 0;
	private delay = RECOMPUTE_MS;
	private stopped = false;

	constructor(source: EditorView, target: EditorView) {
		this.views = [source, target];
	}

	/** Calcule et montre les différences ; renvoie de quoi les annoncer. */
	start(): Diff {
		return this.refresh();
	}

	stop() {
		this.stopped = true;
		window.clearTimeout(this.timer);
		for (const view of this.views) showDiffMarks(view, null);
	}

	involves(view: EditorView): boolean {
		return this.views.includes(view);
	}

	/** À la frappe dans `view`, les marques ne valent plus : on les refait une fois la saisie arrêtée. */
	textChanged(view: EditorView, changes: ChangeDesc) {
		const side = view === this.views[0] ? 0 : 1;
		// Une ligne insérée juste avant elle ne l'emporte pas : la position suit le texte qui la suit.
		if (this.shownAt[side] >= 0) this.shownAt[side] = changes.mapPos(this.shownAt[side], 1);
		this.outdated = true;
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			if (!this.stopped) this.refresh();
		}, this.delay);
	}

	/** La différence suivante (`step` valant 1) ou précédente, à partir de la ligne `line` de `view`. */
	nextChange(view: EditorView, line: number, step: 1 | -1): DiffRow | null {
		// Des différences calculées avant la dernière frappe enverraient à côté.
		if (this.outdated) {
			window.clearTimeout(this.timer);
			this.refresh();
		}
		const row = adjacentChange(this.diff.rows, view === this.views[0] ? 0 : 1, line, this.shown, step);
		// Au bout, on garde la dernière montrée : c'est d'elle que repartira l'autre sens.
		if (row) {
			this.shown = row;
			this.shownAt = [lineStart(this.views[0].state.doc, row.source), lineStart(this.views[1].state.doc, row.target)];
		}
		return row;
	}

	private refresh(): Diff {
		const started = Date.now();
		const [source, target] = this.views;
		this.diff = diffBetween(source.state.doc, target.state.doc);
		this.outdated = false;
		// La différence montrée, si elle est toujours là, au même endroit.
		const shown = this.shown;
		const [sourceLine, targetLine] = [lineAt(source.state.doc, this.shownAt[0]), lineAt(target.state.doc, this.shownAt[1])];
		this.shown = shown
			? this.diff.rows.find((row) => row.kind === shown.kind && row.source === sourceLine && row.target === targetLine) ??
			  null
			: null;
		showDiffMarks(source, marksFor(this.diff, source.state.doc, 0));
		showDiffMarks(target, marksFor(this.diff, target.state.doc, 1));
		this.delay = Math.max(RECOMPUTE_MS, 10 * (Date.now() - started));
		return this.diff;
	}
}

/** Le début de la ligne `line` (à partir de 0), ou -1 pour une ligne absente. */
function lineStart(doc: Text, line: number): number {
	return line < 0 ? -1 : doc.line(Math.min(line + 1, doc.lines)).from;
}

/** La ligne (à partir de 0) de la position `pos`, ou -1 pour une position absente. */
function lineAt(doc: Text, pos: number): number {
	return pos < 0 ? -1 : doc.lineAt(Math.min(pos, doc.length)).number - 1;
}

/** Ce qu'il y a à marquer d'un côté : `side` vaut 0 pour l'ancienne version, 1 pour la nouvelle. */
function marksFor(diff: Diff, doc: Text, side: 0 | 1): DiffMarks {
	const marks: DiffMarks = { lines: [], words: [] };
	for (const row of diff.rows) {
		const number = side === 0 ? row.source : row.target;
		if (row.kind === "same" || number < 0) continue;
		// Le texte a pu changer depuis le calcul : les marques attendront le suivant.
		if (number + 1 > doc.lines) continue;
		const line = doc.line(number + 1);
		marks.lines.push({ pos: line.from, kind: row.kind });
		for (const word of side === 0 ? row.sourceWords : row.targetWords) {
			marks.words.push({
				from: line.from + word.from,
				to: Math.min(line.from + word.to, line.to),
				kind: side === 0 ? "removed" : "added",
			});
		}
	}
	return marks;
}
