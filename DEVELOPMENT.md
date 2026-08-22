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

## Panel ⇔ webview messages (JSON strings over postMessage)

| Request (webview → panel) | Response (panel → webview) |
|---|---|
| `{type:"ready"}` / `{type:"getTree"}` | `{type:"tree", doc:{id,name}, rows:[{id,name,kind,depth,parent,path,visible,text,body},...]}` |
| `{type:"applyTexts", items:[{id,text},...]}` | `{type:"textResult", applied, errors:[]}` followed by a fresh `tree` |
| — | `{type:"showHelp"}` (flyout menu → webview) |

- Layers are identified only by Photoshop's persistent layer id (`layer.id`)
- **Line endings**: Photoshop text uses `\r`; the bridge converts to `\n`
  for the UI on read and back to `\r` on write
- Text is written through the DOM API (`textItem.contents`) rather than a
  batchPlay `textKey` set, which can destroy per-character styling
- Everything applies inside `executeAsModal` + `suspendHistory` →
  one undo step

## Field notes inherited from uxp_psdrename

1. webview → panel messages arrive on `window`, not on the `<webview>`
   element (listen on both)
2. `localStorage` is unavailable inside the webview (language cached in
   memory)
3. `entrypoints.setup` can throw — call it last, wrapped in try/catch
4. Elements with an explicit `display` need `.foo[hidden]{display:none}` or
   the `hidden` attribute silently stops working

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
