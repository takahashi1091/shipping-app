# 出荷支援アプリの開発メモ

後から機能を足すときの目安です。今回の MVP では未実装です。

## サイズによる運送会社自動切替

想定場所: `js/rules.js` の `suggestCarrier(store, size)`。

出荷画面は店舗検索・サイズ選択のたびにこの関数を呼びます。利用者が運送会社を手動変更したあとは上書きしません（`carrierTouched`）。

## 店舗ごとの特別配送ルール

店舗オブジェクト（`db.js` の `putStore`）に `rules` を追加。  
DB_VERSION を 2 に上げ、`onupgradeneeded` で既存レコードを壊さない。

## 出荷件数集計 / 日別・月別 / 出荷実績分析

`js/reports.js` の `byCarrier` / `byDay` / `byMonth` を使う。  
画面は `index.html` に section を足し、メニューに `data-nav` を 1 行足す。

## 送り状番号

履歴レコードに `trackingNumber` を用意済み。出荷画面または履歴詳細に入力欄を足す。

## 運送会社別 CSV レイアウト

`reports.layoutForCarrier(carrier, list)` を運送会社ごとに列順を変える。

## バックアップ

店舗 + 履歴 + 設定を 1 つの JSON で書き出す関数を `csv.js` の隣に `backup.js` として追加するのがわかりやすいです。

## ラベル印刷

ブラウザの `window.print()` か、Bluetooth プリンタ SDK。画面は履歴詳細から出す想定。
