import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Les modules du plugin qui importent CodeMirror ou d'autres modules, assemblés avec esbuild pour être chargés sous
 * Node. `exports` : de quoi les réexporter, chemins pris depuis la racine du dépôt.
 */
export async function bundle(exports) {
	const { outputFiles } = await build({
		stdin: { contents: exports, resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts" },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		logLevel: "silent",
	});
	// Le plugin passe par `window` pour ses minuteries, comme toute page.
	globalThis.window = globalThis;
	return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attend que `done` soit vrai, deux secondes au plus : une machine lente ne fait pas échouer le test. */
export async function until(done, ms = 2000) {
	for (const end = Date.now() + ms; !done() && Date.now() < end; ) await wait(5);
}
