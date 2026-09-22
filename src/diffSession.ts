import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildDiff, Diff, DiffRow } from "./diff";
import { DiffMarks, showDiffMarks } from "./diffMarks";
import { alignUnits, extractUnits } from "./matching";

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

	/** À la frappe, les marques ne valent plus : on les refait une fois la saisie arrêtée. */
	textChanged() {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			if (!this.stopped) this.refresh();
		}, this.delay);
	}

	/** La différence suivante (`step` valant 1) ou précédente, à partir de la ligne `line` de `view`. */
	nextChange(view: EditorView, line: number, step: 1 | -1): DiffRow | null {
		const side = view === this.views[0] ? 0 : 1;
		const lineOf = (row: DiffRow) => row.anchor[side];
		// Dans l'ordre du volet d'où l'on part : un paragraphe supprimé et un ajouté qui se suivent d'un côté
		// ne se suivent pas forcément de l'autre.
		const changes = this.diff.rows.filter((row) => row.kind !== "same").sort((x, y) => lineOf(x) - lineOf(y));
		// Depuis la dernière différence montrée, on passe à sa voisine : plusieurs peuvent tenir sur la même
		// ligne de ce côté-ci, par exemple des paragraphes ajoutés là-bas.
		const current = this.shown ? changes.indexOf(this.shown) : -1;
		let index = current >= 0 && lineOf(changes[current]) === line ? current + step : -1;
		if (index < 0) {
			const beyond = (row: DiffRow) => (step === 1 ? lineOf(row) > line : lineOf(row) < line);
			index = step === 1 ? changes.findIndex(beyond) : lastIndex(changes, beyond);
		}
		this.shown = index >= 0 && index < changes.length ? changes[index] : null;
		return this.shown;
	}

	private refresh(): Diff {
		const started = Date.now();
		const [source, target] = this.views;
		this.diff = diffBetween(source.state.doc, target.state.doc);
		this.shown = null;
		showDiffMarks(source, marksFor(this.diff, source.state.doc, 0));
		showDiffMarks(target, marksFor(this.diff, target.state.doc, 1));
		this.delay = Math.max(RECOMPUTE_MS, 10 * (Date.now() - started));
		return this.diff;
	}
}

/** Le dernier élément qui convient, faute de `findLastIndex` en ES2018. */
function lastIndex<T>(items: readonly T[], matches: (item: T) => boolean): number {
	for (let k = items.length - 1; k >= 0; k--) {
		if (matches(items[k])) return k;
	}
	return -1;
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
