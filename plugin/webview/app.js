//---------------------------------------------------------------------------
// PSD Text Edit — webview 側 UI
//
// psdtext のテキスト編集 (単体編集 + 一覧編集シート) を UXP webview 向けに
// 再構成したもの。CSV の代わりにクリップボードの TSV でやり取りする。
// レイヤの識別は Photoshop の永続レイヤ ID (layer.id) のみ。
// 改行はブリッジ (main.js) が \r ↔ \n を変換するので、ここは \n だけ扱う。
//---------------------------------------------------------------------------

import { dlog } from './debug.js';
import { wireModalClose, escapeModal } from './common/modal.js';
import { createBridge } from './common/bridge.js';
import { newIid, createDiag } from './common/diag.js';
import { createWakeHint } from './common/wake.js';
import { tr, applyI18n, toggleLang, currentLang, setLang } from './i18n.js';
import { baseStyle, sameValue, STYLE_ATTRS } from './tags.js';
import { rangesToTagged, taggedToRich } from './rich.js';

const $ = (sel) => document.querySelector(sel);

//---------------------------------------------------------------------------
// UXP パネルとの通信 (postMessage ブリッジ)
//---------------------------------------------------------------------------


/// この webview インスタンスの識別子 (診断行とパネルへの送信に載る)
const IID = newIid();

//---------------------------------------------------------------------------
// パネルとの配線。仕組みは共通モジュール (common/bridge.js)。
//---------------------------------------------------------------------------

const bridge = createBridge({
	iid: IID,
	timeoutMessage: (type) => tr('app.timeout', type),
	handlers: {
		tree: (msg) => applyTree(msg),
		log: (msg) => dlog('panel', msg.msg),      // パネル側のログをデバッグサーバへ
		showHelp: () => openHelp(),                // フライアウトメニューの「ヘルプ」
		showDiag: () => diag.toggle(),             // 同じく ≡ メニューから
	},
	isConnected: () => state.connected,
	onSendError: () => { if (!state.connected) renderAll(); },
	onGiveUp: () => { bridgeFailed = true; renderAll(); },
});

const { post, request } = bridge;

//---------------------------------------------------------------------------
// 自己診断行 (≡ メニュー / Ctrl+D)。仕組みは共通モジュール (common/diag.js)。
//---------------------------------------------------------------------------

const diag = createDiag({
	iid: IID,
	stats: bridge.stats,
	fields: () =>
		' conn:' + (state.connected ? 'Y' : 'n') +
		' rows:' + state.rows.length +
		' doc:' + (state.doc ? state.doc.name : '-') +
		' trees:' + treeLog.join(','),
});


//---------------------------------------------------------------------------
// 状態
//---------------------------------------------------------------------------

const state = {
	connected: false,   ///< 最初の tree が届いたら true
	lastError: '',      ///< パネル側でツリー構築に失敗したときの内容
	doc: null,          ///< {id, name} または null
	rows: [],           ///< パネルが作った行 (上から下)。{id,name,kind,depth,parent,path,visible,text,body}
	byId: new Map(),
	selected: null,     ///< 最後にクリックしたレイヤ id
	multi: new Set(),   ///< 複数選択 (id)
	collapsed: new Set(),
	filter: '',
};


/// 単体編集に未保存の変更があるか
function editDirty() {
	if (!editTarget) return false;
	if (editTouched) return true;
	try { return modelJson(activeModel()) !== editTarget.origJson; }
	catch (e) { return false; }
}

/// 表に未保存の変更があるか
function sheetDirty() {
	return sheetRows.some(sheetRowChanged);
}

const treeLog = [];   ///< 診断用: 受信したツリーの履歴 (D86 = doc有り86行, -0 = doc無し)

let prefsLoaded = false;

function applyTree(msg) {
	treeLog.push((msg.doc ? 'D' : '-') + (msg.rows || []).length);
	if (treeLog.length > 8) treeLog.shift();
	if (!prefsLoaded) {          // 接続が立った最初のタイミングで設定を読む
		prefsLoaded = true;
		loadPrefs();
	}
	state.connected = true;
	state.lastError = msg.message || '';
	state.doc = msg.doc;
	state.rows = msg.rows || [];
	state.byId = new Map(state.rows.map(r => [r.id, r]));

	// 消えたレイヤの選択・折り畳みは掃除する
	state.multi = new Set([...state.multi].filter(id => state.byId.has(id)));
	if (state.selected !== null && !state.byId.has(state.selected)) state.selected = null;
	state.collapsed = new Set([...state.collapsed].filter(id => state.byId.has(id)));

	renderAll();
	refreshEditFromTree();
	// シートは開いた時点のスナップショット (適用時に読み直す)。ここでは触らない
}

//---------------------------------------------------------------------------
// レイヤツリー描画
//---------------------------------------------------------------------------

const KIND_ICON = {
	folder: '📁', text: 'T', image: '🖼', adjust: '◐', fill: '■',
};

function hiddenByCollapse(row) {
	let p = row.parent, guard = 0;
	while (p >= 0 && guard++ < 64) {
		if (state.collapsed.has(p)) return true;
		const pn = state.byId.get(p);
		p = pn ? pn.parent : -1;
	}
	return false;
}

function matchesFilter(row) {
	const f = state.filter.trim().toLowerCase();
	if (!f) return true;
	if (row.path.toLowerCase().includes(f)) return true;
	return !!(row.body && row.body.toLowerCase().includes(f));
}

function passesListFilter(row) {
	if ($('#fltText').checked && !row.text) return false;
	if ($('#fltVisible').checked && row.visible === false) return false;
	return true;
}

function listFilterOn() {
	return !!($('#fltText').checked || $('#fltVisible').checked || state.filter.trim());
}

/// フィルタが効いているとき、フォルダは中身が残っている場合だけ出す
function folderHasVisibleChild(id) {
	for (const r of state.rows) {
		let p = r.parent, guard = 0;
		while (p >= 0 && guard++ < 64) {
			if (p === id) {
				if (r.kind !== 'folder' && matchesFilter(r) && passesListFilter(r)) return true;
				break;
			}
			const pn = state.byId.get(p);
			p = pn ? pn.parent : -1;
		}
	}
	return false;
}

/// 画面に並んでいる行 (shift 選択の範囲計算用)
function listedLayers() {
	return state.rows.filter(r => {
		if (hiddenByCollapse(r)) return false;
		if (r.kind === 'folder') return !listFilterOn() || folderHasVisibleChild(r.id);
		return matchesFilter(r) && passesListFilter(r);
	});
}

function renderAll() {
	$('#docName').textContent = state.doc ? state.doc.name : '';
	$('#docName').title = state.doc ? state.doc.name : '';
	$('#layerCount').textContent = state.doc
		? tr('app.layers', state.rows.length, state.rows.filter(r => r.text).length) : '';
	$('#noDoc').hidden = !!state.doc;
	$('#noDocMsg').textContent = state.connected ? tr('app.noDoc')
	                           : bridgeFailed    ? tr('app.bridgeFail')
	                                             : tr('app.connecting');
	const diag = state.connected ? '' :
		'uxpHost: ' + (!window.uxpHost ? 'none' : window.uxpHost.__mock ? 'mock' : 'ok') +
		' / sent: ' + bridge.stats.sendTries +
		(bridge.stats.lastSendError ? ' / error: ' + bridge.stats.lastSendError : '');
	$('#noDocDetail').textContent = state.lastError || diag;
	$('#sheetBtn').disabled = !state.doc;
	$('#selTextsBtn').disabled = !state.doc;
	$('#selCount').textContent =
		state.multi.size > 1 ? tr('sel.count', state.multi.size) : '';
	renderTree();
}

function renderTree() {
	const host = $('#tree');
	host.textContent = '';
	const hasChild = new Set(state.rows.map(r => r.parent).filter(p => p >= 0));

	for (const l of listedLayers()) {
		const row = document.createElement('div');
		row.className = 'tree-row' +
			(state.selected === l.id ? ' sel' : '') +
			(l.visible === false ? ' hidden-layer' : '');
		if (state.multi.has(l.id) && state.multi.size > 1) row.classList.add('multi');
		row.style.paddingLeft = (l.depth * 14 + 4) + 'px';
		row.dataset.id = l.id;

		const twist = document.createElement('span');
		twist.className = 'twist';
		if (hasChild.has(l.id)) {
			twist.textContent = state.collapsed.has(l.id) ? '▸' : '▾';
			twist.addEventListener('click', (e) => {
				e.stopPropagation();
				if (state.collapsed.has(l.id)) state.collapsed.delete(l.id);
				else state.collapsed.add(l.id);
				renderTree();
			});
		}

		const icon = document.createElement('span');
		icon.className = 'tree-icon';
		icon.textContent = KIND_ICON[l.kind] || '·';

		const name = document.createElement('span');
		name.className = 'tree-name';
		name.textContent = l.name;

		row.append(twist, icon, name);

		if (l.text) {
			const body = document.createElement('span');
			body.className = 'tree-body';
			body.textContent = (l.body || '').replace(/\n/g, ' ');
			body.title = l.body || '';
			row.appendChild(body);
			// 編集導線を見えるように: 行末の ✎ (ダブルクリック / F2 でも開く)
			const pen = document.createElement('span');
			pen.className = 'row-edit';
			pen.textContent = '✎';
			pen.title = tr('tree.edit.hint');
			pen.addEventListener('click', (e) => {
				e.stopPropagation();
				openEditDialog(l.id);
			});
			row.appendChild(pen);
			row.title = tr('tree.edit.hint');
			row.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				openEditDialog(l.id);
			});
		} else {
			row.title = l.path;
		}

		row.addEventListener('click', (e) => clickLayer(l.id, e));
		host.appendChild(row);
	}
}

//---------------------------------------------------------------------------
// 選択 (クリック / Ctrl / Shift)
//---------------------------------------------------------------------------

function select(id) {
	state.selected = id;
	state.multi = new Set([id]);
	renderAll();
}

/// 一覧に出ているテキストレイヤを全部選択する
function selectAllTexts() {
	const ids = state.rows
		.filter(r => r.text && matchesFilter(r) && passesListFilter(r))
		.map(r => r.id);
	state.multi = new Set(ids);
	state.selected = ids.length ? ids[0] : null;
	renderAll();
}

function clickLayer(id, e) {
	if (e && (e.ctrlKey || e.metaKey)) {
		if (state.multi.has(id) && state.multi.size > 1) {
			state.multi.delete(id);
			if (state.selected === id) state.selected = [...state.multi][0];
		} else {
			state.multi.add(id);
			state.selected = id;
		}
		renderAll();
		return;
	}
	if (e && e.shiftKey && state.selected !== null) {
		const order = listedLayers().map(l => l.id);
		const a = order.indexOf(state.selected);
		const b = order.indexOf(id);
		if (a >= 0 && b >= 0) {
			const [s, t] = a <= b ? [a, b] : [b, a];
			state.multi = new Set(order.slice(s, t + 1));
			state.selected = id;
			renderAll();
			return;
		}
	}
	select(id);
}

//---------------------------------------------------------------------------
// 単体編集 (ダブルクリック / F2)
//---------------------------------------------------------------------------

let editTarget = null;   ///< {id, origJson, origName, origStyle, richBase, useRich, loaded}
const editTouched = { font: false, size: false, color: false, leading: false, tracking: false, align: false };

//---------------------------------------------------------------------------
// WYSIWYG エディタ (Quill)
//
// 内部モデル {text, ranges, paragraphs} を Quill の Delta に変換して編集し、
// 適用時に Delta から書き戻す。カーソルの書式継承・IME・エディタ内 Undo は
// Quill が面倒を見る。サイズとフォントはカスタム属性で「実値 (pt / PS 名)」
// を DOM の data 属性に持ち、表示だけ縮尺・ファミリ名にする。
//---------------------------------------------------------------------------

let quill = null;
let editScale = 1;      ///< 表示縮尺 (基準サイズ ≈ 14px)
let tagMode = false;    ///< タグ編集モード中か
let fmtSyncTimer = null;
let lastQuillSel = null;   ///< 直近のエディタ内選択 (ツールバー操作の復元用)

function eqStyle(a, z) {
	return STYLE_ATTRS.every(k => sameValue(k, a[k], z[k]));
}

function editBase() {
	return baseStyle(editTarget && editTarget.richBase || {});
}

/// 基準 + 基準欄でユーザーが触った値
function editBaseMerged() {
	const b = { ...editBase() };
	if (editTouched.font) {
		const f = resolveFontPs($('#editFont'));
		if (f) b.font = f;
	}
	if (editTouched.size) {
		const v = parseFloat($('#editSize').value);
		if (v > 0) b.size = v;
	}
	if (editTouched.color) b.color = $('#editColor').value;
	if (editTouched.leading) {
		const v = $('#editLeading').value.trim();
		b.leading = v === '' ? 0 : (parseFloat(v) || 0);
	}
	if (editTouched.tracking) b.tracking = parseFloat($('#editTracking').value) || 0;
	return b;
}

/// 隣り合う同一スタイルをまとめ、空範囲を捨てる
function mergeRanges(model) {
	const out = [];
	for (const r of model.ranges) {
		if (r.to <= r.from) continue;
		const last = out[out.length - 1];
		if (last && last.to === r.from && eqStyle(last, r)) last.to = r.to;
		else out.push({ ...r });
	}
	if (!out.length) out.push({ from: 0, to: model.text.length, ...editBase() });
	return { text: model.text, ranges: out, paragraphs: model.paragraphs || [] };
}

/// 変更検出用の正規形 (段落の揃えも含む)
function modelJson(model) {
	const m = mergeRanges(model);
	return JSON.stringify([
		m.text,
		m.ranges.map(r => [r.from, r.to, r.font, r.size, r.color, r.bold, r.italic, r.underline, r.strike, r.leading, r.tracking]),
		(m.paragraphs || []).map(p => [p.from, p.to, p.align || 'left']),
	]);
}

function initQuill() {
	if (quill) return;
	const { StyleAttributor, Scope } = Quill.import('parchment');

	// サイズ: 実 pt を data-pt に持ち、表示は縮尺した px
	class PtSizeAttr extends StyleAttributor {
		add(node, value) {
			const pt = parseFloat(value);
			if (!(pt > 0)) return false;
			node.style.fontSize = Math.max(8, Math.min(64, pt * editScale)) + 'px';
			node.setAttribute('data-pt', String(pt));
			return true;
		}
		value(node) { return node.getAttribute('data-pt') || ''; }
		remove(node) { node.style.fontSize = ''; node.removeAttribute('data-pt'); }
		canAdd() { return true; }
	}
	// フォント: PS 名を data-ps に持ち、表示はファミリ名
	class PsFontAttr extends StyleAttributor {
		add(node, value) {
			const f = fontsCache.find(x => x.ps === value);
			node.style.fontFamily = f ? '"' + f.family + '"' : (value || '');
			node.setAttribute('data-ps', value || '');
			return true;
		}
		value(node) { return node.getAttribute('data-ps') || ''; }
		remove(node) { node.style.fontFamily = ''; node.removeAttribute('data-ps'); }
		canAdd() { return true; }
	}
	Quill.register(new PtSizeAttr('psize', 'font-size', { scope: Scope.INLINE }), true);
	Quill.register(new PsFontAttr('psfont', 'font-family', { scope: Scope.INLINE }), true);
	// 行間・字送りは表示には反映せず、データ属性として運ぶだけ
	const { Attributor } = Quill.import('parchment');
	Quill.register(new Attributor('pslead', 'data-lead', { scope: Scope.INLINE }), true);
	Quill.register(new Attributor('pstrack', 'data-track', { scope: Scope.INLINE }), true);
	Quill.register(Quill.import('attributors/style/color'), true);
	Quill.register(Quill.import('attributors/style/align'), true);

	quill = new Quill('#editRich', {
		modules: { toolbar: false, history: { userOnly: true } },
		formats: ['bold', 'italic', 'underline', 'strike', 'color', 'psize', 'psfont', 'pslead', 'pstrack', 'align'],
	});
	quill.on('editor-change', () => {
		if (fmtSyncTimer) clearTimeout(fmtSyncTimer);
		fmtSyncTimer = setTimeout(syncFmtBar, 60);
	});
	// ツールバー操作でフォーカスが外れても選択を思い出せるように控えておく
	quill.on('selection-change', (r) => { if (r) lastQuillSel = r; });
}

/// モデルをエディタへ流し込む
function modelToEditor(model) {
	initQuill();
	const m = mergeRanges(model);
	editScale = Math.max(0.1, Math.min(2, 14 / ((m.ranges[0] && m.ranges[0].size) || 24)));
	const Delta = Quill.import('delta');
	const d = new Delta();
	let pos = 0;
	const push = (t, st) => {
		if (!t) return;
		const attrs = {};
		if (st.bold) attrs.bold = true;
		if (st.italic) attrs.italic = true;
		if (st.underline) attrs.underline = true;
		if (st.strike) attrs.strike = true;
		if (st.color) attrs.color = st.color;
		if (st.size > 0) attrs.psize = String(st.size);
		if (st.font) attrs.psfont = st.font;
		attrs.pslead = String(st.leading || 0);
		attrs.pstrack = String(st.tracking || 0);
		d.insert(t, attrs);
	};
	for (const r of m.ranges) {
		if (r.from > pos) push(m.text.slice(pos, r.from), editBase());
		push(m.text.slice(r.from, r.to), baseStyle(r));
		pos = r.to;
	}
	if (pos < m.text.length) push(m.text.slice(pos), editBase());
	quill.setContents(d, 'silent');
	for (const p of m.paragraphs || []) {
		if (p.align && p.align !== 'left')
			quill.formatLine(p.from, Math.max(1, p.to - p.from), 'align', p.align, 'silent');
	}
	quill.history.clear();
	syncFmtBar();
}

/// エディタからモデルへ (Quill 末尾の見えない改行は取り除く)
function editorToModel() {
	const b = editBase();
	const ops = (quill ? quill.getContents().ops : []) || [];
	let text = '';
	const ranges = [];
	const paragraphs = [];
	let lineStart = 0;
	const push = (piece, at) => {
		if (!piece) return;
		const sz = parseFloat(at.psize);
		const st = {
			font: at.psfont || b.font,
			size: sz > 0 ? sz : b.size,
			color: (typeof at.color === 'string' && at.color) ? at.color : b.color,
			bold: !!at.bold, italic: !!at.italic, underline: !!at.underline,
			strike: !!at.strike,
			leading: at.pslead !== undefined ? (parseFloat(at.pslead) || 0) : b.leading,
			tracking: at.pstrack !== undefined ? (parseFloat(at.pstrack) || 0) : b.tracking,
		};
		const from = text.length;
		text += piece;
		const last = ranges[ranges.length - 1];
		if (last && eqStyle(last, st)) last.to = text.length;
		else ranges.push({ from, to: text.length, ...st });
	};
	for (const op of ops) {
		if (typeof op.insert !== 'string') continue;
		const at = op.attributes || {};
		let s = op.insert;
		for (;;) {
			const i = s.indexOf('\n');
			if (i < 0) { push(s, at); break; }
			push(s.slice(0, i), at);
			// 改行が行属性 (揃え) を運ぶ。PS の段落範囲は改行込みなので +1
			paragraphs.push({ from: lineStart, to: text.length + 1,
			                  align: typeof at.align === 'string' ? at.align : 'left' });
			push('\n', at);
			lineStart = text.length;
			s = s.slice(i + 1);
		}
	}
	if (text.endsWith('\n')) {          // Quill が必ず足す終端の改行を落とす
		text = text.slice(0, -1);
		const last = ranges[ranges.length - 1];
		if (last) {
			last.to = Math.min(last.to, text.length);
			if (last.to <= last.from) ranges.pop();
		}
		const lp = paragraphs[paragraphs.length - 1];
		if (lp) lp.to = Math.min(lp.to, text.length);
	}
	if (!ranges.length) ranges.push({ from: 0, to: text.length, ...b });
	else ranges[ranges.length - 1].to = text.length;
	if (!paragraphs.length) paragraphs.push({ from: 0, to: text.length, align: 'left' });
	else {
		const lp = paragraphs[paragraphs.length - 1];
		if (lp.to < text.length) paragraphs.push({ from: lineStart, to: text.length, align: lp.align });
		else lp.to = text.length;
	}
	return { text, ranges, paragraphs };
}

//--- タグ編集モード ---------------------------------------------------------

/// タグは揃えを運ばないので、行番号ベースで揃えを引き継ぐ
function remapParagraphs(saved, newText) {
	const aligns = (saved || []).map(p => p.align || 'left');
	const out = [];
	let from = 0, i = 0;
	for (;;) {
		const nl = newText.indexOf('\n', from);
		const to = nl < 0 ? newText.length : nl + 1;
		out.push({ from, to, align: aligns[Math.min(i, aligns.length - 1)] || 'left' });
		if (nl < 0) break;
		from = nl + 1;
		i++;
	}
	out[out.length - 1].to = newText.length;
	return out;
}

function setTagMode(on) {
	if (!editTarget || on === tagMode) return;
	if (on) {
		const m = editorToModel();
		editTarget.savedParagraphs = m.paragraphs;
		$('#editTags').value = rangesToTagged(m.text, m.ranges);
		$('#editRich').hidden = true;
		$('#editTags').hidden = false;
		$('#editTags').focus();
	} else {
		const rich = taggedToRich($('#editTags').value, editBaseMerged());
		modelToEditor({
			text: rich.text, ranges: rich.ranges,
			paragraphs: remapParagraphs(editTarget.savedParagraphs, rich.text),
		});
		$('#editTags').hidden = true;
		$('#editRich').hidden = false;
		quill.focus();
	}
	tagMode = on;
	$('#fmtMode').textContent = tr(on ? 'fmt.mode.wysiwyg' : 'fmt.mode.tag');
	for (const id of ['#fmtB', '#fmtI', '#fmtU', '#fmtS', '#fmtSize', '#fmtSizeApply',
	                  '#fmtColor', '#fmtColorApply', '#fmtAlL', '#fmtAlC',
	                  '#fmtAlR', '#fmtAlJ', '#fmtReset'])
		$(id).disabled = on;
}

/// いま画面に出ている方 (エディタ or タグ) からモデルを取る
function activeModel() {
	if (tagMode) {
		const rich = taggedToRich($('#editTags').value, editBaseMerged());
		return {
			text: rich.text, ranges: rich.ranges,
			paragraphs: remapParagraphs(editTarget && editTarget.savedParagraphs, rich.text),
		};
	}
	return editorToModel();
}

//--- ツールバー = カーソル位置のインスペクタ --------------------------------

function fmtFormat(name, value) {
	if (tagMode || !quill) return;
	quill.focus();
	// フォントコンボ等で入力欄に触れると選択が飛ぶので、控えから戻す
	if (lastQuillSel && !quill.getSelection()) quill.setSelection(lastQuillSel, 'silent');
	quill.format(name, value);
	syncFmtBar();
}

function syncFmtBar() {
	if (!editTarget || $('#editDialog').hidden || tagMode || !quill) return;
	const sel = quill.getSelection();
	const f = sel ? quill.getFormat(sel) : {};
	const b = editBase();
	$('#fmtB').classList.toggle('on', f.bold === true);
	$('#fmtI').classList.toggle('on', f.italic === true);
	$('#fmtU').classList.toggle('on', f.underline === true);
	$('#fmtS').classList.toggle('on', f.strike === true);
	const al = typeof f.align === 'string' ? f.align : 'left';
	$('#fmtAlL').classList.toggle('on', al === 'left');
	$('#fmtAlC').classList.toggle('on', al === 'center');
	$('#fmtAlR').classList.toggle('on', al === 'right');
	$('#fmtAlJ').classList.toggle('on', al === 'justify');
	const size = parseFloat(f.psize) > 0 ? parseFloat(f.psize) : b.size;
	if (document.activeElement !== $('#fmtSize')) $('#fmtSize').value = size || '';
	if (typeof f.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.color))
		$('#fmtColor').value = f.color.toLowerCase();
	const ps = typeof f.psfont === 'string' && f.psfont ? f.psfont : b.font;
	if (document.activeElement !== $('#fmtFont')) setFontValue($('#fmtFont'), ps);
}

/// 選択範囲 (またはカーソル以降の入力) を基準の書式へ戻す
function resetSelToBase() {
	if (tagMode || !quill) return;
	const b = editBase();
	quill.focus();
	quill.format('bold', b.bold || false);
	quill.format('italic', b.italic || false);
	quill.format('underline', b.underline || false);
	quill.format('strike', b.strike || false);
	quill.format('color', b.color || false);
	quill.format('psize', b.size > 0 ? String(b.size) : false);
	quill.format('psfont', b.font || false);
	syncFmtBar();
}

//---------------------------------------------------------------------------

function openEditDialog(id) {
	const row = state.byId.get(id);
	if (!row || !row.text) return;
	editTarget = {
		id, origName: row.name, origStyle: {}, origJson: '',
		richBase: baseStyle({}), useRich: false, loaded: false,
	};
	for (const k of Object.keys(editTouched)) editTouched[k] = false;
	$('#editTitle').textContent = row.name;
	$('#editPath').textContent = row.path;
	$('#editName').value = row.name;
	$('#editFont').value = '';
	$('#editFont').dataset.ps = '';
	$('#editSize').value = '';
	$('#editColor').value = '#ffffff';
	$('#editLeading').value = '';
	$('#editTracking').value = '';
	// モード表示をリセットしつつ、仮表示 (プレーン)。rich が読めたら差し替える
	if (tagMode) setTagMode(false);
	modelToEditor({ text: row.body || '', ranges: [], paragraphs: [] });
	editTarget.origJson = modelJson(editorToModel());
	setStatus('#editStatus', '');
	$('#editDialog').hidden = false;
	quill.focus();
	ensureFonts();
	refreshUsedFonts();
	loadEditRich(id);
}

/// 部分書式と基準書式を読んで、エディタと欄に反映する。
/// rich が読めないレイヤはプレーン編集のまま動く。
async function loadEditRich(id) {
	try {
		const [richRes, styleRes] = await Promise.all([
			request('getRich', { id }),
			request('getStyle', { id }),
		]);
		await ensureFonts();   // フォントのファミリ名表示のため
		if (!editTarget || editTarget.id !== id) return;   // もう別のレイヤを開いた
		const st = styleRes.style || {};
		const unedited = modelJson(activeModel()) === editTarget.origJson;

		if (!richRes.message) {
			editTarget.useRich = true;
			editTarget.richBase = baseStyle((richRes.ranges || [])[0] || {});
			const model = { text: richRes.text || '', ranges: richRes.ranges || [],
			                paragraphs: richRes.paragraphs || [] };
			if (unedited && !tagMode) modelToEditor(model);
			editTarget.origJson = modelJson(model);
			const b = editTarget.richBase;
			editTarget.origStyle = { font: b.font, size: b.size, color: b.color,
			                         leading: b.leading, tracking: b.tracking };
		} else {
			editTarget.richBase = baseStyle({ font: st.font, size: st.size, color: st.color });
			if (unedited && !tagMode) {
				const m = editorToModel();
				modelToEditor({ text: m.text, ranges: [], paragraphs: [] });
				editTarget.origJson = modelJson(editorToModel());
			}
			editTarget.origStyle = st;
		}

		const os = editTarget.origStyle;
		if (!editTouched.font && os.font) setFontValue($('#editFont'), os.font);
		if (!editTouched.size && typeof os.size === 'number' && os.size > 0)
			$('#editSize').value = os.size;
		if (!editTouched.color && os.color) $('#editColor').value = os.color;
		if (!editTouched.leading) $('#editLeading').value = os.leading > 0 ? os.leading : '';
		if (!editTouched.tracking) $('#editTracking').value = os.tracking ? os.tracking : '';
		editTarget.loaded = true;
	} catch (e) { /* プレーン編集のまま */ }
}

function closeEditDialog() {
	$('#editDialog').hidden = true;
	editTarget = null;
}

/// PS 側の更新が届いたら、未編集の欄だけ追従させる。
/// rich モードの本文はツリーのプレーン本文では同期できないので触らない。
function refreshEditFromTree() {
	if (!editTarget || $('#editDialog').hidden) return;
	const fresh = state.byId.get(editTarget.id);
	if (!fresh) return;
	const ni = $('#editName');
	if (!editTarget.useRich && !tagMode) {
		const unedited = modelJson(editorToModel()) === editTarget.origJson;
		if (unedited && !quill.hasFocus()) {
			modelToEditor({ text: fresh.body || '', ranges: [], paragraphs: [] });
			editTarget.origJson = modelJson(editorToModel());
		}
	}
	const nameUnedited = ni.value === editTarget.origName;
	editTarget.origName = fresh.name;
	if (nameUnedited && document.activeElement !== ni) ni.value = editTarget.origName;
	$('#editTitle').textContent = fresh.name;
}

/// ユーザーが触った書式欄のうち、読み込んだ値から変わったものだけ集める
function editStyleDiff() {
	const st = editTarget.origStyle || {};
	const out = {};
	const font = resolveFontPs($('#editFont'));
	if (editTouched.font && font && font !== st.font) out.font = font;
	const size = parseFloat($('#editSize').value);
	if (editTouched.size && size > 0 && size !== st.size) out.size = size;
	const color = $('#editColor').value;
	if (editTouched.color && color !== st.color) out.color = color;
	if (editTouched.leading) {
		const v = $('#editLeading').value.trim();
		const lv = v === '' ? 0 : (parseFloat(v) || 0);
		if (!sameValue('leading', lv, st.leading || 0)) out.leading = lv;
	}
	if (editTouched.tracking) {
		const tv = parseFloat($('#editTracking').value) || 0;
		if (!sameValue('tracking', tv, st.tracking || 0)) out.tracking = tv;
	}
	return Object.keys(out).length ? out : null;
}

async function applyEdit() {
	if (!editTarget) return;
	const model = mergeRanges(activeModel());
	const curJson = modelJson(model);
	const name = $('#editName').value;
	const style = editStyleDiff();   // 触った欄のうち変わったものだけ
	const item = { id: editTarget.id };

	// 基準欄の変更は「基準と同じ値だった範囲」へ連動させる (psdtext と同じ意味論)
	const ranges = model.ranges.map(r => ({ ...r }));
	const newBase = { ...editTarget.richBase };
	const charChanged = !!(style && ['font', 'size', 'color', 'leading', 'tracking'].some(k => k in style));
	if (charChanged) {
		for (const attr of ['font', 'size', 'color', 'leading', 'tracking']) {
			if (!(attr in style)) continue;
			for (const r of ranges)
				if (sameValue(attr, r[attr], editTarget.richBase[attr])) r[attr] = style[attr];
			newBase[attr] = style[attr];
		}
	}

	if (editTarget.useRich) {
		if (curJson !== editTarget.origJson || charChanged) {
			item.rich = {
				text: model.text,
				ranges: ranges.map(r => ({
					from: r.from, to: r.to, font: r.font, size: r.size,
					color: r.color, bold: r.bold, italic: r.italic, underline: r.underline,
					strike: r.strike, leading: r.leading, tracking: r.tracking,
				})),
				paragraphs: (model.paragraphs || []).map(p => ({
					from: p.from, to: p.to, align: p.align || 'left',
				})),
			};
		}
	} else {
		if (curJson !== editTarget.origJson) item.text = model.text;
		if (style) item.style = style;
	}
	if (name.trim() && name !== editTarget.origName) item.name = name;

	if (!item.rich && item.text === undefined && item.name === undefined && !item.style) {
		setStatus('#editStatus', tr('edit.done'), 'ok');   // 変更なし
		return;
	}
	setStatus('#editStatus', tr('edit.working'));
	$('#editApply').disabled = true;
	try {
		const res = await request('applyTexts', { items: [item] });
		if ((res.errors || []).length) throw new Error(res.errors[0].message);
		if (item.rich) {
			editTarget.richBase = baseStyle(newBase);
			if (!tagMode) modelToEditor({ text: model.text, ranges, paragraphs: model.paragraphs });
		}
		editTarget.origJson = modelJson({ text: model.text, ranges, paragraphs: model.paragraphs });
		if (item.name !== undefined) editTarget.origName = name;
		if (style) {
			Object.assign(editTarget.origStyle, style);
			for (const k of Object.keys(editTouched)) editTouched[k] = false;
		}
		setStatus('#editStatus', tr('edit.done'), 'ok');
	} catch (e) {
		setStatus('#editStatus', String(e.message || e), 'error');
	} finally {
		$('#editApply').disabled = false;
	}
}

function setStatus(sel, msg, cls) {
	const el = $(sel);
	el.textContent = msg || '';
	el.className = 'status' + (cls ? ' ' + cls : '');
}

//---------------------------------------------------------------------------
// TSV (クリップボード連携。CSV の代わり)
//---------------------------------------------------------------------------

/// タブ・改行・引用符を含むフィールドは Excel 互換の "" 引用にする
function tsvField(s) {
	return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/// Excel 互換の TSV を行×列に分解する (引用フィールド内の改行・タブ対応)
function parseTsv(text) {
	const rows = [[]];
	let field = '', inQ = false;
	const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (inQ) {
			if (c === '"') {
				if (src[i + 1] === '"') { field += '"'; i++; }
				else inQ = false;
			} else field += c;
		} else if (c === '"' && field === '') {
			inQ = true;
		} else if (c === '\t') {
			rows[rows.length - 1].push(field); field = '';
		} else if (c === '\n') {
			rows[rows.length - 1].push(field); field = '';
			rows.push([]);
		} else field += c;
	}
	rows[rows.length - 1].push(field);
	// 末尾の空行 (コピー時の終端改行ぶん) は捨てる
	while (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();
	return rows;
}

async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (e) {
		// クリップボード API が使えない環境向けの保険
		const ta = document.createElement('textarea');
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	}
}

//---------------------------------------------------------------------------
// 一覧編集シート (psdtext の一覧編集の移植)
//
// カラム: 名前 / 本文 (プレーン) / フォント / サイズ / 色 / 揃え。
// 書式カラムは基準 (先頭ラン) の値で、変えても本文途中の部分書式は温存する。
// 本文を書き換えた行だけは途中の書式が落ちる (psdtext と同じ。件数を報告)。
// 見出しのチェックは「コピー / 貼り付けをどの列に効かせるか」で、
// 編集そのものはチェックに関係なくできる。
//---------------------------------------------------------------------------

const SHEET_COLS = ['name', 'text', 'font', 'size', 'color', 'align'];
const SHEET_PRESETS = {
	text:    ['text'],
	style:   ['font', 'size', 'color', 'align'],
	name:    ['name'],
	notname: SHEET_COLS.filter(k => k !== 'name'),
	all:     SHEET_COLS,
};

let sheetRows = [];      ///< [{id, vals, orig, rich, marks, els}]
let sheetColSel = null;  ///< コピペ対象カラム (Set。null = 全部)

function sheetTargets() {
	const mode = $('#shTarget').value;
	return state.rows.filter(r => r.text && (mode === 'text' || state.multi.has(r.id)));
}

function sheetColOn(key) {
	return !sheetColSel || sheetColSel.has(key);
}

function sheetColsOn() {
	return SHEET_COLS.filter(sheetColOn);
}

function sheetCellChanged(r, key) {
	return String(r.vals[key]) !== String(r.orig[key]);
}

function sheetRowChanged(r) {
	// 名前は空にできない (空欄は「変えない」扱い)
	return SHEET_COLS.some(k => {
		if (k === 'name' && !String(r.vals.name).trim()) return false;
		return sheetCellChanged(r, k);
	});
}

function openSheetDialog() {
	if (!state.doc) return;
	// 複数選んでいるなら、その選択を直したいはず
	$('#shTarget').value = state.multi.size > 1 ? 'sel' : 'text';
	buildSheet();
	setStatus('#shStatus', '');
	$('#sheetDialog').hidden = false;
	ensureFonts();
	refreshUsedFonts();
}

function closeSheetDialog() {
	$('#sheetDialog').hidden = true;
	closeCellMenu();
	sheetRows = [];
}

/// 表の元データを作り直す (画面の値は捨てる)。書式は rich を後追いで読む
function buildSheet() {
	const targets = sheetTargets();
	sheetRows = targets.map(r => {
		const vals = { name: r.name, text: r.body || '', font: '', size: 0,
		               color: '#000000', align: 'left' };
		return { id: r.id, vals, orig: { ...vals }, rich: null, marks: 0, els: {} };
	});
	renderSheet();
	loadSheetRich(targets.map(r => r.id));
}

async function loadSheetRich(ids) {
	if (!ids.length) return;
	try {
		const res = await request('getRichMany', { ids });
		for (const r of sheetRows) {
			const d = (res.map || {})[r.id];
			if (!d || d.message) continue;
			const edited = SHEET_COLS.filter(k => sheetCellChanged(r, k));
			const b = baseStyle((d.ranges || [])[0] || {});
			r.rich = { text: d.text || '', ranges: d.ranges || [],
			           paragraphs: d.paragraphs || [] };
			r.marks = Math.max(0, (d.ranges || []).length - 1);
			const fresh = {
				name: r.orig.name,
				text: d.text || '',
				font: b.font, size: b.size, color: b.color,
				align: ((d.paragraphs || [])[0] || {}).align || 'left',
			};
			for (const k of SHEET_COLS) {
				r.orig[k] = fresh[k];
				if (!edited.includes(k)) r.vals[k] = fresh[k];   // 編集中の値は守る
			}
		}
		renderSheet();
	} catch (e) { /* 書式カラムが空のまま。本文と名前は編集できる */ }
}

function renderSheet() {
	closeCellMenu();
	const table = $('#shTable');
	table.textContent = '';

	// 見出し: コピー / 貼り付けの対象カラムをチェックで選ぶ
	const head = document.createElement('tr');
	for (const key of SHEET_COLS) {
		const th = document.createElement('th');
		th.className = 'c-sh-' + key + (sheetColOn(key) ? ' on' : '');
		const lab = document.createElement('label');
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.checked = sheetColOn(key);
		cb.title = tr('sheet.colTarget');
		cb.addEventListener('change', () => {
			sheetColSel = new Set(SHEET_COLS.filter(k =>
				k === key ? cb.checked : sheetColOn(k)));
			renderSheet();
		});
		lab.append(cb, document.createTextNode(tr('sheet.col.' + key)));
		th.appendChild(lab);
		head.appendChild(th);
	}
	table.appendChild(head);

	sheetRows.forEach((r, i) => {
		const line = document.createElement('tr');
		line.appendChild(sheetCell(r, i, 'name'));
		line.appendChild(sheetCell(r, i, 'text'));
		line.appendChild(sheetCell(r, i, 'font'));
		line.appendChild(sheetCell(r, i, 'size'));
		line.appendChild(sheetCell(r, i, 'color'));
		line.appendChild(sheetAlignCell(r, i));
		table.appendChild(line);
	});

	updateSheetCounts();
}

function sheetCell(r, i, key) {
	const td = document.createElement('td');
	td.className = 'c-sh-' + key + (sheetCellChanged(r, key) ? ' edited' : '');
	const styleCol = key !== 'name' && key !== 'text';
	if (styleCol && !r.rich) { td.classList.add('off'); return td; }

	const el = document.createElement(key === 'text' ? 'textarea' : 'input');
	if (key === 'text') {
		el.rows = Math.min(4, String(r.vals.text || '').split('\n').length);
		el.spellcheck = false;
		if (r.marks) el.title = tr('sheet.marksNote', r.marks);
	} else {
		el.type = 'text';
		el.spellcheck = false;
	}
	el.value = key === 'size'
		? (r.vals.size ? String(Math.round(r.vals.size * 10) / 10) : '')
		: (r.vals[key] ?? '');
	if (key === 'font' && r.vals.font) {
		const f = fontsCache.find(x => x.ps === r.vals.font);
		if (f) el.title = fontLabel(f);
	}
	el.dataset.row = String(i);
	el.dataset.key = key;
	el.addEventListener('input', onSheetInput);
	el.addEventListener('paste', onSheetPaste);
	td.appendChild(el);
	r.els[key] = el;

	if (key === 'font') {
		// ▾ でお気に入り + 使用中フォントの候補を出す
		const btn = document.createElement('button');
		btn.className = 'mini cell-btn';
		btn.textContent = '▾';
		btn.title = tr('sheet.fontPick');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			openCellFontMenu(btn, i);
		});
		td.appendChild(btn);
	}
	if (key === 'color') {
		const sw = document.createElement('input');
		sw.type = 'color';
		sw.className = 'swatch';
		if (/^#[0-9a-fA-F]{6}$/.test(r.vals.color || '')) sw.value = r.vals.color.toLowerCase();
		sw.addEventListener('change', () => {
			r.vals.color = sw.value.toUpperCase();
			el.value = r.vals.color;
			td.classList.toggle('edited', sheetCellChanged(r, 'color'));
			updateSheetCounts();
		});
		td.appendChild(sw);
	}
	return td;
}

const ALIGN_KEYS = ['left', 'center', 'right', 'justify'];

function sheetAlignCell(r, i) {
	const td = document.createElement('td');
	td.className = 'c-sh-align' + (sheetCellChanged(r, 'align') ? ' edited' : '');
	if (!r.rich) { td.classList.add('off'); return td; }
	const sel = document.createElement('select');
	for (const a of ALIGN_KEYS) {
		const o = document.createElement('option');
		o.value = a;
		o.textContent = tr('al.' + a);
		sel.appendChild(o);
	}
	sel.value = r.vals.align || 'left';
	sel.dataset.row = String(i);
	sel.dataset.key = 'align';
	sel.addEventListener('change', () => {
		r.vals.align = sel.value;
		td.classList.toggle('edited', sheetCellChanged(r, 'align'));
		updateSheetCounts();
	});
	td.appendChild(sel);
	r.els.align = sel;
	return td;
}

/// セル入力。作り直すとカーソルが飛ぶので、印とボタンだけ更新する
function onSheetInput(e) {
	const r = sheetRows[Number(e.target.dataset.row)];
	const key = e.target.dataset.key;
	if (!r) return;
	r.vals[key] = key === 'size' ? (parseFloat(e.target.value) || 0) : e.target.value;
	e.target.parentNode.classList.toggle('edited', sheetCellChanged(r, key));
	updateSheetCounts();
}

function updateSheetCounts() {
	const n = sheetRows.filter(sheetRowChanged).length;
	$('#shCount').textContent = tr('sheet.count', sheetRows.length, n);
	$('#shApply').disabled = !n;
	$('#shApply').textContent = n ? tr('sheet.applyN', n) : tr('sheet.apply');
}

/// 表の全行の基準フォントをまとめて変える。
///
/// セルを 1 つずつ触るのと同じことをするだけで、適用の経路は変わらない。
/// applySheet() 側の「基準と同じだった範囲だけが追随する」性質がそのまま効くので、
/// 本文途中で別フォントを指定した箇所は残る。
function setFontOnAllRows() {
	const ps = resolveFontPs($('#shFont'));
	if (!ps) { setStatus('#shStatus', tr('sheet.fontAllNone'), 'error'); return; }
	let n = 0;
	for (const r of sheetRows) {
		if (r.vals.font === ps) continue;
		r.vals.font = ps;
		n++;
		if (r.els.font) {
			r.els.font.value = ps;
			r.els.font.parentNode.classList.toggle('edited', sheetCellChanged(r, 'font'));
		}
	}
	updateSheetCounts();
	setStatus('#shStatus', tr('sheet.fontAllDone', n));
}

//--- フォントセルの候補メニュー (お気に入り + 使用中) ----------------------

function openCellFontMenu(anchor, i) {
	closeCellMenu();
	const menu = document.createElement('div');
	menu.className = 'cell-menu';
	menu.id = 'cellFontMenu';
	const cand = [...new Set([...favFonts, ...usedFonts])].map(fontByPs)
		.sort((a, b) => fontLabel(a).localeCompare(fontLabel(b), 'ja'));
	for (const f of cand) {
		const d = document.createElement('div');
		d.className = 'cell-menu-row' + (f.ps === sheetRows[i].vals.font ? ' on' : '');
		const n = document.createElement('span');
		n.textContent = fontLabel(f);
		const s = document.createElement('span');
		s.className = 'hint';
		s.textContent = f.ps;
		d.append(n, s);
		d.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const r = sheetRows[i];
			r.vals.font = f.ps;
			if (r.els.font) {
				r.els.font.value = f.ps;
				r.els.font.parentNode.classList.toggle('edited', sheetCellChanged(r, 'font'));
			}
			updateSheetCounts();
			closeCellMenu();
		});
		menu.appendChild(d);
	}
	const more = document.createElement('div');
	more.className = 'cell-menu-row more';
	more.textContent = tr('sheet.fontMore');
	more.addEventListener('mousedown', (e) => {
		e.preventDefault();
		closeCellMenu();
		openFontMgr();
	});
	menu.appendChild(more);

	document.body.appendChild(menu);
	const rect = anchor.getBoundingClientRect();
	menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
	const below = window.innerHeight - rect.bottom;
	menu.style.top = (below < menu.offsetHeight + 8 && rect.top > below)
		? Math.max(4, rect.top - menu.offsetHeight - 2) + 'px'
		: (rect.bottom + 2) + 'px';
	setTimeout(() => document.addEventListener('mousedown', closeCellMenu, { once: true }), 0);
}

function closeCellMenu() {
	const m = document.getElementById('cellFontMenu');
	if (m) m.remove();
}

//--- コピー / 貼り付け ------------------------------------------------------

/// 揃えのテキスト表現 (コピー用) と、その逆
function alignText(a) { return tr('al.' + (a || 'left')); }

function alignFromText(s, def) {
	const v = String(s).trim().toLowerCase();
	if (ALIGN_KEYS.includes(v)) return v;
	const ja = { '左': 'left', '左揃え': 'left', '中央': 'center', '中央揃え': 'center',
	             '右': 'right', '右揃え': 'right', '両端': 'justify', '両端揃え': 'justify' };
	return ja[String(s).trim()] || def;
}

function sheetCellText(r, key) {
	if (key === 'align') return alignText(r.vals.align);
	if (key === 'size') return r.vals.size ? String(Math.round(r.vals.size * 10) / 10) : '';
	return String(r.vals[key] ?? '');
}

async function copySheet() {
	const cols = sheetColsOn();
	if (!cols.length) { setStatus('#shStatus', tr('sheet.noCols'), 'error'); return; }
	const tsv = sheetRows
		.map(r => cols.map(k => tsvField(sheetCellText(r, k))).join('\t')).join('\n');
	const ok = await copyToClipboard(tsv);
	setStatus('#shStatus', ok ? tr('sheet.copied', sheetRows.length, cols.length) : 'copy failed',
	          ok ? 'ok' : 'error');
}

/// 貼り付けた中身を startRow から下へ、cols の順に配る
function spreadIntoSheet(text, startRow, cols, note) {
	let n = 0;
	parseTsv(text).forEach((line, dy) => {
		const r = sheetRows[startRow + dy];
		if (!r) return;
		line.forEach((cell, dx) => {
			const key = cols[dx];
			if (!key) return;
			if (key !== 'name' && key !== 'text' && !r.rich) return;   // 書式が読めない行
			if (key === 'size') r.vals.size = parseFloat(cell) || r.vals.size;
			else if (key === 'align') r.vals.align = alignFromText(cell, r.vals.align);
			else if (key === 'color') {
				const h = String(cell).trim();
				if (/^#?[0-9a-fA-F]{6}$/.test(h)) r.vals.color = '#' + h.replace('#', '').toUpperCase();
			} else r.vals[key] = cell;
			n++;
		});
	});
	renderSheet();
	setStatus('#shStatus', (note ? note + ' / ' : '') + tr('sheet.pasted', n));
}

/// 「TSV を貼り付け」ボタン。クリップボードを読んで先頭行から対象列へ流し込む。
/// (セルを選んで Ctrl+V なら、そのセルが起点になる)
async function pasteSheetFromClipboard() {
	const cols = sheetColsOn();
	if (!cols.length) { setStatus('#shStatus', tr('sheet.noCols'), 'error'); return; }
	let text = '';
	try {
		// パネル側で読む (webview で読むと毎回 Chromium の許可ダイアログが出る)
		const res = await request('readClipboard');
		text = res.text || '';
	} catch (e) { /* ブリッジ経由で読めなければ webview で試す */ }
	if (!text) {
		try {
			text = await navigator.clipboard.readText();
		} catch (e) {
			setStatus('#shStatus', tr('sheet.pasteFail'), 'error');
			return;
		}
	}
	if (!text || !text.trim()) { setStatus('#shStatus', tr('sheet.pasteEmpty'), 'error'); return; }
	spreadIntoSheet(text, 0, cols, '');
}

/// セルの中で受けた貼り付け。そのセルが起点になり、右へ「対象カラム」だけに流れる
function onSheetPaste(e) {
	const text = (e.clipboardData || window.clipboardData).getData('text');
	if (!text || !/[\t\n]/.test(text.trim())) return;   // 1 セルぶんは通常の貼り付け
	const all = sheetColsOn();
	if (!all.length) { e.preventDefault(); setStatus('#shStatus', tr('sheet.noCols'), 'error'); return; }
	const at = all.indexOf(e.target.dataset.key);
	const note = at < 0 ? tr('sheet.colOff', tr('sheet.col.' + e.target.dataset.key)) : '';
	e.preventDefault();
	spreadIntoSheet(text, Number(e.target.dataset.row) || 0, at < 0 ? all : all.slice(at), note);
}

//--- 適用 -------------------------------------------------------------------

async function applySheet() {
	const todo = sheetRows.filter(sheetRowChanged);
	if (!todo.length) return;
	setStatus('#shStatus', tr('sheet.working'));
	$('#shApply').disabled = true;
	let lostMarks = 0;
	const items = todo.map(r => {
		const item = { id: r.id };
		if (String(r.vals.name).trim() && sheetCellChanged(r, 'name')) item.name = r.vals.name;

		const textChanged = sheetCellChanged(r, 'text');
		const styleChanged = ['font', 'size', 'color'].some(k => sheetCellChanged(r, k));
		const alignChanged = sheetCellChanged(r, 'align');

		if (!r.rich) {
			// 書式が読めなかった行はプレーン経路
			if (textChanged) item.text = r.vals.text;
			return item;
		}
		if (!textChanged && !styleChanged && !alignChanged) return item;

		const oldBase = baseStyle(r.rich.ranges[0] || {});
		const newBase = { ...oldBase };
		if (r.vals.font) newBase.font = r.vals.font;
		if (r.vals.size > 0) newBase.size = r.vals.size;
		if (/^#[0-9a-fA-F]{6}$/.test(r.vals.color || '')) newBase.color = r.vals.color;

		let text, ranges, paragraphs;
		if (textChanged) {
			// 本文が変わると途中の書式は位置を失うので落とす (psdtext と同じ)
			if (r.marks) lostMarks++;
			text = r.vals.text;
			ranges = [{ from: 0, to: text.length, ...newBase }];
			paragraphs = remapParagraphs(r.rich.paragraphs, text);
		} else {
			text = r.rich.text;
			// 基準と同じ値だった範囲だけ新しい基準へ連動させ、途中の書式は温存
			ranges = r.rich.ranges.map(x => {
				const st = baseStyle(x);
				for (const k of ['font', 'size', 'color'])
					if (sameValue(k, st[k], oldBase[k])) st[k] = newBase[k];
				return { from: x.from, to: x.to, ...st };
			});
			paragraphs = r.rich.paragraphs.map(p => ({ ...p }));
			if (!paragraphs.length) paragraphs = [{ from: 0, to: text.length, align: 'left' }];
		}
		if (alignChanged) for (const p of paragraphs) p.align = r.vals.align;
		item.rich = { text, ranges, paragraphs };
		return item;
	}).filter(it => it.name !== undefined || it.text !== undefined || it.rich);

	try {
		const res = await request('applyTexts', { items });
		const failed = (res.errors || []).length;
		let msg = failed ? tr('sheet.doneFailed', res.applied || 0, failed)
		        : lostMarks ? tr('sheet.doneLost', res.applied || 0, lostMarks)
		                    : tr('sheet.done', res.applied || 0);
		setStatus('#shStatus', msg, failed ? 'error' : 'ok');
	} catch (e) {
		setStatus('#shStatus', String(e.message || e), 'error');
	}
	buildSheet();   // 反映後の姿を読み直す (psdtext の loadSheet と同じ)
}

//---------------------------------------------------------------------------
// お気に入りフォント管理ダイアログ
//
// 全フォントを名前 (ファミリ / PS) で検索して、行クリックで登録/解除する。
// コンボ側のドロップダウンには、ここで登録したものと使用中のものだけが並ぶ。
//---------------------------------------------------------------------------

const FM_CAP = 300;   ///< 一度に描画する最大行数 (それ以上は絞り込んでもらう)
let fmTimer = null;

function openFontMgr() {
	ensureFonts().then(() => {
		$('#fmSearch').value = '';
		renderFontMgr();
		$('#fontMgrDialog').hidden = false;
		$('#fmSearch').focus();
	});
}

function closeFontMgr() {
	$('#fontMgrDialog').hidden = true;
}

function renderFontMgr() {
	const q = $('#fmSearch').value.trim().toLowerCase();
	const list = q
		? fontsCache.filter(f =>
			fontLabel(f).toLowerCase().includes(q) || f.ps.toLowerCase().includes(q))
		: [...fontsCache];
	const host = $('#fmList');
	host.textContent = '';
	for (const f of list.slice(0, FM_CAP)) {
		const d = document.createElement('div');
		d.className = 'font-item';
		const star = document.createElement('span');
		star.className = 'font-star' + (favFonts.has(f.ps) ? ' on' : '');
		star.textContent = favFonts.has(f.ps) ? '★' : '☆';
		const main = document.createElement('span');
		main.className = 'font-main';
		main.textContent = fontLabel(f);
		const sub = document.createElement('span');
		sub.className = 'hint';
		sub.textContent = f.ps;
		d.append(star, main, sub);
		d.addEventListener('click', () => {
			if (favFonts.has(f.ps)) favFonts.delete(f.ps);
			else favFonts.add(f.ps);
			saveFavFonts();
			// 行の場所は動かさず、星だけその場で描き替える
			star.className = 'font-star' + (favFonts.has(f.ps) ? ' on' : '');
			star.textContent = favFonts.has(f.ps) ? '★' : '☆';
			$('#fmCount').textContent = tr('fontmgr.count', favFonts.size);
		});
		host.appendChild(d);
	}
	if (list.length > FM_CAP) {
		const more = document.createElement('div');
		more.className = 'font-hint';
		more.textContent = tr('fontmgr.more', list.length - FM_CAP);
		host.appendChild(more);
	}
	$('#fmCount').textContent = tr('fontmgr.count', favFonts.size);
}

//---------------------------------------------------------------------------
// 初期書式ダイアログ
//
// チェックした項目 (フォント / サイズ / 色 / 揃え) だけを、対象テキスト
// レイヤ全体の初期書式としてまとめて適用する。部分書式には触らない。
//---------------------------------------------------------------------------

let fontsLoaded = false;
const fontsCache = [];   ///< [{ps, family, style}] family の五十音/ABC 順

/// フォント一覧は重いので、最初に必要になったとき 1 回だけ取る
async function ensureFonts() {
	if (fontsLoaded) return;
	try {
		const res = await request('getFonts');
		fontsCache.length = 0;
		fontsCache.push(...(res.fonts || []));
		fontsCache.sort((a, b) =>
			(a.family + ' ' + a.style).localeCompare(b.family + ' ' + b.style, 'ja'));
		fontsLoaded = true;
	} catch (e) { /* 一覧が無くても手入力はできる */ }
}

//---------------------------------------------------------------------------
// フォントコンボボックス
//
// 表示・検索はファミリ名 (日本語名) で、適用に使うのは PostScript 名。
// datalist は PS 名しかまともに出せないので自前で作る。
// 入力欄の dataset.ps に確定した PS 名を持つ。
//---------------------------------------------------------------------------

function fontLabel(f) {
	return f.family + (f.style ? ' ' + f.style : '');
}

/// 入力欄へ PS 名をセットし、表示はファミリ名に直す
function setFontValue(inputEl, ps) {
	const f = fontsCache.find(x => x.ps === ps);
	inputEl.value = f ? fontLabel(f) : (ps || '');
	inputEl.dataset.ps = ps || '';
}

/// 入力欄から PS 名を決める。選択済みならそれ、手入力なら一覧と突き合わせる
function resolveFontPs(inputEl) {
	if (inputEl.dataset.ps) return inputEl.dataset.ps;
	const v = inputEl.value.trim();
	if (!v) return '';
	const lower = v.toLowerCase();
	const f = fontsCache.find(x => x.ps.toLowerCase() === lower)
	       || fontsCache.find(x => fontLabel(x).toLowerCase() === lower)
	       || fontsCache.find(x => x.family.toLowerCase() === lower);
	return f ? f.ps : v;   // 見つからなければ PS 名の手入力とみなす
}

//--- お気に入り / 使用中フォント -------------------------------------------

let favFonts = new Set();   ///< お気に入り (PS 名)。パネル側の prefs.json に永続化
let usedFonts = [];         ///< いまのドキュメントで使われている PS 名

function fontByPs(ps) {
	return fontsCache.find(f => f.ps === ps) || { ps, family: ps, style: '' };
}

async function loadPrefs() {
	try {
		const res = await request('getPrefs');
		const prefs = res.prefs || {};
		favFonts = new Set(prefs.favFonts || []);
		// webview では localStorage が使えないので、言語もここから戻す
		if (setLang(prefs.lang)) {
			$('#langBtn').textContent = tr('app.lang');
			renderAll();
			if (!$('#helpDialog').hidden) syncHelpLang();
		}
	} catch (e) { /* 無ければ空のまま */ }
}

function saveLangPref() {
	request('setPrefs', { prefs: { lang: currentLang() } }).catch(() => {});
}

function saveFavFonts() {
	request('setPrefs', { prefs: { favFonts: [...favFonts] } }).catch(() => {});
}

/// ドキュメントで使用中のフォントを取り直す (ダイアログを開くたび)
async function refreshUsedFonts() {
	try {
		const res = await request('getUsedFonts');
		usedFonts = res.fonts || [];
	} catch (e) { /* 前回の値のまま */ }
}

/// ドロップダウンの中身はお気に入り + 使用中だけ (全フォントは出さない)。
/// 入力があればその中を絞り込む。全フォントからの検索と登録は
/// ★ボタンの管理ダイアログで行う。
function comboGroups(q) {
	const match = f => !q ||
		fontLabel(f).toLowerCase().includes(q) || f.ps.toLowerCase().includes(q);
	const fav = [...favFonts].map(fontByPs).filter(match);
	const used = usedFonts.filter(ps => !favFonts.has(ps)).map(fontByPs).filter(match);
	const groups = [];
	if (fav.length) groups.push({ header: tr('font.fav'), items: fav });
	if (used.length) groups.push({ header: tr('font.used'), items: used });
	return groups;
}

function attachFontCombo(inputEl, onChange) {
	const drop = document.createElement('div');
	drop.className = 'font-drop';
	drop.hidden = true;
	inputEl.parentElement.appendChild(drop);
	let items = [], rows = [], active = -1, lastFiltered = false;

	const hide = () => { drop.hidden = true; active = -1; };
	const markActive = () => {
		rows.forEach((c, i) => c.classList.toggle('active', i === active));
		if (active >= 0) rows[active].scrollIntoView({ block: 'nearest' });
	};
	const pick = (i) => {
		const f = items[i];
		if (!f) return;
		setFontValue(inputEl, f.ps);
		hide();
		if (onChange) onChange();
	};
	const show = (filtered) => {
		lastFiltered = filtered;
		const q = filtered ? inputEl.value.trim().toLowerCase() : '';
		const groups = comboGroups(q);
		items = []; rows = [];
		drop.textContent = '';
		for (const g of groups) {
			const h = document.createElement('div');
			h.className = 'font-group';
			h.textContent = g.header;
			drop.appendChild(h);
			for (const f of g.items) {
				const i = items.length;
				items.push(f);
				const d = document.createElement('div');
				d.className = 'font-item';
				const main = document.createElement('span');
				main.className = 'font-main';
				main.textContent = fontLabel(f);
				const sub = document.createElement('span');
				sub.className = 'hint';
				sub.textContent = f.ps;
				d.append(main, sub);
				d.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
				drop.appendChild(d);
				rows.push(d);
			}
		}
		// リストが空 (お気に入り未登録 + テキストレイヤ無し) なら案内だけ出す
		if (!items.length) {
			const hint = document.createElement('div');
			hint.className = 'font-hint';
			hint.textContent = tr('fontcombo.empty');
			drop.appendChild(hint);
		}
		active = inputEl.dataset.ps
			? items.findIndex(f => f.ps === inputEl.dataset.ps) : -1;
		if (active >= 0) markActive();
		drop.hidden = false;
	};

	inputEl.addEventListener('input', () => {
		inputEl.dataset.ps = '';
		show(true);
		if (onChange) onChange();
	});
	inputEl.addEventListener('focus', () => { ensureFonts().then(() => show(false)); });
	inputEl.addEventListener('blur', () => setTimeout(hide, 150));
	inputEl.addEventListener('keydown', (e) => {
		if (drop.hidden) return;
		if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); markActive(); e.preventDefault(); }
		else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); markActive(); e.preventDefault(); }
		else if (e.key === 'Enter') {
			if (active >= 0) { pick(active); e.preventDefault(); }
			else if (items.length === 1) { pick(0); e.preventDefault(); }
		}
		else if (e.key === 'Escape') { hide(); e.stopPropagation(); }
	});
}

//---------------------------------------------------------------------------
// ヘルプ
//---------------------------------------------------------------------------

/// いまの言語のヘルプ本文だけを見せる
function syncHelpLang() {
	for (const el of document.querySelectorAll('[data-help-lang]'))
		el.style.display = el.dataset.helpLang === currentLang() ? '' : 'none';
}

function openHelp() {
	syncHelpLang();
	$('#helpDialog').hidden = false;
}

function closeHelp() {
	$('#helpDialog').hidden = true;
}

//---------------------------------------------------------------------------
// 配線
//---------------------------------------------------------------------------

function wire() {
	$('#filter').addEventListener('input', (e) => {
		state.filter = e.target.value;
		renderTree();
	});
	for (const id of ['#fltText', '#fltVisible'])
		$(id).addEventListener('change', renderTree);

	$('#refreshBtn').addEventListener('click', () => {
		if (!state.connected) { bridgeFailed = false; renderAll(); bridge.connect(); }
		else request('getTree');
	});
	$('#langBtn').addEventListener('click', () => {
		toggleLang();
		saveLangPref();
		$('#langBtn').textContent = tr('app.lang');
		renderAll();
		if (!$('#sheetDialog').hidden) { renderSheet(); }
		if (!$('#helpDialog').hidden) syncHelpLang();
	});

	$('#helpBtn').addEventListener('click', openHelp);
	$('#selTextsBtn').addEventListener('click', selectAllTexts);
	$('#sheetBtn').addEventListener('click', openSheetDialog);

	$('#editFontMgr').addEventListener('click', openFontMgr);
	$('#fmSearch').addEventListener('input', () => {
		if (fmTimer) clearTimeout(fmTimer);
		fmTimer = setTimeout(renderFontMgr, 120);   // IME 入力を邪魔しないよう少し待つ
	});

	// 各モーダルの × とオーバーレイクリック
	// 編集中の 2 つは未保存ガードつき。残りは失うものが無いのでそのまま閉じる
	wireModalClose('#editDialog', closeEditDialog, editDirty,
	               () => setStatus('#editStatus', tr('modal.dirty'), 'error'));
	wireModalClose('#sheetDialog', closeSheetDialog, sheetDirty,
	               () => setStatus('#shStatus', tr('modal.dirty'), 'error'));
	wireModalClose('#fontMgrDialog', closeFontMgr);
	wireModalClose('#helpDialog', closeHelp);

	$('#editApply').addEventListener('click', applyEdit);
	// 書式欄は「触った項目だけ」を適用対象にするため、入力を記録する
	for (const [id, key] of [['#editFont', 'font'], ['#editSize', 'size'],
	                         ['#editColor', 'color'], ['#editLeading', 'leading'],
	                         ['#editTracking', 'tracking']]) {
		$(id).addEventListener('input', () => { editTouched[key] = true; });
		$(id).addEventListener('change', () => { editTouched[key] = true; });
	}
	attachFontCombo($('#editFont'), () => { editTouched.font = true; });

	// 選択範囲への書式付け (Quill の format API 経由)
	$('#fmtB').addEventListener('click', () => fmtFormat('bold', !(quill.getFormat().bold)));
	$('#fmtI').addEventListener('click', () => fmtFormat('italic', !(quill.getFormat().italic)));
	$('#fmtU').addEventListener('click', () => fmtFormat('underline', !(quill.getFormat().underline)));
	$('#fmtS').addEventListener('click', () => fmtFormat('strike', !(quill.getFormat().strike)));
	$('#fmtSizeApply').addEventListener('click', () => {
		const v = parseFloat($('#fmtSize').value);
		if (v > 0) fmtFormat('psize', String(v));
	});
	$('#fmtColorApply').addEventListener('click', () => {
		fmtFormat('color', $('#fmtColor').value.toUpperCase());
	});
	$('#fmtAlL').addEventListener('click', () => fmtFormat('align', false));
	$('#fmtAlC').addEventListener('click', () => fmtFormat('align', 'center'));
	$('#fmtAlR').addEventListener('click', () => fmtFormat('align', 'right'));
	$('#fmtAlJ').addEventListener('click', () => fmtFormat('align', 'justify'));
	$('#fmtReset').addEventListener('click', resetSelToBase);
	$('#fmtMode').addEventListener('click', () => setTagMode(!tagMode));
	// ツールバーのフォント: 一覧から選んだ時だけ選択範囲へ適用する
	attachFontCombo($('#fmtFont'), () => {
		const ps = $('#fmtFont').dataset.ps;
		if (ps) fmtFormat('psfont', ps);
	});

	$('#shTarget').addEventListener('change', buildSheet);
	$('#shCopy').addEventListener('click', copySheet);
	$('#shPaste').addEventListener('click', pasteSheetFromClipboard);
	$('#shApply').addEventListener('click', applySheet);
	attachFontCombo($('#shFont'));
	$('#shFontMgr').addEventListener('click', openFontMgr);
	$('#shFontApply').addEventListener('click', setFontOnAllRows);
	// コピペ対象カラムのプリセット
	for (const btn of document.querySelectorAll('[data-cols]')) {
		btn.addEventListener('click', () => {
			sheetColSel = new Set(SHEET_PRESETS[btn.dataset.cols] || SHEET_COLS);
			renderSheet();
		});
	}

	document.addEventListener('keydown', (e) => {
		if (e.ctrlKey && e.key === 'd') {          // 自己診断行の表示切り替え
			e.preventDefault();
			diag.toggle();
			return;
		}
		if (e.key === 'Escape') {
			escapeModal(['#helpDialog', '#fontMgrDialog', '#sheetDialog', '#editDialog']);
			return;
		}
		if (e.key === 'F2' && state.selected !== null &&
		    $('#editDialog').hidden && $('#sheetDialog').hidden) {
			openEditDialog(state.selected);
		}
	});
}

//---------------------------------------------------------------------------
// 起動。uxpHost が無い (普通のブラウザで開いた) ときはモックで動かして、
// UI だけ単体で確認できるようにしておく。
//---------------------------------------------------------------------------

function installMock() {
	const rows = [
		{ id: 1, name: 'header', kind: 'folder', depth: 0, parent: -1, path: 'header', visible: true, text: false, body: '' },
		{ id: 2, name: 'title', kind: 'text', depth: 1, parent: 1, path: 'header/title', visible: true, text: true, body: 'PSD Text Edit' },
		{ id: 3, name: 'subtitle', kind: 'text', depth: 1, parent: 1, path: 'header/subtitle', visible: true, text: true, body: 'bulk text editing\nfor Photoshop' },
		{ id: 4, name: 'logo', kind: 'image', depth: 1, parent: 1, path: 'header/logo', visible: true, text: false, body: '' },
		{ id: 5, name: 'body copy', kind: 'text', depth: 0, parent: -1, path: 'body copy', visible: false, text: true, body: 'sample "quoted"\ttext' },
		{ id: 6, name: 'bg', kind: 'fill', depth: 0, parent: -1, path: 'bg', visible: true, text: false, body: '' },
	];
	window.uxpHost = {
		__mock: true,
		postMessage(s) {
			const msg = JSON.parse(s);
			setTimeout(() => {
				if (msg.type === 'applyTexts') {
					for (const it of msg.items) {
						const r = rows.find(x => x.id === it.id);
						if (!r) continue;
						if (it.rich) r.body = it.rich.text;
						else if (typeof it.text === 'string') r.body = it.text;
						if (typeof it.name === 'string' && it.name.trim()) r.name = it.name;
					}
					onMessage({ type: 'textResult', reqId: msg.reqId, applied: msg.items.length, errors: [] });
					onMessage({ type: 'tree', doc: { id: 1, name: 'mock.psd' }, rows: rows.map(r => ({ ...r })) });
				} else if (msg.type === 'getFonts') {
					onMessage({ type: 'fonts', reqId: msg.reqId, fonts: [
						{ ps: 'ArialMT', family: 'Arial', style: 'Regular' },
						{ ps: 'Arial-BoldMT', family: 'Arial', style: 'Bold' },
						{ ps: 'HiraginoSans-W3', family: 'Hiragino Sans', style: 'W3' },
					] });
				} else if (msg.type === 'getStyle') {
					onMessage({ type: 'style', reqId: msg.reqId,
						style: { font: 'ArialMT', size: 24, color: '#ff8800', align: 'center' } });
				} else if (msg.type === 'getRich') {
					const r = rows.find(x => x.id === msg.id);
					onMessage({ type: 'rich', reqId: msg.reqId,
						text: r ? r.body : '',
						ranges: r ? [{ from: 0, to: r.body.length, font: 'ArialMT', size: 24,
						               color: '#ff8800', bold: false, italic: false, underline: false }] : [] });
				} else if (msg.type === 'getRichMany') {
					const map = {};
					for (const id of msg.ids || []) {
						const r = rows.find(x => x.id === id);
						map[id] = r ? { text: r.body,
							ranges: [{ from: 0, to: r.body.length, font: 'ArialMT', size: 24,
							           color: '#ff8800', bold: false, italic: false, underline: false }] }
							: { message: 'not found' };
					}
					onMessage({ type: 'richMany', reqId: msg.reqId, map });
				} else if (msg.type === 'getUsedFonts') {
					onMessage({ type: 'usedFonts', reqId: msg.reqId,
						fonts: ['ArialMT', 'HiraginoSans-W3'] });
				} else if (msg.type === 'getPrefs') {
					onMessage({ type: 'prefs', reqId: msg.reqId,
						prefs: JSON.parse(sessionStorage.getItem('mockPrefs') || '{}') });
				} else if (msg.type === 'setPrefs') {
					sessionStorage.setItem('mockPrefs', JSON.stringify(msg.prefs || {}));
					onMessage({ type: 'prefsSaved', reqId: msg.reqId, ok: true });
				} else if (msg.type === 'applyStyle') {
					onMessage({ type: 'styleResult', reqId: msg.reqId, applied: msg.ids.length, errors: [] });
					onMessage({ type: 'tree', doc: { id: 1, name: 'mock.psd' }, rows: rows.map(r => ({ ...r })) });
				} else {
					onMessage({ type: 'tree', reqId: msg.reqId, doc: { id: 1, name: 'mock.psd' }, rows: rows.map(r => ({ ...r })) });
				}
			}, 30);
		},
	};
}

if (!window.uxpHost) installMock();

//---------------------------------------------------------------------------
// 接続ハンドシェイク。最初の tree が届くまでリトライし続ける。
//---------------------------------------------------------------------------

let bridgeFailed = false;   ///< ready のリトライを打ち切った

// リモート eval からモジュール内部に触れるように出しておく (開発用)
window.__dbg = {
	iid: IID,
	get state() { return state; },
	post, request, renderAll,
};

applyI18n();
$('#langBtn').textContent = tr('app.lang');
wire();
renderAll();
createWakeHint();      // 開いた直後はキーが届かない。1 つでも通れば自分で消える
bridge.connect();
