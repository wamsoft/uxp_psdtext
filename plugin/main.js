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
	case "readClipboard":
		// webview 側で読むと毎回 Chromium の許可ダイアログが出るので、
		// manifest で許可済みのこちら側で読んで渡す
		send({ type: "clipboard", reqId: msg.reqId, text: await readClipboardText() });
		break;
	case "applyTexts": {
		const result = await applyTexts(msg.items || []);
		send({ type: "textResult", reqId: msg.reqId, ...result });
		sendTree();          // 適用後の最新状態を続けて送る
		break;
	}
	case "getFonts":
		send({ type: "fonts", reqId: msg.reqId, fonts: listFonts() });
		break;
	case "getStyle":
		send({ type: "style", reqId: msg.reqId, ...readStyle(msg.id) });
		break;
	case "getRich":
		send({ type: "rich", reqId: msg.reqId, ...(await readRich(msg.id)) });
		break;
	case "getRichMany": {
		const map = {};
		for (const id of msg.ids || []) map[id] = await readRich(id);
		send({ type: "richMany", reqId: msg.reqId, map });
		break;
	}
	case "rawTextKey":   // 開発用: 記述子を生で見る
		send({ type: "raw", reqId: msg.reqId, raw: await rawTextKey(msg.id) });
		break;
	case "getUsedFonts":
		send({ type: "usedFonts", reqId: msg.reqId, fonts: usedFontsList() });
		break;
	case "getPrefs":
		send({ type: "prefs", reqId: msg.reqId, prefs: await readPrefs() });
		break;
	case "setPrefs":
		send({ type: "prefsSaved", reqId: msg.reqId, ok: await writePrefs(msg.prefs || {}) });
		break;
	default:
		break;
	}
}

/// UXP の clipboard API は環境によって文字列ではなく {"text/plain": "..."}
/// のようなオブジェクトを返すことがあるので、どちらでもテキストに揃える
function clipToText(v) {
	if (v === null || v === undefined) return "";
	if (typeof v === "string") return v;
	if (typeof v === "object") {
		return String(v["text/plain"] ?? v.plainText ?? v.text ?? "");
	}
	return String(v);
}

/// クリップボードのテキストを読む。readText → getContent の順に試す
async function readClipboardText() {
	try {
		if (navigator.clipboard.readText) {
			const t = clipToText(await navigator.clipboard.readText());
			if (t) return t;
		}
	} catch (e) { /* 次の形へ */ }
	try {
		if (navigator.clipboard.getContent) {
			return clipToText(await navigator.clipboard.getContent());
		}
	} catch (e) { /* 読めなかった */ }
	return "";
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

/// レイヤ全体の初期書式を適用する。style の指定されたフィールドだけ触る
function applyStyleTo(l, style) {
	if (!l.textItem) throw new Error("not a text layer: " + l.id);
	const cs = l.textItem.characterStyle;
	if (typeof style.font === "string" && style.font) cs.font = style.font;
	if (typeof style.size === "number" && style.size > 0) cs.size = style.size;
	if (typeof style.color === "string" && /^#[0-9a-fA-F]{6}$/.test(style.color)) {
		cs.color = makeSolidColor(style.color);
	}
	if (style.align === "left" || style.align === "center" || style.align === "right") {
		l.textItem.paragraphStyle.justification = justificationOf(style.align);
	}
}

/// items: [{id, text?, rich?, name?, style?}] をまとめて反映し、履歴は 1 段。
/// text はプレーン本文 (textItem.contents 経由 = 全体書式は保たれるが部分
/// 書式は落ちる)、rich は {text, ranges} で部分書式ごと書き戻す。
/// rich があるときの style は align だけ意味を持つ (文字属性は範囲に
/// 焼き込まれて届く。characterStyle で重ねると範囲書式を潰すため)。
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
						if (!l) throw new Error("layer not found: " + it.id);
						if (typeof it.name === "string" && it.name.trim() && it.name !== l.name) {
							l.name = it.name;
						}
						if (it.rich && typeof it.rich === "object") {
							await applyRichTo(it.id, it.rich);
						} else if (typeof it.text === "string") {
							if (!l.textItem) throw new Error("not a text layer: " + it.id);
							l.textItem.contents = it.text.replace(/\n/g, "\r");
						}
						if (it.style && typeof it.style === "object") {
							if (it.rich) {
								// 文字属性は範囲側で処理済み。段落の揃えだけ通す
								if (it.style.align) applyStyleTo(l, { align: it.style.align });
							} else {
								applyStyleTo(l, it.style);
							}
						}
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
// 部分書式 (textStyleRange の読み書き)
//
// レイヤの text 記述子を batchPlay で get/set する。webview 側はタグ付き
// テキストとして扱い、ここでは「プレーン本文 + 範囲ごとの簡易スタイル」の
// 形で受け渡す。行送りやトラッキング等のここで扱わない属性は、先頭ランの
// textStyle をテンプレートに全範囲へ引き継ぐ (psdtext と同じ流儀)。
//---------------------------------------------------------------------------

async function getTextKeyDesc(id) {
	const [res] = await action.batchPlay([{
		_obj: "get",
		_target: [
			{ _ref: "property", _property: "textKey" },
			{ _ref: "layer", _id: id },
		],
	}], {});
	return res && res.textKey;
}

async function rawTextKey(id) {
	try { return await getTextKeyDesc(id); }
	catch (e) { return { error: String(e && e.message || e) }; }
}

function unitVal(v) {
	return (v && typeof v === "object" && "_value" in v) ? v._value : v;
}

/// 記述子の RGBColor。緑は "grain" というキーで来る (Photoshop の古い癖)
function colorToHex(c) {
	if (!c) return "#000000";
	const g = c.grain !== undefined ? c.grain : c.green;
	return "#" + toHex2(c.red || 0) + toHex2(g || 0) + toHex2(c.blue || 0);
}

function simpleStyle(ts) {
	ts = ts || {};
	const u = ts.underline && ts.underline._value;
	const s = ts.strikethrough && ts.strikethrough._value;
	return {
		font: ts.fontPostScriptName || "",
		size: Number(unitVal(ts.size)) || 0,
		color: colorToHex(ts.color),
		bold: !!ts.syntheticBold,
		italic: !!ts.syntheticItalic,
		underline: !!(u && u !== "underlineOff"),
		strike: !!(s && s !== "strikethroughOff"),
	};
}

/// 記述子の揃えを UI 表現へ ("justifyLeft" などは 'justify' に寄せる)
function alignOf(ps) {
	const v = ps && ps.align && ps.align._value;
	if (v === "center" || v === "right") return v;
	if (typeof v === "string" && v.startsWith("justify")) return "justify";
	return "left";
}

function alignEnum(v) {
	const map = { left: "left", center: "center", right: "right", justify: "justifyLeft" };
	return { _enum: "alignmentType", _value: map[v] || "left" };
}

/// {text, ranges, paragraphs:[{from,to,align}]} を返す
async function readRich(id) {
	try {
		const tk = await getTextKeyDesc(id);
		if (!tk) return { message: "no textKey: " + id };
		const text = String(tk.textKey || "").replace(/\r/g, "\n");
		const ranges = (tk.textStyleRange || [])
			.slice().sort((a, b) => a.from - b.from)
			.map(r => ({ from: Math.max(0, r.from), to: Math.min(r.to, text.length),
			             ...simpleStyle(r.textStyle) }))
			.filter(r => r.to > r.from);
		const paragraphs = (tk.paragraphStyleRange || [])
			.slice().sort((a, b) => a.from - b.from)
			.map(p => ({ from: Math.max(0, p.from), to: Math.min(p.to, text.length),
			             align: alignOf(p.paragraphStyle) }))
			.filter(p => p.to > p.from);
		return { text, ranges, paragraphs };
	} catch (e) {
		return { message: String(e && e.message || e) };
	}
}

/// テンプレート (先頭ランの textStyle) に簡易スタイルを重ねる。
/// vertical は縦書きか (下線を引く側が変わる:
/// 横書き = underlineOnLeftInVertical / 縦書き = underlineOnRightInVertical。
/// どちらも Photoshop 自身が書く値を実測して合わせたもの)
function buildTextStyle(template, st, vertical) {
	const ts = JSON.parse(JSON.stringify(template || {}));
	ts._obj = "textStyle";
	if (st.font) {
		ts.fontPostScriptName = st.font;
		delete ts.fontName;        // PS 名と食い違うと古い方が勝つことがある
		delete ts.fontStyleName;
	}
	if (st.size > 0) {
		if (ts.size && typeof ts.size === "object" && "_value" in ts.size) {
			ts.size = { ...ts.size, _value: st.size };
		} else {
			ts.size = { _unit: "pointsUnit", _value: st.size };
		}
		delete ts.impliedFontSize; // 再計算させる
	}
	if (/^#[0-9a-fA-F]{6}$/.test(st.color || "")) {
		ts.color = {
			_obj: "RGBColor",
			red: parseInt(st.color.slice(1, 3), 16),
			grain: parseInt(st.color.slice(3, 5), 16),
			blue: parseInt(st.color.slice(5, 7), 16),
		};
	}
	ts.syntheticBold = !!st.bold;
	ts.syntheticItalic = !!st.italic;
	ts.underline = {
		_enum: "underline",
		_value: st.underline
			? (vertical ? "underlineOnRightInVertical" : "underlineOnLeftInVertical")
			: "underlineOff",
	};
	ts.strikethrough = {
		_enum: "strikethrough",
		_value: st.strike ? "xHeightStrikethroughOn" : "strikethroughOff",
	};
	return ts;
}

/// 段落範囲を新しい本文長に合わせて詰める (揃えの情報を保存するため)
function clampParagraphRanges(prs, len) {
	const out = [];
	for (const r of prs || []) {
		const c = JSON.parse(JSON.stringify(r));
		c.from = Math.max(0, Math.min(c.from, len));
		c.to = Math.min(c.to, len);
		if (c.to > c.from) out.push(c);
	}
	if (out.length) out[out.length - 1].to = len;
	return out;
}

/// rich = {text (\n区切り), ranges} をレイヤへ書き戻す (モーダル内から呼ぶ)
async function applyRichTo(id, rich) {
	const tk = await getTextKeyDesc(id);
	if (!tk) throw new Error("no textKey: " + id);
	const srcRanges = (tk.textStyleRange || []).slice().sort((a, b) => a.from - b.from);
	const template0 = (srcRanges[0] && srcRanges[0].textStyle) || {};
	const vertical = !!(tk.orientation && tk.orientation._value === "vertical");
	const psText = String(rich.text || "").replace(/\n/g, "\r");
	const len = psText.length;

	// 本文が変わっていなければ位置がそのまま対応するので、範囲ごとに
	// 「元のラン」をテンプレートに使う。tracking や縦中横の回転など、
	// こちらで扱わない属性をラン単位で保つため (先頭ランで塗り潰すと、
	// 和欧混在の縦書きで下線位置や字面がずれる)。
	const sameText = String(tk.textKey || "") === psText;
	const templateAt = (pos) => {
		if (!sameText) return template0;
		const hit = srcRanges.find(x => x.from <= pos && pos < x.to);
		return (hit && hit.textStyle) || template0;
	};

	let ranges = (rich.ranges || [])
		.map(r => ({
			_obj: "textStyleRange",
			from: Math.max(0, Math.min(r.from, len)),
			to: Math.min(r.to, len),
			textStyle: buildTextStyle(templateAt(r.from), r, vertical),
		}))
		.filter(r => r.to > r.from);
	if (!ranges.length) {
		ranges = [{ _obj: "textStyleRange", from: 0, to: len,
		            textStyle: buildTextStyle(template0, simpleStyle(template0), vertical) }];
	}
	ranges[ranges.length - 1].to = len;   // 端数を出さない

	const to = { _obj: "textLayer", textKey: psText, textStyleRange: ranges };

	// 段落範囲。webview から揃え付きで来ればそれを使い、無ければ元のものを
	// 新しい本文長に合わせて詰めるだけにする。テンプレートは文字範囲と同じく
	// 位置対応する元の段落から取る
	if (rich.paragraphs && rich.paragraphs.length) {
		const srcParas = (tk.paragraphStyleRange || []).slice().sort((a, b) => a.from - b.from);
		const ptemplate0 = (srcParas[0] && srcParas[0].paragraphStyle) || {};
		const ptemplateAt = (pos) => {
			if (!sameText) return ptemplate0;
			const hit = srcParas.find(x => x.from <= pos && pos < x.to);
			return (hit && hit.paragraphStyle) || ptemplate0;
		};
		const prs = rich.paragraphs
			.map(p => ({
				_obj: "paragraphStyleRange",
				from: Math.max(0, Math.min(p.from, len)),
				to: Math.min(p.to, len),
				paragraphStyle: { ...JSON.parse(JSON.stringify(ptemplateAt(p.from))),
				                  _obj: "paragraphStyle", align: alignEnum(p.align) },
			}))
			.filter(p => p.to > p.from);
		if (prs.length) {
			prs[prs.length - 1].to = len;
			to.paragraphStyleRange = prs;
		}
	} else {
		const prs = clampParagraphRanges(tk.paragraphStyleRange, len);
		if (prs.length) to.paragraphStyleRange = prs;
	}

	await action.batchPlay([{
		_obj: "set",
		_target: [{ _ref: "textLayer", _id: id }],
		to,
	}], {});
}

//---------------------------------------------------------------------------
// 初期書式 (レイヤ全体のフォント / サイズ / 色 / 揃え)
//
// characterStyle / paragraphStyle の DOM API を使う。文字範囲ごとの
// 部分書式はここでは扱わない (レイヤ全体の初期値だけ)。
//---------------------------------------------------------------------------

function listFonts() {
	const out = [];
	try {
		for (const f of app.fonts) {
			try {
				out.push({ ps: f.postScriptName, family: f.family, style: f.style });
			} catch (e) { /* 読めないフォントは飛ばす */ }
		}
	} catch (e) {
		console.error("[psdtext] listFonts failed:", e);
	}
	return out;
}

function toHex2(n) {
	return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/// レイヤの初期書式を読む。読めない属性は黙って欠落させる
function readStyle(id) {
	try {
		const doc = app.activeDocument;
		const l = doc && findLayerById(doc.layers, id);
		if (!l || !l.textItem) return { message: "text layer not found: " + id };
		const st = {};
		const cs = l.textItem.characterStyle;
		try { st.font = cs.font || ""; } catch (e) { /* skip */ }
		try { st.size = cs.size; } catch (e) { /* skip */ }
		try {
			const c = cs.color;
			st.color = "#" + toHex2(c.rgb.red) + toHex2(c.rgb.green) + toHex2(c.rgb.blue);
		} catch (e) { /* skip */ }
		try {
			const j = String(l.textItem.paragraphStyle.justification || "").toLowerCase();
			if (j.startsWith("left")) st.align = "left";
			else if (j.startsWith("center")) st.align = "center";
			else if (j.startsWith("right")) st.align = "right";
		} catch (e) { /* skip */ }
		return { style: st };
	} catch (e) {
		return { message: String(e && e.message || e) };
	}
}

function makeSolidColor(hex) {
	const ps = require("photoshop");
	const Ctor = (ps.app && ps.app.SolidColor) || ps.SolidColor;
	if (!Ctor) throw new Error("SolidColor class not available");
	const c = new Ctor();
	c.rgb.red = parseInt(hex.slice(1, 3), 16);
	c.rgb.green = parseInt(hex.slice(3, 5), 16);
	c.rgb.blue = parseInt(hex.slice(5, 7), 16);
	return c;
}

function justificationOf(align) {
	const J = require("photoshop").constants.Justification;
	return align === "left" ? J.LEFT : align === "center" ? J.CENTER : J.RIGHT;
}

/// いまのドキュメントのテキストレイヤで使われているフォント (PS 名) を集める
function usedFontsList() {
	const doc = app.activeDocument;
	const out = new Set();
	if (!doc) return [];
	const visit = (layers) => {
		for (const l of layers) {
			try {
				if (l.textItem) {
					const f = l.textItem.characterStyle.font;
					if (f) out.add(f);
				}
			} catch (e) { /* 読めないレイヤは飛ばす */ }
			try {
				if (l.layers) visit(l.layers);
			} catch (e) { /* ignore */ }
		}
	};
	visit(doc.layers);
	return [...out];
}

//---------------------------------------------------------------------------
// 設定の永続化 (お気に入りフォント等)
//
// webview では localStorage が使えないので、プラグインのデータフォルダに
// JSON で置く。
//---------------------------------------------------------------------------

const PREFS_FILE = "prefs.json";

async function readPrefs() {
	try {
		const { localFileSystem } = require("uxp").storage;
		const folder = await localFileSystem.getDataFolder();
		const file = await folder.getEntry(PREFS_FILE);
		return JSON.parse(await file.read()) || {};
	} catch (e) {
		return {};      // まだ無い / 読めない
	}
}

async function writePrefs(patch) {
	try {
		const { localFileSystem } = require("uxp").storage;
		const prev = await readPrefs();
		const next = { ...prev, ...patch };
		const folder = await localFileSystem.getDataFolder();
		const file = await folder.createFile(PREFS_FILE, { overwrite: true });
		await file.write(JSON.stringify(next));
		return true;
	} catch (e) {
		console.error("[psdtext] writePrefs failed:", e);
		return false;
	}
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
