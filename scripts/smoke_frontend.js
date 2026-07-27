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

const HEALTH = { chase_index: { buy_above_ma_pct: 64.9, buy_total: 2350 },
  opportunity_cost: { total_missed_twd: 26598877 },
  realized_pnl: { total_realized_twd: 117482, loss_trades: 493, profit_trades: 981 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12", top_currency: "twd" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 } };

let marketMode = "round1"; // round1 → round2（漲跌變動）→ fail（斷網）
const PRICES = { round1: { btctwd: "2091464.5", ethtwd: "60536.6", soltwd: "2469.5", dogetwd: "2.3509" },
  round2: { btctwd: "2100000.0", ethtwd: "60000.0", soltwd: "2469.5", dogetwd: "2.4000" } };

const CHAT = {
  reply: "**最大單筆真實虧損**：2025-03-12 賣出 ETH 實虧 NT$8,412\n（機會成本「少賺」另計：1/8 DOGE 少賺 NT$312,924）<script>alert(1)</script>",
  messages: [],
  mode: "growth",
  tool_trail: [{ seq: 1, tool: "query_user_history", summary: "查交易史（all）" }, { seq: 2, tool: "get_market_data", summary: "查行情（ethtwd）" }],
  scenarios: [
    { key: "partial", label: "先賣 25%，留 75% 觀察", amount_twd: 35920, fee_twd: 57, post_concentration_pct: 44, behavior_note: "1/8 類似情境你全賣後少賺 NT$312,924" },
    { key: "full", label: "照原計畫全部賣出", amount_twd: 143680, fee_twd: 230, post_concentration_pct: 0 },
    { key: "pause", label: "先不動，設價格提醒", behavior_note: "不產生訂單" },
  ],
  confirm: { confirm_token: "tok-1", confirmation_card: { market: "ethtwd", side: "sell", volume_twd: 35920, ord_type: "market", price: null } },
};
const TRAIL = { trail: [
  { seq: 1, ts: 1753000000, type: "tool_call", payload: { tool: "get_market_data", input_summary: "查行情（ethtwd）", status: "success" } },
  { seq: 2, ts: 1753000010, type: "draft_created", payload: { market: "ethtwd", side: "sell", volume_twd: 35920 } },
  { seq: 3, ts: 1753000020, type: "user_confirmed", payload: { market: "ethtwd" } },
  { seq: 4, ts: 1753000030, type: "executed", payload: { exchange_order_id: "8837121" } },
] };
let chatBody = null, orderBody = null; // 攔下 request body 驗 session_id / mode

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
  await page.route("**/chat", (r) => { chatBody = r.request().postDataJSON(); r.fulfill({ json: CHAT }); });
  await page.route("**/order", (r) => { orderBody = r.request().postDataJSON(); r.fulfill({ json: { ok: true, order: {}, exchange_response: { id: "8837121" } } }); });
  await page.route("**/audit*", (r) => r.fulfill({ json: TRAIL }));

  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll("#market .v").length === 4
    && [...document.querySelectorAll("#market .v")].every((e) => e.textContent !== "—"));

  // 健檢卡＋insight（含千分位）
  const cards = await page.$$eval("#health .card", (els) => els.map((e) => e.textContent));
  if (cards.length !== 4 || !cards[1].includes("2,660萬")) throw new Error(`健檢卡異常：${cards}`);
  const insights = await page.$$eval("#insights .insight", (els) => els.map((e) => e.textContent));
  if (insights.length !== 2 || !insights[0].includes("2,350")) throw new Error(`insight 異常：${insights}`);
  // 集中度卡：top_currency=twd 須明確標成「現金（TWD）」，不可只寫「持倉集中度」誤導成加密過度集中
  if (!cards[2].includes("現金") || !cards[2].includes("TWD")) throw new Error(`集中度卡未標明現金/幣別：${cards[2]}`);
  console.log("健檢 2×2 卡＋insight OK（千分位；集中度卡已標現金 TWD）");

  // 麥麥健康分 hero 卡（設計稿 screen1）：透明加權分＋圓環＋已實現損益（千分位）
  const hero = await page.$eval("#hero", (e) => e.textContent);
  const heroScore = await page.$eval("#hero .ring i b", (e) => e.textContent);
  const ringBg = await page.$eval("#hero .ring", (e) => e.getAttribute("style") || "");
  if (!hero.includes("投資健康分")) throw new Error(`hero 卡缺標題：${hero}`);
  if (!/^\d{1,3}$/.test(heroScore.trim())) throw new Error(`hero 分數非數字：${heroScore}`);
  if (!hero.includes("117,482")) throw new Error(`hero 已實現損益未千分位：${hero}`);
  if (!ringBg.includes(`0 ${heroScore.trim()}%`)) throw new Error(`圓環填充未對應分數：${ringBg}`);
  // 圓環必須是圓（計算後尺寸）：防止 CSS 選擇器沒套上退化成橫向 bar（#hero vs .hero 類 bug）
  const ring = await page.$eval("#hero .ring", (e) => ({ w: e.clientWidth, h: e.clientHeight, br: getComputedStyle(e).borderRadius }));
  if (ring.w < 40 || Math.abs(ring.w - ring.h) > 2 || ring.br === "0px") throw new Error(`hero 圓環非圓形（w=${ring.w} h=${ring.h} br=${ring.br}）— CSS 未套上`);
  console.log(`hero 健康分卡 OK：分數 ${heroScore.trim()}、圓環 ${ring.w}×${ring.h} 圓形、已實現損益千分位、公式上卡`);

  // API 數字／確認卡欄位的 XSS 邊界（後端回傳非數字字串時不得注入 DOM）
  await page.evaluate(() => {
    window.__numericXss = 0;
    renderHealth({
      chase_index: { buy_above_ma_pct: '<img src=x onerror="window.__numericXss=1">', buy_total: "not-a-number" },
      opportunity_cost: { total_missed_twd: "not-a-number" },
      concentration: { peak_concentration: { top_pct: '<img src=x onerror="window.__numericXss=1">', month: '<img src=x onerror="window.__numericXss=1">' } },
      cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: '<img src=x onerror="window.__numericXss=1">', twd_withdrawal_count: "not-a-number" },
    });
  });
  await page.waitForTimeout(50);
  const numericXss = await page.evaluate(() => ({
    fired: window.__numericXss,
    injectedNodes: document.querySelectorAll("#health img,#insights img").length,
  }));
  if (numericXss.fired || numericXss.injectedNodes) throw new Error(`數字欄位 XSS 未阻擋：${JSON.stringify(numericXss)}`);
  await page.evaluate(() => addConfirmCard({
    market: '<img src=x onerror="window.__numericXss=1">',
    side: "sell",
    volume_twd: '<img src=x onerror="window.__numericXss=1">',
    ord_type: "limit",
    price: '<img src=x onerror="window.__numericXss=1">',
  }, "xss-test"));
  await page.waitForTimeout(50);
  const confirmXss = await page.evaluate(() => ({
    fired: window.__numericXss,
    injectedNodes: document.querySelectorAll(".confirm img").length,
  }));
  if (confirmXss.fired || confirmXss.injectedNodes) throw new Error(`確認卡 XSS 未阻擋：${JSON.stringify(confirmXss)}`);
  await page.evaluate(() => document.querySelector(".confirm")?.remove());
  await page.evaluate((healthy) => renderHealth(healthy), HEALTH);
  console.log("API 數字／確認卡 XSS 邊界 OK");

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
  // 落差 2（screen3）：手續費取方案真值 fee_twd；市價單數量誠實標「依成交價定」，不編造
  if (!confirmTxt.includes("NT$57")) throw new Error(`確認卡缺方案真實手續費：${confirmTxt}`);
  if (!confirmTxt.includes("依成交價定")) throw new Error(`確認卡市價數量標示缺失：${confirmTxt}`);
  await page.screenshot({ path: "smoke_confirm.png", fullPage: true }); // 確認卡＋三方案卡當下畫面（screen2+3）
  if (!chatBody?.session_id) throw new Error("/chat 未帶 session_id");
  console.log("對話 OK：chips×2、粗體渲染、<script> escape、三方案卡（千分位＋pick）、確認卡、session_id 帶上");

  // 模式徽章切換（#10 R3）：點擊循環，下一次 /chat 帶 mode 覆寫
  const badge0 = await page.$eval("#mode-badge", (e) => e.textContent);
  await page.click("#mode-badge");
  const badge1 = await page.$eval("#mode-badge", (e) => e.textContent);
  if (badge0 === badge1 || !badge1.includes("＊")) throw new Error(`徽章切換異常：${badge0}→${badge1}`);
  console.log(`模式徽章切換 OK：${badge0} → ${badge1}`);

  // Golden Path 收尾：確認 → 成交 → 決策軌跡面板（#12 R3）
  await page.click(".confirm .ok");
  await page.waitForSelector(".trail");
  if (!orderBody?.session_id || orderBody.confirm_token !== "tok-1") throw new Error("/order body 異常");
  const doneTxt = await page.$eval(".done", (e) => e.textContent);
  if (!doneTxt.includes("8837121")) throw new Error("成交訊息缺單號");
  const steps = await page.$$eval(".trail .step", (els) => els.map((e) => e.textContent));
  const hls = await page.$$eval(".trail .step.hl", (els) => els.length);
  if (steps.length !== 4 || !steps[1].includes("NT$35,920") || hls !== 3) throw new Error(`軌跡面板異常：${steps} hl=${hls}`);
  console.log("成交→軌跡 OK：4 步驟、訂單事件 hl×3、金額千分位");

  await page.screenshot({ path: "smoke_mobile.png", fullPage: true });

  // 離線劇本（決賽保險）：/chat 斷線 → mock 接手走完 Golden Path（含 BULLISH 切換）
  await page.unroute("**/chat");
  await page.route("**/chat", (r) => r.abort());
  await page.fill("#q", "ETH 跌太多幫我全部賣掉");
  await page.click(".inputbar button");
  await page.waitForSelector(".confirm");
  const offScens = await page.$$eval(".scen", (els) => els.length);
  if (offScens < 6) throw new Error("離線三方案卡未渲染"); // 前一輪 3 張＋離線 3 張
  await page.click(".confirm .ok");
  await page.waitForFunction(() => [...document.querySelectorAll(".done")].some((e) => e.textContent.includes("離線展示")));
  const trails = await page.$$eval(".trail", (els) => els.length);
  if (trails < 2) throw new Error("離線軌跡面板未渲染");
  const logoSrc = await page.$eval(".topbar .logo img", (e) => e.src);
  if (!logoSrc.includes("bullish")) throw new Error("麥麥未切 BULLISH");
  const offlineBadge = await page.$eval("#offline", (e) => getComputedStyle(e).display);
  if (offlineBadge === "none") throw new Error("離線標示未亮");
  console.log("離線劇本 OK：三方案→確認→示意成交→軌跡、麥麥切 BULLISH、離線標示亮");

  await browser.close();
  server.close();
  console.log("全部通過 ✅（截圖 smoke_mobile.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
