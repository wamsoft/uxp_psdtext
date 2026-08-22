//---------------------------------------------------------------------------
// 最小限の i18n。辞書 + data-i18n / data-i18n-title / data-i18n-ph 属性の
// DOM 走査。既定は英語。
//---------------------------------------------------------------------------

const DICT = {
	ja: {
		'app.title':       'PSD Text Edit',
		'app.noDoc':       'ドキュメントが開かれていません',
		'app.connecting':  'Photoshop に接続中…',
		'app.bridgeFail':  'パネルと通信できません。UXP Developer Tool の Debug でパネル側のログを確認してください (Photoshop 2025 / v26 以降が必要)。',
		'app.refresh':     '再読込',
		'app.refresh.title': 'Photoshop からレイヤ一覧を取り直す',
		'app.layers':      '{0} レイヤ (テキスト {1})',
		'app.lang':        'EN',
		'app.help.title':  '使い方を表示',
		'help.title':      'PSD Text Edit の使い方',

		'tree.filter.ph':  'レイヤ名・本文で絞り込み',
		'tree.flt.text':   'テキスト',
		'tree.flt.text.title': 'テキストレイヤだけ一覧に出す',
		'tree.flt.visible': '表示中',
		'tree.flt.visible.title': '表示 ON のレイヤだけ一覧に出す',
		'tree.edit.hint':  'ダブルクリックで本文を編集',
		'tree.selTexts':   'テキスト全選択',
		'tree.selTexts.title': '一覧に出ているテキストレイヤを全部選択する',
		'tree.sheet':      'まとめて編集…',
		'tree.sheet.title': 'テキストレイヤの本文を表でまとめて編集する',

		'sel.count':       '{0} レイヤ選択中',

		'edit.name':       '名前',
		'edit.apply':      '適用',
		'edit.done':       '反映しました',
		'fmt.b.title':     '選択範囲を太字 / 解除',
		'fmt.i.title':     '選択範囲を斜体 / 解除',
		'fmt.u.title':     '選択範囲に下線 / 解除',
		'fmt.size.title':  '選択範囲のサイズ (pt)',
		'fmt.color.title': '選択範囲の色',
		'fmt.apply':       '適用',
		'fmt.reset':       '基準へ',
		'fmt.reset.title': '選択範囲の書式を基準へ戻す',
		'fmt.al.left':     '左揃え',
		'fmt.al.center':   '中央揃え',
		'fmt.al.right':    '右揃え',
		'fmt.al.justify':  '両端揃え',
		'fmt.mode.tag':    'タグ',
		'fmt.mode.wysiwyg': '見たまま',
		'fmt.mode.title':  '見たまま編集とタグ編集を切り替える',
		'edit.working':    '処理中…',

		'sheet.title':     'テキストをまとめて編集',
		'sheet.hint':      'レイヤ名・本文・基準書式 (フォント/サイズ/色/揃え) を表で書き換えて「適用」。変わった行だけが反映され、履歴 1 回で取り消せる。書式を変えても本文途中の部分書式は保たれるが、本文を書き換えた行は途中の書式が落ちる。見出しのチェックはコピー/貼り付けに効く列の選択で、編集自体はいつでもできる。',
		'sheet.target':    '対象',
		'sheet.target.text': '全テキストレイヤ',
		'sheet.target.sel':  '選択中のレイヤ',
		'sheet.cols':      'コピー / 貼り付けの対象列:',
		'sheet.colsText':  '本文のみ',
		'sheet.colsStyle': '書式のみ',
		'sheet.colsName':  '名前のみ',
		'sheet.colsNotName': '名前以外',
		'sheet.colsAll':   '全部',
		'sheet.colTarget': 'コピー / 貼り付けをこの列に効かせる',
		'sheet.noCols':    '対象列がありません。見出しのチェックかプリセットで選んでください',
		'sheet.colOff':    '「{0}」列は対象外なので、対象列の先頭から流し込みました',
		'sheet.pasted':    '{0} セルに貼り付けました',
		'sheet.copy':      '表をコピー',
		'sheet.copy.title': '対象列を TSV でクリップボードへ (Excel にそのまま貼れる)',
		'sheet.copied':    '{0} 行 × {1} 列をコピーしました',
		'sheet.col.name':  'レイヤ',
		'sheet.col.text':  '本文',
		'sheet.col.font':  'フォント',
		'sheet.col.size':  'サイズ',
		'sheet.col.color': '色',
		'sheet.col.align': '揃え',
		'sheet.count':     '{0} 枚のうち {1} 枚が変わる',
		'sheet.marksNote': '本文途中に {0} 箇所の部分書式あり。本文を書き換えると失われる',
		'sheet.fontPick':  '候補から選ぶ (お気に入り + 使用中)',
		'sheet.fontMore':  'お気に入りを管理…',
		'sheet.apply':     '適用',
		'sheet.applyN':    '{0} 枚に適用',
		'sheet.done':      '{0} 枚に反映しました (履歴 1 回で取り消せます)',
		'sheet.doneLost':  '{0} 枚に反映 (うち {1} 枚は本文変更のため途中の書式が外れました)',
		'sheet.doneFailed': '{0} 枚に反映 / {1} 枚 失敗',
		'sheet.working':   '処理中…',
		'al.left':         '左',
		'al.center':       '中央',
		'al.right':        '右',
		'al.justify':      '両端',

		'style.font':      'フォント',
		'style.font.ph':   'フォント名で検索',
		'fmt.font.title':  '選択範囲のフォント (一覧から選ぶと適用される)',
		'font.fav':        'お気に入り',
		'font.used':       'このドキュメントで使用中',
		'font.favused':    'お気に入り / 使用中',
		'font.all':        '全フォント',
		'fontcombo.empty': '候補が空です。★ ボタンでお気に入りを登録してください',
		'fontmgr.open.title': 'お気に入りフォントを管理',
		'fontmgr.title':   'お気に入りフォント',
		'fontmgr.hint':    '行をクリックすると登録/解除。登録したフォントがフォント欄の候補に並ぶ。',
		'fontmgr.search.ph': 'フォント名で検索 (ファミリ名 / PostScript 名)',
		'fontmgr.count':   '{0} 件登録',
		'fontmgr.more':    '(他 {0} 件 — 検索で絞り込んでください)',
		'style.size':      'サイズ',
		'style.color':     '色',
	},
	en: {
		'app.title':       'PSD Text Edit',
		'app.noDoc':       'No document is open',
		'app.connecting':  'Connecting to Photoshop…',
		'app.bridgeFail':  'Cannot talk to the panel. Check the panel log in UXP Developer Tool (Photoshop 2025 / v26 or later is required).',
		'app.refresh':     'Reload',
		'app.refresh.title': 'Fetch the layer list from Photoshop again',
		'app.layers':      '{0} layer(s), {1} text',
		'app.lang':        'JA',
		'app.help.title':  'Show the guide',
		'help.title':      'PSD Text Edit Guide',

		'tree.filter.ph':  'Filter by name or contents',
		'tree.flt.text':   'Text',
		'tree.flt.text.title': 'List text layers only',
		'tree.flt.visible': 'Shown',
		'tree.flt.visible.title': 'List layers that are currently visible',
		'tree.edit.hint':  'Double-click to edit the contents',
		'tree.selTexts':   'Select all text',
		'tree.selTexts.title': 'Select every text layer in the list',
		'tree.sheet':      'Edit all…',
		'tree.sheet.title': 'Edit the contents of the text layers in a table',

		'sel.count':       '{0} layer(s) selected',

		'edit.name':       'Name',
		'edit.apply':      'Apply',
		'edit.done':       'Applied',
		'fmt.b.title':     'Bold on/off for the selection',
		'fmt.i.title':     'Italic on/off for the selection',
		'fmt.u.title':     'Underline on/off for the selection',
		'fmt.size.title':  'Size for the selection (pt)',
		'fmt.color.title': 'Color for the selection',
		'fmt.apply':       'Set',
		'fmt.reset':       'To base',
		'fmt.reset.title': 'Reset the selection to the base style',
		'fmt.al.left':     'Align left',
		'fmt.al.center':   'Align center',
		'fmt.al.right':    'Align right',
		'fmt.al.justify':  'Justify',
		'fmt.mode.tag':    'Tags',
		'fmt.mode.wysiwyg': 'Visual',
		'fmt.mode.title':  'Switch between visual and tag editing',
		'edit.working':    'Working…',

		'sheet.title':     'Edit text layers',
		'sheet.hint':      'Rewrite names, contents and the base style (font / size / color / alignment) in the table, then Apply. Only changed rows are sent, as one undo step. Style edits keep the formatting inside the body; rewriting the body drops it. The header checkboxes only choose which columns copy & paste touch — editing always works.',
		'sheet.target':    'Layers',
		'sheet.target.text': 'Every text layer',
		'sheet.target.sel':  'Selected',
		'sheet.cols':      'Copy / paste columns:',
		'sheet.colsText':  'Body only',
		'sheet.colsStyle': 'Formatting only',
		'sheet.colsName':  'Name only',
		'sheet.colsNotName': 'All but name',
		'sheet.colsAll':   'All',
		'sheet.colTarget': 'Include this column in copy & paste',
		'sheet.noCols':    'No target columns — pick some via the header checkboxes or the presets',
		'sheet.colOff':    'The "{0}" column is not a target, so the paste started from the first target column',
		'sheet.pasted':    'Pasted into {0} cell(s)',
		'sheet.copy':      'Copy table',
		'sheet.copy.title': 'Copy the target columns as TSV (paste straight into Excel)',
		'sheet.copied':    'Copied {0} row(s) × {1} column(s)',
		'sheet.col.name':  'Layer',
		'sheet.col.text':  'Contents',
		'sheet.col.font':  'Font',
		'sheet.col.size':  'Size',
		'sheet.col.color': 'Color',
		'sheet.col.align': 'Align',
		'sheet.count':     '{1} of {0} row(s) change',
		'sheet.marksNote': '{0} formatted run(s) inside the body — rewriting the body drops them',
		'sheet.fontPick':  'Pick from favorites + fonts in use',
		'sheet.fontMore':  'Manage favorites…',
		'sheet.apply':     'Apply',
		'sheet.applyN':    'Apply to {0} layer(s)',
		'sheet.done':      'Applied to {0} layer(s) — one undo step',
		'sheet.doneLost':  'Applied to {0} (inner formatting dropped on {1} rewritten row(s))',
		'sheet.doneFailed': 'Applied to {0} / {1} failed',
		'sheet.working':   'Working…',
		'al.left':         'Left',
		'al.center':       'Center',
		'al.right':        'Right',
		'al.justify':      'Justify',

		'style.font':      'Font',
		'style.font.ph':   'Search by font name',
		'fmt.font.title':  'Font for the selection (picking from the list applies it)',
		'font.fav':        'Favorites',
		'font.used':       'Used in this document',
		'font.favused':    'Favorites / used',
		'font.all':        'All fonts',
		'fontcombo.empty': 'Nothing to list yet — register favorites with the ★ button',
		'fontmgr.open.title': 'Manage favorite fonts',
		'fontmgr.title':   'Favorite fonts',
		'fontmgr.hint':    'Click a row to add or remove it. Registered fonts appear in the font field\'s list.',
		'fontmgr.search.ph': 'Search by font name (family / PostScript)',
		'fontmgr.count':   '{0} favorite(s)',
		'fontmgr.more':    '({0} more — narrow the search)',
		'style.size':      'Size',
		'style.color':     'Color',
	},
};

const LANG_KEY = 'psdtext.lang';

// UXP の webview では localStorage が使えない (アクセスするたび警告が出る)。
// 言語はメモリに持ち、localStorage は起動時の 1 回だけ試す。
let lang = null;

function safeGet(key) {
	try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, value) {
	try { localStorage.setItem(key, value); } catch (e) { /* 保存できないだけ */ }
}

export function currentLang() {
	if (lang) return lang;
	const saved = safeGet(LANG_KEY);
	lang = (saved === 'ja' || saved === 'en') ? saved : 'en';   // 既定は英語
	return lang;
}

export function toggleLang() {
	lang = currentLang() === 'ja' ? 'en' : 'ja';
	safeSet(LANG_KEY, lang);
	applyI18n();
}

/// tr('sheet.count', 10, 3) → '{0}' '{1}' を引数で埋める
export function tr(key, ...args) {
	const d = DICT[currentLang()] || DICT.en;
	let s = d[key] ?? DICT.en[key] ?? key;
	for (let i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(String(args[i]));
	return s;
}

/// data-i18n / data-i18n-title / data-i18n-ph の付いた要素をまとめて置換する
export function applyI18n() {
	for (const el of document.querySelectorAll('[data-i18n]'))
		el.textContent = tr(el.dataset.i18n);
	for (const el of document.querySelectorAll('[data-i18n-title]'))
		el.title = tr(el.dataset.i18nTitle);
	for (const el of document.querySelectorAll('[data-i18n-ph]'))
		el.placeholder = tr(el.dataset.i18nPh);
}
