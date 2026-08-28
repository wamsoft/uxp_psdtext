//---------------------------------------------------------------------------
// 貼り付け — psdrename / psdtext / psdexport 共通
//
// Windows では UXP パネル内の webview にキーボードフォーカスが来ないため、
// Ctrl+V が届かない (Adobe 既知の不具合。macOS では起きない)。
// クリップボードはパネル側 (manifest で clipboard 権限を持つ) に読んでもらい、
// 直前に触った入力欄へ差し込む。
//
// 「直前に触った欄」で足りるのは、OS のキーボードフォーカスが来なくても
// クリックで DOM のフォーカスは動くため。
//---------------------------------------------------------------------------

let lastTarget = null;      ///< 最後にフォーカスした入力欄 (ダイアログをまたいで 1 つ)

function el(x) {
	return typeof x === 'string' ? document.querySelector(x) : x;
}

/// カーソル位置 (選択中ならその範囲) に差し込む。
/// input イベントも起こして、ライブプレビューなどを更新させる。
export function pasteInto(target, text) {
	if (!target || !text) return false;
	const a = target.selectionStart, b = target.selectionEnd;
	if (typeof a === 'number' && typeof b === 'number' && target.setRangeText) {
		target.setRangeText(text, a, b, 'end');
	} else {
		target.value += text;
	}
	target.dispatchEvent(new Event('input', { bubbles: true }));
	return true;
}

/// 単行の入力欄に流し込むので、改行は畳んでおく
export function clipText(v) {
	return String(v || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/// ダイアログに貼り付けボタンを付ける。
///
///   attachPaste('#renameDialog', {
///       button: '#rnPaste', fallback: '#rnFind',
///       request, tr, setStatus: setRenameStatus,
///   });
///
/// fallback はまだどの欄も触っていないときの既定の差し込み先。
export function attachPaste(dlgSel, opts) {
	const dlg = el(dlgSel);
	if (!dlg) return;
	const { button, fallback, request, tr, setStatus } = opts;

	const remember = (e) => {
		if (e.target.matches && e.target.matches('input[type="text"], textarea'))
			lastTarget = e.target;
	};
	dlg.addEventListener('focusin', remember);
	dlg.addEventListener('mousedown', remember);

	const btn = el(button);
	if (!btn) return;
	btn.addEventListener('click', async () => {
		// 直前に触った欄がこのダイアログの中に無ければ既定欄に戻す
		const target = (lastTarget && dlg.contains(lastTarget)) ? lastTarget : el(fallback);
		if (!target) return;
		try {
			const res = await request('readClipboard');
			const text = clipText(res.text);
			if (!text) { setStatus(tr('app.clipEmpty'), 'error'); return; }
			target.focus();
			pasteInto(target, text);
			setStatus('');
		} catch (e) {
			setStatus(String(e.message || e), 'error');
		}
	});
}
