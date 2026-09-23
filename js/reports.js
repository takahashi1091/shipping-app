/**
 * reports.js
 * 出荷実績の集計。いまは履歴 Excel の土台と、後からの画面追加用。
 *
 * まだメニューには出さない機能:
 *   - 運送会社別集計  reports.byCarrier(list)
 *   - 日別件数        reports.byDay(list)
 *   - 月別件数        reports.byMonth(list)
 *   - 出荷実績分析    件数を組み合わせて画面を足す
 *   - 送り状番号      履歴レコードの trackingNumber（入力 UI は未実装）
 *   - 運送会社別 CSV  reports.layoutForCarrier(carrier, list) を後で拡張
 */

const reports = (() => {
  function dateKeyOf(row) {
    if (row && row.dateKey) return row.dateKey;
    if (row && row.datetime) return localDateKey(row.datetime);
    return "";
  }

  function groupCount(list, keyFn) {
    const map = {};
    (list || []).forEach((row) => {
      const key = keyFn(row) || "（未設定）";
      map[key] = (map[key] || 0) + 1;
    });
    return Object.keys(map)
      .sort()
      .map((key) => ({ key, count: map[key] }));
  }

  function byCarrier(list) {
    return groupCount(list, (row) => row.carrier);
  }

  function byDay(list) {
    return groupCount(list, dateKeyOf);
  }

  function byMonth(list) {
    return groupCount(list, (row) => dateKeyOf(row).slice(0, 7));
  }

  /**
   * 将来: 運送会社ごとの専用 CSV 列順を返す。
   * いまは共通列のまま。
   */
  function layoutForCarrier(carrier, list) {
    return {
      carrier: carrier || "",
      headers: ["日付", "店舗コード", "店舗名", "サイズ区分", "備考", "送り状番号"],
      rows: (list || []).filter((row) => !carrier || row.carrier === carrier),
    };
  }

  return { dateKeyOf, groupCount, byCarrier, byDay, byMonth, layoutForCarrier };
})();
