/**
 * Différences entre deux versions d'un texte, paragraphe par paragraphe : ce qui a été modifié, ajouté ou
 * supprimé, et les mots qui changent à l'intérieur d'un paragraphe modifié.
 *
 * Ce module n'importe rien, pour pouvoir être testé directement sous Node : l'appariement des paragraphes
 * (matching.ts) lui est passé tout fait.
 */

/** Un intervalle de caractères dans une ligne. */
export interface Span {
	from: number;
	to: number;
}

export type DiffKind = "same" | "changed" | "added" | "removed";

export interface DiffRow {
	kind: DiffKind;
	/** Ligne (à partir de 0) dans l'ancienne et dans la nouvelle version ; -1 là où le paragraphe manque. */
	source: number;
	target: number;
	/** Mots retirés, puis mots ajoutés, d'un paragraphe modifié. */
	sourceWords: Span[];
	targetWords: Span[];
	/** Les deux lignes à amener face à face pour montrer cette différence. */
	anchor: readonly [number, number];
}

export interface Diff {
	/** Les paragraphes des deux versions, appariés ou non, dans l'ordre. */
	rows: DiffRow[];
	changed: number;
	added: number;
	removed: number;
}

export interface DiffInput {
	sourceLines: readonly string[];
	targetLines: readonly string[];
	/**
	 * Les commentaires de chaque ligne, `commentSpans` : ils ne comptent pas, ajouter une note de relecture ne
	 * modifie pas un paragraphe.
	 */
	sourceComments: readonly (readonly Span[])[];
	targetComments: readonly (readonly Span[])[];
	/** Lignes (à partir de 0) qui portent du texte, dans l'ordre : `extractUnits`. */
	sourceUnits: readonly number[];
	targetUnits: readonly number[];
	/** Paragraphes appariés, croissants des deux côtés, en indices dans les listes ci-dessus : `alignUnits`. */
	pairs: readonly { source: number; target: number }[];
}

// Au-delà, l'appariement mot à mot coûterait trop cher : le paragraphe est alors marqué sans le détail.
const MAX_WORD_CELLS = 200000;
// De même pour le rattrapage des paragraphes identiques qu'aucune paire ne couvre.
const MAX_GAP_CELLS = 20000;

/** Les différences entre les deux versions, dans l'ordre du texte. */
export function buildDiff(input: DiffInput): Diff {
	const rows: DiffRow[] = [];
	let source = 0;
	let target = 0;
	// Une paire fictive après la fin ferme le dernier intervalle.
	const end = { source: input.sourceUnits.length, target: input.targetUnits.length };
	for (const pair of [...input.pairs, end]) {
		fillGap(input, rows, source, pair.source, target, pair.target);
		if (pair === end) break;
		rows.push(pairedRow(input, pair.source, pair.target));
		source = pair.source + 1;
		target = pair.target + 1;
	}
	const count = (kind: DiffKind) => rows.filter((row) => row.kind === kind).length;
	return { rows, changed: count("changed"), added: count("added"), removed: count("removed") };
}

/** Deux paragraphes appariés : inchangés, ou modifiés avec le détail des mots. */
function pairedRow(input: DiffInput, source: number, target: number): DiffRow {
	const sourceLine = input.sourceUnits[source];
	const targetLine = input.targetUnits[target];
	const before = input.sourceLines[sourceLine];
	const after = input.targetLines[targetLine];
	const beforeComments = input.sourceComments[sourceLine];
	const afterComments = input.targetComments[targetLine];
	const anchor = [sourceLine, targetLine] as const;
	if (readable(before, beforeComments) === readable(after, afterComments)) {
		return { kind: "same", source: sourceLine, target: targetLine, sourceWords: [], targetWords: [], anchor };
	}
	const words = changedWords(before, beforeComments, after, afterComments);
	return {
		kind: "changed",
		source: sourceLine,
		target: targetLine,
		sourceWords: words.source,
		targetWords: words.target,
		anchor,
	};
}

/**
 * Les paragraphes qu'aucune paire ne couvre, entre deux appariements : supprimés d'un côté, ajoutés de
 * l'autre — sauf ceux qui se retrouvent identiques des deux côtés, rattrapés ici.
 */
function fillGap(
	input: DiffInput,
	rows: DiffRow[],
	sourceFrom: number,
	sourceTo: number,
	targetFrom: number,
	targetTo: number
) {
	const { sourceUnits, targetUnits } = input;
	// Où montrer, dans l'autre version, un paragraphe qui n'y est pas : au paragraphe apparié qui suit, à
	// défaut à celui qui précède.
	const facing = (units: readonly number[], index: number, start: number) =>
		index < units.length ? units[index] : start > 0 ? units[start - 1] : 0;
	let source = sourceFrom;
	let target = targetFrom;
	const end = { source: sourceTo, target: targetTo };
	for (const pair of [...identicalPairs(input, sourceFrom, sourceTo, targetFrom, targetTo), end]) {
		const facingTarget = facing(targetUnits, pair.target, targetFrom);
		const facingSource = facing(sourceUnits, pair.source, sourceFrom);
		for (; source < pair.source; source++) {
			rows.push({
				kind: "removed",
				source: sourceUnits[source],
				target: -1,
				sourceWords: [],
				targetWords: [],
				anchor: [sourceUnits[source], facingTarget],
			});
		}
		for (; target < pair.target; target++) {
			rows.push({
				kind: "added",
				source: -1,
				target: targetUnits[target],
				sourceWords: [],
				targetWords: [],
				anchor: [facingSource, targetUnits[target]],
			});
		}
		if (pair === end) break;
		rows.push(pairedRow(input, pair.source, pair.target));
		source = pair.source + 1;
		target = pair.target + 1;
	}
}

/**
 * Les paragraphes identiques mot pour mot que l'appariement a laissés de côté, recollés dans l'ordre (plus
 * longue sous-suite commune) : une réplique qui se répète ne compte ni pour un ajout ni pour une suppression.
 */
function identicalPairs(
	input: DiffInput,
	sourceFrom: number,
	sourceTo: number,
	targetFrom: number,
	targetTo: number
): { source: number; target: number }[] {
	const n = sourceTo - sourceFrom;
	const m = targetTo - targetFrom;
	if (n <= 0 || m <= 0 || n * m > MAX_GAP_CELLS) return [];
	const before = texts(input.sourceLines, input.sourceComments, input.sourceUnits, sourceFrom, n);
	const after = texts(input.targetLines, input.targetComments, input.targetUnits, targetFrom, m);
	return longestCommon(before, after).map(([source, target]) => ({
		source: sourceFrom + source,
		target: targetFrom + target,
	}));
}

function texts(
	lines: readonly string[],
	comments: readonly (readonly Span[])[],
	units: readonly number[],
	from: number,
	count: number
): string[] {
	return Array.from({ length: count }, (_, k) => readable(lines[units[from + k]], comments[units[from + k]]));
}

// Ce qui, après un commentaire, se colle au mot qui le précède : « la place %%nom ?%%, sous » se lit « la place,
// sous ».
const CLOSING = /[\s.,;:!?…)\]}»”’]/;

/** La ligne telle qu'elle se lit, sans ses commentaires `comments`. */
function readable(line: string, comments: readonly Span[]): string {
	let text = line;
	for (let k = comments.length - 1; k >= 0; k--) {
		let { from } = comments[k];
		const { to } = comments[k];
		// Suivi d'une espace, d'une ponctuation qui ferme ou de la fin de la ligne, un commentaire emporte les
		// espaces qui le précèdent ; devant un mot, il les laisse pour l'en séparer.
		if (to >= text.length || CLOSING.test(text[to])) {
			while (from > 0 && /[ \t]/.test(text[from - 1])) from--;
		}
		text = text.slice(0, from) + text.slice(to);
	}
	return text.trim();
}

/** La ligne dont les commentaires `comments` sont remplacés par des espaces : les mots y gardent leurs positions. */
function blanked(line: string, comments: readonly Span[]): string {
	let text = line;
	for (const { from, to } of comments) text = text.slice(0, from) + " ".repeat(to - from) + text.slice(to);
	return text;
}

/** Les mots retirés et les mots ajoutés d'un paragraphe à l'autre. */
function changedWords(
	before: string,
	beforeComments: readonly Span[],
	after: string,
	afterComments: readonly Span[]
): { source: Span[]; target: Span[] } {
	const source = tokenize(blanked(before, beforeComments));
	const target = tokenize(blanked(after, afterComments));
	if (source.words.length * target.words.length > MAX_WORD_CELLS) return { source: [], target: [] };
	const kept = longestCommon(source.words, target.words);
	const keptSource = new Set(kept.map(([index]) => index));
	const keptTarget = new Set(kept.map(([, index]) => index));
	return {
		source: spansOf(before, source, (index) => !keptSource.has(index)),
		target: spansOf(after, target, (index) => !keptTarget.has(index)),
	};
}

// Un mot (apostrophes et traits d'union compris), un nombre, une suite d'espaces, ou un signe isolé.
const TOKEN = /\p{L}[\p{L}\p{N}'’-]*|\p{N}+|\s+|[^\s]/gu;

function tokenize(text: string): { words: string[]; spans: Span[] } {
	const words: string[] = [];
	const spans: Span[] = [];
	TOKEN.lastIndex = 0;
	for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
		// Les suites d'espaces se valent, quelle que soit leur longueur : sinon celles qui remplacent un commentaire
		// désaligneraient les mots autour. Une espace insécable, elle, reste ce qu'elle est.
		words.push(/^[ \t]+$/.test(match[0]) ? " " : match[0]);
		spans.push({ from: match.index, to: match.index + match[0].length });
	}
	return { words, spans };
}

/**
 * La différence suivante (`step` valant 1) ou précédente, vue du côté `side` (0 pour l'ancienne version) depuis la
 * ligne `line` (à partir de 0) ; null s'il n'y en a plus dans ce sens. `shown` : la dernière différence montrée.
 */
export function adjacentChange(
	rows: readonly DiffRow[],
	side: 0 | 1,
	line: number,
	shown: DiffRow | null,
	step: 1 | -1
): DiffRow | null {
	const lineOf = (row: DiffRow) => row.anchor[side];
	// Dans l'ordre du volet d'où l'on part : un paragraphe supprimé et un ajouté qui se suivent d'un côté ne se
	// suivent pas forcément de l'autre.
	const changes = rows.filter((row) => row.kind !== "same").sort((x, y) => lineOf(x) - lineOf(y));
	// Plusieurs différences peuvent tenir sur la même ligne de ce côté-ci, par exemple des paragraphes ajoutés
	// là-bas : depuis la dernière montrée, on passe à sa voisine ; sinon, celles de la ligne du curseur viennent
	// d'abord, faute de quoi aucune ne serait jamais atteinte depuis cette ligne.
	const current = shown ? changes.indexOf(shown) : -1;
	const index =
		current >= 0 && lineOf(changes[current]) === line
			? current + step
			: step === 1
			? changes.findIndex((row) => lineOf(row) >= line)
			: lastIndex(changes, (row) => lineOf(row) <= line);
	return index >= 0 && index < changes.length ? changes[index] : null;
}

/** Le dernier élément qui convient, faute de `findLastIndex` en ES2018. */
function lastIndex<T>(items: readonly T[], matches: (item: T) => boolean): number {
	for (let k = items.length - 1; k >= 0; k--) {
		if (matches(items[k])) return k;
	}
	return -1;
}

/** Les couples d'indices de la plus longue sous-suite commune. */
function longestCommon(a: readonly string[], b: readonly string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const width = m + 1;
	const lengths = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lengths[i * width + j] =
				a[i] === b[j]
					? lengths[(i + 1) * width + j + 1] + 1
					: Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
		}
	}
	const common: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) common.push([i++, j++]);
		else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
		else j++;
	}
	return common;
}

/**
 * Les intervalles à marquer dans la ligne `line` : deux mots changés que seuls des espaces y séparent n'en font
 * qu'un — un commentaire entre eux les garde distincts, pour qu'aucune marque ne le couvre —, et une marque ne
 * porte jamais sur de seuls espaces, qui ne se verraient pas.
 */
function spansOf(
	line: string,
	tokens: { words: readonly string[]; spans: readonly Span[] },
	changed: (index: number) => boolean
): Span[] {
	const marks: Span[] = [];
	tokens.spans.forEach((span, index) => {
		if (!changed(index) || /^\s/.test(tokens.words[index])) return;
		const last = marks[marks.length - 1];
		if (last && line.slice(last.to, span.from).trim() === "") last.to = span.to;
		else marks.push({ from: span.from, to: span.to });
	});
	return marks;
}
