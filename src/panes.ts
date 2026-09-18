/** Un volet, en pixels dans le repère de la fenêtre. */
export interface PaneBounds {
	top: number;
	bottom: number;
}

/**
 * La hauteur d'écran où amener, dans le volet `to`, l'équivalent de ce qui se trouve à la hauteur `y` dans le
 * volet `from` : côte à côte, la même hauteur ; l'un au-dessus de l'autre, la même position relative dans le
 * volet. Toujours dans le volet `to`, une ligne au moins (`lineHeight`) restant visible : entre des volets de
 * hauteurs ou de positions différentes, l'équivalent sortirait sinon de la vue.
 */
export function counterpartY(y: number, from: PaneBounds, to: PaneBounds, lineHeight: number): number {
	const sideBySide = from.top < to.bottom && to.top < from.bottom;
	const height = from.bottom - from.top;
	const wanted = sideBySide || height <= 0 ? y : to.top + ((y - from.top) / height) * (to.bottom - to.top);
	return Math.max(to.top, Math.min(wanted, to.bottom - lineHeight));
}
