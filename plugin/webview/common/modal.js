//---------------------------------------------------------------------------
// モーダルの開閉 — psdrename / psdtext / psdexport 共通
//
// 「背景クリックで閉じる」を click の target だけで判定してはいけない。
// click は mousedown の target と mouseup の target の最近共通祖先で発火する
// ので、ダイアログの中で選択ドラッグを始めて背景で離しただけで「背景が
// クリックされた」ことになり、編集中の内容ごと閉じてしまう。
// 押した位置と離した位置の両方が背景自身のときだけ閉じる。
//
// 閉じると内容が失われるダイアログには isDirty を渡す。未保存のときは
// 背景クリックと Escape では閉じず、代わりに onBlocked を呼ぶ
// (× は意図的な操作なので、未保存でもそのまま閉じる)。
//---------------------------------------------------------------------------

const guards = new Map();   ///< 要素 → {close, isDirty, onBlocked}

function el(x) {
	return typeof x === 'string' ? document.querySelector(x) : x;
}

export function wireModalClose(sel, close, isDirty, onBlocked) {
	const dlg = el(sel);
	if (!dlg) return;
	guards.set(dlg, { close, isDirty, onBlocked });

	let downOnBackdrop = false;
	dlg.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dlg; });
	dlg.addEventListener('mouseleave', () => { downOnBackdrop = false; });
	dlg.addEventListener('mouseup', (e) => {
		const onBackdrop = downOnBackdrop && e.target === dlg;
		downOnBackdrop = false;
		if (onBackdrop) requestModalClose(dlg);
	});

	const x = dlg.querySelector('[data-close]');
	if (x) x.addEventListener('click', close);
}

/// 背景クリックと Escape からの「閉じたい」。未保存の変更があるときは閉じない。
export function requestModalClose(sel) {
	const g = guards.get(el(sel));
	if (!g) return false;
	if (g.isDirty && g.isDirty()) { if (g.onBlocked) g.onBlocked(); return false; }
	g.close();
	return true;
}

/// いま開いているいちばん手前のモーダルを閉じる (Escape 用)。
/// 引数は手前に出ているものから順に並べる。
export function escapeModal(order) {
	for (const sel of order) {
		const dlg = el(sel);
		if (dlg && !dlg.hidden) { requestModalClose(dlg); return true; }
	}
	return false;
}
