import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiff } from "../src/diff.ts";
import { alignUnits, extractUnits } from "../src/matching.ts";
import { FIRST, PROOFREAD, UNRELATED } from "./fixtures.mjs";

/** Le diff de deux textes, avec de quoi relire les lignes qu'il désigne. */
function diffOf(before, after) {
	const sourceLines = before.split("\n");
	const targetLines = after.split("\n");
	const sourceUnits = extractUnits(sourceLines);
	const targetUnits = extractUnits(targetLines);
	const diff = buildDiff({
		sourceLines,
		targetLines,
		sourceUnits: sourceUnits.map((unit) => unit.line),
		targetUnits: targetUnits.map((unit) => unit.line),
		pairs: alignUnits(sourceUnits, targetUnits),
	});
	const lineOf = (row) => (row.source >= 0 ? sourceLines[row.source] : targetLines[row.target]);
	return {
		...diff,
		sourceLines,
		targetLines,
		/** Les lignes d'un genre de différence, telles quelles. */
		texts: (kind) => diff.rows.filter((row) => row.kind === kind).map(lineOf),
		changes: () => diff.rows.filter((row) => row.kind !== "same"),
		lineOf,
		/** Les mots changés du paragraphe modifié qui commence par `start`, relus dans la ligne. */
		words: (start) => {
			const row = diff.rows.find((r) => r.kind === "changed" && sourceLines[r.source].startsWith(start));
			assert.ok(row, `paragraphe modifié introuvable : ${start}`);
			return {
				removed: row.sourceWords.map((word) => sourceLines[row.source].slice(word.from, word.to)),
				added: row.targetWords.map((word) => targetLines[row.target].slice(word.from, word.to)),
			};
		},
	};
}

test("deux textes identiques n'ont aucune différence", () => {
	const diff = diffOf(FIRST, FIRST);
	assert.deepEqual([diff.changed, diff.added, diff.removed], [0, 0, 0]);
	assert.ok(diff.rows.every((row) => row.kind === "same"));
});

test("la version relue : ce qui est supprimé, ajouté, remanié", () => {
	const diff = diffOf(FIRST, PROOFREAD);
	assert.ok(diff.texts("removed").some((text) => text.startsWith("La maison n'avait pas changé")));
	assert.ok(diff.texts("added").some((text) => text.startsWith("Au dernier virage")));
	// Un paragraphe coupé en deux : la première moitié s'ajoute, le reste passe pour modifié.
	assert.ok(diff.texts("added").includes("Il n'était pas là."));
	assert.ok(diff.changed >= 5, `paragraphes modifiés : ${diff.changed}`);
});

test("les mots changés sont repérés dans la ligne", () => {
	const diff = diffOf(FIRST, PROOFREAD);
	assert.deepEqual(diff.words("— Tu es sûre"), {
		removed: ["Tu es", "t'a"],
		added: ["Vous êtes", "vous a"],
	});
	assert.deepEqual(diff.words("Elle sortit sur la place"), {
		removed: ["maintenant"],
		added: [",", "désormais"],
	});
	// Une virgule ajoutée, et rien d'autre : aucune marque sur les espaces, qui ne se verrait pas.
	assert.deepEqual(diff.words("— Alors il viendra"), { removed: [], added: [","] });
});

test("une réplique répétée mot pour mot ne fait pas une différence", () => {
	const diff = diffOf(FIRST, PROOFREAD);
	const repeated = diff.changes().filter((row) => diff.lineOf(row).trim() === "— Oui.");
	assert.deepEqual(repeated, []);
});

test("chaque différence sait où se montrer dans les deux volets", () => {
	const diff = diffOf(FIRST, PROOFREAD);
	for (const row of diff.rows) {
		const [source, target] = row.anchor;
		assert.ok(source >= 0 && source < diff.sourceLines.length, `ancre hors du texte : ${source}`);
		assert.ok(target >= 0 && target < diff.targetLines.length, `ancre hors du texte : ${target}`);
	}
});

test("deux textes sans rapport : tout est supprimé d'un côté, ajouté de l'autre", () => {
	const diff = diffOf(FIRST, UNRELATED);
	assert.equal(diff.changed, 0);
	assert.equal(diff.removed, extractUnits(FIRST.split("\n")).length);
	assert.equal(diff.added, extractUnits(UNRELATED.split("\n")).length);
});
