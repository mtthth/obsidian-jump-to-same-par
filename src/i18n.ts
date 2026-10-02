/**
 * Textes de l'interface (menus, commandes, notices, réglages), en anglais ou en français.
 *
 * Ce module n'importe ni Obsidian ni CodeMirror.
 */

export type Language = "en" | "fr";

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
	return value === "en" || value === "fr";
}

export interface Strings {
	alignTitle: string;
	syncTitle: string;
	diffTitle: string;
	toggleSyncCommand: string;
	toggleDiffCommand: string;
	nextDifference: string;
	previousDifference: string;

	syncStopTooltip: string;
	diffHideTooltip: string;

	openOtherVersion: string;
	otherInReadingMode: string;
	nothingToAlign: string;
	noEquivalent: string;
	syncNeedsPanes: string;
	syncTooDifferent: string;
	syncOn: string;
	syncOff: string;
	syncStoppedNoteGone: string;
	diffNeedsPanes: string;
	diffTooDifferent: string;
	diffHidden: string;
	diffStoppedNoteGone: string;
	lastDifference: string;
	firstDifference: string;
	enableDiffFirst: string;
	/** « 8 paragraphes modifiés, 1 ajouté, 1 supprimé » ; ne se termine pas par un point. */
	summary(changed: number, added: number, removed: number): string;
	/** `reference` : nom de la note qui fait l'ancienne version, ou null si elle n'en a pas. */
	oldVersionNotice(reference: string | null): string;

	languageName: string;
	languageDesc: string;
}

const en: Strings = {
	alignTitle: "Align paragraphs",
	syncTitle: "Synchronized scrolling",
	diffTitle: "Show differences",
	toggleSyncCommand: "Synchronized scrolling (toggle)",
	toggleDiffCommand: "Show differences (toggle)",
	nextDifference: "Next difference",
	previousDifference: "Previous difference",

	syncStopTooltip: "Stop synchronized scrolling",
	diffHideTooltip: "Hide differences",

	openOtherVersion: "Open the other version of the text in a neighbouring pane.",
	otherInReadingMode: "The other text is in reading mode: switch it to editing mode.",
	nothingToAlign: "No paragraph to align in this note.",
	noEquivalent: "No matching paragraph in the other text.",
	syncNeedsPanes: "Synchronized scrolling only works between two notes open in panes.",
	syncTooDifferent: "The two texts are too different to scroll together.",
	syncOn: "Synchronized scrolling on.",
	syncOff: "Synchronized scrolling off.",
	syncStoppedNoteGone: "Synchronized scrolling stopped: one of the two notes was closed or replaced.",
	diffNeedsPanes: "Differences can only be shown between two notes open in panes.",
	diffTooDifferent: "The two texts are too different to be compared.",
	diffHidden: "Differences hidden.",
	diffStoppedNoteGone: "Differences hidden: one of the two notes was closed or replaced.",
	lastDifference: "Last difference reached.",
	firstDifference: "First difference reached.",
	enableDiffFirst: "First turn on “Show differences” on both notes.",
	summary(changed, added, removed) {
		const counts: [number, string][] = [
			[changed, "changed"],
			[added, "added"],
			[removed, "removed"],
		];
		const parts = counts
			.filter(([count]) => count > 0)
			.map(([count, word], k) => `${count}${k === 0 ? ` paragraph${count > 1 ? "s" : ""}` : ""} ${word}`);
		return parts.length === 0 ? "The two texts are identical" : parts.join(", ");
	},
	oldVersionNotice(reference) {
		return `“${reference ?? "the first one"}” is the old version: in red what disappears from it, in green what appears in the other.`;
	},

	languageName: "Language",
	languageDesc: "Language of the menus, commands and notices. Command names in the palette follow it at once or after restarting Obsidian.",
};

const fr: Strings = {
	alignTitle: "Aligner les paragraphes",
	syncTitle: "Défilement simultané",
	diffTitle: "Montrer les différences",
	toggleSyncCommand: "Défilement simultané (activer ou désactiver)",
	toggleDiffCommand: "Montrer les différences (activer ou désactiver)",
	nextDifference: "Différence suivante",
	previousDifference: "Différence précédente",

	syncStopTooltip: "Arrêter le défilement simultané",
	diffHideTooltip: "Masquer les différences",

	openOtherVersion: "Ouvrez l'autre version du texte dans un volet voisin.",
	otherInReadingMode: "L'autre texte est en mode lecture : passez-le en mode édition.",
	nothingToAlign: "Aucun paragraphe à aligner dans cette note.",
	noEquivalent: "Aucun paragraphe équivalent dans l'autre texte.",
	syncNeedsPanes: "Le défilement simultané ne fonctionne qu'entre deux notes ouvertes dans des volets.",
	syncTooDifferent: "Les deux textes se ressemblent trop peu pour défiler ensemble.",
	syncOn: "Défilement simultané activé.",
	syncOff: "Défilement simultané désactivé.",
	syncStoppedNoteGone: "Défilement simultané arrêté : l'une des deux notes a été fermée ou remplacée.",
	diffNeedsPanes: "Les différences ne se montrent qu'entre deux notes ouvertes dans des volets.",
	diffTooDifferent: "Les deux textes se ressemblent trop peu pour être comparés.",
	diffHidden: "Différences masquées.",
	diffStoppedNoteGone: "Différences masquées : l'une des deux notes a été fermée ou remplacée.",
	lastDifference: "Dernière différence atteinte.",
	firstDifference: "Première différence atteinte.",
	enableDiffFirst: "Activez d'abord « Montrer les différences » sur les deux notes.",
	summary(changed, added, removed) {
		const counts: [number, string][] = [
			[changed, "modifié"],
			[added, "ajouté"],
			[removed, "supprimé"],
		];
		const parts = counts
			.filter(([count]) => count > 0)
			.map(([count, word], k) => {
				const plural = count > 1 ? "s" : "";
				// Le nom ne se dit qu'une fois, en tête : « 8 paragraphes modifiés, 1 ajouté ».
				return `${count}${k === 0 ? ` paragraphe${plural}` : ""} ${word}${plural}`;
			});
		return parts.length === 0 ? "Les deux textes sont identiques" : parts.join(", ");
	},
	oldVersionNotice(reference) {
		return `« ${reference ?? "la première"} » fait l'ancienne version : en rouge ce qui en disparaît, en vert ce qui apparaît dans l'autre.`;
	},

	languageName: "Langue",
	languageDesc:
		"Langue des menus, des commandes et des notices. Les noms de commandes de la palette suivent aussitôt ou au prochain démarrage d'Obsidian.",
};

const ALL: Record<Language, Strings> = { en, fr };

export function strings(language: Language): Strings {
	return ALL[language];
}
