//---------------------------------------------------------------------------
// 開発用デバッグフック。localhost:18999 のデバッグサーバ (dev/debug-server.mjs)
// が立っていれば、console 出力の転送・エラー捕捉・リモート eval を提供する。
// サーバが居なければ何もしない (通信失敗はすべて握りつぶす)。
//---------------------------------------------------------------------------

const BASE = 'http://127.0.0.1:18999';
let serverSeen = false;

function fmt(a) {
	if (typeof a === 'string') return a;
	try { return JSON.stringify(a); } catch (e) { return String(a); }
}

async function send(path, data) {
	try {
		await fetch(BASE + path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		serverSeen = true;
	} catch (e) { /* サーバ不在 */ }
}

/// side 付きでログを送る。パネルからの中継 (side='panel') にも使う
export function dlog(side, ...args) {
	send('/log', { side, msg: args.map(fmt).join(' ') });
}

// console をフックして webview 内のログを丸ごと転送する
for (const level of ['log', 'warn', 'error']) {
	const orig = console[level].bind(console);
	console[level] = (...args) => {
		orig(...args);
		dlog('wv:' + level, ...args);
	};
}

window.addEventListener('error', (e) => {
	dlog('wv:onerror', e.message, e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
	dlog('wv:reject', fmt(e.reason && (e.reason.message || e.reason)));
});

// リモート eval。サーバの /push に積まれた JS をこの webview の中で実行して
// 結果を返す。デバッグサーバは開発者本人しか立てない前提の開発専用機能。
async function pollLoop() {
	for (;;) {
		await new Promise((r) => setTimeout(r, 1000));
		try {
			const res = await fetch(BASE + '/poll?side=wv');
			const { cmds } = await res.json();
			serverSeen = true;
			for (const c of cmds || []) {
				let ok = true, value;
				try {
					value = await Promise.resolve((0, eval)(c.js));
				} catch (e) {
					ok = false;
					value = String(e && (e.stack || e.message) || e);
				}
				send('/result', { id: c.id, ok, value: fmt(value) });
			}
		} catch (e) { /* サーバ不在 */ }
	}
}
pollLoop();

dlog('wv', 'debug hook loaded: ' + location.href);
