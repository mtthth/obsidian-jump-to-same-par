import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flashLines } from "./highlight";
import { alignmentQuality, alignUnits, extractUnits } from "./matching";

/**
 * Les lignes pleines qui entourent `line` : le paragraphe, au sens où `extractUnits` découpe le texte
 * — il ne retient que les lignes portant du texte, les vides séparant donc les paragraphes.
 */
function paragraphLines(doc: Text, line: number): { from: number; to: number } {
	let from = line;
	while (from > 1 && doc.line(from - 1).text.trim() !== "") from--;
	let to = line;
	while (to < doc.lines && doc.line(to + 1).text.trim() !== "") to++;
	return { from, to };
}

/** Repères du défilement simultané : débuts des lignes appariées dans les deux documents, dans l'ordre. */
export interface Anchors {
	positions: [number, number][];
	/** Voir `alignmentQuality`. */
	quality: number;
}

export function anchorsBetween(a: Text, b: Text): Anchors {
	const unitsA = extractUnits(a.toJSON());
	const unitsB = extractUnits(b.toJSON());
	const pairs = alignUnits(unitsA, unitsB);
	return {
		positions: pairs.map((pair): [number, number] => [
			a.line(unitsA[pair.source].line + 1).from,
			b.line(unitsB[pair.target].line + 1).from,
		]),
		quality: alignmentQuality(pairs, unitsA.length, unitsB.length),
	};
}

// Événements qui montrent que l'utilisateur agit sur un volet : c'est alors ce volet qui mène.
const INTENT_EVENTS = ["wheel", "pointerdown", "touchstart", "keydown"];
// Tant que le volet meneur défile, les défilements de l'autre ne sont que l'écho des nôtres (ou les
// corrections de hauteur de CodeMirror) : ils ne prennent pas la main.
const LEADER_HOLD_MS = 500;
// Après le dernier défilement, une passe de plus rattrape les hauteurs de lignes estimées hors écran.
const SETTLE_MS = 150;
// Pendant la frappe, les repères ne sont recalculés qu'à cet intervalle (et au moins dix fois la durée du
// dernier calcul, pour les très longs textes).
const RECOMPUTE_MIN_MS = 300;

/** Où caler l'autre volet, et la paire de repères alors alignée. */
interface Placement {
	scrollTop: number;
	/** Débuts des deux lignes alignées, dans l'ordre des vues de la session ; null sans aucun repère. */
	focus: readonly [number, number] | null;
}

/** Mesures d'un volet, en pixels. */
interface Pane {
	view: EditorView;
	top: number;
	bottom: number;
	height: number;
	scrollTop: number;
	scrollHeight: number;
	maxScroll: number;
	/** Distance du haut de la zone qui défile au début du document (titre intégré, propriétés…). */
	contentOffset: number;
}

function measurePane(view: EditorView): Pane {
	const scroller = view.scrollDOM;
	const rect = scroller.getBoundingClientRect();
	return {
		view,
		top: rect.top,
		bottom: rect.bottom,
		height: scroller.clientHeight,
		scrollTop: scroller.scrollTop,
		scrollHeight: scroller.scrollHeight,
		maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
		contentOffset: view.documentTop - rect.top + scroller.scrollTop,
	};
}

/**
 * Hauteur de la ligne de lecture, en fraction du volet : au milieu, sauf en début de document où elle part
 * du haut, et en fin de document où elle rejoint le bas, pour que les deux textes commencent et finissent
 * ensemble.
 */
function readingRatio(pane: Pane): number {
	if (pane.maxScroll <= 0) return 0;
	const edge = Math.min(pane.height, pane.maxScroll) / 2;
	if (pane.scrollTop < edge) return (0.5 * pane.scrollTop) / edge;
	const toEnd = pane.maxScroll - pane.scrollTop;
	if (toEnd < edge) return 1 - (0.5 * toEnd) / edge;
	return 0.5;
}

/**
 * Défilement simultané de deux éditeurs : le volet qu'on fait défiler mène, et l'autre garde en face, à la
 * hauteur de la ligne de lecture, le passage équivalent. Entre deux paragraphes appariés, la correspondance
 * est interpolée.
 */
export class ScrollSync {
	readonly views: readonly [EditorView, EditorView];
	private anchors: Anchors;
	private docs: [Text, Text];
	private recomputeAfter = 0;
	private leader: EditorView;
	private leaderActiveAt = 0;
	private ignoreUntil = 0;
	private settleTimer = 0;
	private stopped = false;
	/** Première ligne du paragraphe qui clignote dans chaque volet, pour ne le rejouer qu'au changement. */
	private readonly flashedParagraphs: [number | null, number | null] = [null, null];
	private readonly removeListeners: (() => void)[] = [];

	constructor(a: EditorView, b: EditorView, anchors: Anchors) {
		this.views = [a, b];
		this.anchors = anchors;
		this.docs = [a.state.doc, b.state.doc];
		this.leader = a;
	}

	/** Branche les écouteurs et cale tout de suite l'autre volet sur `leader`. */
	start(leader: EditorView) {
		for (const view of this.views) {
			// Sans capture : les défilements internes (bloc de code, tableau) ne remontent pas jusqu'ici.
			this.listen(view.scrollDOM, "scroll", false, () => this.onScroll(view));
			for (const type of INTENT_EVENTS) this.listen(view.scrollDOM, type, true, () => this.lead(view));
		}
		this.lead(leader);
		this.sync(true);
	}

	stop() {
		this.stopped = true;
		window.clearTimeout(this.settleTimer);
		for (const remove of this.removeListeners.splice(0)) remove();
		this.flashFocus(null);
	}

	involves(view: EditorView): boolean {
		return this.views.includes(view);
	}

	/** Laisse `action` faire défiler les deux volets sans que la synchronisation s'en mêle. */
	async suspend<T>(action: () => Promise<T>): Promise<T> {
		// Une passe de rattrapage encore en attente écrirait au milieu de l'action.
		window.clearTimeout(this.settleTimer);
		this.ignoreUntil = Infinity;
		try {
			return await action();
		} finally {
			// Les événements scroll des derniers défilements de l'action n'arrivent qu'à l'image suivante.
			this.ignoreUntil = Date.now() + 100;
		}
	}

	private listen(target: HTMLElement, type: string, capture: boolean, handler: () => void) {
		const options = { capture, passive: true };
		target.addEventListener(type, handler, options);
		this.removeListeners.push(() => target.removeEventListener(type, handler, options));
	}

	private lead(view: EditorView) {
		this.leader = view;
		this.leaderActiveAt = Date.now();
	}

	private onScroll(view: EditorView) {
		const now = Date.now();
		if (now < this.ignoreUntil) return;
		if (view !== this.leader && now - this.leaderActiveAt < LEADER_HOLD_MS) return;
		this.lead(view);
		this.sync(true);
	}

	/** Cale l'autre volet sur le meneur à la prochaine mesure de CodeMirror : une écriture par image au plus. */
	private sync(settle: boolean) {
		const leader = this.leader;
		const follower = leader === this.views[0] ? this.views[1] : this.views[0];
		leader.requestMeasure({
			key: this,
			// Une mesure déjà demandée peut tomber après l'arrêt ou pendant une suspension : elle n'écrit rien.
			read: () => (this.stopped || Date.now() < this.ignoreUntil ? null : this.followerPlacement(leader, follower)),
			write: (placement) => {
				if (!placement) return;
				if (Math.abs(placement.scrollTop - follower.scrollDOM.scrollTop) >= 1) {
					follower.scrollDOM.scrollTo({ top: placement.scrollTop, behavior: "instant" });
				}
				// Après la mesure : CodeMirror refuse qu'on modifie un éditeur pendant sa propre mise à jour.
				queueMicrotask(() => {
					if (!this.stopped) this.flashFocus(placement.focus);
				});
			},
		});
		if (settle) {
			window.clearTimeout(this.settleTimer);
			this.settleTimer = window.setTimeout(() => this.sync(false), SETTLE_MS);
		}
	}

	/**
	 * Fait clignoter, dans chaque volet, la ligne de la paire alignée, seulement quand elle change :
	 * sinon le clignotement repartirait à chaque image et vaudrait un surlignage permanent.
	 */
	private flashFocus(focus: readonly [number, number] | null) {
		this.views.forEach((view, k) => {
			const doc = view.state.doc;
			const line = focus ? doc.lineAt(Math.min(focus[k], doc.length)).number : null;
			// Suivre le paragraphe et non la ligne : sinon il se rallumerait à chaque ligne franchie.
			const paragraph = line === null ? null : paragraphLines(doc, line);
			const first = paragraph ? paragraph.from : null;
			if (first === this.flashedParagraphs[k]) return;
			this.flashedParagraphs[k] = first;
			// À l'arrêt (null), rien à effacer : le clignotement en cours s'éteint tout seul.
			if (paragraph) flashLines(view, paragraph.from, paragraph.to);
		});
	}

	/** Où caler `follower` pour garder en face, à la ligne de lecture de `leader`, le passage équivalent. */
	private followerPlacement(leader: EditorView, follower: EditorView): Placement | null {
		if (!leader.dom.isConnected || !follower.dom.isConnected) return null;
		const from = measurePane(leader);
		const to = measurePane(follower);
		// Un volet masqué (onglet en arrière-plan, mode lecture) n'a rien à mesurer.
		if (from.height === 0 || to.height === 0) return null;
		this.refreshAnchors();

		const offset = from.height * readingRatio(from);
		const { position, focus } = this.map(from, to, from.scrollTop + offset - from.contentOffset);
		// Côte à côte, même hauteur d'écran ; l'un au-dessus de l'autre, même distance au haut du volet.
		const sideBySide = from.top < to.bottom && to.top < from.bottom;
		const screenY = sideBySide ? Math.min(Math.max(from.top + offset, to.top), to.bottom) : to.top + offset;
		return {
			scrollTop: Math.min(Math.max(to.top + to.contentOffset + position - screenY, 0), to.maxScroll),
			focus: focus < 0 ? null : this.anchors.positions[focus],
		};
	}

	/**
	 * La position dans le document de `to` qui correspond à `y` dans celui de `from`, interpolée entre repères,
	 * et le repère le plus proche de `y` : la paire de paragraphes sur laquelle les deux textes sont alignés.
	 */
	private map(from: Pane, to: Pane, y: number): { position: number; focus: number } {
		const positions = this.anchors.positions;
		const fromSide = from.view === this.views[0] ? 0 : 1;
		const lineAt = (pane: Pane, side: number, k: number) =>
			pane.view.lineBlockAt(Math.min(positions[k][side], pane.view.state.doc.length));
		// Avant le premier repère, le haut de la zone qui défile ; après le dernier, son bas.
		const top = (pane: Pane, side: number, k: number): number => {
			if (k < 0) return -pane.contentOffset;
			if (k >= positions.length) return pane.scrollHeight - pane.contentOffset;
			return lineAt(pane, side, k).top;
		};

		let before = -1;
		let after = positions.length;
		while (after - before > 1) {
			const middle = (before + after) >> 1;
			if (top(from, fromSide, middle) <= y) before = middle;
			else after = middle;
		}
		const fromStart = top(from, fromSide, before);
		const fromEnd = top(from, fromSide, after);
		const toStart = top(to, 1 - fromSide, before);
		const toEnd = top(to, 1 - fromSide, after);
		const progress = fromEnd > fromStart ? Math.min(1, Math.max(0, (y - fromStart) / (fromEnd - fromStart))) : 0;

		// Le paragraphe apparié sous la ligne de lecture ; entre deux (ligne vide, paragraphe sans équivalent),
		// le plus proche.
		const beforeBottom = before >= 0 ? lineAt(from, fromSide, before).bottom : -Infinity;
		const nearerBefore = y < beforeBottom || after === positions.length || y - beforeBottom <= fromEnd - y;
		const focus = before >= 0 && nearerBefore ? before : after < positions.length ? after : -1;
		return { position: toStart + progress * (toEnd - toStart), focus };
	}

	/** Recalcule les repères quand l'un des textes a changé, sans le faire à chaque frappe. */
	private refreshAnchors() {
		const [a, b] = this.views;
		if (a.state.doc === this.docs[0] && b.state.doc === this.docs[1]) return;
		// Entre-temps, les anciens repères restent à peu près justes : ils ne se décalent que des lignes tapées.
		if (Date.now() < this.recomputeAfter) return;
		const started = Date.now();
		this.docs = [a.state.doc, b.state.doc];
		this.anchors = anchorsBetween(a.state.doc, b.state.doc);
		this.recomputeAfter = Date.now() + Math.max(RECOMPUTE_MIN_MS, 10 * (Date.now() - started));
	}
}
