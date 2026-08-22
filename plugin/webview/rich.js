//---------------------------------------------------------------------------
// 部分書式: 範囲配列 ⇄ タグ付きテキスト
//
// ブリッジ (main.js) は textStyleRange を「プレーン本文 + 範囲ごとの簡易
// スタイル」で渡してくる。UI ではそれをタグ付き 1 本の文字列として扱う。
// タグ文法は psdtext と互換 (tags.js)。DOM に触れない純粋変換だけ。
//---------------------------------------------------------------------------

import { escapeText, segments, formatMark, baseStyle, sameValue,
         VALUE_ATTRS, FLAG_ATTRS, STYLE_ATTRS } from './tags.js';

/// {text, ranges} をタグ付き 1 本の文字列へ。
/// 基準 = 先頭ランの書式。基準と同じ値へ戻る所は [/color] の形になる。
export function rangesToTagged(text, ranges) {
	if (!ranges || !ranges.length) return escapeText(text);
	const base = baseStyle(ranges[0]);
	let out = '';
	let prev = { ...base };
	let pos = 0;
	for (const r of ranges) {
		if (r.from > pos) out += escapeText(text.slice(pos, r.from));
		const cur = baseStyle(r);
		const specs = {};
		for (const a of VALUE_ATTRS)
			if (!sameValue(a, cur[a], prev[a]))
				specs[a] = sameValue(a, cur[a], base[a]) ? null : cur[a];
		for (const a of FLAG_ATTRS)
			if (cur[a] !== prev[a]) specs[a] = cur[a];
		if (Object.keys(specs).length) out += formatMark(specs);
		out += escapeText(text.slice(r.from, r.to));
		prev = cur;
		pos = r.to;
	}
	if (pos < text.length) out += escapeText(text.slice(pos));
	return out;
}

function applySpecs(cur, specs, b) {
	if (specs.reset) Object.assign(cur, b);
	for (const a of VALUE_ATTRS)
		if (a in specs) cur[a] = specs[a] === null ? b[a] : specs[a];
	for (const a of FLAG_ATTRS)
		if (a in specs) cur[a] = specs[a];
}

/// タグ付きテキストを {text (プレーン), ranges} へ。base は null 解決に使う
/// 基準書式 (基準欄でユーザーが変えた値を混ぜてから渡す)。
export function taggedToRich(tagged, base) {
	const b = baseStyle(base || {});
	const cur = { ...b };
	let plain = '';
	const ranges = [];
	for (const seg of segments(tagged)) {
		if (seg.kind !== 'text') {
			applySpecs(cur, seg.specs, b);
			continue;
		}
		if (!seg.text) continue;
		const from = plain.length;
		plain += seg.text;
		const last = ranges[ranges.length - 1];
		if (last && STYLE_ATTRS.every(a => sameValue(a, last[a], cur[a]))) {
			last.to = plain.length;
		} else {
			ranges.push({ from, to: plain.length, ...cur });
		}
	}
	if (!ranges.length) ranges.push({ from: 0, to: plain.length, ...b });
	else ranges[ranges.length - 1].to = plain.length;
	return { text: plain, ranges };
}
