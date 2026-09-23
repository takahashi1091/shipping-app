/**
 * rules.js
 * 運送会社の決め方をまとめる場所。
 *
 * MVP:
 *   - 標準運送会社を返す
 *   - 特別条件があれば「必ず画面に出す」（自動切替はしない）
 *
 * 将来:
 *   - サイズによる運送会社の自動切替
 *   - 店舗ごとの特別配送ルール
 *
 * 出荷画面は lookupStore / サイズ選択のたびに suggestCarrier() を呼ぶ。
 * 自動切替を足すときは、このファイルだけ直せば画面側はほぼそのままで済む。
 */

const rules = (() => {
  /**
   * @param {object|null} store 店舗マスタ1件
   * @param {string} size 選択中サイズ（未選択なら空文字）
   * @returns {{
   *   carrier: string,
   *   specialText: string,
   *   hasSpecial: boolean,
   *   autoApplied: boolean,
   *   hint: string
   * }}
   */
  function suggestCarrier(store, size) {
    const empty = {
      carrier: CARRIERS[0],
      specialText: "",
      hasSpecial: false,
      autoApplied: false,
      hint: "",
    };
    if (!store) return empty;

    const specialText = String(store.specialCondition || "").trim();
    const hasSpecial = specialText.length > 0;

    // --- MVP: 標準運送会社を採用。size は将来の自動切替用に受け取る ---
    let carrier = String(store.defaultCarrier || "").trim() || CARRIERS[0];
    let autoApplied = false;

    // 将来ここに分岐を足す例（コメントのみ）:
    // if (size === "大型" && specialText.includes("西濃")) { carrier = "西濃"; autoApplied = true; }

    const hint = hasSpecial
      ? "特別条件があります。必要なら運送会社を手動で変更してください。"
      : "";

    return { carrier, specialText, hasSpecial, autoApplied, hint, size: size || "" };
  }

  return { suggestCarrier };
})();
