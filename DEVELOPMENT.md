# Developer notes

Shares its architecture with
[uxp_psdrename](https://github.com/wamsoft/uxp_psdrename) — the UI lives
entirely in a webview (real Chromium / Edge WebView2) and the UXP panel
script is only a bridge to Photoshop. See that repository's DEVELOPMENT.md
for the full field notes; the highlights and the differences are below.

## Loading from source (UDT)

1. Install the [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/installation/)
2. *Add Plugin* → select `plugin/manifest.json`
3. With Photoshop running, click *Load*

Changes under `plugin/webview/` only need a panel reload; changes to
`manifest.json` or `main.js` need an Unload → Load in UDT.

## Building a release (.ccx)

```
node dev/build-ccx.mjs        # → dist/psdtext-<version>.ccx
```

Strips the dev instrumentation automatically (DEBUG block in `main.js`,
no-op `debug.js`, `network` permission). Tag `v<version>` and push — the
`release` workflow attaches the `.ccx` to a GitHub Release.

## Architecture

```
plugin/
  main.js              Photoshop bridge (tree walk, batchPlay descriptor
                       read/write, fonts, prefs, clipboard, flyout menu)
  webview/
    app.js             Tree / selection / editor dialog / sheet / font UI
    tags.js            psdtext's tag model, verbatim (marks, editRange, ...)
    rich.js            ranges ⇄ tagged-text converters (unit-tested)
    i18n.js            en/ja dictionary (English default)
    vendor/quill.js    Quill 2.0.3 (BSD-3) — the WYSIWYG editor engine
```

The single-layer editor is Quill with two custom style attributors:
`psize` keeps the real pt in `data-pt` while rendering a scaled px
(base ≈ 14px), and `psfont` keeps the PostScript name in `data-ps`
while rendering the family name. The editor's tag mode and the sheet's
TSV use the psdtext-compatible tag syntax via `tags.js` / `rich.js`.

## Panel ⇔ webview messages (JSON strings over postMessage)

| Request (webview → panel) | Response (panel → webview) |
|---|---|
| `{type:"ready"}` / `{type:"getTree"}` | `{type:"tree", doc:{id,name}, rows:[{id,name,kind,depth,parent,path,visible,text,body},...]}` |
| `{type:"applyTexts", items:[...]}` | `{type:"textResult", applied, errors:[]}` followed by a fresh `tree` |
| `{type:"getRich", id}` / `{type:"getRichMany", ids}` | `{type:"rich"/"richMany", text, ranges:[{from,to,font,size,color,bold,italic,underline}], paragraphs:[{from,to,align}]}` (per id for richMany) |
| `{type:"getStyle", id}` | `{type:"style", style:{font,size,color,align}}` (base style, for the plain fallback) |
| `{type:"getFonts"}` / `{type:"getUsedFonts"}` | installed fonts / PS names used in the document |
| `{type:"getPrefs"}` / `{type:"setPrefs", prefs}` | prefs.json in the plugin data folder (favorite fonts) |
| `{type:"readClipboard"}` | `{type:"clipboard", text}` — silent read via the manifest permission |
| — | `{type:"showHelp"}` (flyout menu → webview) |

`applyTexts` items: `{id, name?, style?, text?, rich?}` —
`text` writes plain contents via `textItem.contents` (keeps the base
style, drops per-range formatting), `rich` = `{text, ranges, paragraphs}`
writes the full `textStyleRange` / `paragraphStyleRange` descriptors,
using the first run's textStyle as a template so untouched attributes
(leading, tracking, ...) survive. Everything applies inside
`executeAsModal` + `suspendHistory` → one undo step. Layers are
identified only by Photoshop's persistent layer id; line endings are
`\r` in Photoshop and `\n` in the UI, converted at the bridge.

## Field notes (see also uxp_psdrename's DEVELOPMENT.md)

1. webview → panel messages arrive on `window`, not on the `<webview>`
   element (listen on both)
2. `localStorage` is unavailable inside the webview — the language lives
   in memory, favorites persist via prefs.json in the plugin data folder
3. `entrypoints.setup` can throw — call it last, wrapped in try/catch
4. Elements with an explicit `display` need `.foo[hidden]{display:none}` or
   the `hidden` attribute silently stops working
5. The descriptor's RGBColor uses `grain` for green; `underline` is an
   enum whose on-value depends on orientation: `underlineOnLeftInVertical`
   for horizontal text, `underlineOnRightInVertical` for vertical (measured
   from what Photoshop itself writes)
6. UXP's `navigator.clipboard.readText()` can resolve to an object
   (`{"text/plain": ...}`) instead of a string — normalize both shapes.
   Reading on the panel side avoids the per-use Chromium permission
   dialog the webview shows
7. `navigator.clipboard.readText` in the *webview* prompts every time
   (the file:// origin never persists the grant) — hence the bridge route

## Self-diagnosis line

**Ctrl+D** toggles a status line at the bottom (instance id, ticking clock,
connection state, received-tree history, last JS error) written by the
visible context itself — no fetch, no bridge.

## Debug server (dev only)

Same tool as uxp_psdrename:

```
node dev/debug-server.mjs debug.log
curl -X POST http://127.0.0.1:18999/push -H "Content-Type: application/json" \
     -d '{"side":"wv","js":"window.__dbg.state.rows.length"}'
```

Console output streams to `/log`; JS pushed to `/push` is eval'd in the
webview (`side:"wv"`) or the panel (`side:"panel"`). Silent when the server
is not running.
