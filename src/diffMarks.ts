import { Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

/** Ce qu'il y a à marquer dans une version : des paragraphes entiers, et les mots qui changent dedans. */
export interface DiffMarks {
	lines: { pos: number; kind: "changed" | "added" | "removed" }[];
	words: { from: number; to: number; kind: "added" | "removed" }[];
}

const setMarks = StateEffect.define<DiffMarks | null>();

// À la git : rouge pour ce qui disparaît, vert pour ce qui apparaît (voir styles.css).
const lineMark = {
	changed: Decoration.line({ class: "jump-to-same-par-diff-changed" }),
	added: Decoration.line({ class: "jump-to-same-par-diff-added" }),
	removed: Decoration.line({ class: "jump-to-same-par-diff-removed" }),
};
const wordMark = {
	added: Decoration.mark({ class: "jump-to-same-par-diff-word-added" }),
	removed: Decoration.mark({ class: "jump-to-same-par-diff-word-removed" }),
};

/** Extension d'éditeur des différences montrées, remplacées en bloc à chaque `setMarks`. */
export const diffField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(marks, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(setMarks)) continue;
			if (!effect.value) return Decoration.none;
			const ranges: Range<Decoration>[] = [];
			for (const line of effect.value.lines) ranges.push(lineMark[line.kind].range(line.pos));
			for (const word of effect.value.words) {
				if (word.to > word.from) ranges.push(wordMark[word.kind].range(word.from, word.to));
			}
			return Decoration.set(ranges, true);
		}
		// Le texte change : les marques suivent, en attendant le prochain calcul.
		return marks.map(tr.changes);
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Montre ces différences-là dans ce volet, ou les efface avec `null`. */
export function showDiffMarks(view: EditorView, marks: DiffMarks | null) {
	// Le volet a pu être fermé entre-temps.
	if (view.dom.isConnected) view.dispatch({ effects: setMarks.of(marks) });
}
