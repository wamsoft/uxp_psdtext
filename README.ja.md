# PSD Text Edit

Photoshop のテキストレイヤ本文をまとめて編集するパネル — 一覧・検索・
表で編集・Undo 1 回で反映。UXP + webview UI で実装。
[uxp_psdrename](https://github.com/wamsoft/uxp_psdrename)
(同じ構成のレイヤ一括リネーム) の姉妹ツール。

[English README](README.md) / [開発者向けメモ (英語)](DEVELOPMENT.md)

## 機能

- アクティブドキュメントの**レイヤツリー**表示 (既定はテキストレイヤのみ)。
  Photoshop 側の変更に自動追従し、各レイヤの横に本文を表示
- **検索・絞り込み**: レイヤパスと本文の部分一致
- **単体編集**: テキストレイヤをダブルクリック (または F2) で
  **WYSIWYG エディタ** ([Quill](https://quilljs.com) 採用) —
  部分ごとの太字/斜体/下線/サイズ/色と行ごとの揃えが見たまま表示・編集でき、
  エディタ内 Undo/Redo 対応。「タグ」ボタンでタグ編集モードにも切替可
- **一括編集 (「まとめて編集…」) は psdtext 流のカラム構成**: 名前 / 本文 /
  フォント / サイズ / 色 / 揃えを行ごとに編集し、変わった行だけが反映される。
  書式列の変更は本文途中の部分書式を保ち、見出しチェック
  (「本文のみ」「書式のみ」等のプリセット付き) でコピー / 貼り付けに効く
  列を選べる (規則ベースの一括リネームは uxp_psdrename 側)
- **CSV の代わりにクリップボード TSV**: 「表をコピー」は対象列を
  Excel 互換 (引用付き) で書き出し、セルへの貼り付けは**そのセルを起点に
  右の対象列 → 下の行へ流し込み**
- 改行は正しく往復する (Photoshop の `\r` ⇄ `\n`)
- 適用は**履歴 1 段** — Ctrl+Z 1 回で全部戻る
- 日英 UI (既定は英語)、内蔵ガイド付き
  (**?** ボタン、またはパネルのフライアウトメニュー **≡ > Help**)

## 動作環境

- Adobe Photoshop **2025 (v26) 以降** — UI が webview のローカル HTML で
  動くため UXP 8.0 が必要。

## インストール

1. [Releases](https://github.com/wamsoft/uxp_psdtext/releases) から
   `psdtext-x.y.z.ccx` をダウンロード
2. `.ccx` をダブルクリック — Creative Cloud デスクトップアプリがインストールする
3. パネルを開く: *プラグイン > PSD Text Edit > Text Edit*

ソースから動かす場合は [DEVELOPMENT.md](DEVELOPMENT.md) を参照。

## 使い方

1. PSD を開くと自動でテキストレイヤが並ぶ
2. 行末の **✎**（またはダブルクリック / F2）で単体編集、
   「**まとめて編集…**」で表編集
3. 表は「表をコピー」→ Excel で編集 →「TSV を貼り付け」で往復できる
   （セルに Ctrl+V ならそのセルが起点）
4. **適用**で変わった行だけ反映。Ctrl+Z 1 回で全部戻る

フォント欄の候補は「お気に入り + このドキュメントで使用中」のみ。
全フォントからの検索・登録は ★ ボタンから。
詳しい使い方はパネルの **?** ボタンへ。

## ライセンス

[MIT](LICENSE)。エディタとして [Quill](https://quilljs.com)
(BSD 3-Clause、`plugin/webview/vendor/quill.js.LICENSE.txt`) を同梱。
