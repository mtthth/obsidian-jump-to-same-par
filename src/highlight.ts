import { RangeSetBuilder, StateEffect, StateEffectType, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

// Doit couvrir l'animation de styles.css.
const FLASH_DURATION_MS = 1500;

/** Lignes à surligner (numéros CodeMirror, à partir de 1), ou null pour effacer. */
type LineRange = { from: number; to: number } | null;

const flashEffect = StateEffect.define<LineRange>();

/** Un surlignage de lignes, remplacé en bloc à chaque `effect`, et qui suit les modifications du texte. */
function lineHighlight(effect: StateEffectType<LineRange>, className: string) {
	const decoration = Decoration.line({ class: className });
	return StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(decorations, tr) {
			for (const change of tr.effects) {
				if (!change.is(effect)) continue;
				if (!change.value) return Decoration.none;
				const doc = tr.state.doc;
				const builder = new RangeSetBuilder<Decoration>();
				for (let n = Math.min(change.value.from, doc.lines); n <= Math.min(change.value.to, doc.lines); n++) {
					builder.add(doc.line(n).from, doc.line(n).from, decoration);
				}
				return builder.finish();
			}
			return decorations.map(tr.changes);
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}

/** Extension d'éditeur du surlignage fugace, seule façon dont le plugin marque une ligne. */
export const highlightField = lineHighlight(flashEffect, "jump-to-same-par-flash");

const timers = new WeakMap<EditorView, number>();

/**
 * Surligne brièvement des lignes : les paragraphes que l'alignement vient d'apparier, pour voir
 * lesquels ont été retenus, ou la ligne que le défilement simultané vient d'amener en face.
 */
export function flashLines(view: EditorView, from: number, to: number) {
	// Le volet a pu être fermé pendant l'alignement.
	if (!view.dom.isConnected) return;
	window.clearTimeout(timers.get(view));
	view.dispatch({ effects: flashEffect.of({ from, to }) });
	timers.set(
		view,
		window.setTimeout(() => {
			if (view.dom.isConnected) view.dispatch({ effects: flashEffect.of(null) });
		}, FLASH_DURATION_MS)
	);
}
