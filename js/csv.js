/**
 * csv.js
 * カンマ区切り CSV の読み書きと、出荷履歴の Excel（xlsx）出力。
 *
 * 店舗マスタの列:
 *   店舗コード,店舗名,標準運送会社,特別条件,郵便番号,住所,備考
 *
 * 出荷履歴の列:
 *   日付,店舗コード,店舗名,運送会社,個口数,サイズ区分,登録区分,備考,日時,送り状番号
 *
 * Excel で文字化けしないよう、CSV は UTF-8（BOM 付き）。
 * 店舗コードは文字列のまま出す（先頭 0 を消さない）。
 */

const csvUtil = (() => {
  const STORE_HEADERS = [
    "店舗コード",
    "店舗名",
    "標準運送会社",
    "特別条件",
    "郵便番号",
    "住所",
    "備考",
  ];

  const HISTORY_HEADERS = [
    "日付",
    "店舗コード",
    "店舗名",
    "運送会社",
    "個口数",
    "サイズ区分",
    "登録区分",
    "備考",
    "日時",
    "送り状番号",
  ];

  /** 1行をカンマ区切りに。カンマや改行を含むときは " で囲む */
  function escapeCell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function toCsv(headers, rows) {
    const lines = [headers.map(escapeCell).join(",")];
    for (const row of rows) {
      lines.push(row.map(escapeCell).join(","));
    }
    return lines.join("\r\n");
  }

  function storesToCsv(stores) {
    const rows = (stores || []).map((s) => [
      padStoreCode(s.code),
      s.name,
      s.defaultCarrier,
      s.specialCondition,
      s.postalCode,
      s.address,
      s.note,
    ]);
    return toCsv(STORE_HEADERS, rows);
  }

  function shipmentToRow(h) {
    const dateKey = h.dateKey || localDateKey(h.datetime);
    return [
      dateKey,
      padStoreCode(h.storeCode),
      h.storeName,
      h.carrier,
      h.pieceCount || 1,
      h.size,
      h.entryType || ENTRY_NORMAL,
      h.note,
      h.datetime,
      h.trackingNumber || "",
    ];
  }

  function shipmentsToCsv(list) {
    return toCsv(HISTORY_HEADERS, (list || []).map(shipmentToRow));
  }

  /**
   * CSV テキストを行・列に分解する（簡易パーサ）。
   * ダブルクォートで囲まれたカンマ／タブにも対応する。
   */
  function parseCsv(text, delimiter) {
    const sep = delimiter || ",";
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const src = String(text).replace(/^\uFEFF/, "");

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch === "\r") {
        // \r\n の \r は無視
      } else {
        cell += ch;
      }
    }
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  function guessDelimiter(text) {
    const first = String(text)
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((line) => line.trim());
    if (!first) return ",";
    const commas = (first.match(/,/g) || []).length;
    const tabs = (first.match(/\t/g) || []).length;
    return tabs > commas ? "\t" : ",";
  }

  /** 半角カナ・全角英数を揃え、列名の比較をしやすくする */
  function normalizeText(value) {
    return String(value == null ? "" : value)
      .replace(/^\uFEFF/, "")
      .trim()
      .normalize("NFKC");
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/\s+/g, "");
  }

  function headerIndex(headerRow, name) {
    const target = normalizeHeader(name);
    return headerRow.findIndex((h) => normalizeHeader(h) === target);
  }

  function headerIndexAny(headerRow, names) {
    for (const name of names) {
      const i = headerIndex(headerRow, name);
      if (i >= 0) return i;
    }
    return -1;
  }

  function col(row, idx) {
    if (idx < 0) return "";
    return normalizeText(row[idx]);
  }

  /** 運送会社名をアプリの選択肢に寄せる（ﾔﾏﾄ → ヤマト） */
  function matchCarrier(raw) {
    const n = normalizeText(raw);
    if (!n) return "";
    const hit = CARRIERS.find((c) => n === c || n.indexOf(c) !== -1);
    return hit || n;
  }

  function extractPostal(text) {
    const n = normalizeText(text).replace(/^〒/, "");
    const m = n.match(/(\d{3})-?(\d{4})/);
    return m ? m[1] + "-" + m[2] : n;
  }

  function joinParts(parts) {
    return parts
      .map((p) => normalizeText(p))
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Excel（日本語Windows）の CSV は Shift_JIS が多い。
   * file.text() は UTF-8 固定なので文字化けする。
   * FileReader.readAsText の文字コード指定で読み分ける。
   */
  function readAsText(blob, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob, encoding);
    });
  }

  function scoreDecoded(text) {
    if (!text) return -9999;
    const jp = (text.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
    const header = /店舗名|店舗コード|店舗CD|標準運送|特別条件/.test(text) ? 200 : 0;
    const bad = (text.match(/\uFFFD/g) || []).length;
    return jp + header - bad * 20;
  }

  function decodeWithTextDecoder(bytes) {
    const encodings = ["utf-8", "shift_jis", "shift-jis", "windows-31j", "euc-jp"];
    let best = "";
    let bestScore = -9999;
    encodings.forEach((enc) => {
      try {
        const text = new TextDecoder(enc, { fatal: false }).decode(bytes);
        const score = scoreDecoded(text);
        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      } catch (e) {
        // 未対応の文字コードはスキップ
      }
    });
    return { text: best, score: bestScore };
  }

  async function readCsvFile(file) {
    const encodings = ["UTF-8", "Shift_JIS", "Windows-31J", "csWindows31J", "SJIS", "MS932"];
    let best = "";
    let bestScore = -9999;

    for (const enc of encodings) {
      try {
        const text = await readAsText(file, enc);
        const score = scoreDecoded(text);
        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      } catch (e) {
        // その指定に未対応のブラウザはスキップ
      }
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const alt = decodeWithTextDecoder(bytes);
      if (alt.score > bestScore) {
        best = alt.text;
      }
    } catch (e) {
      // arrayBuffer が使えない場合は FileReader の結果を使う
    }

    return best;
  }

  /**
   * CSV → 店舗オブジェクト。
   * - 店舗コードは 6 桁へゼロ埋め
   * - 半角カナは NFKC で全角化（ｱｲﾅｰｽﾞ → アイナーズ）
   * - 社内Excel形式（店舗CD / 出荷方法 / 住所1〜3 / 備考1…）も読む
   */
  function csvToStores(text) {
    const rows = parseCsv(text, guessDelimiter(text));
    if (rows.length === 0) return [];

    const first = rows[0].map((c) => normalizeText(c));
    const looksLikeHeader =
      headerIndexAny(first, ["店舗コード", "店舗CD", "店舗Cd", "店コード"]) >= 0 ||
      headerIndex(first, "店舗名") >= 0;

    let dataRows = rows;
    let idx = {
      code: 0,
      name: 1,
      defaultCarrier: 2,
      specialCondition: 3,
      postalCode: -1,
      address: -1,
      address1: -1,
      address2: -1,
      address3: -1,
      note: 4,
      note1: -1,
      note2: -1,
      note3: -1,
      note4: -1,
      tel: -1,
      yamatoType: -1,
      method2: -1,
      method3: -1,
    };

    if (looksLikeHeader) {
      dataRows = rows.slice(1);
      idx.code = headerIndexAny(first, ["店舗コード", "店舗CD", "店舗Cd", "店コード"]);
      idx.name = headerIndexAny(first, ["店舗名", "店名"]);
      idx.defaultCarrier = headerIndexAny(first, ["標準運送会社", "出荷方法", "運送会社"]);
      idx.specialCondition = headerIndexAny(first, ["特別条件", "備考1"]);
      idx.postalCode = headerIndexAny(first, ["郵便番号", "〒"]);
      idx.address = headerIndexAny(first, ["住所", "所在地"]);
      idx.address1 = headerIndexAny(first, ["住所1", "住所１"]);
      idx.address2 = headerIndexAny(first, ["住所2", "住所２"]);
      idx.address3 = headerIndexAny(first, ["住所3", "住所３"]);
      idx.note = headerIndex(first, "備考");
      idx.note1 = headerIndex(first, "備考1");
      idx.note2 = headerIndex(first, "備考2");
      idx.note3 = headerIndex(first, "備考3");
      idx.note4 = headerIndex(first, "備考4");
      idx.tel = headerIndexAny(first, ["電話番号", "電話", "TEL"]);
      idx.yamatoType = headerIndexAny(first, ["ヤマト便種", "ﾔﾏﾄ便種"]);
      idx.method2 = headerIndex(first, "出荷方法2");
      idx.method3 = headerIndex(first, "出荷方法3");
      if (idx.code < 0) idx.code = 0;
      if (idx.name < 0) idx.name = 1;
      if (idx.defaultCarrier < 0) idx.defaultCarrier = 2;
    } else {
      idx.postalCode = 4;
      idx.address = 5;
      idx.note = 6;
    }

    const result = [];
    for (const r of dataRows) {
      const code = padStoreCode(col(r, idx.code).replace(/\.0$/, ""));
      if (!code) continue;

      const address = joinParts([
        col(r, idx.address),
        col(r, idx.address1),
        col(r, idx.address2),
        col(r, idx.address3),
      ]);

      let postalCode = col(r, idx.postalCode);
      const note3 = col(r, idx.note3);
      if (!postalCode && /〒|\d{3}-?\d{4}/.test(note3)) {
        postalCode = extractPostal(note3);
      } else if (postalCode) {
        postalCode = extractPostal(postalCode);
      }

      // 特別条件は「特別条件」列、なければ備考1
      let specialCondition = col(r, idx.specialCondition);
      if (!specialCondition && idx.specialCondition !== idx.note1) {
        specialCondition = col(r, idx.note1);
      }

      const extraNote = joinParts([
        col(r, idx.note),
        col(r, idx.tel) ? "TEL:" + col(r, idx.tel) : "",
        col(r, idx.yamatoType) ? "ヤマト便種:" + col(r, idx.yamatoType) : "",
        col(r, idx.method2) ? "出荷方法2:" + col(r, idx.method2) : "",
        col(r, idx.method3) ? "出荷方法3:" + col(r, idx.method3) : "",
        col(r, idx.note2),
        postalCode && note3 && extractPostal(note3) === postalCode ? "" : note3,
        col(r, idx.note4),
      ]);

      result.push({
        code,
        name: col(r, idx.name),
        defaultCarrier: matchCarrier(col(r, idx.defaultCarrier)),
        specialCondition,
        postalCode,
        address,
        note: extraNote,
      });
    }
    return result;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCsv(filename, csvText) {
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvText], { type: "text/csv;charset=utf-8" });
    downloadBlob(filename, blob);
  }

  /**
   * 出荷履歴を xlsx で出す。店舗コードは文字列にして先頭 0 を残す。
   * 将来、reports.js の集計結果を別シートに足せる。
   */
  function downloadHistoryXlsx(filename, list) {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel ライブラリを読み込めませんでした");
    }
    const header = HISTORY_HEADERS.slice();
    const aoa = [header].concat((list || []).map(shipmentToRow));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });

    // 店舗コード列（B）を文字列にする
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 1 });
      if (ws[addr]) {
        ws[addr].t = "s";
        ws[addr].v = String(ws[addr].v == null ? "" : ws[addr].v);
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "出荷履歴");
    // 将来: XLSX.utils.book_append_sheet(wb, 集計シート, "運送会社別");
    XLSX.writeFile(wb, filename);
  }

  return {
    STORE_HEADERS,
    HISTORY_HEADERS,
    storesToCsv,
    shipmentsToCsv,
    csvToStores,
    readCsvFile,
    downloadCsv,
    downloadHistoryXlsx,
    parseCsv,
  };
})();
