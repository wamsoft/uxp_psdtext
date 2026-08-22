// 開発用デバッグサーバ。プラグイン (webview) が localhost へログを送り、
// こちらから JS を送り込んで webview / パネル内で eval させるための口。
//
//   node dev/debug-server.mjs [logfile]
//
//   POST /log     {side, msg}          ログを受けて表示 + ファイルへ追記
//   GET  /poll?side=wv|panel           そのside宛のevalコマンドを払い出す
//   POST /result  {id, ok, value}      eval の結果
//   POST /push    {side, js}           evalコマンドを積む (curl で使う)
//   GET  /                             動作確認用
//
// リリース物ではない。127.0.0.1 のみで待ち受ける。

import http from 'node:http';
import fs from 'node:fs';

const PORT = 18999;
const LOGFILE = process.argv[2] || 'psdrename-debug.log';

const queues = { wv: [], panel: [] };
let cmdSeq = 0;

function stamp() {
	const d = new Date();
	return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function out(line) {
	const s = `[${stamp()}] ${line}`;
	console.log(s);
	try { fs.appendFileSync(LOGFILE, s + '\n'); } catch (e) { /* ignore */ }
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (c) => { data += c; });
		req.on('end', () => resolve(data));
	});
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://127.0.0.1');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

	try {
		if (req.method === 'POST' && url.pathname === '/log') {
			const b = JSON.parse(await readBody(req) || '{}');
			out(`${b.side || '?'} | ${b.msg || ''}`);
			res.end('ok');
		} else if (req.method === 'GET' && url.pathname === '/poll') {
			const side = url.searchParams.get('side') || 'wv';
			const cmds = queues[side] ? queues[side].splice(0) : [];
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ cmds }));
		} else if (req.method === 'POST' && url.pathname === '/result') {
			const b = JSON.parse(await readBody(req) || '{}');
			out(`result #${b.id} ${b.ok ? 'ok' : 'ERROR'} | ${b.value}`);
			res.end('ok');
		} else if (req.method === 'POST' && url.pathname === '/push') {
			const b = JSON.parse(await readBody(req) || '{}');
			const id = ++cmdSeq;
			(queues[b.side || 'wv'] ||= []).push({ id, js: b.js || '' });
			out(`push #${id} -> ${b.side}: ${b.js}`);
			res.end(String(id));
		} else if (req.method === 'GET' && url.pathname === '/') {
			res.end('psdrename debug server\n');
		} else {
			res.writeHead(404); res.end();
		}
	} catch (e) {
		out('server error: ' + e.message);
		res.writeHead(500); res.end();
	}
});

server.listen(PORT, '127.0.0.1', () => out(`listening on http://127.0.0.1:${PORT} log=${LOGFILE}`));
