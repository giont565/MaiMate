/* 前端煙測（workflow.md 驗證紀律 #3）：mock API 驗證三件事
 *   1. 行情輪詢就地更新——DOM 節點不重建、不閃爍，且漲跌上色
 *   2. 抓取失敗保留上一次數值，不被「—」蓋掉
 *   3. 聊天氣泡：粗體/換行渲染、HTML escape（防 XSS）
 * 用法：npm run smoke（首次先 npm i && npx playwright install chromium）
 * 自帶靜態伺服器，不需要另外起 server；離線可跑（API 全被 mock）。 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };

const HEALTH = { chase_index: { buy_above_ma_pct: 65 }, opportunity_cost: { total_missed_twd: 26598877 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2 } };

let marketMode = "round1"; // round1 → round2（漲跌變動）→ fail（斷網）
const PRICES = { round1: { btctwd: "2091464.5", ethtwd: "60536.6", soltwd: "2469.5", dogetwd: "2.3509" },
  round2: { btctwd: "2100000.0", ethtwd: "60000.0", soltwd: "2469.5", dogetwd: "2.4000" } };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { // 雲端環境瀏覽器路徑備援（Claude Code remote 預裝）
    if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    else throw e;
  }
  const page = await browser.newPage();

  // index.html 可能寫死絕對 API_BASE，用路徑尾端比對同時涵蓋 /api/* 與絕對網址
  await page.route("**/health*", (r) => r.fulfill({ json: HEALTH }));
  await page.route("**/market*", (route) => {
    if (marketMode === "fail") return route.abort();
    const m = new URL(route.request().url()).searchParams.get("market");
    route.fulfill({ json: { kind: "ticker", market: m, data: { last: PRICES[marketMode][m] } } });
  });
  await page.route("**/chat", (r) => r.fulfill({ json: {
    reply: "**最痛的一筆**：2025-01-08 賣出 DOGE\n少賺 NT$312,924 <script>alert(1)</script>",
    messages: [] } }));

  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll("#market .v").length === 4
    && [...document.querySelectorAll("#market .v")].every((e) => e.textContent !== "—"));

  // 標記目前 DOM 節點 → 驗證刷新沒有砍掉重建
  await page.evaluate(() => document.querySelectorAll("#market .v").forEach((e) => e.setAttribute("data-marker", "keep")));
  console.log("round1 值：", (await page.$$eval("#market .v", (els) => els.map((e) => e.textContent))).join(" / "));

  marketMode = "round2";
  await page.evaluate(() => loadMarket());
  await page.waitForFunction(() => document.querySelector("#market .v").textContent === "2100000.0");
  const kept = await page.$$eval('#market .v[data-marker="keep"]', (els) => els.length);
  if (kept !== 4) throw new Error(`DOM 被重建了：marker 只剩 ${kept}/4`);
  console.log("round2 就地更新 OK（4/4 節點保留），class：",
    (await page.$$eval("#market .v", (els) => els.map((e) => e.className))).join(" / "));

  marketMode = "fail";
  await page.evaluate(() => loadMarket());
  await page.waitForTimeout(300);
  const r3 = await page.$$eval("#market .v", (els) => els.map((e) => e.textContent));
  if (r3.some((v) => v === "—")) throw new Error(`斷網後值被清成 —：${r3}`);
  console.log("斷網保留舊值 OK：", r3.join(" / "));

  await page.fill("#q", "去年我虧最多的是哪一筆");
  await page.click("button[type=submit]");
  await page.waitForSelector(".msg.ai");
  const bold = await page.$$eval(".msg.ai b", (els) => els.map((e) => e.textContent));
  const scripts = await page.$$eval(".msg.ai script", (els) => els.length);
  const html = await page.$eval(".msg.ai", (e) => e.innerHTML);
  if (!bold.includes("最痛的一筆")) throw new Error("粗體未渲染");
  if (scripts !== 0 || !html.includes("&lt;script&gt;")) throw new Error("HTML 未 escape");
  if (!html.includes("<br>")) throw new Error("換行未渲染");
  console.log("聊天氣泡 OK：粗體渲染、<script> 已 escape、換行成 <br>");

  await browser.close();
  server.close();
  console.log("全部通過 ✅");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
