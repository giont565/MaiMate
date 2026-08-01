/* market-core.js —— 行情模組的純函式層
 *
 * 規矩同 kline-core.js：不碰 DOM、不 fetch、不引用 mocks，可以在 node 下直接測。
 * K 線的解析與幾何全在 kline-core.js（那支已經是純的，這裡原封不動複用），
 * 這支只管兩件 kline-core 管不到的事：有哪些標的、即時價怎麼讀。
 */
(function () {
  "use strict";

  /* 與 app.js 的 MOCK.markets 同一組。要加幣種改這裡一處，兩頁一起生效。 */
  var MARKETS = [
    { market: "btctwd", label: "BTC/TWD" },
    { market: "ethtwd", label: "ETH/TWD" },
    { market: "soltwd", label: "SOL/TWD" },
    { market: "dogetwd", label: "DOGE/TWD" },
  ];

  /* /market?kind=ticker 回 { data: { last } }（見 app.js:214、host-app.html:336）。
     讀不到就 ok:false——呼叫端顯示「—」，絕不補一個看起來像價格的數字。 */
  function parseTicker(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, reason: "NO_PAYLOAD" };
    var data = payload.data && typeof payload.data === "object" ? payload.data : null;
    if (!data) return { ok: false, reason: "NO_DATA" };
    var price = Number(data.last);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "NO_PRICE" };
    return { ok: true, price: price };
  }

  /* 新舊價比較 → 漲/跌/持平。前一次沒有價（首次載入）一律回 "flat"，
     不要讓第一次渲染就閃一片綠——那是假的變化。 */
  function direction(prev, next) {
    var a = Number(prev);
    var b = Number(next);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return "flat";
    return b > a ? "up" : "down";
  }

  /* 模組 payload 的形狀。service 與 mock 共用這支產生，兩邊不會長歪。
     注意：payload 裡沒有價格。價格是活的、會變的，塞進 payload 就變成快照，
     而 payload 會被 sanitize 進 sessionStorage 快取——快取一個過期價格比不顯示更糟。
     取價與就地更新由 renderer 負責（開發紀律③）。 */
  function buildPayload(opts) {
    var o = opts || {};
    var list = Array.isArray(o.markets) && o.markets.length ? o.markets : MARKETS;
    return {
      title: o.title || "即時行情",
      markets: list.map(function (m) { return { market: String(m.market), label: String(m.label) }; }),
      defaultPeriod: Number.isFinite(Number(o.defaultPeriod)) ? Number(o.defaultPeriod) : 60,
      /* live=false 代表這一頁沒有 API_BASE／後端不可用，renderer 直接進誠實的空狀態，
         不要送出註定失敗的請求再閃一次錯誤。 */
      live: o.live !== false,
      note: o.note || "點一列展開 K 線",
    };
  }

  function validate(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (typeof payload.title !== "string" || !payload.title) return false;
    if (!Array.isArray(payload.markets) || payload.markets.length === 0) return false;
    for (var i = 0; i < payload.markets.length; i++) {
      var m = payload.markets[i];
      if (!m || typeof m.market !== "string" || !m.market) return false;
      if (typeof m.label !== "string" || !m.label) return false;
    }
    return Number.isFinite(Number(payload.defaultPeriod));
  }

  var api = {
    MARKETS: MARKETS,
    parseTicker: parseTicker,
    direction: direction,
    buildPayload: buildPayload,
    validate: validate,
  };
  if (typeof window !== "undefined") window.MM_MARKET_CORE = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
