/**
 * sw.js … オフライン用の簡易キャッシュ。
 * ファイルを大きく変えたら CACHE の名前（v1 → v2）を変えると取り直す。
 */
const CACHE = "shipping-app-v6";

const PRECACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/constants.js",
  "./js/db.js",
  "./js/rules.js",
  "./js/reports.js",
  "./js/csv.js",
  "./js/scanner.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./sample-stores.csv",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          // CDN も含め、成功した GET をキャッシュ（2回目以降オフラインでも動きやすくする）
          if (res && res.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes("cdn.jsdelivr.net") || req.url.includes("unpkg.com"))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
