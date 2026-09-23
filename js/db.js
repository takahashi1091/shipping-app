/**
 * db.js
 * IndexedDB への読み書きをまとめる。
 * サーバーは使わず、この端末（iPhone）の中だけに保存する。
 *
 * 使い方の例:
 *   const stores = await db.getAllStores();
 *   await db.putStore({ code: "1001", name: "東京店", ... });
 */

const db = (() => {
  let _db = null;

  /** DB を開く（初回はテーブル作成） */
  function open() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onerror = () => reject(req.error);

      // バージョンが上がったとき、または初回作成時
      req.onupgradeneeded = (event) => {
        const database = event.target.result;
        const tx = event.target.transaction;

        // 店舗マスタ: 店舗コードを主キーにする
        if (!database.objectStoreNames.contains(STORE_MASTER)) {
          const store = database.createObjectStore(STORE_MASTER, { keyPath: "code" });
          store.createIndex("name", "name", { unique: false });
        }

        // 出荷履歴: 連番 ID。日時で並べ替えしやすいよう index を付ける
        if (!database.objectStoreNames.contains(STORE_HISTORY)) {
          database.createObjectStore(STORE_HISTORY, {
            keyPath: "id",
            autoIncrement: true,
          });
        }

        const hist = tx.objectStore(STORE_HISTORY);
        if (!hist.indexNames.contains("datetime")) {
          hist.createIndex("datetime", "datetime", { unique: false });
        }
        if (!hist.indexNames.contains("storeCode")) {
          hist.createIndex("storeCode", "storeCode", { unique: false });
        }
        // v2: 日次の重複チェック・絞り込み用
        if (!hist.indexNames.contains("dateKey")) {
          hist.createIndex("dateKey", "dateKey", { unique: false });
        }
        if (!hist.indexNames.contains("carrier")) {
          hist.createIndex("carrier", "carrier", { unique: false });
        }
        if (!hist.indexNames.contains("size")) {
          hist.createIndex("size", "size", { unique: false });
        }

        // 設定: key / value
        if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
          database.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
        }
      };

      req.onsuccess = () => {
        _db = req.result;
        resolve(_db);
      };
    });
  }

  function tx(storeName, mode) {
    return open().then((database) => database.transaction(storeName, mode).objectStore(storeName));
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- 店舗マスタ ----

  async function getAllStores() {
    const store = await tx(STORE_MASTER, "readonly");
    const list = await requestToPromise(store.getAll());
    // 店舗コード順（文字として比較）
    list.sort((a, b) => String(a.code).localeCompare(String(b.code), "ja", { numeric: true }));
    return list;
  }

  function normalizeStore(row) {
    return {
      code: padStoreCode(row.code),
      name: String(row.name || "").trim(),
      defaultCarrier: String(row.defaultCarrier || "").trim(),
      specialCondition: String(row.specialCondition || "").trim(),
      postalCode: String(row.postalCode || "").trim(),
      address: String(row.address || "").trim(),
      note: String(row.note || "").trim(),
    };
  }

  async function getStore(code) {
    const key = String(code || "").trim();
    if (!key) return null;
    const padded = padStoreCode(key);
    const stripped = key.replace(/^0+/, "") || "0";
    const candidates = [];
    [key, padded, stripped].forEach((c) => {
      if (c && candidates.indexOf(c) === -1) candidates.push(c);
    });

    const database = await open();
    const store = database.transaction(STORE_MASTER, "readonly").objectStore(STORE_MASTER);
    for (const candidate of candidates) {
      const row = await requestToPromise(store.get(candidate));
      if (row) return row;
    }
    return null;
  }

  /** 追加または更新（同じ店舗コードなら上書き） */
  async function putStore(row) {
    const record = normalizeStore(row);
    if (!record.code) throw new Error("店舗コードは必須です");
    const store = await tx(STORE_MASTER, "readwrite");
    await requestToPromise(store.put(record));
    return record;
  }

  async function deleteStore(code) {
    const store = await tx(STORE_MASTER, "readwrite");
    await requestToPromise(store.delete(String(code)));
  }

  /** CSV 取込などでまとめて保存する */
  async function putStoresBulk(rows) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_MASTER, "readwrite");
      const store = transaction.objectStore(STORE_MASTER);
      for (const row of rows) {
        const record = normalizeStore(row);
        if (record.code) store.put(record);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /** 店舗マスタを空にする（全件入替インポート用） */
  async function clearStores() {
    const store = await tx(STORE_MASTER, "readwrite");
    await requestToPromise(store.clear());
  }

  // ---- 出荷履歴 ----

  function normalizeShipment(row) {
    const datetime = row.datetime || new Date().toISOString();
    return {
      datetime,
      dateKey: row.dateKey || localDateKey(datetime),
      storeCode: padStoreCode(row.storeCode) || String(row.storeCode || "").trim(),
      storeName: String(row.storeName || "").trim(),
      size: String(row.size || "").trim(),
      pieceCount: Math.max(1, parseInt(row.pieceCount, 10) || 1),
      carrier: String(row.carrier || "").trim(),
      note: String(row.note || "").trim(),
      entryType: String(row.entryType || ENTRY_NORMAL).trim() || ENTRY_NORMAL,
      trackingNumber: String(row.trackingNumber || "").trim(),
    };
  }

  async function addShipment(row) {
    const record = normalizeShipment(row);
    const store = await tx(STORE_HISTORY, "readwrite");
    const id = await requestToPromise(store.add(record));
    return { id, ...record };
  }

  async function getAllShipments() {
    const store = await tx(STORE_HISTORY, "readonly");
    const list = await requestToPromise(store.getAll());
    const normalized = list.map((row) => {
      const n = normalizeShipment(row);
      n.id = row.id;
      return n;
    });
    normalized.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
    return normalized;
  }

  /** 指定日・指定店舗の履歴（誤登録防止の重複確認用） */
  async function getShipmentsForStoreOnDate(storeCode, dateKey) {
    const list = await getAllShipments();
    const padded = padStoreCode(storeCode);
    const day = dateKey || localDateKey(new Date());
    return list.filter((h) => {
      const sameStore = h.storeCode === storeCode || h.storeCode === padded || padStoreCode(h.storeCode) === padded;
      return sameStore && h.dateKey === day;
    });
  }

  async function deleteShipment(id) {
    const store = await tx(STORE_HISTORY, "readwrite");
    await requestToPromise(store.delete(id));
  }

  async function clearShipments() {
    const store = await tx(STORE_HISTORY, "readwrite");
    await requestToPromise(store.clear());
  }

  // ---- 設定 ----

  async function getSetting(key, defaultValue) {
    const store = await tx(STORE_SETTINGS, "readonly");
    const row = await requestToPromise(store.get(key));
    if (!row) return defaultValue;
    return row.value;
  }

  async function setSetting(key, value) {
    const store = await tx(STORE_SETTINGS, "readwrite");
    await requestToPromise(store.put({ key, value }));
  }

  /** 開発・トラブル時用。店舗・履歴・設定をすべて消す */
  async function clearAll() {
    await clearStores();
    await clearShipments();
    const store = await tx(STORE_SETTINGS, "readwrite");
    await requestToPromise(store.clear());
  }

  return {
    open,
    getAllStores,
    getStore,
    putStore,
    deleteStore,
    putStoresBulk,
    clearStores,
    addShipment,
    getAllShipments,
    getShipmentsForStoreOnDate,
    deleteShipment,
    clearShipments,
    getSetting,
    setSetting,
    clearAll,
  };
})();
