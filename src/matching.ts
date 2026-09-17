/**
 * Appariement d'un paragraphe avec son équivalent dans une autre version du même texte.
 *
 * L'unité est la ligne non vide : dans les notes Obsidian, un paragraphe tient le plus souvent sur une
 * seule ligne, et beaucoup ne sont séparés que par un simple retour à la ligne, qu'un découpage sur
 * les lignes vides fusionnerait.
 *
 * Ce module n'importe ni Obsidian ni CodeMirror, pour pouvoir être testé directement sous Node.
 */

export interface TextUnit {
	/** Index de la ligne dans le document, à partir de 0. */
	line: number;
	/** Trigrammes de caractères du texte normalisé, avec leur nombre d'occurrences. */
	grams: Map<string, number>;
}

export interface ParagraphMatch {
	/** Unités appariées, en indices inclusifs dans les listes d'unités source et cible. */
	sourceFrom: number;
	sourceTo: number;
	targetFrom: number;
	targetTo: number;
	/** Score global : contenu, voisins et position combinés. */
	score: number;
}

/**
 * En dessous, l'autre texte n'a vraisemblablement rien à voir avec celui-ci : mieux vaut ne pas défiler.
 * Sur les textes de test, une prose sans rapport plafonne vers 0,17 et une version aux lignes coupées
 * autrement descend vers 0,24.
 */
export const MIN_SCORE = 0.2;

// Le contenu domine. Les voisins départagent les lignes courtes ou répétées (« — Oui. », une date) et
// situent un paragraphe supprimé d'une version à l'autre ; la position relative ne fait que trancher
// les derniers ex æquo.
const CONTENT_WEIGHT = 0.6;
const NEIGHBOUR_WEIGHT = 0.2;
const POSITION_WEIGHT = 0.1;
// Deux débuts (ou deux fins) de document se correspondent un peu, sans valoir un voisin identique : sinon
// deux textes courts sans rapport dépasseraient MIN_SCORE par leurs seules extrémités.
const EDGE_NEIGHBOUR = 0.5;
// Un paragraphe coupé en deux (ou deux paragraphes fusionnés) s'apparie à deux unités à la fois ; cette
// petite pénalité garde l'appariement simple quand il vaut autant.
const SPAN_PENALTY = 0.03;

export function normalize(text: string): string {
	return (
		text
			// Commentaires Obsidian : notes de relecture, marqueurs de marge…
			.replace(/%%.*?%%/g, " ")
			// Sans accents ni casse : une relecture corrige souvent « a » en « à ».
			.normalize("NFD")
			.replace(/\p{M}/gu, "")
			.toLowerCase()
			// Ponctuation, typographie (« », ’, espaces insécables) et syntaxe markdown.
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim()
	);
}

/** Les lignes qui portent du texte, frontmatter exclu. */
export function extractUnits(lines: readonly string[]): TextUnit[] {
	const units: TextUnit[] = [];
	for (let line = frontmatterEnd(lines); line < lines.length; line++) {
		const text = normalize(lines[line]);
		if (text) units.push({ line, grams: trigrams(text) });
	}
	return units;
}

/** Première ligne après le frontmatter, que l'aperçu en direct masque derrière les propriétés. */
function frontmatterEnd(lines: readonly string[]): number {
	if (lines.length === 0 || !/^---\s*$/.test(lines[0])) return 0;
	for (let i = 1; i < lines.length; i++) {
		if (/^(?:---|\.\.\.)\s*$/.test(lines[i])) return i + 1;
	}
	return 0;
}

// Des trigrammes de caractères plutôt que des mots : une coquille corrigée ou un mot accordé change
// quelques trigrammes, alors qu'un mot entier ne se retrouverait plus d'une version à l'autre.
function trigrams(text: string): Map<string, number> {
	const padded = ` ${text} `;
	const grams = new Map<string, number>();
	for (let i = 0; i + 3 <= padded.length; i++) {
		const gram = padded.slice(i, i + 3);
		grams.set(gram, (grams.get(gram) ?? 0) + 1);
	}
	return grams;
}

/**
 * L'unité de la ligne `line` ou, pour une ligne sans texte, la plus proche (celle qui suit à distance
 * égale). -1 s'il n'y a aucune unité.
 */
export function unitIndexAt(units: readonly TextUnit[], line: number): number {
	if (units.length === 0) return -1;
	let lo = 0;
	let hi = units.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (units[mid].line < line) lo = mid + 1;
		else hi = mid;
	}
	if (lo === units.length) return lo - 1;
	if (lo === 0 || units[lo].line === line) return lo;
	return units[lo].line - line <= line - units[lo - 1].line ? lo : lo - 1;
}

/**
 * L'équivalent dans `target` de l'unité `index` de `source`, ou null si `target` est vide.
 *
 * Un paragraphe coupé en deux, ou fusionné avec son voisin, d'une version à l'autre s'apparie à deux
 * unités consécutives : c'est alors la première des deux qu'il faut aligner.
 */
export function findEquivalent(
	source: readonly TextUnit[],
	index: number,
	target: readonly TextUnit[]
): ParagraphMatch | null {
	const n = source.length;
	const m = target.length;
	if (index < 0 || index >= n || m === 0) return null;

	const weights = gramWeights(source, target);

	// Seules servent l'unité source, celle avec laquelle elle peut former une paire, et leurs voisines.
	const first = Math.max(0, index - 2);
	const last = Math.min(n - 1, index + 2);
	const products: Float64Array[] = [];
	const sourceNorms: number[] = [];
	const sourceNext: number[] = [];
	for (let k = first; k <= last; k++) {
		const grams = source[k].grams;
		products.push(Float64Array.from(target, (unit) => dot(grams, unit.grams, weights)));
		sourceNorms.push(dot(grams, grams, weights));
		sourceNext.push(k + 1 < n ? dot(grams, source[k + 1].grams, weights) : 0);
	}
	const targetNorms = target.map((unit) => dot(unit.grams, unit.grams, weights));
	const targetNext = target.map((unit, j) => (j + 1 < m ? dot(unit.grams, target[j + 1].grams, weights) : 0));

	// Norme au carré d'une ou deux unités consécutives mises bout à bout : |a + b|² = |a|² + |b|² + 2⟨a, b⟩.
	const sourceSpanNorm = (a: number, b: number) =>
		a === b
			? sourceNorms[a - first]
			: sourceNorms[a - first] + sourceNorms[b - first] + 2 * sourceNext[a - first];
	const targetSpanNorm = (c: number, d: number) =>
		c === d ? targetNorms[c] : targetNorms[c] + targetNorms[d] + 2 * targetNext[c];

	// Cosinus entre une ou deux unités source et une ou deux unités cible (jamais deux contre deux).
	const similarity = (a: number, b: number, c: number, d: number): number => {
		let shared = 0;
		for (let k = a; k <= b; k++) {
			for (let j = c; j <= d; j++) shared += products[k - first][j];
		}
		let cosine = shared / Math.sqrt(sourceSpanNorm(a, b) * targetSpanNorm(c, d));
		// Deux unités ne valent une seule que si chacune s'y retrouve : sinon une ligne sans rapport ferait
		// paire avec sa voisine, qui porterait à elle seule toute la ressemblance.
		if (b > a) {
			const row = (k: number) => products[k - first][c] / sourceNorms[k - first];
			cosine = Math.min(cosine, row(a), row(b));
		}
		if (d > c) {
			const column = (j: number) => products[a - first][j] / targetNorms[j];
			cosine = Math.min(cosine, column(c), column(d));
		}
		return cosine;
	};

	const neighbour = (k: number, j: number): number => {
		const sourceEdge = k < 0 || k >= n;
		const targetEdge = j < 0 || j >= m;
		if (sourceEdge || targetEdge) return sourceEdge && targetEdge ? EDGE_NEIGHBOUR : 0;
		return similarity(k, k, j, j);
	};

	const sourceSpans = [
		[index, index],
		[index - 1, index],
		[index, index + 1],
	].filter(([a, b]) => a >= 0 && b < n);

	let best: ParagraphMatch | null = null;
	for (const [a, b] of sourceSpans) {
		for (let c = 0; c < m; c++) {
			// Pas de paire contre paire : elle ne dirait rien de plus que deux appariements simples.
			const lastTarget = a === b ? Math.min(c + 1, m - 1) : c;
			for (let d = c; d <= lastTarget; d++) {
				const score =
					CONTENT_WEIGHT * similarity(a, b, c, d) +
					NEIGHBOUR_WEIGHT * (neighbour(a - 1, c - 1) + neighbour(b + 1, d + 1)) -
					POSITION_WEIGHT * Math.abs((a + 0.5) / n - (c + 0.5) / m) -
					SPAN_PENALTY * (b - a + d - c);
				if (!best || score > best.score) {
					best = { sourceFrom: a, sourceTo: b, targetFrom: c, targetTo: d, score };
				}
			}
		}
	}
	return best;
}

/** Couple d'unités appariées par `alignUnits`. */
export interface UnitPair {
	source: number;
	target: number;
	/** Cosinus entre les deux unités. */
	similarity: number;
}

/**
 * En dessous (voir `alignmentQuality`), les deux textes se ressemblent trop peu pour défiler ensemble.
 * Sur les textes de test, une version relue atteint 0,84 et une prose sans rapport n'a aucun repère (0) :
 * le seuil reste bas pour ne pas refuser une relecture plus lourde.
 */
export const MIN_ALIGNMENT_QUALITY = 0.15;

// Pour chaque unité source, seuls quelques candidats (les plus ressemblants, position relative comprise)
// peuvent servir de repère, et seulement s'ils se ressemblent assez.
const PAIR_CANDIDATES = 4;
const PAIR_MIN_SIMILARITY = 0.4;
// Retranché à chaque repère de la chaîne : un repère franc vaut mieux que plusieurs repères médiocres qui le
// croiseraient.
const PAIR_FLOOR = 0.3;
// La présélection des candidats parcourt les trigrammes de chaque unité du plus rare au plus courant, et
// s'arrête après ce nombre d'occurrences dans la cible (au moins deux par unité cible) : les trigrammes
// courants (« de », « les ») coûteraient cher sans rien distinguer.
const PRESELECTION_BUDGET = 500;

/**
 * Appariement des deux textes entiers : des couples d'unités qui se ressemblent, dans le même ordre des deux
 * côtés, pour que le défilement simultané ne revienne jamais en arrière. Les unités sans équivalent net (un
 * paragraphe ajouté, une réplique trop courante) restent hors de la chaîne.
 */
export function alignUnits(source: readonly TextUnit[], target: readonly TextUnit[]): UnitPair[] {
	const n = source.length;
	const m = target.length;
	if (n === 0 || m === 0) return [];

	const weights = gramWeights(source, target);
	const targetNorms = target.map((unit) => dot(unit.grams, unit.grams, weights));

	// Index inversé de la cible : pour chaque trigramme, les unités qui le contiennent, avec le nombre
	// d'occurrences (à plat : unité, nombre, unité, nombre…).
	const index = new Map<string, number[]>();
	target.forEach((unit, j) => {
		for (const [gram, count] of unit.grams) {
			let postings = index.get(gram);
			if (!postings) index.set(gram, (postings = []));
			postings.push(j, count);
		}
	});
	const budget = Math.max(PRESELECTION_BUDGET, 2 * m);

	const shared = new Float64Array(m);
	const touched: number[] = [];
	const pairs: UnitPair[] = [];
	source.forEach((unit, i) => {
		const lists: { postings: number[]; weight: number }[] = [];
		for (const [gram, count] of unit.grams) {
			const postings = index.get(gram);
			if (postings) lists.push({ postings, weight: count * (weights.get(gram) ?? 0) });
		}
		lists.sort((x, y) => x.postings.length - y.postings.length);
		let spent = 0;
		for (const { postings, weight } of lists) {
			if (spent > 0 && spent + postings.length / 2 > budget) break;
			spent += postings.length / 2;
			for (let p = 0; p < postings.length; p += 2) {
				if (shared[postings[p]] === 0) touched.push(postings[p]);
				shared[postings[p]] += weight * postings[p + 1];
			}
		}

		const norm = dot(unit.grams, unit.grams, weights);
		const best: { target: number; score: number }[] = [];
		for (const j of touched) {
			const score =
				shared[j] / Math.sqrt(norm * targetNorms[j]) -
				POSITION_WEIGHT * Math.abs((i + 0.5) / n - (j + 0.5) / m);
			shared[j] = 0;
			if (best.length < PAIR_CANDIDATES || score > best[best.length - 1].score) {
				best.push({ target: j, score });
				best.sort((x, y) => y.score - x.score);
				if (best.length > PAIR_CANDIDATES) best.pop();
			}
		}
		touched.length = 0;

		// La présélection a ignoré les trigrammes courants : la ressemblance retenue est recalculée en entier.
		for (const { target: j } of best) {
			const similarity = dot(unit.grams, target[j].grams, weights) / Math.sqrt(norm * targetNorms[j]);
			if (similarity >= PAIR_MIN_SIMILARITY) pairs.push({ source: i, target: j, similarity });
		}
	});
	return heaviestChain(pairs, m);
}

/** Part des unités du texte le plus court qui ont un équivalent, pondérée par la ressemblance (0 à 1). */
export function alignmentQuality(pairs: readonly UnitPair[], sourceCount: number, targetCount: number): number {
	if (sourceCount === 0 || targetCount === 0) return 0;
	return pairs.reduce((sum, pair) => sum + pair.similarity, 0) / Math.min(sourceCount, targetCount);
}

/** La chaîne de couples strictement croissants des deux côtés dont le poids total est le plus grand. */
function heaviestChain(pairs: UnitPair[], targetCount: number): UnitPair[] {
	pairs.sort((x, y) => x.source - y.source || x.target - y.target);
	const total = new Float64Array(pairs.length);
	const previous = new Int32Array(pairs.length);
	// Arbre de Fenwick indexé par unité cible (à partir de 1) : la plus lourde chaîne qui finit avant elle.
	const treeTotal = new Float64Array(targetCount + 1);
	const treePair = new Int32Array(targetCount + 1).fill(-1);

	for (let start = 0; start < pairs.length; ) {
		let end = start;
		while (end < pairs.length && pairs[end].source === pairs[start].source) end++;
		// Les couples d'une même unité source lisent tous l'arbre avant qu'aucun n'y soit inscrit : la chaîne
		// n'en retient jamais deux.
		for (let p = start; p < end; p++) {
			let best = 0;
			let bestPair = -1;
			for (let k = pairs[p].target; k > 0; k -= k & -k) {
				if (treeTotal[k] > best) {
					best = treeTotal[k];
					bestPair = treePair[k];
				}
			}
			total[p] = best + pairs[p].similarity - PAIR_FLOOR;
			previous[p] = bestPair;
		}
		for (let p = start; p < end; p++) {
			for (let k = pairs[p].target + 1; k <= targetCount; k += k & -k) {
				if (total[p] > treeTotal[k]) {
					treeTotal[k] = total[p];
					treePair[k] = p;
				}
			}
		}
		start = end;
	}

	let last = -1;
	for (let p = 0; p < pairs.length; p++) {
		if (last < 0 || total[p] > total[last]) last = p;
	}
	const chain: UnitPair[] = [];
	for (let p = last; p >= 0; p = previous[p]) chain.push(pairs[p]);
	return chain.reverse();
}

// Poids idf² de chaque trigramme sur l'ensemble des deux textes : les trigrammes que partagent presque
// toutes les lignes (« de », « es ») ne doivent pas faire se ressembler deux paragraphes sans rapport.
function gramWeights(...texts: (readonly TextUnit[])[]): Map<string, number> {
	const counts = new Map<string, number>();
	let total = 0;
	for (const units of texts) {
		for (const unit of units) {
			total++;
			for (const gram of unit.grams.keys()) counts.set(gram, (counts.get(gram) ?? 0) + 1);
		}
	}
	const weights = new Map<string, number>();
	for (const [gram, count] of counts) {
		const idf = Math.log(1 + total / count);
		weights.set(gram, idf * idf);
	}
	return weights;
}

function dot(a: Map<string, number>, b: Map<string, number>, weights: Map<string, number>): number {
	if (a.size > b.size) [a, b] = [b, a];
	let sum = 0;
	for (const [gram, count] of a) {
		const other = b.get(gram);
		if (other !== undefined) sum += count * other * (weights.get(gram) ?? 0);
	}
	return sum;
}
