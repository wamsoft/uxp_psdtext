# PSD Text Edit

A Photoshop panel for editing text-layer contents in bulk — list, search,
edit in a table, apply as one undo step. Built on UXP with a webview UI.
Companion to [uxp_psdrename](https://github.com/wamsoft/uxp_psdrename)
(same architecture, layer renaming).

[日本語版 README はこちら](README.ja.md) / [Developer notes](DEVELOPMENT.md)

## Features

- **Layer tree** of the active document (text layers by default), kept in
  sync with Photoshop automatically; contents shown next to each layer
- **Search & filter**: match layer paths and text contents
- **Single edit**: double-click a text layer (or F2) for a **WYSIWYG editor**
  (powered by [Quill](https://quilljs.com)) — per-range bold / italic /
  underline / size / color and per-line alignment render and edit as-is,
  with undo/redo inside the editor; a "Tags" toggle switches to text-based
  tag editing
- **Bulk edit ("Edit all…") with psdtext-style columns**: name / contents /
  font / size / color / alignment per row, only changed rows applied;
  style edits keep the formatting inside the body, and header checkboxes
  (with presets like "body only" / "formatting only") choose which columns
  copy &amp; paste touch (rule-based bulk renaming lives in uxp_psdrename)
- **Clipboard TSV instead of CSV**: *Copy table* writes the target columns
  Excel-style (quoted cells); pasting into a cell **flows right through the
  target columns and down the rows** from that cell
- Line breaks round-trip correctly (Photoshop's `\r` ⇄ `\n`)
- Applying is **one history step** — a single Ctrl+Z undoes the whole batch
- Bilingual UI (English default / 日本語) with a built-in guide
  (**?** button, or the panel flyout menu **≡ > Help**)

## Requirements

- Adobe Photoshop **2025 (v26) or later** — the UI runs in a webview with
  local HTML, which requires UXP 8.0.

## Installation

1. Download `psdtext-x.y.z.ccx` from
   [Releases](https://github.com/wamsoft/uxp_psdtext/releases)
2. Double-click the `.ccx` — the Creative Cloud desktop app installs it
3. Open the panel: *Plugins > PSD Text Edit > Text Edit*

To run from source instead, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Usage

1. Open a PSD — the text layers appear automatically
2. The **✎** at the end of a row (or double-click / F2) opens the
   single-layer editor; **Edit all…** opens the table
3. The table round-trips with spreadsheets: *Copy table* → edit in
   Excel → *Paste TSV* (Ctrl+V in a cell starts the fill there instead)
4. **Apply** sends the changed rows; Ctrl+Z reverts everything at once

Font fields list only favorites + the fonts used in the document;
search and register from all installed fonts via the ★ button.
Press the **?** button in the panel for the full guide.

## License

[MIT](LICENSE). Bundles the [Quill](https://quilljs.com) editor
(BSD 3-Clause, see `plugin/webview/vendor/quill.js.LICENSE.txt`).
