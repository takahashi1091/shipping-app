/**
 * app.js
 * 画面切り替えと各機能のつなぎ込み。
 * 新しい画面を足すときは:
 *   1. index.html に section を追加
 *   2. メニューの data-screen を追加
 *   3. 下の SCREENS と showScreen() を確認
 */

const app = (() => {
  let currentScreen = SCREENS.SHIP;
  let selectedSize = "";
  let selectedPieceCount = 1;
  let currentStore = null; // いま読み取った店舗
  let carrierTouched = false; // 利用者が運送会社を手で変えたか（自動上書きしない）
  let storeFilterText = "";
  let pendingShipment = null; // 重複確認ダイアログ待ち
  let lastHistoryRows = [];

  // ---------- ユーティリティ ----------

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, type) {
    const el = $("toast");
    el.className = "toast align-items-center text-bg-" + (type || "success") + " border-0";
    $("toast-body").textContent = message;
    bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "/" +
      p(d.getMonth() + 1) +
      "/" +
      p(d.getDate()) +
      " " +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes())
    );
  }

  async function maybeVibrate() {
    const on = await db.getSetting(SETTING_VIBRATE, true);
    if (on && navigator.vibrate) navigator.vibrate(40);
  }

  // ---------- テーマ ----------

  async function applyTheme() {
    const theme = await db.getSetting(SETTING_THEME, "auto");
    let resolved = theme;
    if (theme === "auto") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-bs-theme", resolved);
    const select = $("setting-theme");
    if (select) select.value = theme;
  }

  // ---------- 画面切り替え ----------

  function closeMenu() {
    const collapse = document.getElementById("appMenu");
    if (collapse && collapse.classList.contains("show")) {
      bootstrap.Collapse.getOrCreateInstance(collapse).hide();
    }
  }

  async function showScreen(name) {
    currentScreen = name;
    document.querySelectorAll(".screen").forEach((sec) => {
      sec.classList.toggle("d-none", sec.dataset.screen !== name);
    });
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === name);
    });
    closeMenu();

    // 出荷画面以外ではカメラを止める（バッテリーと誤読防止）
    if (name !== SCREENS.SHIP) {
      await scanner.stop();
      $("scan-panel").classList.add("d-none");
    }

    if (name === SCREENS.STORES) await renderStores();
    if (name === SCREENS.HISTORY) await renderHistory();
    if (name === SCREENS.SETTINGS) await renderSettings();
  }

  // ---------- 出荷処理 ----------

  function renderPieceButtons() {
    const wrap = $("piece-buttons");
    wrap.innerHTML = "";
    PIECE_COUNTS.forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline-primary piece-btn";
      btn.textContent = String(n);
      if (n === selectedPieceCount) btn.classList.add("active");
      btn.addEventListener("click", () => {
        selectedPieceCount = n;
        wrap.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
      wrap.appendChild(btn);
    });
  }

  function renderSizeButtons() {
    const wrap = $("size-buttons");
    wrap.innerHTML = "";
    SIZES.forEach((size) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline-primary btn-lg size-btn";
      btn.textContent = size;
      btn.addEventListener("click", () => {
        selectedSize = size;
        wrap.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        // サイズ変更時にルールへ渡す（MVP では標準運送会社のまま。将来ここが自動切替になる）
        applyCarrierSuggestion();
      });
      wrap.appendChild(btn);
    });
  }

  function fillCarrierSelect(selected) {
    const sel = $("carrier-select");
    sel.innerHTML = "";
    CARRIERS.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    if (selected && !CARRIERS.includes(selected)) {
      const opt = document.createElement("option");
      opt.value = selected;
      opt.textContent = selected + "（マスタ）";
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function resetShipForm(keepScanHint) {
    currentStore = null;
    selectedSize = "";
    selectedPieceCount = 1;
    carrierTouched = false;
    $("store-code").value = "";
    $("store-name").textContent = "—";
    $("default-carrier").textContent = "—";
    $("special-condition").textContent = "なし";
    $("special-hint").textContent = "";
    $("special-box").classList.add("d-none");
    $("ship-note").value = "";
    $("store-not-found").classList.add("d-none");
    fillCarrierSelect(CARRIERS[0]);
    renderPieceButtons();
    renderSizeButtons();
    if (!keepScanHint) $("scan-status").textContent = "未読取";
  }

  /** 特別条件の表示と、運送会社の初期値（手動変更後は上書きしない） */
  function applyCarrierSuggestion() {
    const result = rules.suggestCarrier(currentStore, selectedSize);
    if (result.hasSpecial) {
      $("special-condition").textContent = result.specialText;
      $("special-hint").textContent = result.hint;
      $("special-box").classList.remove("d-none");
    } else {
      $("special-condition").textContent = "なし";
      $("special-hint").textContent = "";
      $("special-box").classList.add("d-none");
    }
    if (!carrierTouched) {
      fillCarrierSelect(result.carrier);
    }
  }

  async function lookupStore(code) {
    const raw = String(code || "").trim();
    const trimmed = padStoreCode(raw) || raw;
    $("store-code").value = trimmed;
    if (!trimmed) {
      currentStore = null;
      $("store-name").textContent = "—";
      $("default-carrier").textContent = "—";
      $("special-hint").textContent = "";
      $("special-box").classList.add("d-none");
      return;
    }

    const store = await db.getStore(trimmed);
    currentStore = store;
    $("store-not-found").classList.toggle("d-none", !!store);

    if (!store) {
      $("store-name").textContent = "見つかりません";
      $("default-carrier").textContent = "—";
      $("special-condition").textContent = "なし";
      $("special-hint").textContent = "";
      $("special-box").classList.add("d-none");
      fillCarrierSelect(CARRIERS[0]);
      return;
    }

    $("store-name").textContent = store.name || "（名称なし）";
    $("default-carrier").textContent = store.defaultCarrier || "（未設定）";
    $("store-code").value = store.code;
    carrierTouched = false;
    applyCarrierSuggestion();
  }

  async function onBarcode(text) {
    $("scan-status").textContent = "読取: " + text;
    await maybeVibrate();
    await lookupStore(text);
    await scanner.stop();
    $("scan-panel").classList.add("d-none");
  }

  async function toggleScan() {
    const panel = $("scan-panel");
    const opening = panel.classList.contains("d-none");
    if (!opening) {
      await scanner.stop();
      panel.classList.add("d-none");
      return;
    }
    if (!window.isSecureContext) {
      showToast("カメラは HTTPS（または localhost）でのみ使えます。手入力もできます。", "warning");
    }
    panel.classList.remove("d-none");
    try {
      await scanner.start("reader", onBarcode);
    } catch (e) {
      console.error(e);
      showToast("カメラを開始できません。Safari のカメラ許可を確認してください。", "danger");
      panel.classList.add("d-none");
    }
  }

  function buildShipmentPayload(entryType, sizeOverride) {
    return {
      datetime: new Date().toISOString(),
      storeCode: currentStore.code,
      storeName: currentStore.name,
      size: sizeOverride || selectedSize,
      pieceCount: selectedPieceCount,
      carrier: $("carrier-select").value,
      note: $("ship-note").value.trim(),
      entryType: entryType || ENTRY_NORMAL,
      trackingNumber: "",
    };
  }

  async function finishRegister(payload) {
    await db.addShipment(payload);
    pendingShipment = null;
    await maybeVibrate();
    showToast("出荷を登録しました");

    const continuous = await db.getSetting(SETTING_CONTINUOUS, false);
    resetShipForm(true);
    $("scan-status").textContent = continuous ? "続けて読み取ってください" : "登録完了。次の荷物へ";

    if (continuous) {
      if ($("scan-panel").classList.contains("d-none")) {
        await toggleScan();
      }
    }
  }

  async function registerShipment() {
    const code = $("store-code").value.trim();
    if (!code) {
      showToast("店舗バーコードを読むか、店舗コードを入力してください。", "warning");
      return;
    }
    if (!currentStore) {
      showToast("店舗マスタにないコードです。先に店舗を登録してください。", "warning");
      return;
    }
    if (!selectedPieceCount || selectedPieceCount < 1) {
      showToast("個口数を選択してください。", "warning");
      return;
    }
    if (!selectedSize) {
      showToast("サイズを選択してください。", "warning");
      return;
    }
    const carrier = $("carrier-select").value;
    if (!carrier) {
      showToast("運送会社を選択してください。", "warning");
      return;
    }

    const today = localDateKey(new Date());
    const existing = await db.getShipmentsForStoreOnDate(currentStore.code, today);
    if (existing.length > 0) {
      pendingShipment = buildShipmentPayload(ENTRY_NORMAL);
      $("dup-store-name").textContent = currentStore.name || currentStore.code;
      $("dup-carrier").textContent = existing[0].carrier || carrier;
      bootstrap.Modal.getOrCreateInstance($("dup-modal")).show();
      return;
    }

    await finishRegister(buildShipmentPayload(ENTRY_NORMAL));
  }

  async function confirmDuplicate(kind) {
    if (!pendingShipment) return;
    const payload = pendingShipment;
    if (kind === ENTRY_KOGUCHI) {
      payload.entryType = ENTRY_KOGUCHI;
      payload.size = "小口";
    } else {
      payload.entryType = ENTRY_SEPARATE;
    }
    bootstrap.Modal.getOrCreateInstance($("dup-modal")).hide();
    await finishRegister(payload);
  }

  // ---------- 店舗マスタ ----------

  async function renderStores() {
    const list = await db.getAllStores();
    $("store-count").textContent = String(list.length);
    const q = storeFilterText.trim();
    const filtered = q
      ? list.filter((s) => (s.code + " " + s.name).indexOf(q) !== -1)
      : list;
    const tbody = $("store-table-body");
    tbody.innerHTML = "";
    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="3" class="text-secondary py-4 text-center">店舗がありません。CSV 取込か「追加」から登録してください。</td></tr>';
      return;
    }
    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="3" class="text-secondary py-4 text-center">該当する店舗がありません。</td></tr>';
      return;
    }
    filtered.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td><strong>" +
        escapeHtml(s.code) +
        "</strong><div class='small text-secondary'>" +
        escapeHtml(s.name) +
        (s.postalCode || s.address
          ? "<div class='small text-secondary'>" +
            escapeHtml([s.postalCode, s.address].filter(Boolean).join(" ")) +
            "</div>"
          : "") +
        "</div></td>" +
        "<td>" +
        escapeHtml(s.defaultCarrier || "—") +
        (s.specialCondition
          ? "<div class='small text-warning'>" + escapeHtml(s.specialCondition) + "</div>"
          : "") +
        "</td>";
      const td = document.createElement("td");
      td.className = "text-end";
      const wrap = document.createElement("div");
      wrap.className = "row-actions";
      const edit = document.createElement("button");
      edit.className = "btn btn-outline-primary";
      edit.textContent = "編集";
      edit.addEventListener("click", () => openStoreEditor(s));
      const del = document.createElement("button");
      del.className = "btn btn-outline-danger";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        if (!confirm("店舗 " + s.code + " を削除しますか？")) return;
        await db.deleteStore(s.code);
        await renderStores();
        showToast("削除しました");
      });
      wrap.appendChild(edit);
      wrap.appendChild(del);
      td.appendChild(wrap);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openStoreEditor(store) {
    $("store-edit-title").textContent = store ? "店舗を編集" : "店舗を追加";
    $("edit-code").value = store ? store.code : "";
    $("edit-code").disabled = !!store; // コード変更は削除→再追加とする（主キーのため）
    $("edit-name").value = store ? store.name : "";
    fillEditCarrier(store ? store.defaultCarrier : CARRIERS[0]);
    $("edit-special").value = store ? store.specialCondition : "";
    $("edit-postal").value = store ? store.postalCode || "" : "";
    $("edit-address").value = store ? store.address || "" : "";
    $("edit-note").value = store ? store.note : "";
    bootstrap.Modal.getOrCreateInstance($("store-modal")).show();
  }

  function fillEditCarrier(selected) {
    const sel = $("edit-carrier");
    sel.innerHTML = "";
    CARRIERS.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    if (selected && !CARRIERS.includes(selected)) {
      const opt = document.createElement("option");
      opt.value = selected;
      opt.textContent = selected;
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  async function saveStoreFromForm() {
    const code = $("edit-code").value.trim();
    if (!code) {
      showToast("店舗コードを入力してください。", "warning");
      return;
    }
    await db.putStore({
      code,
      name: $("edit-name").value.trim(),
      defaultCarrier: $("edit-carrier").value,
      specialCondition: $("edit-special").value.trim(),
      postalCode: $("edit-postal").value.trim(),
      address: $("edit-address").value.trim(),
      note: $("edit-note").value.trim(),
    });
    bootstrap.Modal.getOrCreateInstance($("store-modal")).hide();
    await renderStores();
    showToast("店舗を保存しました");
  }

  // ---------- 履歴 ----------

  function fillSelectWithAll(selectId, items) {
    const sel = $(selectId);
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "すべて";
    sel.appendChild(all);
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item;
      opt.textContent = item;
      sel.appendChild(opt);
    });
  }

  function historyMatches(h) {
    const date = $("hist-date").value;
    if (date && h.dateKey !== date) return false;

    const codeQ = $("hist-code").value.trim();
    if (codeQ) {
      const padded = padStoreCode(codeQ);
      const hay = String(h.storeCode || "");
      if (hay.indexOf(codeQ) === -1 && hay.indexOf(padded) === -1 && padStoreCode(hay).indexOf(padded) === -1) {
        return false;
      }
    }

    const nameQ = $("hist-name").value.trim();
    if (nameQ && String(h.storeName || "").indexOf(nameQ) === -1) return false;

    const carrier = $("hist-carrier").value;
    if (carrier && h.carrier !== carrier) return false;

    const size = $("hist-size").value;
    if (size && h.size !== size) return false;

    return true;
  }

  async function renderHistory() {
    const all = await db.getAllShipments();
    const list = all.filter(historyMatches);
    lastHistoryRows = list;
    $("history-count").textContent = String(list.length);
    const tbody = $("history-table-body");
    tbody.innerHTML = "";
    if (all.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-secondary py-4 text-center">まだ出荷履歴がありません。</td></tr>';
      return;
    }
    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-secondary py-4 text-center">条件に合う履歴がありません。</td></tr>';
      return;
    }
    list.forEach((h) => {
      const tr = document.createElement("tr");
      const extra = h.entryType && h.entryType !== ENTRY_NORMAL ? " / " + h.entryType : "";
      tr.innerHTML =
        "<td>" +
        escapeHtml(formatDateJa(h.dateKey || h.datetime)) +
        "</td>" +
        "<td class='store-cell'><div>" +
        escapeHtml(h.storeCode) +
        "</div><div class='small'>" +
        escapeHtml(h.storeName) +
        "</div></td>" +
        "<td>" +
        escapeHtml(h.carrier) +
        "</td>" +
        "<td>" +
        escapeHtml(String(h.pieceCount || 1)) +
        "</td>" +
        "<td>" +
        escapeHtml(h.size) +
        (extra ? "<div class='small text-secondary'>" + escapeHtml(h.entryType) + "</div>" : "") +
        "</td>";
      const td = document.createElement("td");
      td.className = "text-end align-middle";
      const del = document.createElement("button");
      del.className = "btn btn-outline-danger";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        if (!confirm("この履歴を削除しますか？")) return;
        await db.deleteShipment(h.id);
        await renderHistory();
      });
      td.appendChild(del);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
  }

  async function exportHistoryCsv() {
    if (lastHistoryRows.length === 0) {
      showToast("書き出す履歴がありません。", "warning");
      return;
    }
    const csv = csvUtil.shipmentsToCsv(lastHistoryRows);
    csvUtil.downloadCsv("出荷履歴_" + localDateKey(new Date()) + ".csv", csv);
    showToast("履歴 CSV を書き出しました");
  }

  async function exportHistoryXlsx() {
    if (lastHistoryRows.length === 0) {
      showToast("書き出す履歴がありません。", "warning");
      return;
    }
    try {
      csvUtil.downloadHistoryXlsx("出荷履歴_" + localDateKey(new Date()) + ".xlsx", lastHistoryRows);
      showToast("履歴 Excel を書き出しました");
    } catch (e) {
      console.error(e);
      showToast("Excel を書き出せませんでした。CSV をご利用ください。", "danger");
    }
  }

  // ---------- CSV ----------

  async function onImportFile(file) {
    const text = await csvUtil.readCsvFile(file);
    const stores = csvUtil.csvToStores(text);
    if (stores.length === 0) {
      showToast("有効な店舗行がありません。ヘッダと列を確認してください。", "warning");
      return;
    }
    const replace = $("import-replace").checked;
    if (replace) {
      if (!confirm(stores.length + " 件で店舗マスタを入れ替えます。既存店舗は消えます。よろしいですか？")) {
        return;
      }
      await db.clearStores();
    }
    await db.putStoresBulk(stores);
    const sample = stores
      .slice(0, 3)
      .map((s) => s.code + " " + s.name)
      .join(" / ");
    $("import-result").textContent =
      (replace ? "入れ替え完了: " : "取り込み完了: ") +
      stores.length +
      " 件" +
      (sample ? "　例）" + sample : "");
    showToast("CSV を取り込みました（" + stores.length + " 件）");
  }

  async function exportCsv() {
    const stores = await db.getAllStores();
    if (stores.length === 0) {
      showToast("書き出す店舗がありません。", "warning");
      return;
    }
    const csv = csvUtil.storesToCsv(stores);
    const day = new Date().toISOString().slice(0, 10);
    csvUtil.downloadCsv("店舗マスタ_" + day + ".csv", csv);
    showToast("CSV を書き出しました");
  }

  // ---------- 設定 ----------

  async function renderSettings() {
    $("setting-theme").value = await db.getSetting(SETTING_THEME, "auto");
    $("setting-vibrate").checked = await db.getSetting(SETTING_VIBRATE, true);
    $("setting-continuous").checked = await db.getSetting(SETTING_CONTINUOUS, false);
    const stores = await db.getAllStores();
    const hist = await db.getAllShipments();
    $("setting-counts").textContent = "店舗 " + stores.length + " 件 / 履歴 " + hist.length + " 件";
  }

  // ---------- 起動 ----------

  async function init() {
    await db.open();
    await applyTheme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    renderPieceButtons();
    renderSizeButtons();
    fillCarrierSelect(CARRIERS[0]);
    fillSelectWithAll("hist-carrier", CARRIERS);
    fillSelectWithAll("hist-size", SIZES);
    resetShipForm();

    // メニュー
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        showScreen(el.dataset.nav);
      });
    });

    $("btn-scan").addEventListener("click", toggleScan);
    $("btn-scan-close").addEventListener("click", async () => {
      await scanner.stop();
      $("scan-panel").classList.add("d-none");
    });
    $("btn-lookup").addEventListener("click", () => lookupStore($("store-code").value));
    $("store-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") lookupStore($("store-code").value);
    });
    $("carrier-select").addEventListener("change", () => {
      carrierTouched = true;
    });
    $("btn-register").addEventListener("click", registerShipment);
    $("btn-reset-ship").addEventListener("click", () => resetShipForm());
    $("btn-dup-koguchi").addEventListener("click", () => confirmDuplicate(ENTRY_KOGUCHI));
    $("btn-dup-separate").addEventListener("click", () => confirmDuplicate(ENTRY_SEPARATE));
    $("dup-modal").addEventListener("hidden.bs.modal", () => {
      pendingShipment = null;
    });
    $("store-filter").addEventListener("input", (e) => {
      storeFilterText = e.target.value;
      renderStores();
    });

    $("btn-store-add").addEventListener("click", () => openStoreEditor(null));
    $("btn-store-save").addEventListener("click", saveStoreFromForm);

    $("csv-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) await onImportFile(file);
      e.target.value = "";
    });
    $("btn-export").addEventListener("click", exportCsv);
    ["hist-date", "hist-code", "hist-name", "hist-carrier", "hist-size"].forEach((id) => {
      $(id).addEventListener("input", () => renderHistory());
      $(id).addEventListener("change", () => renderHistory());
    });
    $("btn-hist-clear").addEventListener("click", () => {
      $("hist-date").value = "";
      $("hist-code").value = "";
      $("hist-name").value = "";
      $("hist-carrier").value = "";
      $("hist-size").value = "";
      renderHistory();
    });
    $("btn-hist-csv").addEventListener("click", exportHistoryCsv);
    $("btn-hist-xlsx").addEventListener("click", exportHistoryXlsx);

    $("setting-theme").addEventListener("change", async (e) => {
      await db.setSetting(SETTING_THEME, e.target.value);
      await applyTheme();
    });
    $("setting-vibrate").addEventListener("change", async (e) => {
      await db.setSetting(SETTING_VIBRATE, e.target.checked);
    });
    $("setting-continuous").addEventListener("change", async (e) => {
      await db.setSetting(SETTING_CONTINUOUS, e.target.checked);
    });
    $("btn-clear-history").addEventListener("click", async () => {
      if (!confirm("出荷履歴をすべて削除しますか？")) return;
      await db.clearShipments();
      await renderSettings();
      showToast("履歴を削除しました");
    });
    $("btn-clear-all").addEventListener("click", async () => {
      if (!confirm("店舗・履歴・設定をすべて削除します。この操作は取り消せません。")) return;
      await db.clearAll();
      await applyTheme();
      await renderSettings();
      resetShipForm();
      showToast("すべてのデータを削除しました", "warning");
    });

    // PWA: サービスワーカー（オフライン用）
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (e) {
        console.warn("SW register failed", e);
      }
    }

    showScreen(SCREENS.SHIP);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
      console.error(err);
      alert("起動エラー: " + err.message);
    });
  });

  return { showScreen };
})();
