//---------------------------------------------------------------------------
// PSD Text Edit — UXP パネル側 (Photoshop ブリッジ)
//
// UI はすべて webview (webview/) が持つ。ここは
//   1. レイヤツリーの取得 (getTree)
//   2. テキスト一括反映 (applyTexts)
//   3. Photoshop 側の変化を webview へ通知
// の 3 つだけを担当する。webview とは JSON 文字列の postMessage で話す。
//
// Photoshop のテキストは改行が \r。UI 側は \n で統一し、ここで変換する。
//---------------------------------------------------------------------------

const { app, core, action } = require("photoshop");

const wv = document.getElementById("wv");

//---------------------------------------------------------------------------
// webview との通信
//---------------------------------------------------------------------------

function send(msg) {
	const s = JSON.stringify(msg);
	console.log("[psdtext] to webview:", msg.type,
		msg.rows ? "(" + msg.rows.length + " rows)" : "");
	for (const w of document.querySelectorAll("webview")) {
		try {
			w.postMessage(s);
		} catch (e) { /* 読み込み前の webview は捨てる */ }
	}
}

// webview からのメッセージの受け口。
// 実機 (UXP 8.x/9.x) では webview 要素の message イベントは data が
// undefined で届き、実データは window 側の message イベントに乗ってくる。
// どちらで来てもいいように両方を同じ処理へ流す (data の無い方は素通り)。
function routeIncoming(ev, via) {
	let msg = ev.data;
	if (msg === undefined || msg === null) return;
	if (typeof msg === "string") {
		try { msg = JSON.parse(msg); } catch (e) { return; }
	}
	if (!msg || !msg.type) return;
	console.log("[psdtext] from webview (" + via + "):", msg.type,
		msg.iid ? "iid=" + msg.iid : "");
	handleMessage(msg).catch((e) => {
		console.error("[psdtext] handleMessage failed:", e);
		send({ type: "error", reqId: msg.reqId, message: String(e && e.message || e) });
	});
}

wv.addEventListener("message", (ev) => routeIncoming(ev, "element"));
window.addEventListener("message", (ev) => routeIncoming(ev, "window"));

// webview の読み込み完了時にもこちらから push する。
// (webview 側の初回 ready がブリッジ確立前に消えても、これで届く)
for (const evName of ["load", "loadstop"]) {
	wv.addEventListener(evName, () => {
		console.log("[psdtext] webview " + evName);
		sendTree();
	});
}

wv.addEventListener("loaderror", () => {
	// PS 26 (UXP 8.0) 未満だとローカル HTML を読めずここに来る
	document.getElementById("fallbackMsg").textContent =
		"webview の読み込みに失敗しました。Photoshop 2025 (v26) 以降が必要です。 / " +
		"Failed to load the webview. Photoshop 2025 (v26) or later is required.";
	document.getElementById("fallback").classList.add("show");
});

async function handleMessage(msg) {
	switch (msg.type) {
	case "ready":            // webview の起動完了
		sendTree(msg.reqId);
		break;
	case "getTree":
		sendTree(msg.reqId);
		break;
	case "ping":
		send({ type: "pong", reqId: msg.reqId });
		break;
	case "applyTexts": {
		const result = await applyTexts(msg.items || []);
		send({ type: "textResult", reqId: msg.reqId, ...result });
		sendTree();          // 適用後の最新状態を続けて送る
		break;
	}
	default:
		break;
	}
}

//---------------------------------------------------------------------------
// レイヤツリー取得
//---------------------------------------------------------------------------

/// UXP の LayerKind を大まかな種別へ寄せる
function kindOf(layer) {
	const k = String(layer.kind || "").toLowerCase();
	if (k === "group") return "folder";
	if (k === "text") return "text";
	if (k === "solidcolor" || k === "gradientfill" || k === "patternfill") return "fill";
	if (k === "pixel" || k === "normal" || k === "smartobject" || k === "video") return "image";
	if (k === "") return "image";
	return "adjust";         // 残りは調整レイヤの類
}

/// layers は上から下の順で返ってくるので、そのまま並べれば Photoshop と同じ見た目
function walk(layers, depth, parentPath, parentId, out) {
	for (const l of layers) {
		try {
			walkOne(l, depth, parentPath, parentId, out);
		} catch (e) {
			// 読めないレイヤはスキップして続ける (全滅させない)
			console.error("[psdtext] layer skipped:", e);
		}
	}
}

function walkOne(l, depth, parentPath, parentId, out) {
	const kind = kindOf(l);
	const row = {
		id: l.id,
		name: l.name,
		kind,
		depth,
		parent: parentId,
		path: parentPath ? parentPath + "/" + l.name : l.name,
		visible: l.visible !== false,
		text: kind === "text",
		body: "",
	};
	if (row.text) {
		try {
			// Photoshop の改行 \r は UI では \n に統一する
			row.body = ((l.textItem && l.textItem.contents) || "").replace(/\r/g, "\n");
		} catch (e) { /* 空のまま */ }
	}
	out.push(row);
	if (kind === "folder" && l.layers) {
		walk(l.layers, depth + 1, row.path, l.id, out);
	}
}

function buildTree() {
	const doc = app.activeDocument;
	if (!doc) return { doc: null, rows: [] };
	const rows = [];
	walk(doc.layers, 0, "", -1, rows);
	return { doc: { id: doc.id, name: doc.name || "" }, rows };
}

function sendTree(reqId) {
	try {
		send({ type: "tree", reqId, ...buildTree() });
	} catch (e) {
		send({ type: "tree", reqId, doc: null, rows: [], message: String(e && e.message || e) });
	}
}

//---------------------------------------------------------------------------
// テキスト反映
//---------------------------------------------------------------------------

let applying = false;        // 自分の変更で通知リスナが暴れないように

function findLayerById(layers, id) {
	for (const l of layers) {
		if (l.id === id) return l;
		if (l.layers) {
			const f = findLayerById(l.layers, id);
			if (f) return f;
		}
	}
	return null;
}

/// items: [{id, text}] をまとめて反映し、履歴は 1 段にまとめる。
/// batchPlay で textKey を直接 set すると文字単位の書式が壊れることが
/// あるので、DOM API (textItem.contents) を使う。
async function applyTexts(items) {
	const doc = app.activeDocument;
	if (!doc) return { applied: 0, errors: [{ message: "no document" }] };

	let applied = 0;
	const errors = [];
	applying = true;
	try {
		await core.executeAsModal(async (ctx) => {
			const hist = await ctx.hostControl.suspendHistory({
				documentID: doc.id,
				name: "Edit Text",
			});
			try {
				for (const it of items) {
					try {
						const l = findLayerById(doc.layers, it.id);
						if (!l || !l.textItem) throw new Error("text layer not found: " + it.id);
						l.textItem.contents = String(it.text).replace(/\n/g, "\r");
						applied++;
					} catch (e) {
						errors.push({ id: it.id, message: String(e && e.message || e) });
					}
				}
			} finally {
				await ctx.hostControl.resumeHistory(hist);
			}
		}, { commandName: "Edit Text" });
	} finally {
		applying = false;
	}
	return { applied, errors };
}

//---------------------------------------------------------------------------
// Photoshop 側の変化を追いかける
//---------------------------------------------------------------------------

let refreshTimer = null;

function scheduleRefresh() {
	if (applying) return;
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => { refreshTimer = null; sendTree(); }, 400);
}

action.addNotificationListener(
	["set", "make", "delete", "move", "duplicate", "paste",
	 "open", "close", "select", "newDocument", "historyStateChanged"],
	scheduleRefresh
);

// DEBUG-BEGIN (dev/build-ccx.mjs がリリースビルドでこの区間を除去する)
//---------------------------------------------------------------------------
// 開発用デバッグ口 (dev/debug-server.mjs)
//---------------------------------------------------------------------------

function debugMirror(level, args) {
	try {
		const msg = args.map((a) => {
			if (typeof a === "string") return a;
			try { return JSON.stringify(a); } catch (e) { return String(a); }
		}).join(" ");
		wv.postMessage(JSON.stringify({ type: "log", msg: "[" + level + "] " + msg }));
	} catch (e) { /* webview 未ロードなど */ }
}

for (const level of ["log", "warn", "error"]) {
	const orig = console[level].bind(console);
	console[level] = (...args) => {
		orig(...args);
		debugMirror(level, args);
	};
}

const DEBUG_BASE = "http://127.0.0.1:18999";

async function debugPoll() {
	let fails = 0;
	while (fails < 5) {
		await new Promise((r) => setTimeout(r, 1000));
		try {
			const res = await fetch(DEBUG_BASE + "/poll?side=panel");
			const { cmds } = await res.json();
			fails = 0;
			for (const c of cmds || []) {
				let ok = true, value;
				try {
					value = await Promise.resolve(eval(c.js));
				} catch (e) {
					ok = false;
					value = String(e && (e.stack || e.message) || e);
				}
				try {
					await fetch(DEBUG_BASE + "/result", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							id: c.id, ok,
							value: typeof value === "string" ? value : JSON.stringify(value),
						}),
					});
				} catch (e) { /* ignore */ }
			}
		} catch (e) {
			fails++;
		}
	}
}
debugPoll();
// DEBUG-END

//---------------------------------------------------------------------------
// パネルのフライアウトメニュー (右上 ≡)
// entrypoints.setup は例外を投げうるので必ず最後に呼び、失敗しても
// ブリッジ (上のリスナ群) を巻き込まないこと。
//---------------------------------------------------------------------------

try {
	const { entrypoints } = require("uxp");
	entrypoints.setup({
		panels: {
			"psdtext.panel": {
				show() { /* パネルは index.html の読み込みで動いている */ },
				menuItems: [
					{ id: "help", label: "ヘルプ / Help" },
				],
				invokeMenu(id) {
					if (id === "help") send({ type: "showHelp" });
				},
			},
		},
	});
	console.log("[psdtext] flyout menu ready");
} catch (e) {
	// フライアウトが出ないだけ。ヘルプは webview 内の ? ボタンから開ける
	console.error("[psdtext] entrypoints.setup failed:", e);
}
