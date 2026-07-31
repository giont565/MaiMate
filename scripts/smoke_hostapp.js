/* 宿主 App 入口示意的煙測（frontend/host-app.html）
 *
 * 這頁是給評審點的 Demo 素材，講的是「MaiMate 加一個入口就能進既有 App，主系統零改動」。
 * 它最容易壞在兩個地方，而且壞了都不會報錯：
 *   1. 總資產寫死 → 哪天 health_report 重跑，宿主 App 顯示的帳戶就跟麥麥講的不是同一個
 *   2. 行情填假價格 → 這頁根本不打 API，填數字等於編造
 * 所以除了功能斷言，另外兩條是反向誠實斷言。
 *
 * 用法：npm run smoke:hostapp（自帶伺服器，離線可跑）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png" };

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
  catch (e) {
    if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    else throw e;
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));

  // 全站離線：這頁不該打任何外部 API
  await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());

  await page.goto(`${base}/host-app.html`, { waitUntil: "load" });
  await page.waitForSelector(".wm");

  // ── 1. 兩個宿主可切換 ──────────────────────────────────────────
  const maxName = await page.$eval(".wm", (e) => e.textContent.trim());
  if (maxName !== "MAX") throw new Error(`預設宿主應為 MAX，實際：${maxName}`);
  await page.click("#btn-mc");
  await page.waitForFunction(() => document.querySelector(".wm").textContent.trim() === "MaiCoin");
  const mcTheme = await page.$eval("#screen", (e) => e.className);
  if (!mcTheme.includes("mc")) throw new Error(`切到 MaiCoin 後主題未換：${mcTheme}`);
  await page.click("#btn-max");
  await page.waitForFunction(() => document.querySelector(".wm").textContent.trim() === "MAX");
  console.log("宿主切換 OK：MAX ⇄ MaiCoin，字標與主題同步");

  // ── 2. 誠實斷言：總資產必須等於 MM_ACCOUNT，不得寫死 ────────────
  const check = await page.evaluate(() => {
    const acc = window.MM_ACCOUNT;
    const shown = document.querySelector(".assets .vv").textContent.replace(/[^\d]/g, "");
    return { shown, expect: acc && acc.holdings ? String(Math.round(acc.holdings.portfolioTwd)) : null };
  });
  if (!check.expect) throw new Error("讀不到 MM_ACCOUNT.holdings.portfolioTwd — mocks/account.js 沒載入？");
  if (check.shown !== check.expect) {
    throw new Error(`總資產與帳戶來源不符：畫面 ${check.shown} vs mocks/account.js ${check.expect}`
      + "（宿主 App 顯示的必須是麥麥講的同一個帳戶，不能寫死）");
  }
  console.log(`總資產一致 OK：NT$${Number(check.expect).toLocaleString("en-US")}（來自 mocks/account.js）`);

  // ── 3. 誠實斷言：行情不得出現假價格 ────────────────────────────
  // 這頁不打 API，所以四個報價只能是「— —」。任何看起來像價格的數字都是編造。
  const tickers = await page.$$eval("[data-ticker]", (els) => els.map((e) => ({
    sym: e.dataset.ticker,
    quote: e.querySelector(".pv").textContent.trim(),
    label: e.querySelector(".pc").textContent.trim(),
  })));
  if (tickers.length !== 4) throw new Error(`行情列應有 4 列，實際 ${tickers.length}（選擇器失準會造成假通過）`);
  const fabricated = tickers.filter((t) => /\d/.test(t.quote));
  if (fabricated.length) {
    throw new Error(`行情列出現數字：${fabricated.map((t) => `${t.sym}=${t.quote}`).join("、")}`
      + "。本頁不打 API，報價只能顯示「— —」，不得編造價格");
  }
  const unlabelled = tickers.filter((t) => t.label !== "示意");
  if (unlabelled.length) throw new Error(`行情列未標「示意」：${unlabelled.map((t) => t.sym).join("、")}`);
  console.log("行情誠實 OK：四格皆「— —」並標示意，未編造價格");

  // ── 4. 兩個入口都要能進麥麥，且進到不同頁 ──────────────────────
  await page.click(".gi.mm");
  await page.waitForFunction(() => document.getElementById("wv").classList.contains("on"));
  const gridEntry = await page.$eval("#wvframe", (e) => e.getAttribute("src"));
  if (gridEntry !== "welcome.html") throw new Error(`九宮格入口應開 welcome.html，實際：${gridEntry}`);

  // 返回鍵要顯示當前宿主名稱
  const backLabel = await page.$eval("#wvhost", (e) => e.textContent.trim());
  if (backLabel !== "MAX") throw new Error(`返回鍵宿主名稱錯誤：${backLabel}`);

  await page.click("#wvback");
  await page.waitForFunction(() => !document.getElementById("wv").classList.contains("on"));
  await page.waitForFunction(() => document.getElementById("wvframe").getAttribute("src") === "about:blank", { timeout: 3000 });
  console.log("九宮格入口 OK：開 welcome.html → 返回鍵標示 MAX → 關閉後 iframe 卸載");

  await page.click(".tab.mm");
  await page.waitForFunction(() => document.getElementById("wv").classList.contains("on"));
  const tabEntry = await page.$eval("#wvframe", (e) => e.getAttribute("src"));
  if (tabEntry !== "index.html") throw new Error(`底部分頁入口應開 index.html，實際：${tabEntry}`);

  // 麥麥要真的在 iframe 裡跑起來，不是空白框
  const fr = page.frames().find((f) => f.url().includes("index.html"));
  if (!fr) throw new Error("WebView 內找不到 index.html 的 frame");
  await fr.waitForSelector("#hero", { timeout: 8000 });
  const heroText = await fr.$eval("#hero", (e) => e.textContent);
  if (!heroText.includes("投資健康分")) throw new Error(`WebView 內麥麥未正常渲染：${heroText.slice(0, 60)}`);
  console.log("底部分頁入口 OK：開 index.html，麥麥在 WebView 內正常渲染（健康分卡就位）");

  // ── 5. 示意標示必須常駐可見（含 WebView 開啟時）────────────────
  const tagVisible = await page.$eval(".simtag", (e) => {
    const st = getComputedStyle(e), r = e.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.height > 0;
  });
  if (!tagVisible) throw new Error("「示意 wireframe」標示在 WebView 開啟時消失了——不可讓人誤認為官方 App");
  await page.click("#wvback");
  await page.waitForFunction(() => !document.getElementById("wv").classList.contains("on"));
  console.log("誠實標示 OK：「非官方 App 畫面」在宿主與 WebView 兩種狀態都可見");

  // ── 6. 未實作的宿主功能要說明，不能是死路 ──────────────────────
  await page.click('[data-noop="現貨"]');
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("on"));
  const toastTxt = await page.$eval("#toast", (e) => e.textContent);
  if (!toastTxt.includes("未實作")) throw new Error(`未實作提示文字不對：${toastTxt}`);
  console.log(`未實作項目 OK：點了會說明而非無反應（「${toastTxt}」）`);

  // ── 7. 觸控目標 ≥44px ─────────────────────────────────────────
  const small = await page.$$eval("button", (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => {
    const r = n.getBoundingClientRect();
    return { t: (n.textContent || "").trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) };
  }).filter((x) => x.w < 44 || x.h < 44));
  if (small.length) throw new Error(`觸控目標小於 44px：${small.map((s) => `${s.t} ${s.w}x${s.h}`).join("；")}`);
  console.log("觸控目標 OK：全部可點元素 ≥44px");

  if (jsErrors.length) throw new Error(`JS 例外：${jsErrors.slice(0, 3).join("；")}`);

  await browser.close();
  server.close();
  console.log("全部通過 ✅");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
