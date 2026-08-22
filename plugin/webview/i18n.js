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
		'edit.working':    '処理中…',

		'sheet.title':     'テキストをまとめて編集',
		'sheet.hint':      'レイヤ名と本文を書き換えて「適用」。変わった行だけが反映され、履歴 1 回で取り消せる。セルへの貼り付けは下方向に流し込まれる (2 列以上を貼ると先頭列が名前・最後の列が本文になる)。名前を空にした行は名前を変えない。',
		'sheet.target':    '対象',
		'sheet.target.text': '全テキストレイヤ',
		'sheet.target.sel':  '選択中のレイヤ',
		'sheet.copy':      'TSV でコピー',
		'sheet.copy.title': '「レイヤ名 (タブ) 本文」をクリップボードへ書き出す',
		'sheet.copied':    'コピーしました',
		'sheet.col.name':  'レイヤ',
		'sheet.col.text':  '本文',
		'sheet.count':     '{0} 枚のうち {1} 枚が変わる',
		'sheet.apply':     '適用',
		'sheet.applyN':    '{0} 枚に適用',
		'sheet.done':      '{0} 枚に反映しました (履歴 1 回で取り消せます)',
		'sheet.doneFailed': '{0} 枚に反映 / {1} 枚 失敗',
		'sheet.working':   '処理中…',

		'tree.style':      '書式…',
		'tree.style.title': 'テキストレイヤの初期書式 (フォント/サイズ/色/揃え) をまとめて変える',
		'style.title':     '初期書式をまとめて変える',
		'style.hint':      'チェックした項目だけが、対象レイヤ全体の初期書式として適用される。本文の途中に部分的にかかっている書式には触らない。',
		'style.target':    '対象',
		'style.target.sel': '選択中のレイヤ',
		'style.target.text': '全テキストレイヤ',
		'style.count':     '{0} 枚に適用',
		'style.from':      '選択レイヤから取得',
		'style.from.title': '最後に選んだテキストレイヤの書式を欄に読み込む (書式コピー)',
		'style.read':      '「{0}」の書式を読み込みました',
		'style.font':      'フォント',
		'style.font.ph':   'フォント名で検索',
		'font.fav':        'お気に入り',
		'font.used':       'このドキュメントで使用中',
		'font.favused':    'お気に入り / 使用中',
		'font.all':        '全フォント',
		'font.star.title': 'お気に入りに登録 / 解除',
		'style.size':      'サイズ',
		'style.color':     '色',
		'style.align':     '揃え',
		'style.align.keep':   '(変更しない)',
		'style.align.left':   '左',
		'style.align.center': '中央',
		'style.align.right':  '右',
		'style.note':      'フォント欄は、既定ではお気に入り (★) とこのドキュメントで使用中のものだけが並ぶ。名前を入力すると全フォントから検索でき、☆ を押すとお気に入りに登録できる。',
		'style.apply':     '適用',
		'style.done':      '{0} 枚に反映しました (履歴 1 回で取り消せます)',
		'style.doneFailed': '{0} 枚に反映 / {1} 枚 失敗',
		'style.working':   '処理中…',
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
		'edit.working':    'Working…',

		'sheet.title':     'Edit text layers',
		'sheet.hint':      'Rewrite the layer names and contents, then press Apply. Only the changed rows are sent, as one undo step. Pasting into a cell flows downwards (with two or more columns, the first becomes the name and the last the contents). Rows with an emptied name keep their name.',
		'sheet.target':    'Layers',
		'sheet.target.text': 'Every text layer',
		'sheet.target.sel':  'Selected',
		'sheet.copy':      'Copy as TSV',
		'sheet.copy.title': 'Put "layer name (tab) contents" on the clipboard',
		'sheet.copied':    'Copied',
		'sheet.col.name':  'Layer',
		'sheet.col.text':  'Contents',
		'sheet.count':     '{1} of {0} row(s) change',
		'sheet.apply':     'Apply',
		'sheet.applyN':    'Apply to {0} layer(s)',
		'sheet.done':      'Applied to {0} layer(s) — one undo step',
		'sheet.doneFailed': 'Applied to {0} / {1} failed',
		'sheet.working':   'Working…',

		'tree.style':      'Style…',
		'tree.style.title': 'Change the base text style (font / size / color / alignment) in bulk',
		'style.title':     'Base text style',
		'style.hint':      'Only the checked fields are applied, as the base style of each whole layer. Formatting applied to parts of the text is left alone.',
		'style.target':    'Layers',
		'style.target.sel': 'Selected',
		'style.target.text': 'Every text layer',
		'style.count':     'applies to {0} layer(s)',
		'style.from':      'Read from selected',
		'style.from.title': 'Load the style of the last-selected text layer into the fields (style copy)',
		'style.read':      'Read the style of "{0}"',
		'style.font':      'Font',
		'style.font.ph':   'Search by font name',
		'font.fav':        'Favorites',
		'font.used':       'Used in this document',
		'font.favused':    'Favorites / used',
		'font.all':        'All fonts',
		'font.star.title': 'Add to / remove from favorites',
		'style.size':      'Size',
		'style.color':     'Color',
		'style.align':     'Alignment',
		'style.align.keep':   '(keep)',
		'style.align.left':   'Left',
		'style.align.center': 'Center',
		'style.align.right':  'Right',
		'style.note':      'The font field lists only favorites (★) and the fonts used in this document by default. Type to search all fonts, and click ☆ to add one to the favorites.',
		'style.apply':     'Apply',
		'style.done':      'Applied to {0} layer(s) — one undo step',
		'style.doneFailed': 'Applied to {0} / {1} failed',
		'style.working':   'Working…',
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
