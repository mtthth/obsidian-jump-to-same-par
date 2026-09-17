import { EditorView } from "@codemirror/view";

/** Une ligne à l'écran, et le volet qui l'affiche, en pixels dans le repère de la fenêtre. */
interface Placement {
	top: number;
	paneTop: number;
	paneBottom: number;
}

// Hors de la zone rendue, CodeMirror estime la hauteur des lignes ; et le défilement peut buter en
// début ou en fin de document. Chaque passe mesure et corrige : quelques-unes suffisent à converger.
const MAX_PASSES = 6;

/** Fait défiler `target` pour amener la ligne de `targetPos` à la hauteur de celle de `sourcePos`. */
export async function alignLines(
	source: EditorView,
	sourcePos: number,
	target: EditorView,
	targetPos: number
): Promise<void> {
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const [from, to] = await Promise.all([measure(source, sourcePos), measure(target, targetPos)]);

		// Le début d'un long paragraphe peut être sorti du volet : on vise alors le haut du volet, plutôt
		// que d'envoyer hors de vue un équivalent peut-être plus court.
		const anchor = Math.max(from.top, from.paneTop);
		// Côte à côte, même hauteur d'écran ; l'un au-dessus de l'autre, même distance au haut du volet.
		const sideBySide = from.paneTop < to.paneBottom && to.paneTop < from.paneBottom;
		const wanted = sideBySide ? anchor : to.paneTop + (anchor - from.paneTop);

		const delta = to.top - wanted;
		if (Math.abs(delta) < 1) return;
		// L'autre texte en butée (début ou fin du document) : c'est ce texte-ci qui se déplace.
		if (Math.abs(scrollBy(target, delta)) < 1 && Math.abs(scrollBy(source, -delta)) < 1) return;
	}
}

/** Mesure une fois que CodeMirror a pris en compte le dernier défilement, hauteurs de lignes comprises. */
function measure(view: EditorView, pos: number): Promise<Placement> {
	const read = (v: EditorView): Placement => {
		const pane = v.scrollDOM.getBoundingClientRect();
		const line = v.lineBlockAt(Math.min(pos, v.state.doc.length));
		return { top: v.documentTop + line.top, paneTop: pane.top, paneBottom: pane.bottom };
	};
	return new Promise((resolve) => {
		// Une vue fermée entre-temps ne rappellerait jamais : on mesure alors directement.
		const fallback = window.setTimeout(() => resolve(read(view)), 250);
		view.requestMeasure({
			read,
			write: (placement) => {
				window.clearTimeout(fallback);
				resolve(placement);
			},
		});
	});
}

/** Fait défiler de `dy` pixels ; renvoie le déplacement réellement obtenu. */
function scrollBy(view: EditorView, dy: number): number {
	const scroller = view.scrollDOM;
	const before = scroller.scrollTop;
	// "instant" : sous un thème en scroll-behavior: smooth, scrollTop ne bougerait pas tout de suite.
	scroller.scrollTo({ top: before + dy, behavior: "instant" });
	return scroller.scrollTop - before;
}
