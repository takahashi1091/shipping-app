/**
 * scanner.js
 * iPhone カメラでバーコードを読む（html5-qrcode を利用）。
 * 対応: Code128 / EAN / QR（ほか一般的な1次元も読める）。
 *
 * 注意: iPhone ではカメラ利用に HTTPS が必要です。
 * file:// や http:// の社内IPではカメラが動かないことがあります。
 */

const scanner = (() => {
  let html5QrCode = null;
  let running = false;

  function isSupported() {
    return typeof Html5Qrcode !== "undefined";
  }

  /**
   * 指定した DIV でカメラを開始する。
   * onDecoded(text) がバーコード文字列を受け取る。
   */
  async function start(elementId, onDecoded) {
    if (!isSupported()) {
      throw new Error("バーコードライブラリを読み込めませんでした");
    }
    if (running) await stop();

    html5QrCode = new Html5Qrcode(elementId, { verbose: false });

    const formats = [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
    ];

    const config = {
      fps: 8,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        // 画面幅いっぱいに近い読み取り枠（現場で合わせやすい）
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.floor(minEdge * 0.85);
        return { width: size, height: Math.floor(size * 0.45) };
      },
      aspectRatio: 1.777,
      formatsToSupport: formats,
    };

    // 背面カメラ優先
    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        onDecoded(String(decodedText).trim());
      },
      () => {
        // 読み取り中のエラーは無視（毎フレーム出るため）
      }
    );
    running = true;
  }

  async function stop() {
    if (!html5QrCode || !running) {
      running = false;
      return;
    }
    try {
      await html5QrCode.stop();
      await html5QrCode.clear();
    } catch (e) {
      console.warn("scanner stop:", e);
    }
    running = false;
    html5QrCode = null;
  }

  return { start, stop, isSupported };
})();
