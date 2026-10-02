# Jump to Same Paragraph

An [Obsidian](https://obsidian.md) plugin for working on two versions of the same text open side by side: it finds, in the other pane, the paragraph that matches the one you are on, even if the text has been rewritten, cut or reordered in the meantime.

> Menus, commands and notices are in English by default. Switch to French in *Settings → Jump to Same Paragraph → Language*.

## What it does

- **Align paragraphs**: right-click a paragraph, then choose "Align paragraphs". Its counterpart in the other pane scrolls to the same height.
- **Synchronized scrolling**: both panes stay facing each other while you scroll one of them.
- **Show differences**: git-style, modified, added and removed paragraphs are highlighted in both versions, along with the words that change inside a modified paragraph. A notice sums it up ("8 paragraphs changed, 1 added, 1 removed").
- **Next / previous difference**: jumps from one difference to the next.

## Usage

1. Open both versions in two neighbouring panes (split view), in editing mode. The left (or top) pane is read as the old version, the other as the new one.
2. Right-click in either note: the menu offers the three actions above.
3. The same actions are available in the command palette, where you can assign hotkeys to them:
   - Align paragraphs
   - Synchronized scrolling (toggle)
   - Show differences (toggle)
   - Next difference
   - Previous difference

To stop synchronized scrolling or hide the differences, run the same command again, or click the button added to the note's header. Closing one of the two notes, or replacing it with another, stops them too.

## How paragraphs are matched

The unit is the non-empty line: in an Obsidian note, a paragraph usually fits on a single line. Matching compares content (character trigrams), neighbouring paragraphs and relative position in the text. If the best candidate is too dissimilar, the plugin does nothing rather than take you to the wrong place.

Frontmatter, `%% … %%` comments (including multi-line ones) and hidden content are ignored.

## Limitations

- Works between two notes open in panes, in editing mode (not reading mode).
- The texts must stay reasonably close: two unrelated notes will not be aligned.

## Installation

Not yet in the community plugins directory. Manually:

1. Build the plugin (see below) or get `main.js`, `manifest.json` and `styles.css`.
2. Copy these three files into `<your vault>/.obsidian/plugins/jump-to-same-par/`.
3. Reload Obsidian and enable the plugin in *Settings → Community plugins*.

## Development

```bash
npm install
npm run build   # type check, then main.js
npm run dev     # watch mode
npm test        # tests for matching and differences
```

On Windows, `deploy.ps1` builds the plugin and copies it into a vault's plugins folder:

```powershell
.\deploy.ps1 -VaultPath "C:\path\to\the\vault"
```

## License

[MIT](LICENSE) © Matthieu Thomas (mtthth)
