/**
 * constants.js
 * アプリ全体で使う固定値（サイズ・運送会社・画面ID）をまとめる。
 * 将来、サイズによる自動切替などを足すときは、まずここを増やすとわかりやすい。
 */

/** 荷物サイズ（出荷処理の選択ボタン） */
const SIZES = ["小口", "中型", "大型", "ワンピースロッド"];

/** 個口数（サイズ選択の上。よく使う 1〜10） */
const PIECE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 店舗コードは数字なら 6 桁（足りない分は先頭 0） */
const STORE_CODE_LENGTH = 6;

/** 数字の店舗コードを 6 桁に揃える。123 → 000123。英字混在はそのまま */
function padStoreCode(code) {
  const raw = String(code == null ? "" : code).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw) && raw.length < STORE_CODE_LENGTH) {
    return raw.padStart(STORE_CODE_LENGTH, "0");
  }
  return raw;
}

/** 端末の「今日」を YYYY-MM-DD にする（重複チェック・日次集計用） */
function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function formatDateJa(dateKeyOrIso) {
  const key = String(dateKeyOrIso || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(key)) {
    const p = key.slice(0, 10).split("-");
    return p[0] + "/" + p[1] + "/" + p[2];
  }
  const d = new Date(dateKeyOrIso);
  if (Number.isNaN(d.getTime())) return key;
  return formatDateJa(localDateKey(d));
}

/** 当日すでに同じ店舗があるときの登録区分 */
const ENTRY_NORMAL = "通常";
const ENTRY_KOGUCHI = "小口追加";
const ENTRY_SEPARATE = "別口";

/** 運送会社（標準表示・手動変更の両方で使用） */
const CARRIERS = ["ヤマト", "佐川", "西濃", "福山", "その他"];

/** 画面（メニュー）のID。index.html の data-screen と一致させる */
const SCREENS = {
  SHIP: "ship",
  STORES: "stores",
  HISTORY: "history",
  CSV_IMPORT: "csv-import",
  CSV_EXPORT: "csv-export",
  SETTINGS: "settings",
};

/** IndexedDB の名前とバージョン。項目を増やすときは VERSION を上げて db.js で upgrade する */
const DB_NAME = "shipping-app-db";
const DB_VERSION = 2;

/** オブジェクトストア（テーブル相当）の名前 */
const STORE_MASTER = "stores";
const STORE_HISTORY = "shipments";
const STORE_SETTINGS = "settings";

/** 設定のキー */
const SETTING_THEME = "theme"; // auto | light | dark
const SETTING_VIBRATE = "vibrate";
const SETTING_CONTINUOUS = "continuousScan";
