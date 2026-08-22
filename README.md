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
2. Double-click a layer to edit it on its own, or click **Edit all…**
   for the table
3. In the table: edit cells directly, or *Copy as TSV* → edit in a
   spreadsheet → copy the contents column → paste back into the first cell
4. **Apply** sends the changed rows; Ctrl+Z reverts everything at once

## License

[MIT](LICENSE). Bundles the [Quill](https://quilljs.com) editor
(BSD 3-Clause, see `plugin/webview/vendor/quill.js.LICENSE.txt`).
