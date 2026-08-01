/* K 線煙測（frontend/kline-core.js ＋ index.html 行情列展開）
 *
 * 這功能最容易壞在四個地方，而且壞了畫面都還「看起來正常」：
 *   1. 幾何算錯 → K 棒位置顛倒（最高價畫在下面），行情被誤讀
 *   2. range=0（盤整不動）→ 除以零變 NaN，SVG 直接消失
 *   3. 抓不到資料時畫出假 K 線 → 違反「離線不假造價格」原則
 *   4. 週期鈕熱區 < 44px → 手機點不到
 * 所以除了功能斷言，另有反向誠實斷言與熱區斷言。
 *
 * 用法：npm run smoke:kline（自帶伺服器，離線可跑——API 全被 mock）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

const HEALTH = { chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
  opportunity_cost: { total_missed_twd: 26598877 },
  realized_pnl: { total_realized_twd: 117482, loss_trades: 493, profit_trades: 981 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12", top_currency: "twd" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 } };

/* 造 48 根：前 24 根一路漲、後 24 根一路跌，這樣「期間漲跌」與紅綠棒數都可預期。 */
function makeBars(n = 48, base = 60000) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const up = i < n / 2;
    const open = base + (up ? i : n - i) * 10;
    const close = open + (up ? 8 : -8);
    rows.push({
      timestamp: 1785387600 + i * 3600,
      time_utc: "2026-07-30T05:00:00Z",
      time_taipei: `2026-07-30T${String(13 + (i % 10)).padStart(2, "0")}:00:00+08:00`,
      open, high: Math.max(open, close) + 5, low: Math.min(open, close) - 5, close, volume: 1.5,
    });
  }
  return rows;
}

let klineMode = "ok"; // ok | fail

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const ok = (m) => console.log(m);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

  await page.route("**/health", (r) => r.fulfill({ json: HEALTH }));
  await page.route("**/market**", (r) => {
    const url = r.request().url();
    if (url.includes("kind=kline")) {
      if (klineMode === "fail") return r.abort();
      const period = Number(new URL(url).searchParams.get("period")) || 60;
      return r.fulfill({ json: { kind: "kline", market: "btctwd", period_minutes: period,
        fetched_at_taipei: "2026-08-01T12:34:56+08:00", data: makeBars() } });
    }
    return r.fulfill({ json: { kind: "ticker", data: { last: "2091464.5" } } });
  });
  await page.route("**/chat", (r) => r.fulfill({ json: { reply: "ok", messages: [], mode: "growth" } }));

  await page.goto(`${base}/index.html`);
  await page.waitForSelector("#market .mrow");

  // ── 1. 純函式層 ──
  const core = await page.evaluate(() => {
    const K = window.MM_KLINE_CORE;
    const bars = [
      { t: "a", open: 10, high: 12, low: 9, close: 11 },
      { t: "b", open: 11, high: 15, low: 10, close: 10 },
    ];
    const g = K.geometry(bars, 100, 50);
    const flat = K.geometry([{ t: "f", open: 5, high: 5, low: 5, close: 5 }], 100, 50);
    return {
      frozen: Object.isFrozen(K),
      badPayload: K.parse(null).ok,
      wrongKind: K.parse({ kind: "ticker", data: [] }).ok,
      emptyData: K.parse({ kind: "kline", data: [] }).ok,
      badRow: K.parse({ kind: "kline", data: [{ open: 1, high: 0, low: 5, close: 1 }] }).ok,
      highAboveLow: g.candles.every((c) => c.wickTop <= c.wickBottom),
      upFlag: [g.candles[0].up, g.candles[1].up],
      flatOk: flat.ok && flat.candles.every((c) => isFinite(c.y) && isFinite(c.h) && c.h >= 1),
      dojiVisible: K.geometry([{ t: "d", open: 7, high: 8, low: 6, close: 7 }], 100, 50).candles[0].h >= 1,
      pct: [K.fmtPct(1.234), K.fmtPct(-0.5)],
      price: [K.fmtPrice(2091464.5), K.fmtPrice(2.3509)],
      time: K.fmtTime("2026-08-01T12:00:00+08:00"),
    };
  });
  if (!core.frozen) throw new Error("MM_KLINE_CORE 應為 frozen");
  for (const [k, v] of Object.entries({ badPayload: core.badPayload, wrongKind: core.wrongKind,
    emptyData: core.emptyData, badRow: core.badRow })) {
    if (v !== false) throw new Error(`壞資料 ${k} 應回 ok:false`);
  }
  if (!core.highAboveLow) throw new Error("K 棒上下影線顛倒：最高價的 y 應小於最低價的 y");
  if (core.upFlag[0] !== true || core.upFlag[1] !== false) throw new Error("漲跌判定錯誤");
  if (!core.flatOk) throw new Error("range=0 時應仍可畫，且不得出現 NaN");
  if (!core.dojiVisible) throw new Error("十字星高度應至少 1px");
  if (core.pct[0] !== "+1.23%" || core.pct[1] !== "-0.50%") throw new Error("漲跌幅格式錯誤：" + core.pct);
  // 與 app.js 的 fmt() 同語意：最多四位小數、不補零。BTC 不截、DOGE 不被截成 2.35
  if (core.price[0] !== "2,091,464.5" || core.price[1] !== "2.3509") {
    throw new Error("價格格式與 app.js fmt() 不一致：" + core.price);
  }
  if (core.time !== "08-01 12:00") throw new Error("時間格式錯誤：" + core.time);
  ok("純函式 OK：壞資料四種皆擋、影線方向正確、range=0 不爆、十字星可見、量級格式正確");

  // ── 2. 展開與繪製 ──
  const rows = page.locator("#market .mrow");
  if (await rows.count() !== 4) throw new Error("行情應有四列");
  if (await rows.first().locator(".kl svg").count() !== 0) throw new Error("未展開時不應有圖");

  await rows.first().locator(".tick").click();
  await page.waitForSelector("#market .mrow.open .kl svg");
  const drew = await page.evaluate(() => {
    const svg = document.querySelector("#market .mrow.open .kl svg");
    return { rects: svg.querySelectorAll("rect").length, lines: svg.querySelectorAll("line").length,
             expanded: document.querySelector("#market .mrow.open .tick").getAttribute("aria-expanded"),
             hasNaN: svg.innerHTML.includes("NaN") };
  });
  if (drew.rects !== 48 || drew.lines !== 48) throw new Error(`應畫 48 根，實際 rect=${drew.rects} line=${drew.lines}`);
  if (drew.hasNaN) throw new Error("SVG 內出現 NaN");
  if (drew.expanded !== "true") throw new Error("展開後 aria-expanded 應為 true");
  ok(`展開 OK：48 根 K 棒（${drew.rects} 實體＋${drew.lines} 影線）、無 NaN、aria-expanded 正確`);

  // ── 3. 一次只開一列 ──
  await rows.nth(1).locator(".tick").click();
  await page.waitForFunction(() => document.querySelectorAll("#market .mrow.open").length === 1);
  const openIdx = await page.evaluate(() =>
    [...document.querySelectorAll("#market .mrow")].findIndex((r) => r.classList.contains("open")));
  if (openIdx !== 1) throw new Error("應改為第二列展開");
  ok("互斥展開 OK：開新的一列時前一列自動收起");

  // ── 4. 週期切換 ──
  const periodReq = [];
  page.on("request", (r) => { if (r.url().includes("kind=kline")) periodReq.push(r.url()); });
  await page.locator('#market .mrow.open .pd button[data-p="1440"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#market .mrow.open .pd button[aria-pressed='true']")?.textContent === "1日");
  if (!periodReq.some((u) => u.includes("period=1440"))) throw new Error("切 1日 應送 period=1440");
  ok("週期切換 OK：點「1日」送出 period=1440，按鈕 aria-pressed 跟著移動");

  // ── 5. 熱區 ≥44px ──
  const small = await page.evaluate(() => {
    const bad = [];
    for (const b of document.querySelectorAll("#market .mrow.open .pd button, #market .tick")) {
      const r = b.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) bad.push(`${b.textContent.trim().slice(0, 8)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return bad;
  });
  if (small.length) throw new Error("熱區小於 44px：" + small.join("、"));
  ok("觸控目標 OK：行情列與五個週期鈕熱區皆 ≥44px");

  // ── 6. 反向誠實斷言：抓不到就不准畫 ──
  klineMode = "fail";
  await page.locator('#market .mrow.open .pd button[data-p="5"]').click();
  // .na.ld 是載入中，錯誤態是不帶 .ld 的 .na——不分開等會等到載入中的字
  await page.waitForSelector("#market .mrow.open .kl .na:not(.ld)");
  const failState = await page.evaluate(() => ({
    text: document.querySelector("#market .mrow.open .kl .na:not(.ld)").textContent,
    svgs: document.querySelectorAll("#market .mrow.open .kl svg").length,
    offlineShown: getComputedStyle(document.getElementById("offline")).display !== "none",
  }));
  if (failState.svgs !== 0) throw new Error("抓取失敗時不得畫任何 K 線");
  if (!/取不到/.test(failState.text)) throw new Error("抓取失敗應明說：" + failState.text);
  if (!failState.offlineShown) throw new Error("抓取失敗應亮離線標示");
  ok(`離線誠實 OK：抓不到時零張圖、明說「${failState.text}」、離線標示亮起`);

  await browser.close();
  server.close();
  console.log("全部通過 ✅");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
