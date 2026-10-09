import { test } from "node:test";
import assert from "node:assert/strict";
import {
	alignmentQuality,
	alignUnits,
	anchorParagraph,
	commentSpans,
	extractUnits,
	findEquivalent,
	MIN_ALIGNMENT_QUALITY,
	MIN_SCORE,
	normalize,
	unitIndexAt,
} from "../src/matching.ts";
import { FIRST, OTHER_PROSE, PROOFREAD, UNRELATED, wrap } from "./fixtures.mjs";

/** Index de la ligne qui commence par `start` (la n-ième si elle se répète). */
function lineOf(text, start, occurrence = 0) {
	const lines = text.split("\n");
	const found = lines.map((line, i) => (line.startsWith(start) ? i : -1)).filter((i) => i >= 0);
	assert.ok(found.length > occurrence, `ligne introuvable : ${start} (#${occurrence})`);
	return found[occurrence];
}

/** Aligne la ligne `line` de `sourceText` : renvoie l'appariement en numéros de ligne. */
function align(sourceText, line, targetText) {
	const source = extractUnits(sourceText.split("\n"));
	const target = extractUnits(targetText.split("\n"));
	const match = findEquivalent(source, unitIndexAt(source, line), target);
	assert.ok(match, "aucun appariement");
	return {
		sourceLine: source[match.sourceFrom].line,
		targetLine: target[match.targetFrom].line,
		targetLastLine: target[match.targetTo].line,
		score: match.score,
	};
}

test("normalize ignore casse, accents, ponctuation, typographie et commentaires", () => {
	assert.equal(normalize("%%mn rouge%% « Là-bas », dit‑il !"), "la bas dit il");
	assert.equal(normalize("**Déjà** vu ?"), "deja vu");
	assert.equal(normalize("---"), "");
});

test("extractUnits saute le frontmatter et les lignes sans texte", () => {
	const units = extractUnits(["---", "titre: x", "---", "", "# Titre", "---", "Texte", "```"]);
	assert.deepEqual(
		units.map((u) => u.line),
		[4, 6]
	);
});

test("extractUnits ignore les commentaires sur plusieurs lignes, pas les %% du code", () => {
	const lines = [
		"Premier paragraphe.",
		"%%",
		"à reprendre : trop long",
		"%%",
		"Deuxième %%note%% paragraphe.",
		"Troisième %% début d'une note",
		"qui continue",
		"et finit %% quatrième.",
		"```",
		'printf("100 %%");',
		"```",
		"Le code `%%` ne commente rien.",
		"Dernier paragraphe.",
	];
	const units = extractUnits(lines);
	assert.deepEqual(
		units.map((u) => u.line),
		[0, 4, 5, 7, 9, 11, 12]
	);
	const gramsOf = (text) => extractUnits([text])[0].grams;
	assert.deepEqual(units[2].grams, gramsOf("Troisième"));
	assert.deepEqual(units[3].grams, gramsOf("quatrième."));
});

test("un bloc de code n'est refermé que par une clôture comme la sienne", () => {
	// Un ~~~ dans un bloc ```, un ``` dans un bloc ```` : du code, qui ne referme rien. Sans quoi la suite du texte
	// passerait pour du code, et ses commentaires sur plusieurs lignes pour du texte.
	const tail = ["Paragraphe.", "%%", "note de relecture sur plusieurs lignes", "%%", "Suite."];
	for (const block of [
		["```", "~~~", "```"],
		["````", "```", "````"],
		["~~~", "```", "~~~~"],
		["```js", "code", "```"],
	]) {
		const units = extractUnits([...block, ...tail]).map((u) => u.line);
		assert.ok(!units.includes(block.length + 2), `${block.join(" ")} : la note est prise pour du texte`);
		assert.ok(units.includes(block.length) && units.includes(block.length + 4), block.join(" "));
	}
	// Une clôture suivie d'autre chose ne referme pas le bloc : la suite reste du code, où %% ne commente rien.
	const lines = ["```", "```js", "%%", "pas un commentaire", "%%"];
	assert.ok(extractUnits(lines).some((u) => u.line === 3));
	// Du code en ligne en début de ligne n'ouvre aucun bloc : un accent grave suit ``` sur la ligne.
	const inline = ["```grep``` cherche un motif.", "```sed``` le remplace.", "", ...tail];
	assert.ok(!extractUnits(inline).some((u) => u.line === 5), "la note est prise pour du texte");
});

test("commentSpans situe les commentaires, délimiteurs compris", () => {
	const lines = [
		"---",
		"taux: 100%%",
		"---",
		"Avant %%note%% après.",
		"Début %% d'une note",
		"qui continue",
		"et finit %% ici.",
		"Le code `%%` reste, `a %% b` aussi.",
		"```",
		'printf("%% %%");',
		"```",
	];
	const spans = commentSpans(lines);
	assert.deepEqual(
		spans.map((line, k) => line.map(({ from, to }) => lines[k].slice(from, to))),
		[[], [], [], ["%%note%%"], ["%% d'une note"], ["qui continue"], ["et finit %%"], [], [], [], []]
	);
});

test("anchorParagraph : le paragraphe entier, sauf dans un texte sans lignes vides", () => {
	const at = (text, line, previous, next) => {
		const lines = text.split("\n");
		return anchorParagraph((n) => lines[n], lines.length, line, previous, next);
	};
	// Des paragraphes séparés par un simple retour à la ligne : la seule ligne du repère, et non tout le texte.
	const proofread = lineOf(PROOFREAD, "Elle sortit sur la place");
	assert.deepEqual(at(PROOFREAD, proofread, proofread - 1, proofread + 1), { from: proofread, to: proofread });
	// De même pour des répliques qui se suivent.
	const yes = lineOf(FIRST, "— Oui.");
	assert.deepEqual(at(FIRST, yes, yes - 1, yes + 1), { from: yes, to: yes });
	// Des lignes coupées : tout le paragraphe d'où elles viennent, qu'il ne porte que ce repère…
	const { text, origin } = wrap(FIRST, 60);
	const first = origin.indexOf(lineOf(FIRST, "Le train arriva"));
	const last = origin.lastIndexOf(lineOf(FIRST, "Le train arriva"));
	assert.ok(last > first + 1, "le paragraphe doit tenir sur plusieurs lignes");
	assert.deepEqual(at(text, first + 1, first - 2, last + 2), { from: first, to: last });
	// … ou que ses autres lignes en soient aussi, l'autre version étant coupée de même.
	assert.deepEqual(at(text, first + 1, first, first + 2), { from: first, to: last });
	// Le frontmatter collé au premier paragraphe n'en fait pas partie, même s'il contient une ligne vide.
	const title = lineOf(FIRST, "# Chapitre 3");
	assert.deepEqual(at(FIRST, title, -1, lineOf(FIRST, "Le train arriva")), { from: title, to: title });
	assert.deepEqual(at("---\ntitre: x\n---\nUn.\nDeux.", 3, -1, 5), { from: 3, to: 4 });
	assert.deepEqual(at("---\ntitre: x\n\ntags: y\n---\nUn.\nDeux.\n\nSuite.", 5, -1, 8), { from: 5, to: 6 });
});

test("unitIndexAt prend la ligne visée, sinon la plus proche", () => {
	const units = extractUnits(["a", "", "", "b", "", "c"]);
	assert.equal(unitIndexAt(units, 0), 0);
	assert.equal(unitIndexAt(units, 1), 0);
	assert.equal(unitIndexAt(units, 2), 1);
	assert.equal(unitIndexAt(units, 4), 2);
	assert.equal(unitIndexAt(units, 99), 2);
	assert.equal(unitIndexAt([], 0), -1);
});

test("un texte identique s'apparie ligne à ligne, répliques répétées comprises", () => {
	const units = extractUnits(FIRST.split("\n"));
	for (let i = 0; i < units.length; i++) {
		const match = findEquivalent(units, i, units);
		assert.equal(match.targetFrom, i, `unité ${i}`);
		assert.equal(match.sourceFrom, i, `unité ${i}`);
	}
});

test("chaque paragraphe retrouve son équivalent dans la version relue", () => {
	const cases = [
		["# Chapitre 3", 0, "# Chapitre 3", 0],
		["Le train arriva", 0, "Le train arriva", 0],
		["— Tu es sûre", 0, "— Vous êtes sûre", 0],
		["— Oui.", 0, "— Oui.", 0],
		["— Alors il viendra.", 0, "— Alors, il viendra.", 0],
		["Elle sortit sur la place", 0, "Elle sortit sur la place", 0],
		["Elle s'assit en terrasse", 0, "Elle s'assit en terrasse", 0],
		["— Vous attendez", 0, "— Vous attendez", 0],
		["— Oui.", 1, "— Oui.", 1],
		["La voiture de Paul", 0, "La voiture de Paul", 0],
		["— Maman t'attend", 0, "— Maman t'attend", 0],
		["— Oui.", 2, "— Oui.", 2],
		["Clara resta", 0, "Clara resta", 0],
	];
	for (const [from, fromOccurrence, to, toOccurrence] of cases) {
		const result = align(FIRST, lineOf(FIRST, from, fromOccurrence), PROOFREAD);
		assert.equal(result.targetLine, lineOf(PROOFREAD, to, toOccurrence), `${from} (#${fromOccurrence})`);
		assert.ok(result.score >= MIN_SCORE, `${from} : score ${result.score}`);
	}
});

test("un paragraphe coupé en deux s'aligne sur sa première moitié", () => {
	const result = align(FIRST, lineOf(FIRST, "Il n'était pas là."), PROOFREAD);
	assert.equal(result.targetLine, lineOf(PROOFREAD, "Il n'était pas là."));
	assert.equal(result.targetLastLine, lineOf(PROOFREAD, "Elle attendit dix minutes"));
});

test("les deux moitiés d'un paragraphe coupé retrouvent le paragraphe d'origine", () => {
	for (const half of ["Il n'était pas là.", "Elle attendit dix minutes"]) {
		const result = align(PROOFREAD, lineOf(PROOFREAD, half), FIRST);
		assert.equal(result.targetLine, lineOf(FIRST, "Il n'était pas là."), half);
	}
});

test("deux paragraphes fusionnés retrouvent tous deux le paragraphe fusionné", () => {
	for (const part of ["Ils s'embrassèrent", "Sur la route du moulin"]) {
		const result = align(FIRST, lineOf(FIRST, part), PROOFREAD);
		assert.equal(result.targetLine, lineOf(PROOFREAD, "Ils s'embrassèrent"), part);
	}
	const back = align(PROOFREAD, lineOf(PROOFREAD, "Ils s'embrassèrent"), FIRST);
	assert.equal(back.targetLine, lineOf(FIRST, "Ils s'embrassèrent"));
});

test("un paragraphe supprimé s'aligne à l'endroit où il se trouvait", () => {
	const result = align(FIRST, lineOf(FIRST, "La maison n'avait pas changé"), PROOFREAD);
	assert.ok(result.score >= MIN_SCORE, `score ${result.score}`);
	assert.ok(result.targetLine >= lineOf(PROOFREAD, "Ils s'embrassèrent"), `ligne ${result.targetLine}`);
	assert.ok(result.targetLine <= lineOf(PROOFREAD, "— Maman t'attend"), `ligne ${result.targetLine}`);
});

test("un paragraphe ajouté s'aligne à l'endroit où il s'insère", () => {
	const result = align(PROOFREAD, lineOf(PROOFREAD, "Au dernier virage"), FIRST);
	assert.ok(result.score >= MIN_SCORE, `score ${result.score}`);
	assert.ok(result.targetLine >= lineOf(FIRST, "Sur la route du moulin"), `ligne ${result.targetLine}`);
	assert.ok(result.targetLine <= lineOf(FIRST, "— Maman t'attend"), `ligne ${result.targetLine}`);
});

test("une version aux lignes coupées à 60 caractères retrouve ses paragraphes", () => {
	// Chaque ligne longue devient plusieurs lignes courtes ; `origin` garde la ligne d'où elles viennent.
	const { text: wrappedText, origin } = wrap(FIRST, 60);
	const wrapped = wrappedText.split("\n");

	const paragraph = (start) => lineOf(FIRST, start);
	for (const [start, equivalent] of [
		["Le train arriva", "Le train arriva"],
		["Elle sortit sur la place", "Elle sortit sur la place"],
		["La voiture de Paul", "La voiture de Paul"],
		["Clara resta", "Clara resta"],
	]) {
		// Chaque morceau du paragraphe coupé retrouve la ligne entière…
		wrapped.forEach((_, line) => {
			if (origin[line] !== paragraph(start)) return;
			const result = align(wrappedText, line, PROOFREAD);
			assert.equal(result.targetLine, lineOf(PROOFREAD, equivalent), `${start}, morceau ligne ${line}`);
		});
		// … et la ligne entière retombe dans le paragraphe coupé.
		const back = align(PROOFREAD, lineOf(PROOFREAD, equivalent), wrappedText);
		assert.equal(origin[back.targetLine], paragraph(start), start);
		assert.ok(back.score >= MIN_SCORE, `${start} : score ${back.score}`);
	}
});

test("un texte sans rapport reste sous le score minimal, dans les deux sens", () => {
	for (const [a, b] of [
		[FIRST, UNRELATED],
		[UNRELATED, FIRST],
		[FIRST, OTHER_PROSE],
		[OTHER_PROSE, FIRST],
		[PROOFREAD, OTHER_PROSE],
	]) {
		const source = extractUnits(a.split("\n"));
		const target = extractUnits(b.split("\n"));
		source.forEach((unit, i) => {
			const { score } = findEquivalent(source, i, target);
			assert.ok(score < MIN_SCORE, `${a.split("\n")[unit.line].slice(0, 40)} : score ${score}`);
		});
	}
});

test("reste rapide sur un long texte", () => {
	const repeat = (text, times) => Array.from({ length: times }, (_, i) => text.replace("Chapitre 3", `Chapitre ${i}`)).join("\n");
	const source = extractUnits(repeat(FIRST, 150).split("\n"));
	const target = extractUnits(repeat(PROOFREAD, 150).split("\n"));
	const started = performance.now();
	const match = findEquivalent(source, Math.floor(source.length / 2), target);
	const elapsed = performance.now() - started;
	assert.ok(match);
	assert.ok(elapsed < 1000, `${Math.round(elapsed)} ms pour ${source.length} × ${target.length} unités`);
});

/** Chapitres numérotés : le même texte répété `times` fois, en un seul document. */
function repeatChapters(text, times) {
	return Array.from({ length: times }, (_, i) => text.replace("Chapitre 3", `Chapitre ${i}`)).join("\n");
}

/** Appariement global, en numéros de ligne : source → cible. */
function alignAll(sourceText, targetText) {
	const source = extractUnits(sourceText.split("\n"));
	const target = extractUnits(targetText.split("\n"));
	const pairs = alignUnits(source, target);
	for (let k = 1; k < pairs.length; k++) {
		assert.ok(pairs[k].source > pairs[k - 1].source, `source non croissante en ${k}`);
		assert.ok(pairs[k].target > pairs[k - 1].target, `cible non croissante en ${k}`);
	}
	return {
		lines: new Map(pairs.map((pair) => [source[pair.source].line, target[pair.target].line])),
		quality: alignmentQuality(pairs, source.length, target.length),
	};
}

test("alignUnits apparie un texte identique ligne à ligne", () => {
	const { lines, quality } = alignAll(FIRST, FIRST);
	assert.equal(quality, 1);
	for (const [source, target] of lines) assert.equal(target, source);
});

test("alignUnits retrouve les paragraphes relus, dans l'ordre", () => {
	const { lines, quality } = alignAll(FIRST, PROOFREAD);
	assert.ok(quality >= MIN_ALIGNMENT_QUALITY, `qualité ${quality}`);
	for (const start of ["# Chapitre 3", "Le train arriva", "Elle sortit sur la place", "La voiture de Paul", "Clara resta"]) {
		assert.equal(lines.get(lineOf(FIRST, start)), lineOf(PROOFREAD, start), start);
	}
	for (let k = 0; k < 3; k++) {
		assert.equal(lines.get(lineOf(FIRST, "— Oui.", k)), lineOf(PROOFREAD, "— Oui.", k), `— Oui. #${k}`);
	}
});

test("alignUnits ne s'égare pas d'un chapitre à l'autre dans un long texte répétitif", () => {
	const sourceText = repeatChapters(FIRST, 30);
	const targetText = repeatChapters(PROOFREAD, 30);
	const { lines, quality } = alignAll(sourceText, targetText);
	assert.ok(quality >= MIN_ALIGNMENT_QUALITY, `qualité ${quality}`);
	for (const chapter of [0, 7, 15, 29]) {
		for (const start of ["La voiture de Paul", "Elle sortit sur la place"]) {
			const source = lineOf(sourceText, start, chapter);
			assert.equal(lines.get(source), lineOf(targetText, start, chapter), `${start}, chapitre ${chapter}`);
		}
	}
});

test("alignUnits ne trouve aucun repère entre des textes sans rapport", () => {
	for (const [a, b] of [
		[FIRST, UNRELATED],
		[FIRST, OTHER_PROSE],
		[repeatChapters(PROOFREAD, 10), repeatChapters(OTHER_PROSE, 10)],
	]) {
		const { quality } = alignAll(a, b);
		assert.ok(quality < MIN_ALIGNMENT_QUALITY, `qualité ${quality}`);
	}
});

test("alignUnits reste rapide sur un long texte", () => {
	const source = extractUnits(repeatChapters(FIRST, 30).split("\n"));
	const target = extractUnits(repeatChapters(PROOFREAD, 30).split("\n"));
	const started = performance.now();
	alignUnits(source, target);
	const elapsed = performance.now() - started;
	assert.ok(elapsed < 500, `${Math.round(elapsed)} ms pour ${source.length} × ${target.length} unités`);
});
