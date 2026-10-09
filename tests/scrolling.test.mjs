import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Text } from "@codemirror/state";
import { build } from "esbuild";
import { FIRST, PROOFREAD } from "./fixtures.mjs";

// alignment.ts et scrollSync.ts importent CodeMirror et d'autres modules du plugin : on les assemble avant de les
// charger. Les éditeurs, eux, sont simulés (voir `fakeView`).
const { outputFiles } = await build({
	stdin: {
		contents: `export { alignLines, revealLine } from "./src/alignment";
export { anchorsBetween, ScrollSync } from "./src/scrollSync";`,
		resolveDir: fileURLToPath(new URL("..", import.meta.url)),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const { alignLines, revealLine, anchorsBetween, ScrollSync } = await import(
	`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
// Le plugin passe par `window` pour ses minuteries, comme toute page.
globalThis.window = globalThis;

const LINE_HEIGHT = 20;

/**
 * Un éditeur simulé, juste ce que le plugin en lit : des lignes de hauteur fixe, dans un volet de `height` pixels
 * dont le haut est à `top`, qui défile comme dans un navigateur. `flashes` : les lignes qu'on lui a fait clignoter.
 */
function fakeView(lines, { top = 0, height = 200 } = {}) {
	const doc = Text.of(lines);
	const flashes = [];
	const scrollDOM = Object.assign(new EventTarget(), {
		scrollTop: 0,
		clientHeight: height,
		scrollHeight: doc.lines * LINE_HEIGHT,
		getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: 300 }),
		scrollTo({ top: wanted }) {
			const next = Math.max(0, Math.min(wanted, this.scrollHeight - this.clientHeight));
			if (next === this.scrollTop) return;
			this.scrollTop = next;
			// L'événement arrive après coup, comme dans un navigateur.
			setTimeout(() => this.dispatchEvent(new Event("scroll")), 0);
		},
	});
	return {
		state: { doc },
		dom: { isConnected: true },
		scrollDOM,
		defaultLineHeight: LINE_HEIGHT,
		flashes,
		get documentTop() {
			return top - scrollDOM.scrollTop;
		},
		lineBlockAt(pos) {
			const line = doc.lineAt(pos).number - 1;
			return { top: line * LINE_HEIGHT, bottom: (line + 1) * LINE_HEIGHT };
		},
		requestMeasure(request) {
			setTimeout(() => request.write?.(request.read(this), this), 0);
		},
		dispatch({ effects }) {
			if (effects?.value) flashes.push(effects.value);
		},
	};
}

/** Cent lignes qui ne se ressemblent pas trop, pour que chacune ait son équivalent net. */
const LINES = Array.from({ length: 100 }, (_, i) => `Ligne ${i} : ${(i * 7919).toString(36)} ${(i * 104729).toString(36)}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("alignLines amène la ligne équivalente en face", async () => {
	const source = fakeView(LINES);
	const target = fakeView(LINES);
	source.scrollDOM.scrollTop = 200;
	// La ligne 15 (à partir de 0) est à 100 pixels du haut de son volet : la ligne 40 doit l'y rejoindre.
	await alignLines(source, source.state.doc.line(16).from, target, target.state.doc.line(41).from);
	assert.equal(target.scrollDOM.scrollTop, 40 * LINE_HEIGHT - 100);
});

test("un alignement interrompu ne fait plus rien défiler", async () => {
	const source = fakeView(LINES);
	const target = fakeView(LINES);
	const alignment = new AbortController();
	const aligning = alignLines(source, 0, target, target.state.doc.line(51).from, alignment.signal);
	alignment.abort();
	await aligning;
	assert.equal(target.scrollDOM.scrollTop, 0);

	const view = fakeView(LINES);
	const reveal = new AbortController();
	const revealing = revealLine(view, view.state.doc.line(80).from, reveal.signal);
	reveal.abort();
	await revealing;
	assert.equal(view.scrollDOM.scrollTop, 0);
});

test("le défilement simultané reste suspendu jusqu'à la fin du dernier alignement", async () => {
	const a = fakeView(LINES);
	const b = fakeView(LINES);
	const sync = new ScrollSync(a, b, anchorsBetween(a.state.doc, b.state.doc));
	sync.start(a);
	await wait(200);

	// Deux alignements coup sur coup : le premier finit pendant que le second tourne encore.
	let finishFirst;
	let finishSecond;
	const first = sync.suspend(() => new Promise((resolve) => (finishFirst = resolve)));
	const second = sync.suspend(() => new Promise((resolve) => (finishSecond = resolve)));
	finishFirst();
	await first;
	await wait(150);
	a.scrollDOM.scrollTo({ top: 600 });
	await wait(50);
	assert.equal(b.scrollDOM.scrollTop, 0, "le second alignement est encore en cours");

	finishSecond();
	await second;
	await wait(150);
	a.scrollDOM.scrollTo({ top: 800 });
	await wait(50);
	sync.stop();
	assert.equal(b.scrollDOM.scrollTop, 800, "les deux alignements sont finis");
});

test("le défilement simultané fait clignoter le paragraphe aligné, pas tout le texte", async () => {
	// La version relue n'a pas de lignes vides : chaque ligne y est un paragraphe.
	const a = fakeView(FIRST.split("\n"));
	const b = fakeView(PROOFREAD.split("\n"));
	const sync = new ScrollSync(a, b, anchorsBetween(a.state.doc, b.state.doc));
	sync.start(a);
	await wait(50);
	a.scrollDOM.scrollTo({ top: 200 });
	await wait(50);
	sync.stop();
	assert.ok(b.flashes.length >= 2, `clignotements : ${JSON.stringify(b.flashes)}`);
	for (const { from, to } of b.flashes) assert.equal(to, from, `lignes ${from} à ${to}`);
});
