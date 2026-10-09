import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacentChange, buildDiff } from "../src/diff.ts";
import { alignUnits, extractUnits, withoutComments } from "../src/matching.ts";
import { FIRST, PROOFREAD, UNRELATED } from "./fixtures.mjs";

/** Le diff de deux textes, comme le calcule `diffBetween`, avec de quoi relire les lignes qu'il désigne. */
function diffOf(before, after) {
	const sourceLines = before.split("\n");
	const targetLines = after.split("\n");
	const sourceUnits = extractUnits(sourceLines);
	const targetUnits = extractUnits(targetLines);
	const diff = buildDiff({
		sourceLines: withoutComments(sourceLines),
		targetLines: withoutComments(targetLines),
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

test("une note de relecture ajoutée ou retirée ne modifie pas un paragraphe", () => {
	const before = ["Elle sortit sur la place, sous les platanes taillés.", "", "Le serveur apporta sa tasse sans un mot."];
	for (const after of [
		["Elle sortit sur la place, sous les platanes taillés. %%à revoir%%", "", "Le serveur apporta sa tasse sans un mot."],
		["Elle sortit %%trop plat%% sur la place, sous les platanes taillés.", "", "Le serveur apporta sa tasse sans un mot."],
		["Elle sortit sur la place, sous les platanes taillés. %%une note", "sur plusieurs lignes%%", "", "Le serveur apporta sa tasse sans un mot."],
		["Elle sortit sur la place, sous les platanes taillés.", "%%", "à reprendre", "%%", "Le serveur apporta sa tasse sans un mot."],
	]) {
		const diff = diffOf(before.join("\n"), after.join("\n"));
		assert.deepEqual([diff.changed, diff.added, diff.removed], [0, 0, 0], after.join(" / "));
	}
});

test("les mots changés autour d'une note de relecture sont repérés à leur place", () => {
	const diff = diffOf("Le train arriva %%à vérifier%% en retard, sous la pluie.", "Le train arriva à l'heure, sous la pluie.");
	assert.equal(diff.changed, 1);
	// Aucune marque ne porte sur la note, ni sur les espaces qu'elle laisse.
	assert.deepEqual(diff.words("Le train arriva"), { removed: ["en retard"], added: ["à l'heure"] });
});

/**
 * Ce que montrent les appuis successifs sur « différence suivante » (`step` 1) ou « précédente » (-1) dans le volet
 * `side`, curseur d'abord sur la ligne `line`, comme le fait `DiffSession` : le curseur suit chaque différence
 * montrée, et la dernière reste retenue quand on bute au bout.
 */
function navigate(rows, side, line, steps) {
	let shown = null;
	return steps.map((step) => {
		const row = adjacentChange(rows, side, line, shown, step);
		if (!row) return null;
		shown = row;
		line = row.anchor[side];
		return row;
	});
}

test("on revient en arrière après avoir buté sur la dernière différence", () => {
	const before = ["Le train arriva en gare de Saint-Aubin un peu avant midi.", "Clara descendit la première, sa valise à la main."];
	const after = [...before, "Premier paragraphe ajouté, tout à fait nouveau.", "Second paragraphe ajouté, absent lui aussi."];
	const diff = diffOf(before.join("\n"), after.join("\n"));
	const added = diff.rows.filter((row) => row.kind === "added");
	assert.equal(added.length, 2);
	// Dans l'ancienne version, les deux ajouts tiennent sur la même ligne : la dernière.
	assert.deepEqual(navigate(diff.rows, 0, 0, [1, 1, 1, -1, -1, -1]), [added[0], added[1], null, added[0], null, null]);
	// Curseur déjà sur cette ligne : ni l'une ni l'autre ne doit être hors d'atteinte.
	assert.deepEqual(navigate(diff.rows, 0, 1, [1, 1, 1]), [added[0], added[1], null]);
	assert.deepEqual(navigate(diff.rows, 0, 1, [-1, -1, -1]), [added[1], added[0], null]);
});

test("toutes les différences sont atteintes, d'où que l'on parte", () => {
	const diff = diffOf(FIRST, PROOFREAD);
	const changes = diff.changes();
	for (const side of [0, 1]) {
		const lines = side === 0 ? diff.sourceLines.length : diff.targetLines.length;
		for (let line = 0; line < lines; line++) {
			const forward = navigate(diff.rows, side, line, Array(changes.length + 1).fill(1));
			const backward = navigate(diff.rows, side, line, Array(changes.length + 1).fill(-1));
			const reached = new Set([...forward, ...backward].filter(Boolean));
			assert.equal(reached.size, changes.length, `côté ${side}, ligne ${line}`);
			// Sans jamais montrer deux fois la même dans un sens.
			for (const visits of [forward, backward]) {
				const shown = visits.filter(Boolean);
				assert.equal(new Set(shown).size, shown.length, `côté ${side}, ligne ${line}`);
			}
		}
	}
});
