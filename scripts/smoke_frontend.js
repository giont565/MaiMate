/* 前端煙測（workflow.md 驗證紀律 #3）：mock API 驗證
 *   1. 行情輪詢就地更新——DOM 節點不重建、不閃爍，漲跌上色，金額千分位
 *   2. 抓取失敗保留上一次數值，不被「—」蓋掉
 *   3. 聊天氣泡：粗體/換行渲染、HTML escape（防 XSS）
 *   4. 設計稿元件：健檢 2×2 卡、insight、工具鏈 chips、三方案卡、確認卡（皆含千分位金額）
 * 用法：npm run smoke（首次先 npm i && npx playwright install chromium）
 * 自帶靜態伺服器，不需要另外起 server；離線可跑（API 全被 mock）。 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png" };

const HEALTH = { chase_index: { buy_above_ma_pct: 65, buy_total: 2350 },
  opportunity_cost: { total_missed_twd: 26598877 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 } };

let marketMode = "round1"; // round1 → round2（漲跌變動）→ fail（斷網）
const PRICES = { round1: { btctwd: "2091464.5", ethtwd: "60536.6", soltwd: "2469.5", dogetwd: "2.3509" },
  round2: { btctwd: "2100000.0", ethtwd: "60000.0", soltwd: "2469.5", dogetwd: "2.4000" } };

const CHAT = {
  reply: "**最大單筆真實虧損**：2025-03-12 賣出 ETH 實虧 NT$8,412\n（機會成本「少賺」另計：1/8 DOGE 少賺 NT$312,924）<script>alert(1)</script>",
  messages: [],
  tool_trail: [{ seq: 1, tool: "query_user_history", summary: "查交易史（all）" }, { seq: 2, tool: "get_market_data", summary: "查行情（ethtwd）" }],
  scenarios: [
    { key: "partial", label: "先賣 25%，留 75% 觀察", amount_twd: 35920, fee_twd: 57, post_concentration_pct: 44, behavior_note: "1/8 類似情境你全賣後少賺 NT$312,924" },
    { key: "full", label: "照原計畫全部賣出", amount_twd: 143680, fee_twd: 230, post_concentration_pct: 0 },
    { key: "pause", label: "先不動，設價格提醒", behavior_note: "不產生訂單" },
  ],
  confirm: { confirm_token: "tok-1", confirmation_card: { market: "ethtwd", side: "sell", volume_twd: 35920, ord_type: "market", price: null } },
};

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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // 手機優先（mockup 尺寸）

  // index.html 可能寫死絕對 API_BASE，用路徑尾端比對同時涵蓋 /api/* 與絕對網址
  await page.route("**/health*", (r) => r.fulfill({ json: HEALTH }));
  await page.route("**/market*", (route) => {
    if (marketMode === "fail") return route.abort();
    const m = new URL(route.request().url()).searchParams.get("market");
    route.fulfill({ json: { kind: "ticker", market: m, data: { last: PRICES[marketMode][m] } } });
  });
  await page.route("**/chat", (r) => r.fulfill({ json: CHAT }));

  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll("#market .v").length === 4
    && [...document.querySelectorAll("#market .v")].every((e) => e.textContent !== "—"));

  // 健檢卡＋insight（含千分位）
  const cards = await page.$$eval("#health .card", (els) => els.map((e) => e.textContent));
  if (cards.length !== 4 || !cards[1].includes("2,660萬")) throw new Error(`健檢卡異常：${cards}`);
  const insights = await page.$$eval("#insights .insight", (els) => els.map((e) => e.textContent));
  if (insights.length !== 2 || !insights[0].includes("2,350")) throw new Error(`insight 異常：${insights}`);
  console.log("健檢 2×2 卡＋insight OK（千分位）");

  // 行情就地更新（千分位顯示、原始值存 dataset）
  const r1 = await page.$$eval("#market .v", (els) => els.map((e) => e.textContent));
  if (r1.join("/") !== "2,091,464.5/60,536.6/2,469.5/2.3509") throw new Error(`round1 格式異常：${r1}`);
  console.log("round1 值：", r1.join(" / "));
  await page.evaluate(() => document.querySelectorAll("#market .v").forEach((e) => e.setAttribute("data-marker", "keep")));

  marketMode = "round2";
  await page.evaluate(() => loadMarket());
  await page.waitForFunction(() => document.querySelector("#market .v").textContent === "2,100,000");
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

  // 對話：chips → 氣泡（粗體/escape/換行）→ 三方案卡 → 確認卡
  await page.fill("#q", "去年我虧最多的是哪一筆");
  await page.click(".inputbar button");
  await page.waitForSelector(".confirm");
  const chips = await page.$$eval(".tools .tool", (els) => els.map((e) => e.textContent));
  if (chips.length !== 2 || !chips[0].includes("查交易史")) throw new Error(`chips 異常：${chips}`);
  const bold = await page.$$eval(".msg.ai b", (els) => els.map((e) => e.textContent));
  const scripts = await page.$$eval(".msg.ai script", (els) => els.length);
  const html = await page.$eval(".msg.ai", (e) => e.innerHTML);
  if (!bold.includes("最大單筆真實虧損")) throw new Error("粗體未渲染");
  if (scripts !== 0 || !html.includes("&lt;script&gt;")) throw new Error("HTML 未 escape");
  if (!html.includes("<br>")) throw new Error("換行未渲染");
  const scens = await page.$$eval(".scen", (els) => els.map((e) => e.textContent));
  if (scens.length !== 3 || !scens[0].includes("NT$35,920") || !scens[1].includes("NT$143,680")) throw new Error(`三方案卡異常：${scens}`);
  const pick = await page.$$eval(".scen.pick", (els) => els.length);
  if (pick !== 1) throw new Error("pick 高亮異常");
  const confirmTxt = await page.$eval(".confirm", (e) => e.textContent);
  if (!confirmTxt.includes("NT$35,920") || !confirmTxt.includes("確認賣出")) throw new Error("確認卡異常");
  console.log("對話 OK：chips×2、粗體渲染、<script> escape、三方案卡（千分位＋pick）、確認卡");

  await page.screenshot({ path: "smoke_mobile.png", fullPage: true });
  await browser.close();
  server.close();
  console.log("全部通過 ✅（截圖 smoke_mobile.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
