//---------------------------------------------------------------------------
// PSD Text Edit — webview 側 UI
//
// psdtext のテキスト編集 (単体編集 + 一覧編集シート) を UXP webview 向けに
// 再構成したもの。CSV の代わりにクリップボードの TSV でやり取りする。
// レイヤの識別は Photoshop の永続レイヤ ID (layer.id) のみ。
// 改行はブリッジ (main.js) が \r ↔ \n を変換するので、ここは \n だけ扱う。
//---------------------------------------------------------------------------

import { dlog } from './debug.js';
import { tr, applyI18n, toggleLang, currentLang } from './i18n.js';

const $ = (sel) => document.querySelector(sel);

//---------------------------------------------------------------------------
// UXP パネルとの通信 (postMessage ブリッジ)
//---------------------------------------------------------------------------

const pending = new Map();
let reqSeq = 0;
let sendTries = 0;          ///< 診断用: 送信を試みた回数
let lastSendError = '';     ///< 診断用: 最後に出た送信例外

//---------------------------------------------------------------------------
// 自己診断。fetch もブリッジも使わず画面の #diagLine に内部状態を出し続ける。
//---------------------------------------------------------------------------

const IID = Math.floor(Math.random() * 36 ** 4).toString(36);  ///< インスタンス識別子
let lastJsError = '';
let diagShown = false;      ///< Ctrl+D でトグル

window.addEventListener('error', (e) => {
	lastJsError = (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno;
});
window.addEventListener('unhandledrejection', (e) => {
	lastJsError = 'reject: ' + String(e.reason && (e.reason.message || e.reason));
});

function updateDiag() {
	const el = document.getElementById('diagLine');
	if (!el) return;
	const t = new Date();
	const clock = t.toTimeString().slice(0, 8) + '.' + Math.floor(t.getMilliseconds() / 100);
	el.textContent =
		'[' + IID + '] ' + clock +
		' conn:' + (state.connected ? 'Y' : 'n') +
		' rows:' + state.rows.length +
		' doc:' + (state.doc ? state.doc.name : '-') +
		' host:' + (!window.uxpHost ? 'none' : window.uxpHost.__mock ? 'mock' : 'ok') +
		' sent:' + sendTries +
		' trees:' + treeLog.join(',') +
		(lastSendError ? ' SENDERR:' + lastSendError : '') +
		(lastJsError ? ' JSERR:' + lastJsError : '');
	el.className = (diagShown ? 'show' : '') +
	               ((lastJsError || lastSendError) ? ' err' : '');
}
setInterval(updateDiag, 500);

/// uxpHost.postMessage は環境によって受け付ける形が違うことがあるので、
/// 文字列 1 引数 → 文字列 + targetOrigin → 素のオブジェクト の順に試す。
function post(msg) {
	sendTries++;
	const s = JSON.stringify({ ...msg, iid: IID });
	const attempts = [
		() => window.uxpHost.postMessage(s),
		() => window.uxpHost.postMessage(s, '*'),
		() => window.uxpHost.postMessage(msg),
	];
	for (const f of attempts) {
		try { f(); return; } catch (e) { lastSendError = String(e && e.message || e); }
	}
	console.error('postMessage failed:', lastSendError);
	if (!state.connected) renderAll();
}

function request(type, payload = {}) {
	return new Promise((resolve, reject) => {
		const reqId = ++reqSeq;
		pending.set(reqId, { resolve, reject });
		post({ type, reqId, ...payload });
	});
}

function onMessage(msg) {
	if (typeof msg === 'string') {
		try { msg = JSON.parse(msg); } catch (e) { return; }
	}
	if (!msg || !msg.type) return;

	if (msg.type === 'log') {           // パネル側のログをデバッグサーバへ中継
		dlog('panel', msg.msg);
		return;
	}

	if (msg.type === 'showHelp') {      // フライアウトメニューの「ヘルプ」
		openHelp();
		return;
	}

	if (msg.reqId && pending.has(msg.reqId)) {
		const p = pending.get(msg.reqId);
		pending.delete(msg.reqId);
		if (msg.type === 'error') p.reject(new Error(msg.message || 'error'));
		else p.resolve(msg);
		if (msg.type !== 'tree') return;   // tree は下の共通処理にも流す
	}

	if (msg.type === 'tree') applyTree(msg);
}

window.addEventListener('message', (ev) => onMessage(ev.data));

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
	refreshSheetFromTree();
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
		' / sent: ' + sendTries +
		(lastSendError ? ' / error: ' + lastSendError : '');
	$('#noDocDetail').textContent = state.lastError || diag;
	$('#sheetBtn').disabled = !state.doc;
	$('#selTextsBtn').disabled = !state.doc;
	$('#styleBtn').disabled = !state.doc;
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

let editTarget = null;   ///< {id, orig, origName, origStyle} 編集中のレイヤ
const editTouched = { font: false, size: false, color: false, align: false };

function openEditDialog(id) {
	const row = state.byId.get(id);
	if (!row || !row.text) return;
	editTarget = { id, orig: row.body || '', origName: row.name, origStyle: {} };
	for (const k of Object.keys(editTouched)) editTouched[k] = false;
	$('#editTitle').textContent = row.name;
	$('#editPath').textContent = row.path;
	$('#editName').value = row.name;
	$('#editText').value = editTarget.orig;
	$('#editFont').value = '';
	$('#editFont').dataset.ps = '';
	$('#editSize').value = '';
	$('#editColor').value = '#ffffff';
	$('#editAlign').value = '';
	setStatus('#editStatus', '');
	$('#editDialog').hidden = false;
	$('#editText').focus();
	ensureFonts();
	refreshUsedFonts();
	loadEditStyle(id);
}

/// いまの初期書式を読んで欄に反映する (開いた直後は空のまま編集できる)
async function loadEditStyle(id) {
	try {
		const res = await request('getStyle', { id });
		await ensureFonts();   // PS 名 → ファミリ名表示のため
		if (!editTarget || editTarget.id !== id) return;   // もう別のレイヤを開いた
		const st = res.style || {};
		editTarget.origStyle = st;
		if (!editTouched.font && st.font) setFontValue($('#editFont'), st.font);
		if (!editTouched.size && typeof st.size === 'number') $('#editSize').value = st.size;
		if (!editTouched.color && st.color) $('#editColor').value = st.color;
		if (!editTouched.align && st.align) $('#editAlign').value = st.align;
	} catch (e) { /* 書式欄が空のままなだけ */ }
}

function closeEditDialog() {
	$('#editDialog').hidden = true;
	editTarget = null;
}

/// PS 側の更新が届いたら、未編集の欄だけ追従させる
function refreshEditFromTree() {
	if (!editTarget || $('#editDialog').hidden) return;
	const fresh = state.byId.get(editTarget.id);
	if (!fresh) return;
	const ta = $('#editText');
	const ni = $('#editName');
	const textUnedited = ta.value === editTarget.orig;
	const nameUnedited = ni.value === editTarget.origName;
	editTarget.orig = fresh.body || '';
	editTarget.origName = fresh.name;
	if (textUnedited && document.activeElement !== ta) ta.value = editTarget.orig;
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
	const align = $('#editAlign').value;
	if (align && align !== st.align) out.align = align;
	return Object.keys(out).length ? out : null;
}

async function applyEdit() {
	if (!editTarget) return;
	const text = $('#editText').value;
	const name = $('#editName').value;
	const item = { id: editTarget.id };
	if (text !== editTarget.orig) item.text = text;
	if (name.trim() && name !== editTarget.origName) item.name = name;
	const style = editStyleDiff();
	if (style) item.style = style;
	if (item.text === undefined && item.name === undefined && !item.style) {
		setStatus('#editStatus', tr('edit.done'), 'ok');   // 変更なし
		return;
	}
	setStatus('#editStatus', tr('edit.working'));
	$('#editApply').disabled = true;
	try {
		const res = await request('applyTexts', { items: [item] });
		if ((res.errors || []).length) throw new Error(res.errors[0].message);
		if (item.text !== undefined) editTarget.orig = text;
		if (item.name !== undefined) editTarget.origName = name;
		if (item.style) {
			Object.assign(editTarget.origStyle, item.style);
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
// 一覧編集シート
//
// 対象テキストレイヤを表にして本文をまとめて編集する。psdtext の一覧編集の
// 移植。変わった行だけ適用され、履歴 1 段にまとまる。
//---------------------------------------------------------------------------

let sheetRows = [];   ///< [{id, nameOrig, nameVal, orig, val, elName, elText}]

function sheetTargets() {
	const mode = $('#shTarget').value;
	return state.rows.filter(r => r.text && (mode === 'text' || state.multi.has(r.id)));
}

/// 名前は空にできない (空欄は「変えない」扱い)
function nameChanged(r) { return !!r.nameVal.trim() && r.nameVal !== r.nameOrig; }
function textChanged(r) { return r.val !== r.orig; }
function rowChanged(r)  { return nameChanged(r) || textChanged(r); }

function markRow(r) {
	const tr_ = r.elText && r.elText.closest('tr');
	if (tr_) tr_.classList.toggle('hit', rowChanged(r));
}

function openSheetDialog() {
	if (!state.doc) return;
	// 複数選んでいるなら、その選択を直したいはず
	$('#shTarget').value = state.multi.size > 1 ? 'sel' : 'text';
	buildSheet();
	setStatus('#shStatus', '');
	$('#sheetDialog').hidden = false;
}

function closeSheetDialog() {
	$('#sheetDialog').hidden = true;
	sheetRows = [];
}

function buildSheet() {
	sheetRows = sheetTargets().map(r => ({
		id: r.id,
		nameOrig: r.name, nameVal: r.name,
		orig: r.body || '', val: r.body || '',
		elName: null, elText: null,
	}));
	renderSheet();
}

function renderSheet() {
	const table = $('#shTable');
	table.textContent = '';

	const head = document.createElement('tr');
	for (const k of ['name', 'text']) {
		const th = document.createElement('th');
		th.textContent = tr('sheet.col.' + k);
		th.className = 'c-sh-' + k;
		head.appendChild(th);
	}
	table.appendChild(head);

	sheetRows.forEach((r, idx) => {
		const line = document.createElement('tr');

		const nameCell = document.createElement('td');
		nameCell.className = 'c-sh-name';
		const ni = document.createElement('input');
		ni.type = 'text';
		ni.value = r.nameVal;
		ni.spellcheck = false;
		ni.addEventListener('input', () => {
			r.nameVal = ni.value;
			markRow(r);
			updateSheetCounts();
		});
		ni.addEventListener('paste', (e) => sheetPaste(e, idx, 'name'));
		nameCell.appendChild(ni);
		r.elName = ni;

		const cell = document.createElement('td');
		cell.className = 'c-sh-text';
		const ta = document.createElement('textarea');
		ta.rows = 1;
		ta.value = r.val;
		ta.spellcheck = false;
		ta.addEventListener('input', () => {
			r.val = ta.value;
			markRow(r);
			updateSheetCounts();
		});
		ta.addEventListener('paste', (e) => sheetPaste(e, idx, 'text'));
		cell.appendChild(ta);
		r.elText = ta;

		if (rowChanged(r)) line.classList.add('hit');
		line.append(nameCell, cell);
		table.appendChild(line);
	});

	updateSheetCounts();
}

function updateSheetCounts() {
	const n = sheetRows.filter(rowChanged).length;
	$('#shCount').textContent = tr('sheet.count', sheetRows.length, n);
	$('#shApply').disabled = !n;
	$('#shApply').textContent = n ? tr('sheet.applyN', n) : tr('sheet.apply');
}

/// セルへの貼り付け。複数行 (または複数列) の TSV なら、その行から下へ
/// まとめて流し込む。1 列なら貼り付けた列 (名前 or 本文) へ、
/// 2 列以上なら先頭列を名前・最後の列を本文として使う。
function sheetPaste(e, startIdx, col) {
	const text = (e.clipboardData || window.clipboardData).getData('text');
	if (!text) return;
	const rows = parseTsv(text);
	if (rows.length <= 1 && (rows[0] || []).length <= 1) return;  // 通常の貼り付けに任せる
	e.preventDefault();
	rows.forEach((cols, i) => {
		const r = sheetRows[startIdx + i];
		if (!r) return;
		if (cols.length >= 2) {
			r.nameVal = cols[0];
			r.val = cols[cols.length - 1];
		} else if (col === 'name') {
			r.nameVal = cols[0];
		} else {
			r.val = cols[0];
		}
		if (r.elName) r.elName.value = r.nameVal;
		if (r.elText) r.elText.value = r.val;
		markRow(r);
	});
	updateSheetCounts();
}

async function copySheet() {
	const tsv = sheetRows.map(r => tsvField(r.nameVal) + '\t' + tsvField(r.val)).join('\n');
	const ok = await copyToClipboard(tsv);
	setStatus('#shStatus', ok ? tr('sheet.copied') : 'copy failed', ok ? 'ok' : 'error');
}

async function applySheet() {
	const todo = sheetRows.filter(rowChanged);
	if (!todo.length) return;
	setStatus('#shStatus', tr('sheet.working'));
	$('#shApply').disabled = true;
	try {
		const res = await request('applyTexts', {
			items: todo.map(r => {
				const item = { id: r.id };
				if (textChanged(r)) item.text = r.val;
				if (nameChanged(r)) item.name = r.nameVal;
				return item;
			}),
		});
		const failed = (res.errors || []).length;
		const failedIds = new Set((res.errors || []).map(er => er.id));
		for (const r of todo) {
			if (!failedIds.has(r.id)) { r.orig = r.val; r.nameOrig = r.nameVal; }
			markRow(r);
		}
		setStatus('#shStatus', failed ? tr('sheet.doneFailed', res.applied || 0, failed)
		                              : tr('sheet.done', res.applied || 0),
		          failed ? 'error' : 'ok');
	} catch (e) {
		setStatus('#shStatus', String(e.message || e), 'error');
	}
	updateSheetCounts();
}

/// PS 側の更新が届いたら、未編集の欄だけ追従させる (編集中の値は守る)
function refreshSheetFromTree() {
	if ($('#sheetDialog').hidden || !sheetRows.length) return;
	for (const r of sheetRows) {
		const fresh = state.byId.get(r.id);
		if (!fresh) continue;
		const textUnedited = r.val === r.orig;
		const nameUnedited = r.nameVal === r.nameOrig;
		r.orig = fresh.body || '';
		r.nameOrig = fresh.name;
		if (textUnedited) {
			r.val = r.orig;
			if (r.elText && document.activeElement !== r.elText) r.elText.value = r.val;
		}
		if (nameUnedited) {
			r.nameVal = r.nameOrig;
			if (r.elName && document.activeElement !== r.elName) r.elName.value = r.nameVal;
		}
		markRow(r);
	}
	updateSheetCounts();
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

function styleTargets() {
	const mode = $('#stTarget').value;
	return state.rows.filter(r => r.text && (mode === 'text' || state.multi.has(r.id)));
}

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
		favFonts = new Set((res.prefs || {}).favFonts || []);
	} catch (e) { /* 無ければ空のまま */ }
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

function selectedTextLayer() {
	const r = state.selected !== null ? state.byId.get(state.selected) : null;
	return r && r.text ? r : null;
}

function openStyleDialog() {
	if (!state.doc) return;
	$('#stTarget').value =
		[...state.multi].some(id => (state.byId.get(id) || {}).text) ? 'sel' : 'text';
	updateStyleCounts();
	setStatus('#stStatus', '');
	$('#styleDialog').hidden = false;
	ensureFonts();
	refreshUsedFonts();
}

function closeStyleDialog() {
	$('#styleDialog').hidden = true;
}

function updateStyleCounts() {
	const n = styleTargets().length;
	$('#stCount').textContent = tr('style.count', n);
	const any = ['#stUseFont', '#stUseSize', '#stUseColor', '#stUseAlign']
		.some(id => $(id).checked);
	$('#stApply').disabled = !n || !any;
	$('#stFrom').disabled = !selectedTextLayer();
}

/// 最後に選んだテキストレイヤの書式を欄に読み込む (書式コピー相当)
async function readStyleFromSelected() {
	const src = selectedTextLayer();
	if (!src) return;
	setStatus('#stStatus', tr('style.working'));
	try {
		const res = await request('getStyle', { id: src.id });
		await ensureFonts();
		const st = res.style || {};
		if (st.font) { setFontValue($('#stFont'), st.font); $('#stUseFont').checked = true; }
		if (typeof st.size === 'number') { $('#stSize').value = st.size; $('#stUseSize').checked = true; }
		if (st.color) { $('#stColor').value = st.color; $('#stUseColor').checked = true; }
		if (st.align) { $('#stAlign').value = st.align; $('#stUseAlign').checked = true; }
		setStatus('#stStatus', res.message ? String(res.message) : tr('style.read', src.name),
		          res.message ? 'error' : 'ok');
	} catch (e) {
		setStatus('#stStatus', String(e.message || e), 'error');
	}
	updateStyleCounts();
}

async function applyStyleDialog() {
	const targets = styleTargets();
	const style = {};
	if ($('#stUseFont').checked) {
		const ps = resolveFontPs($('#stFont'));
		if (ps) style.font = ps;
	}
	if ($('#stUseSize').checked) {
		const v = parseFloat($('#stSize').value);
		if (v > 0) style.size = v;
	}
	if ($('#stUseColor').checked) style.color = $('#stColor').value;
	if ($('#stUseAlign').checked) style.align = $('#stAlign').value;
	if (!targets.length || !Object.keys(style).length) return;
	setStatus('#stStatus', tr('style.working'));
	$('#stApply').disabled = true;
	try {
		const res = await request('applyTexts', {
			items: targets.map(r => ({ id: r.id, style })),
		});
		const failed = (res.errors || []).length;
		setStatus('#stStatus', failed ? tr('style.doneFailed', res.applied || 0, failed)
		                              : tr('style.done', res.applied || 0),
		          failed ? 'error' : 'ok');
	} catch (e) {
		setStatus('#stStatus', String(e.message || e), 'error');
	}
	updateStyleCounts();
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
		if (!state.connected) { bridgeFailed = false; renderAll(); connect(); }
		else request('getTree');
	});
	$('#langBtn').addEventListener('click', () => {
		toggleLang();
		$('#langBtn').textContent = tr('app.lang');
		renderAll();
		if (!$('#sheetDialog').hidden) { renderSheet(); }
		if (!$('#helpDialog').hidden) syncHelpLang();
	});

	$('#helpBtn').addEventListener('click', openHelp);
	$('#selTextsBtn').addEventListener('click', selectAllTexts);
	$('#sheetBtn').addEventListener('click', openSheetDialog);
	$('#styleBtn').addEventListener('click', openStyleDialog);

	$('#editFontMgr').addEventListener('click', openFontMgr);
	$('#stFontMgr').addEventListener('click', openFontMgr);
	$('#fmSearch').addEventListener('input', () => {
		if (fmTimer) clearTimeout(fmTimer);
		fmTimer = setTimeout(renderFontMgr, 120);   // IME 入力を邪魔しないよう少し待つ
	});

	// 各モーダルの × とオーバーレイクリック
	for (const [dlg, close] of [
		['#editDialog', closeEditDialog],
		['#sheetDialog', closeSheetDialog],
		['#styleDialog', closeStyleDialog],
		['#fontMgrDialog', closeFontMgr],
		['#helpDialog', closeHelp],
	]) {
		$(dlg).querySelector('[data-close]').addEventListener('click', close);
		$(dlg).addEventListener('click', (e) => {
			if (e.target === $(dlg)) close();
		});
	}

	$('#editApply').addEventListener('click', applyEdit);
	// 書式欄は「触った項目だけ」を適用対象にするため、入力を記録する
	for (const [id, key] of [['#editFont', 'font'], ['#editSize', 'size'],
	                         ['#editColor', 'color'], ['#editAlign', 'align']]) {
		$(id).addEventListener('input', () => { editTouched[key] = true; });
		$(id).addEventListener('change', () => { editTouched[key] = true; });
	}
	attachFontCombo($('#editFont'), () => { editTouched.font = true; });
	attachFontCombo($('#stFont'), () => {
		$('#stUseFont').checked = true;   // フォントを選んだ＝適用したいはず
		updateStyleCounts();
	});

	$('#shTarget').addEventListener('change', buildSheet);
	$('#shCopy').addEventListener('click', copySheet);
	$('#shApply').addEventListener('click', applySheet);

	$('#stTarget').addEventListener('change', updateStyleCounts);
	for (const id of ['#stUseFont', '#stUseSize', '#stUseColor', '#stUseAlign'])
		$(id).addEventListener('change', updateStyleCounts);
	$('#stFrom').addEventListener('click', readStyleFromSelected);
	$('#stApply').addEventListener('click', applyStyleDialog);

	document.addEventListener('keydown', (e) => {
		if (e.ctrlKey && e.key === 'd') {          // 自己診断行の表示切り替え
			e.preventDefault();
			diagShown = !diagShown;
			updateDiag();
			return;
		}
		if (e.key === 'Escape') {
			if (!$('#helpDialog').hidden) closeHelp();
			else if (!$('#fontMgrDialog').hidden) closeFontMgr();
			else if (!$('#styleDialog').hidden) closeStyleDialog();
			else if (!$('#sheetDialog').hidden) closeSheetDialog();
			else if (!$('#editDialog').hidden) closeEditDialog();
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
						if (typeof it.text === 'string') r.body = it.text;
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

let bridgeFailed = false;

function connect() {
	let tries = 0;
	const timer = setInterval(() => {
		if (state.connected) { clearInterval(timer); return; }
		if (++tries > 20) {              // ~15 秒で諦める
			clearInterval(timer);
			bridgeFailed = true;
			renderAll();
			return;
		}
		try { post({ type: 'ready' }); } catch (e) { /* 次のリトライへ */ }
	}, 700);
	try { post({ type: 'ready' }); } catch (e) { /* リトライに任せる */ }
}

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
connect();
