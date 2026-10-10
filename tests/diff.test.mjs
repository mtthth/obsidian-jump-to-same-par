import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeSet, Text } from "@codemirror/state";
import { extractUnits } from "../src/matching.ts";
import { bundle, until } from "./bundle.mjs";
import { FIRST, PROOFREAD, UNRELATED } from "./fixtures.mjs";

const { diffBetween, DiffSession } = await bundle(`export { diffBetween, DiffSession } from "./src/diffSession";`);

/** Le diff de deux textes, avec de quoi relire les lignes qu'il désigne. */
function diffOf(before, after) {
	const sourceLines = before.split("\n");
	const targetLines = after.split("\n");
	const diff = diffBetween(Text.of(sourceLines), Text.of(targetLines));
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
	const place = "Elle sortit sur la place, sous les platanes taillés.";
	const before = [place, "", "Le serveur apporta sa tasse sans un mot."];
	const rest = before.slice(1);
	for (const after of [
		["Elle sortit sur la place, sous les platanes taillés. %%à revoir%%", ...rest],
		["Elle sortit %%trop plat%% sur la place, sous les platanes taillés.", ...rest],
		["Elle sortit sur la place, sous les platanes taillés. %%une note", "sur plusieurs lignes%%", ...rest],
		[place, "%%", "à reprendre", "%%", "Le serveur apporta sa tasse sans un mot."],
		// Collée à la ponctuation, ou précédée d'une espace qui ne sépare plus rien une fois la note retirée.
		["Elle sortit sur la place, sous les platanes taillés%%lesquels ?%%.", ...rest],
		["Elle sortit sur la place %%vérifier le nom%%, sous les platanes taillés.", ...rest],
		["Elle sortit sur la place%%vérifier le nom%%, sous les platanes taillés.", ...rest],
		["Elle sortit sur la %%grande ?%%place, sous les platanes taillés.", ...rest],
	]) {
		const diff = diffOf(before.join("\n"), after.join("\n"));
		assert.deepEqual([diff.changed, diff.added, diff.removed], [0, 0, 0], after.join(" / "));
	}
	// Les espaces autour d'une note tiennent à la note : celles d'avant un point d'exclamation restent du texte.
	for (const [before, after] of [
		["— Tu viens ? demanda-t-elle.", "— Tu viens%%ton ?%% ? demanda-t-elle."],
		["Il pleuvait enfin !", "Il pleuvait enfin  %%trop ?%%!"],
		["Il pleuvait enfin !", "Il pleuvait enfin %%trop ?%% !"],
		["Il resta sur la terrasse ?", "Il resta sur la terrasse %%nom ?%%?"],
	]) {
		const diff = diffOf(before, after);
		assert.deepEqual([diff.changed, diff.added, diff.removed], [0, 0, 0], after);
	}
	// Une espace ajoutée, sans note, reste une différence.
	assert.equal(diffOf("Elle sortit sur la place, sous les platanes.", "Elle sortit sur la place , sous les platanes.").changed, 1);
});

test("les mots changés autour d'une note de relecture sont repérés à leur place", () => {
	const diff = diffOf("Le train arriva %%à vérifier%% en retard, sous la pluie.", "Le train arriva à l'heure, sous la pluie.");
	assert.equal(diff.changed, 1);
	// Aucune marque ne porte sur la note, ni sur les espaces qu'elle laisse.
	assert.deepEqual(diff.words("Le train arriva"), { removed: ["en retard"], added: ["à l'heure"] });
	// Ni sur une note restée entre deux mots changés.
	const kept = diffOf(
		"Le train arriva en %%à vérifier%% retard, sous la pluie.",
		"Le train arriva à %%à vérifier%% l'heure, sous la pluie."
	);
	assert.deepEqual(kept.words("Le train arriva"), { removed: ["en", "retard"], added: ["à", "l'heure"] });
});

test("une espace insécable corrigée reste une différence", () => {
	const diff = diffOf("Elle demanda : « Tu viens ? » sans lever les yeux.", "Elle demanda\u00a0: «\u00a0Tu viens\u00a0?\u00a0» sans lever les yeux.");
	assert.equal(diff.changed, 1);
});

/** Un éditeur simulé, juste ce que `DiffSession` en lit. */
function editor(text) {
	return { state: { doc: Text.of(text.split("\n")) }, dom: { isConnected: true }, dispatch() {} };
}

/** Les différences entre deux textes, montrées dans des éditeurs simulés, et la liste de leurs paragraphes. */
function sessionOf(before, after) {
	const session = new DiffSession(editor(before), editor(after));
	return { session, rows: session.start().rows };
}

/**
 * Ce que montrent les appuis successifs sur « différence suivante » (`step` 1) ou « précédente » (-1) dans le volet
 * `side`, curseur d'abord sur la ligne `line`, puis sur chaque différence montrée, comme le fait la commande.
 */
function navigate(session, side, line, steps) {
	return steps.map((step) => {
		const row = session.nextChange(session.views[side], line, step);
		if (row) line = row.anchor[side];
		return row;
	});
}

/** Une frappe dans le volet `side`, dont la session est prévenue comme par l'éditeur. */
function type(session, side, change) {
	const view = session.views[side];
	const changes = ChangeSet.of(change, view.state.doc.length);
	view.state = { doc: changes.apply(view.state.doc) };
	session.textChanged(view, changes);
}

test("on revient en arrière après avoir buté sur la dernière différence", () => {
	const before = ["Le train arriva en gare de Saint-Aubin un peu avant midi.", "Clara descendit la première, sa valise à la main."];
	const after = [...before, "Premier paragraphe ajouté, tout à fait nouveau.", "Second paragraphe ajouté, absent lui aussi."];
	const { session, rows } = sessionOf(before.join("\n"), after.join("\n"));
	const added = rows.filter((row) => row.kind === "added");
	assert.equal(added.length, 2);
	// Dans l'ancienne version, les deux ajouts tiennent sur la même ligne : la dernière.
	assert.deepEqual(navigate(session, 0, 0, [1, 1, 1, -1, -1, -1]), [added[0], added[1], null, added[0], null, null]);
	// Curseur déjà sur cette ligne : ni l'une ni l'autre ne doit être hors d'atteinte.
	assert.deepEqual(navigate(sessionOf(before.join("\n"), after.join("\n")).session, 0, 1, [1, 1, 1]).map(Boolean), [true, true, false]);
	assert.deepEqual(navigate(sessionOf(before.join("\n"), after.join("\n")).session, 0, 1, [-1, -1, -1]).map(Boolean), [true, true, false]);
});

test("toutes les différences sont atteintes, d'où que l'on parte", () => {
	const { rows } = sessionOf(FIRST, PROOFREAD);
	const changes = rows.filter((row) => row.kind !== "same").length;
	for (const side of [0, 1]) {
		const lines = (side === 0 ? FIRST : PROOFREAD).split("\n").length;
		for (let line = 0; line < lines; line++) {
			const forward = navigate(sessionOf(FIRST, PROOFREAD).session, side, line, Array(changes + 1).fill(1));
			const backward = navigate(sessionOf(FIRST, PROOFREAD).session, side, line, Array(changes + 1).fill(-1));
			// Les lignes des deux versions désignent chaque différence, quelle que soit la session qui l'a trouvée.
			const key = (row) => `${row.kind} ${row.source} ${row.target}`;
			const reached = new Set([...forward, ...backward].filter(Boolean).map(key));
			assert.equal(reached.size, changes, `côté ${side}, ligne ${line}`);
			// Sans jamais montrer deux fois la même dans un sens.
			for (const visits of [forward, backward]) {
				const shown = visits.filter(Boolean).map(key);
				assert.equal(new Set(shown).size, shown.length, `côté ${side}, ligne ${line}`);
			}
		}
	}
});

const BEFORE = [
	"Un paragraphe qui ne change pas du tout, d'une version à l'autre.",
	"Le train arriva en gare un peu avant midi, sous une pluie fine.",
	"Elle sortit sur la place, sous les platanes taillés depuis sa visite.",
].join("\n");
const AFTER = [
	"Un paragraphe qui ne change pas du tout, d'une version à l'autre.",
	"Le train arriva en gare peu avant midi, sous une pluie fine.",
	"Elle sortit sur la place, sous les platanes coupés depuis sa visite.",
].join("\n");

test("une différence retouchée n'est pas montrée une seconde fois", async () => {
	const { session } = sessionOf(BEFORE, AFTER);
	const train = session.nextChange(session.views[1], 0, 1);
	assert.equal(train?.target, 1);
	// On la retouche, sans la faire disparaître ; les différences sont recalculées une fois la frappe arrêtée.
	const computed = session.diff;
	type(session, 1, { from: AFTER.indexOf(" sous une pluie"), insert: " tout juste" });
	await until(() => session.diff !== computed);
	assert.notEqual(session.diff, computed, "les différences n'ont pas été recalculées");
	assert.equal(session.nextChange(session.views[1], 1, 1)?.target, 2);
	session.stop();
});

test("une ligne insérée plus haut ne fait pas montrer deux fois la même différence", () => {
	const { session } = sessionOf(BEFORE, AFTER);
	assert.equal(session.nextChange(session.views[1], 0, 1)?.target, 1);
	type(session, 1, { from: 0, insert: "Un paragraphe ajouté tout en haut, pendant la relecture.\n" });
	// Le curseur a suivi son paragraphe, descendu d'une ligne.
	assert.equal(session.nextChange(session.views[1], 2, 1)?.target, 3);
	session.stop();
});

test("juste après une frappe, les différences sont celles du texte tel qu'il est", () => {
	const { session } = sessionOf(BEFORE, AFTER);
	type(session, 1, { from: 0, insert: "Un paragraphe ajouté tout en haut, pendant la relecture.\n" });
	const lines = session.views[1].state.doc;
	const shown = navigate(session, 1, 0, [1, 1]).map((row) => lines.line(row.target + 1).text);
	assert.ok(shown[0].startsWith("Un paragraphe ajouté"), shown[0]);
	assert.ok(shown[1].startsWith("Le train arriva"), shown[1]);
	session.stop();
});
