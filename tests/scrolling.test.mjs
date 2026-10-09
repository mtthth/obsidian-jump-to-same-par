import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { bundle, until, wait } from "./bundle.mjs";
import { FIRST, PROOFREAD, wrap } from "./fixtures.mjs";

// Les éditeurs, eux, sont simulés (voir `fakeView`).
const { alignLines, revealLine, anchorsBetween, ScrollSync } = await bundle(`
	export { alignLines, revealLine } from "./src/alignment";
	export { anchorsBetween, ScrollSync } from "./src/scrollSync";
`);

const LINE_HEIGHT = 20;

/**
 * Un éditeur simulé, juste ce que le plugin en lit : des lignes de hauteur fixe, dans un volet de `height` pixels
 * dont le haut est à `top`, qui défile comme dans un navigateur. `flashes` : les lignes qu'on lui a fait clignoter.
 */
function fakeView(lines, { top = 0, height = 200 } = {}) {
	const doc = Text.of(lines);
	const flashes = [];
	let measuring = false;
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
			setTimeout(() => {
				const value = request.read(this);
				measuring = true;
				try {
					request.write?.(value, this);
				} finally {
					measuring = false;
				}
			}, 0);
		},
		dispatch({ effects }) {
			// Comme CodeMirror, qui refuse qu'on modifie un éditeur pendant sa propre mise à jour.
			if (measuring) throw new Error("Calls to EditorView.update are not allowed while an update is in progress");
			if (effects?.value) flashes.push(effects.value);
		},
	};
}

/** Cent lignes qui ne se ressemblent pas trop, pour que chacune ait son équivalent net. */
const LINES = Array.from({ length: 100 }, (_, i) => `Ligne ${i} : ${(i * 7919).toString(36)} ${(i * 104729).toString(36)}`);

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
	await until(() => b.scrollDOM.scrollTop === 800);
	sync.stop();
	assert.equal(b.scrollDOM.scrollTop, 800, "les deux alignements sont finis");
});

test("le défilement simultané fait clignoter le paragraphe aligné, pas tout le texte", async () => {
	// La version relue n'a pas de lignes vides : chaque ligne y est un paragraphe.
	const a = fakeView(FIRST.split("\n"));
	const b = fakeView(PROOFREAD.split("\n"));
	const sync = new ScrollSync(a, b, anchorsBetween(a.state.doc, b.state.doc));
	sync.start(a);
	await until(() => b.flashes.length >= 1);
	a.scrollDOM.scrollTo({ top: 200 });
	await until(() => b.flashes.length >= 2);
	sync.stop();
	assert.ok(b.flashes.length >= 2, `clignotements : ${JSON.stringify(b.flashes)}`);
	for (const { from, to } of b.flashes) assert.equal(to, from, `lignes ${from} à ${to}`);
});

test("deux versions aux lignes coupées clignotent paragraphe par paragraphe", async () => {
	// Chaque ligne coupée a son équivalent dans l'autre version : toutes sont des repères.
	const first = wrap(FIRST, 60);
	const edited = wrap(FIRST.replace("un peu avant midi", "peu avant midi"), 60);
	const a = fakeView(first.text.split("\n"));
	const b = fakeView(edited.text.split("\n"));
	const sync = new ScrollSync(a, b, anchorsBetween(a.state.doc, b.state.doc));
	sync.start(a);
	for (let top = 0; top <= a.scrollDOM.scrollHeight; top += 10) {
		a.scrollDOM.scrollTo({ top });
		await wait(5);
	}
	await until(() => a.flashes.length >= 5);
	sync.stop();
	assert.ok(a.flashes.length >= 5, `clignotements : ${JSON.stringify(a.flashes)}`);
	// Un paragraphe coupé en plusieurs lignes clignote en entier, jamais ligne par ligne.
	for (const { from, to } of a.flashes) {
		const origin = first.origin[from - 1];
		const lines = first.origin.filter((line) => line === origin).length;
		if (lines > 1) assert.equal(to - from + 1, lines, `lignes ${from} à ${to}`);
	}
});
