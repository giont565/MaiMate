/* K 線純函式層（#18 kline 契約的前端消費者）
 *
 * 職責邊界（沿用 C 包分層）：
 *   - 這裡只做「資料 → 幾何座標」，不碰 DOM、不碰 fetch、不讀 mocks
 *   - 算不出來一律回 {ok:false, reason}，絕不回 NaN／Infinity，讓 UI 顯示「資料不足」
 *   - 後端已保證 data 由舊到新排序且時間欄位權威（backend/integrations/max_public.py
 *     的 _normalize_kline），所以這裡不重排、不自行換算 Unix timestamp
 *
 * 契約：GET /market?market=<m>&kind=kline&period=<分鐘>
 *   { kind, market, period_minutes, fetched_at_utc, fetched_at_taipei,
 *     data: [{ timestamp, time_utc, time_taipei, open, high, low, close, volume }] }
 */
(function () {
  "use strict";

  // 後端 period 單位為分鐘；這五個都對線上實測過（各回 48 根）
  var PERIODS = [
    { minutes: 1, label: "1分" },
    { minutes: 5, label: "5分" },
    { minutes: 15, label: "15分" },
    { minutes: 60, label: "1時" },
    { minutes: 1440, label: "1日" },
  ];

  var DEFAULT_PERIOD = 60;

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* 把 API 回應收斂成可畫的 bars。任何一根壞掉就整批不畫——寧可顯示資料不足，
     也不要畫出一根位置錯誤的 K 棒讓使用者誤讀行情。 */
  function parse(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, reason: "NO_PAYLOAD" };
    if (payload.kind !== "kline") return { ok: false, reason: "WRONG_KIND" };
    var rows = payload.data;
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: "NO_DATA" };
    var bars = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !isNum(r.open) || !isNum(r.high) || !isNum(r.low) || !isNum(r.close)) {
        return { ok: false, reason: "BAD_ROW" };
      }
      if (r.high < r.low) return { ok: false, reason: "BAD_ROW" };
      bars.push({
        t: r.time_taipei || r.time_utc || "",
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: isNum(r.volume) ? r.volume : null,
      });
    }
    return {
      ok: true,
      bars: bars,
      market: typeof payload.market === "string" ? payload.market : "",
      periodMinutes: isNum(payload.period_minutes) ? payload.period_minutes : null,
      fetchedAt: payload.fetched_at_taipei || "",
    };
  }

  /* 期間摘要：用第一根的 open 對最後一根的 close，這是這 48 根涵蓋期間的實際漲跌。 */
  function summarize(bars) {
    if (!Array.isArray(bars) || bars.length === 0) return null;
    var first = bars[0], last = bars[bars.length - 1];
    var hi = -Infinity, lo = Infinity;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].high > hi) hi = bars[i].high;
      if (bars[i].low < lo) lo = bars[i].low;
    }
    var changePct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null;
    return {
      open: first.open, close: last.close, high: hi, low: lo,
      changePct: changePct,
      up: changePct === null ? null : changePct >= 0,
      from: first.t, to: last.t, count: bars.length,
    };
  }

  /* bars → SVG 幾何。回傳純數字，畫圖的人只負責塞進 <rect>／<line>。 */
  function geometry(bars, width, height, opts) {
    if (!Array.isArray(bars) || bars.length === 0) return { ok: false, reason: "NO_DATA" };
    if (!isNum(width) || !isNum(height) || width <= 0 || height <= 0) {
      return { ok: false, reason: "BAD_VIEWPORT" };
    }
    var o = opts || {};
    var padTop = isNum(o.padTop) ? o.padTop : 6;
    var padBottom = isNum(o.padBottom) ? o.padBottom : 6;
    var plotH = height - padTop - padBottom;
    if (plotH <= 0) return { ok: false, reason: "BAD_VIEWPORT" };

    var hi = -Infinity, lo = Infinity;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].high > hi) hi = bars[i].high;
      if (bars[i].low < lo) lo = bars[i].low;
    }
    var range = hi - lo;
    // 整段完全沒波動（極少見，但 1 分線盤整時真的會發生）：畫一條置中的平線，
    // 不要讓 range=0 變成除以零。
    var flat = range === 0;
    function y(v) { return flat ? padTop + plotH / 2 : padTop + ((hi - v) / range) * plotH; }

    var step = width / bars.length;
    var bodyW = Math.max(1, step * 0.62);
    var candles = [];
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      var cx = step * j + step / 2;
      var yo = y(b.open), yc = y(b.close);
      var top = Math.min(yo, yc);
      var h = Math.abs(yc - yo);
      candles.push({
        x: cx - bodyW / 2,
        w: bodyW,
        y: top,
        h: Math.max(1, h),          // 十字星也要看得見
        cx: cx,
        wickTop: y(b.high),
        wickBottom: y(b.low),
        up: b.close >= b.open,
        bar: b,
      });
    }
    return { ok: true, candles: candles, hi: hi, lo: lo, flat: flat, step: step };
  }

  /* 價格顯示：與 app.js 的 fmt() 同語意（最多四位小數、不補零）。
     兩者必須一致——同一個價格在行情列與 K 線的高低標上顯示成兩種格式就是缺陷。
     TWD 標的跨了 2.3509（DOGE）到 2,091,464.5（BTC）六個數量級，
     maximumFractionDigits:4 同時涵蓋兩端，不會把 DOGE 截成 2.35。 */
  function fmtPrice(v) {
    if (!isNum(v)) return "—";
    return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  function fmtPct(v) {
    if (!isNum(v)) return "—";
    return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  /* 「2026-08-01T12:00:00+08:00」→「08-01 12:00」。後端已給權威台北時間，
     這裡只做字串裁切，不做時區換算（鐵則：禁止自行換算）。 */
  function fmtTime(iso) {
    if (typeof iso !== "string" || iso.length < 16) return "";
    return iso.slice(5, 10) + " " + iso.slice(11, 16);
  }

  function periodLabel(minutes) {
    for (var i = 0; i < PERIODS.length; i++) {
      if (PERIODS[i].minutes === minutes) return PERIODS[i].label;
    }
    return String(minutes) + "分";
  }

  var api = {
    PERIODS: PERIODS,
    DEFAULT_PERIOD: DEFAULT_PERIOD,
    parse: parse,
    summarize: summarize,
    geometry: geometry,
    fmtPrice: fmtPrice,
    fmtPct: fmtPct,
    fmtTime: fmtTime,
    periodLabel: periodLabel,
  };

  if (typeof window !== "undefined") window.MM_KLINE_CORE = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
