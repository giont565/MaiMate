/* 示範帳戶標示的常設回歸測試（沒有 MAX 金鑰時走的那條路）。
 *
 * 為什麼要獨立一支：這條路的紅線是「絕不能把示範資料當成真實帳戶資料呈現」，
 * 而它最容易破的地方**不是**第一輪——第一輪的橫幅很好寫也很好驗。真正會出事的是：
 *   ① 第二輪（點方案卡 → 確認卡）後端 tool_trail 只有 prepare_order；
 *   ② 追問輪模型直接引用歷史裡的工具結果作答，tool_trail 是空的。
 * 這兩種輪次一旦漏標，畫面照樣顯示示範數字、照樣可以按下確認，卻沒有任何標示。
 *
 * ⚠️ fixture 必須是**後端真的會產生的形狀**，不能把 account_source 和 confirm 合成一包。
 * 下面兩份就是實跑無金鑰後端抓回來的原始 payload 骨架：
 *   T1（第一輪）：有 account_source、有 scenarios、**沒有** confirm
 *   T2（第二輪）：有 confirm、**沒有** scenarios
 * T2 另外跑兩種版本：帶標示（修好之後後端會帶）與不帶標示（修好之前的實際回應）。
 * 不帶標示那一版是重點——它在驗「就算 payload 一個標示欄位都沒有，頂欄那道常設標示
 * 仍然在畫面上」，也就是模型漏講時最後那道防線。
 *
 * 用法：npm run smoke:demo
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".png": "image/png" };

const NOTICE = "🧪 示範帳戶 — 命題方提供的一年份帳戶資料（估值日 2025-12-31），"
  + "非真實 MAX 帳戶餘額；行情、手續費、交易所下限仍是即時真實資料。";

// 第一輪：查餘額 → 行情 → 三方案（實測 tool_trail 就是這三支）
const T1 = {
  reply: "（示範帳戶模式）這台環境沒有連上 MAX 帳戶，以下用命題方提供的一年份帳戶資料試算，"
    + "資產估值日 2025-12-31；行情與手續費是即時真實資料。\n\n"
    + "**示範帳戶**的 ETH 持倉約 **NT$405,305**（佔 0.3%）。",
  messages: [],
  mode: "growth",
  account_source: "demo_dataset",
  account_notice: NOTICE,
  tool_trail: [
    { seq: 1, tool: "get_account_balance", summary: "查餘額", status: "success" },
    { seq: 2, tool: "get_market_data", summary: "查行情（ethtwd）", status: "success" },
    { seq: 3, tool: "calculate_trade_scenarios", summary: "方案試算（ethtwd）", status: "success" },
  ],
  scenarios: [
    { key: "partial", label: "先賣 25%，留倉觀察", amount_twd: 101326, fee_twd: 162,
      post_concentration_pct: 0.3, account_source: "demo_dataset", account_notice: NOTICE },
    { key: "full", label: "照原意圖全部賣出", amount_twd: 405305, fee_twd: 648,
      post_concentration_pct: 0.0, account_source: "demo_dataset", account_notice: NOTICE },
    { key: "pause", label: "先不動，設價格提醒", post_concentration_pct: 0.3,
      account_source: "demo_dataset", account_notice: NOTICE },
  ],
};

// 第二輪：只跑 prepare_order。marked=false 是修好前後端真的回過的形狀。
const t2 = (marked) => {
  const payload = {
    reply: "確認卡片已產生，請直接在這個畫面上按下確認按鈕。卡片有效期 **60 秒**。",
    messages: [], mode: "growth",
    tool_trail: [{ seq: 1, tool: "prepare_order", summary: "擬定訂單草稿", status: "success" }],
    confirm: { confirm_token: "tok-demo-1", ttl_seconds: 60,
      confirmation_card: { market: "ethtwd", side: "sell", volume_twd: 405305,
        ord_type: "market", price: null } },
  };
  if (marked) { payload.account_source = "demo_dataset"; payload.account_notice = NOTICE; }
  return payload;
};

// 送出確認 → 後端不下單、也不偽造成交
const ORDER_DEMO = { ok: false, demo_account: true, code: "demo_account", retryable: false,
  message: "示範帳戶模式：確認流程已完整跑完，但沒有送出任何真實訂單（本環境未連線 MAX 帳戶）。" };

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const json = (route, body) => route.fulfill({ status: 200,
  contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });

const fail = (msg) => { throw new Error(msg); };

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    else throw e;
  }

  /* 兩條渲染路徑各跑一次。踩坑 #5：index.html 與 chat.html 是兩套獨立的 DOM 與
     兩份各自的 addConfirmCard，只驗一頁等於沒驗另一頁。上台用的是 index.html。 */
  for (const page of ["index", "chat"]) {
    const isChat = page === "chat";
    const tab = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    tab.on("pageerror", (e) => errors.push(String(e)));

    let turn = 0;
    let markSecondTurn = true;           // 由下面的兩趟切換
    await tab.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (/\/chat(\?|$)/.test(url)) { turn += 1; return json(route, turn === 1 ? T1 : t2(markSecondTurn)); }
      if (/\/order(\?|$)/.test(url)) return json(route, ORDER_DEMO);
      if (/\/health|\/market|\/audit/.test(url)) return route.abort();  // 走既有離線保留值路徑
      return route.abort();
    });
    /* chat.html 有 route guard：沒有 session 會被導回 welcome.html。
       先用 home.html?demo=… 建立 demo session，之後 reload 也還在（localStorage）。 */
    const open = async () => {
      if (isChat) {
        await tab.goto(`${base}/home.html?demo=STEADY_PLANNER`, { waitUntil: "domcontentloaded" });
        await tab.waitForSelector(".bottom-nav", { timeout: 15000 });
      }
      await tab.goto(`${base}/${isChat ? "chat.html" : "index.html"}`, { waitUntil: "domcontentloaded" });
      await tab.waitForTimeout(400);
    };
    await open();

    const persistent = async () => (isChat
      ? tab.$eval("#chat-subtitle", (e) => (e.dataset.demo === "1" ? e.textContent : null)).catch(() => null)
      : tab.$eval("#demo-pill", (e) => (getComputedStyle(e).display !== "none" ? e.textContent : null)).catch(() => null));

    if (await persistent()) fail(`${page}：一進頁面就亮示範帳戶標示——標示必須由後端資料驅動，不能寫死`);

    // ── 第一輪：三方案 ──────────────────────────────────────────────
    const send = async (text) => {
      const beforeCards = await tab.$$eval(".scen, .confirm", (els) => els.length);
      await tab.fill("#q", text);
      await tab.click(isChat ? "#chat-send" : "#chatform button[type=submit], #chatform button");
      await tab.waitForFunction((n) => document.querySelectorAll(".scen, .confirm").length > n,
        beforeCards, { timeout: 15000 });
    };
    await send("ETH 跌太多了，幫我全部賣掉！");

    if ((await tab.$$eval(".scen", (e) => e.length)) !== 3) fail(`${page} T1：三方案卡沒有三張`);
    if (!(await tab.$$eval(".demo-banner", (e) => e.length))) fail(`${page} T1：沒有示範帳戶橫幅`);
    const pinned = await persistent();
    if (!pinned || !pinned.includes("示範帳戶")) fail(`${page} T1：頂欄沒有常設的示範帳戶標示`);
    /* 常設標示必須真的在視窗裡（sticky），不是只存在於 DOM。橫幅會被捲走，它不能。 */
    const inView = await tab.$eval(isChat ? "#chat-subtitle" : "#demo-pill", (e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.width > 0 && r.height > 0;
    });
    if (!inView) fail(`${page} T1：常設標示不在視窗內，等於看不到`);
    console.log(`  ${page} T1 OK：三方案卡 3 張＋橫幅＋常設標示「${pinned.trim()}」`);

    // ── 第二輪：確認卡（重點）────────────────────────────────────────
    for (const marked of [true, false]) {
      markSecondTurn = marked;
      await open();                                 // 回到乾淨的一頁，重跑整段對話
      turn = 0;
      await send("ETH 跌太多了，幫我全部賣掉！");    // T1，把常設標示點亮
      turn = 1;
      await send("照原意圖全部賣出");                 // T2

      if (!(await tab.$$eval(".confirm", (e) => e.length))) fail(`${page} T2(marked=${marked})：確認卡沒有出現`);
      const stillPinned = await persistent();
      if (!stillPinned || !stillPinned.includes("示範帳戶")) {
        fail(`${page} T2(marked=${marked})：確認卡這一輪常設標示不見了`
          + "——這正是漏標的那一輪，畫面會變成沒有任何程式保證的裸卡");
      }
      /* 捲到確認卡，模擬使用者真的要按下去的那一刻：那時橫幅早就在視窗外了，
         常設標示必須還看得見。這一項就是原本被 fixture 蓋掉的漏洞。 */
      await tab.$eval(".confirm", (e) => e.scrollIntoView({ block: "center" }));
      await tab.waitForTimeout(150);
      const visibleAtConfirm = await tab.$eval(isChat ? "#chat-subtitle" : "#demo-pill", (e) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.width > 0 && r.height > 0;
      });
      if (!visibleAtConfirm) fail(`${page} T2(marked=${marked})：捲到確認卡時常設標示已經看不見`);

      if (marked) {
        const line = await tab.$$eval(".confirm .demo-line", (e) => e.length);
        if (!line) fail(`${page} T2：payload 帶了 account_source，確認卡上卻沒有 .demo-line`);
      }
      console.log(`  ${page} T2(payload 標示=${marked}) OK：確認卡在場、常設標示仍可見`
        + (marked ? "、卡上有示範行" : "（payload 零標示仍守得住）"));
    }

    // ── 按下確認：不得偽造成交 ──────────────────────────────────────
    await tab.$eval(".confirm .ok, .confirm button.ok", (e) => e.click());
    await tab.waitForTimeout(600);
    const log = await tab.$eval(isChat ? "#chatlog" : "#chatlog, #log", (e) => e.textContent);
    if (/已成交|單號 #/.test(log)) fail(`${page}：示範模式按下確認後畫面出現「已成交」——偽造成交是最嚴重的失效`);
    if (!log.includes("沒有送出任何真實訂單")) fail(`${page}：按下確認後沒有講明未送出訂單`);
    if (await tab.$$eval(".confirm", (e) => e.length)) fail(`${page}：按下確認後確認卡沒有收掉`);
    console.log(`  ${page} 送出 OK：未偽造成交，明說未送出真實訂單`);

    if (errors.length) fail(`${page}：頁面拋出例外 ${errors[0].slice(0, 160)}`);
    await tab.close();
  }

  await browser.close();
  server.close();
  console.log("示範帳戶標示煙測全部通過 ✅（兩條渲染路徑 × 第一輪／確認卡輪／零標示 payload）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
