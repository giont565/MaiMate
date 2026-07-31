/* sw.js — MaiMate PWA 的 service worker
 *
 * 目的有兩個：
 *   1. 加到主畫面後能 standalone 開啟（那需要 manifest；SW 是 Android 可安裝性的門檻）
 *   2. **決賽現場網路整條掛掉也能把 Demo 走完** —— 這是主要動機，呼應 issue #8 的離線備援
 *
 * 快取策略：同源一律 network-first，失敗才用快取。
 *
 * 為什麼不是 cache-first（雖然更快）：
 *   cache-first 會讓「部署了新版但使用者還是看到舊版」變成常態，而那正是
 *   scripts/verify_live_ui.js 花了一整節在抓的災情。快一點不值得換來一個
 *   會靜默給舊版的機制。network-first 只在**真的斷網**時吃快取，
 *   線上時永遠拿最新的。
 *
 * 跨來源（execute-api 的 /chat /market /order /audit）一律不碰：
 *   讓它照常失敗，由前端自己的離線 mock 邏輯接手並亮「離線展示」標示。
 *   在這裡快取 API 回應會讓畫面顯示過期的行情與帳戶，而且不會有任何提示。
 */
importScripts("sw-assets.js"); // 自動生成，見 scripts/build_sw_manifest.js

const CACHE = `maimate-${self.SW_VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 逐檔加入而非 addAll：addAll 只要一個檔 404 就整批失敗，
    // 於是「少一個圖檔」會變成「整個離線備援沒生效」，而且安靜無聲。
    const results = await Promise.allSettled(self.SW_ASSETS.map((a) => c.add(a)));
    const failed = results
      .map((r, i) => (r.status === "rejected" ? self.SW_ASSETS[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn("[sw] 這些檔沒快取到：", failed);
    await self.skipWaiting(); // 新版立刻接手，不等所有分頁關閉
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API 交給前端自己的離線邏輯

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true }); // ?demo=… 等參數不影響命中
      if (hit) return hit;
      // 導覽請求（點連結、開新頁）在完全沒快取時，至少回入口頁而不是瀏覽器錯誤畫面
      if (req.mode === "navigate") {
        const home = await caches.match("host-app.html");
        if (home) return home;
      }
      throw err;
    }
  })());
});
