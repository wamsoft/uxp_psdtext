// リリース用 .ccx を作る。
//
//   node dev/build-ccx.mjs
//   → dist/<name>-<version>.ccx   (<name> は manifest id の末尾セグメント)
//
// plugin/ をそのまま固めるのではなく、開発用の計装を落としてから固める:
//   - main.js         : DEBUG-BEGIN〜DEBUG-END の区間を除去
//   - webview/debug.js: no-op に差し替え (app.js の import はそのまま生きる)
//   - manifest.json   : network 権限を除去 (デバッグサーバ専用のため)
//
// .ccx は素の zip。依存を増やさないため store (無圧縮) の zip を自前で書く。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'plugin');
const outDir = path.join(root, 'dist');

//---------------------------------------------------------------------------
// ファイル収集と変換
//---------------------------------------------------------------------------

const NOOP_DEBUG = [
	'// Release build: debug hooks disabled. See dev/build-ccx.mjs.',
	'export function dlog() {}',
	'',
].join('\n');

function collect(dir, rel = '') {
	const out = [];
	for (const name of fs.readdirSync(dir)) {
		// submodule が置く .git などは同梱しない
		if (name.startsWith('.')) continue;
		const abs = path.join(dir, name);
		const r = rel ? rel + '/' + name : name;
		if (fs.statSync(abs).isDirectory()) out.push(...collect(abs, r));
		else out.push({ rel: r, data: fs.readFileSync(abs) });
	}
	return out;
}

function transform(f) {
	if (f.rel === 'main.js') {
		const s = f.data.toString('utf8');
		const stripped = s.replace(/\/\/ DEBUG-BEGIN[\s\S]*?\/\/ DEBUG-END\n?/g, '');
		if (stripped === s) throw new Error('main.js: DEBUG markers not found');
		return { ...f, data: Buffer.from(stripped, 'utf8') };
	}
	if (f.rel === 'webview/debug.js') {
		return { ...f, data: Buffer.from(NOOP_DEBUG, 'utf8') };
	}
	if (f.rel === 'manifest.json') {
		const m = JSON.parse(f.data.toString('utf8'));
		if (m.requiredPermissions) delete m.requiredPermissions.network;
		return { ...f, data: Buffer.from(JSON.stringify(m, null, '\t') + '\n', 'utf8'), manifest: m };
	}
	return f;
}

//---------------------------------------------------------------------------
// store 方式の zip (ローカルヘッダ + セントラルディレクトリ + EOCD)
//---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
	const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	return { time, date };
}

function buildZip(files) {
	const { time, date } = dosDateTime(new Date());
	const locals = [];
	const centrals = [];
	let offset = 0;

	for (const f of files) {
		const name = Buffer.from(f.rel, 'utf8');
		const crc = crc32(f.data);
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0);
		head.writeUInt16LE(20, 4);            // version needed
		head.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
		head.writeUInt16LE(0, 8);             // method: store
		head.writeUInt16LE(time, 10);
		head.writeUInt16LE(date, 12);
		head.writeUInt32LE(crc, 14);
		head.writeUInt32LE(f.data.length, 18);
		head.writeUInt32LE(f.data.length, 22);
		head.writeUInt16LE(name.length, 26);
		head.writeUInt16LE(0, 28);

		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0);
		cen.writeUInt16LE(20, 4);             // version made by
		cen.writeUInt16LE(20, 6);
		cen.writeUInt16LE(0x0800, 8);
		cen.writeUInt16LE(0, 10);
		cen.writeUInt16LE(time, 12);
		cen.writeUInt16LE(date, 14);
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(f.data.length, 20);
		cen.writeUInt32LE(f.data.length, 24);
		cen.writeUInt16LE(name.length, 28);
		cen.writeUInt32LE(offset, 42);

		locals.push(head, name, f.data);
		centrals.push(Buffer.concat([cen, name]));
		offset += head.length + name.length + f.data.length;
	}

	const centralBuf = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(centralBuf.length, 12);
	eocd.writeUInt32LE(offset, 16);

	return Buffer.concat([...locals, centralBuf, eocd]);
}

//---------------------------------------------------------------------------

const files = collect(srcDir).map(transform);
const manifest = files.find(f => f.rel === 'manifest.json');
const version = manifest.manifest.version;
const name = manifest.manifest.id.split('.').pop();

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${name}-${version}.ccx`);
fs.writeFileSync(out, buildZip(files));

console.log(`${out} (${files.length} files)`);
for (const f of files) console.log('  ' + f.rel + ' (' + f.data.length + ' bytes)');
