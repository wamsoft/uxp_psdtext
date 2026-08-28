//---------------------------------------------------------------------------
// i18n エンジン — psdrename / psdtext / psdexport 共通
//
// 辞書は各案件が持ち、ここは仕組みだけ。
//
//   import { createI18n } from '../common/i18n.js';
//   const DICT = { ja: {...}, en: {...} };
//   export const { tr, applyI18n, currentLang, toggleLang, setLang } =
//       createI18n(DICT, 'psdrename.lang');
//
// UXP の webview では localStorage が使えない (アクセスするたび警告が出る)。
// 言語はメモリに持ち、localStorage は起動時の 1 回だけ試す。
// パネル側の prefs.json に置きたいときは setLang() を使う。
//---------------------------------------------------------------------------

export function createI18n(DICT, storageKey) {
	let lang = null;

	function safeGet(key) {
		try { return localStorage.getItem(key); } catch (e) { return null; }
	}
	function safeSet(key, value) {
		try { localStorage.setItem(key, value); } catch (e) { /* 保存できないだけ */ }
	}

	function currentLang() {
		if (lang) return lang;
		const saved = safeGet(storageKey);
		lang = (saved === 'ja' || saved === 'en') ? saved : 'en';   // 既定は英語
		return lang;
	}

	/// パネル側 prefs から復元するときなど、外から言語を決める。
	/// 実際に変わったときだけ true を返す。
	function setLang(l) {
		if (l !== 'ja' && l !== 'en') return false;
		if (currentLang() === l) return false;
		lang = l;
		safeSet(storageKey, lang);
		applyI18n();
		return true;
	}

	function toggleLang() {
		lang = currentLang() === 'ja' ? 'en' : 'ja';
		safeSet(storageKey, lang);
		applyI18n();
	}

	/// tr('rn.count', 10, 3) → '{0}' '{1}' を引数で埋める
	function tr(key, ...args) {
		const d = DICT[currentLang()] || DICT.en;
		let s = d[key] ?? DICT.en[key] ?? key;
		for (let i = 0; i < args.length; i++)
			s = s.split('{' + i + '}').join(String(args[i]));
		return s;
	}

	/// data-i18n / data-i18n-title / data-i18n-ph の付いた要素をまとめて置換する
	function applyI18n() {
		for (const el of document.querySelectorAll('[data-i18n]'))
			el.textContent = tr(el.dataset.i18n);
		for (const el of document.querySelectorAll('[data-i18n-title]'))
			el.title = tr(el.dataset.i18nTitle);
		for (const el of document.querySelectorAll('[data-i18n-ph]'))
			el.placeholder = tr(el.dataset.i18nPh);
	}

	return { tr, applyI18n, currentLang, toggleLang, setLang };
}
