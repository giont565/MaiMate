/* 宿主 App 入口示意的煙測（frontend/host-app.html）
 *
 * 這頁是給評審點的 Demo 素材，講的是「MaiMate 加一個入口就能進既有 App，主系統零改動」。
 * 它最容易壞在三個地方，而且壞了都不會報錯：
 *   1. 總資產寫死 → 哪天 health_report 重跑，宿主 App 顯示的帳戶就跟麥麥講的不是同一個
 *   2. 行情在抓不到 API 時填假價格 → 這頁離線時只能顯示「—」
 *   3. 麥麥入口指到舊頁 → Demo 演到一半跑出上一版的畫面
 * 所以除了功能斷言，另外有反向誠實斷言與入口目標斷言。
 *
 * 用法：npm run smoke:hostapp（自帶伺服器，離線可跑）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
// .svg 一定要在：宿主 logo 是 SVG，少了它瀏覽器拿到 octet-stream 會當成載入失敗、
// 退回字標，於是煙測會回報「無 logo 檔」——檔案明明在，狀態卻是錯的。
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// 麥麥的兩個入口該進哪一頁——寫在這裡當單一事實來源，改入口就要改這裡
// 九宮格 icon：先播入口動畫，播完/跳過轉 welcome.html。
// 落點是 welcome.html 而不是 index.html，因為 welcome.html 是**風險問卷的唯一守門頁**
// （welcome.js:155 依 entryState 分流：新用戶／設定到一半 → onboarding.html#/consent 五屏問卷；
// 已完成 → home.html）。#53 為了保住 #45 的「直接進主畫面」寫成 ?from=index.html，
// 副作用是問卷從進場流程整個消失。2026-08-02 決賽日改回完整流程。
const ENTRY_GRID = "intro.html?from=welcome.html";
const ENTRY_TAB = "home.html?demo=STEADY_PLANNER";      // 底部分頁：Screen 6 新首頁

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

  // 全站離線：本測試不打外部 API，行情必須走「抓不到」那條路
  await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());

  await page.goto(`${base}/host-app.html`, { waitUntil: "load" });
  await page.waitForSelector(".wm");

  // ── 1. 版面只有一層：不該有手機外框或說明區塊 ────────────────────
  // （評審看到的應該就是 App 畫面本身，不是「網頁裡放一支手機、手機裡放一個 App」）
  const layers = await page.evaluate(() => ({
    appTop: Math.round(document.querySelector(".app").getBoundingClientRect().top),
    bodyScroll: document.body.scrollHeight > window.innerHeight + 2,
  }));
  if (layers.appTop !== 0) throw new Error(`App 畫面沒有滿版（top=${layers.appTop}）——不應該有外框或說明區塊`);
  if (layers.bodyScroll) throw new Error("整頁可捲動——App 畫面應該固定滿版，只有內容區捲動");
  console.log("版面 OK：整頁即 App 畫面，無外框、無外層捲動");

  // ── 2. 兩個宿主可切換 ──────────────────────────────────────────
  const hostKey = () => page.$eval("#app", (e) => e.dataset.host);
  if ((await hostKey()) !== "max") throw new Error(`預設宿主應為 max，實際：${await hostKey()}`);
  await page.click("#h-mc");
  await page.waitForFunction(() => document.getElementById("app").dataset.host === "mc");
  if (!(await page.$eval("#app", (e) => e.className)).includes("mc")) throw new Error("切到 MaiCoin 後主題未換");
  // 用 data-name 判定，不看 .wm 的文字——放進官方 logo 檔之後那裡會變成 <img>，沒有文字
  if ((await page.$eval(".wm", (e) => e.dataset.name)) !== "MaiCoin") throw new Error("字標未換成 MaiCoin");
  await page.click("#h-max");
  await page.waitForFunction(() => document.getElementById("app").dataset.host === "max");
  // 網址參數也要能指定（現場最穩的切法）
  await page.goto(`${base}/host-app.html?host=mc`, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("app").dataset.host === "mc");
  await page.goto(`${base}/host-app.html`, { waitUntil: "load" });
  await page.waitForSelector(".wm");
  console.log("宿主切換 OK：底部切換鈕與 ?host=mc 兩種方式都生效");

  // ── 2b. logo 缺檔時要退回字標，不能留一個破圖 ────────────────────
  // frontend/brand/ 的官方 logo 要人工放（官網對程式抓取回 403），所以缺檔是常態，
  // 缺檔的畫面必須仍然完整——破圖 icon 出現在 Demo 上比沒有 logo 更難看。
  const brand = await page.evaluate(() => {
    const wm = document.querySelector(".wm");
    const img = wm.querySelector("img");
    return {
      hasImg: !!img,
      imgLoaded: img ? img.naturalWidth > 0 : null,
      text: wm.textContent.trim(),
      name: wm.dataset.name,
    };
  });
  if (brand.hasImg && !brand.imgLoaded) throw new Error("logo 圖檔載入失敗但沒有退回字標——畫面會出現破圖");
  if (!brand.hasImg && !brand.text.includes(brand.name)) throw new Error(`退回字標後看不到宿主名稱：「${brand.text}」`);
  console.log(`品牌標示 OK：${brand.hasImg ? "使用 brand/ 的官方 logo" : `無 logo 檔，已退回字標（${brand.text}）`}`);

  // 圖示容器內只能有一個元素：曾經把 SVG 字串塞進 onerror 屬性，字串裡的雙引號
  // 提早關掉屬性，剩下的標記散落成 DOM 亂碼疊在圖示上——而且不會有任何錯誤訊息
  const strays = await page.$$eval(".qi .ib, .wm", (els) =>
    els.map((e) => ({ cls: e.className || "wm", n: e.children.length, txt: e.textContent.trim().slice(0, 24) }))
      .filter((x) => x.cls === "wm" ? x.n > 2 : x.n !== 1));
  if (strays.length) throw new Error(`圖示容器有多餘節點（多半是屬性被字串內的引號截斷）：${JSON.stringify(strays)}`);
  console.log("圖示結構 OK：每個圖示容器只有一個節點，無散落標記");

  // ── 2c. 不畫假的狀態列（這是要放到真手機上展示的）──────────────
  const fakeBar = await page.evaluate(() => /9:41/.test(document.querySelector(".app").textContent));
  if (fakeBar) throw new Error("畫面上還有假的狀態列時間——真手機自己就有狀態列，不要疊一層假的");
  console.log("無假狀態列 OK：交給真手機自己的狀態列");

  // ── 3. 誠實斷言 A：總資產必須等於 MM_ACCOUNT，不得寫死 ──────────
  const acc = await page.evaluate(() => ({
    shown: document.querySelector(".ast .v").textContent.replace(/[^\d]/g, ""),
    expect: window.MM_ACCOUNT && window.MM_ACCOUNT.holdings
      ? String(Math.round(window.MM_ACCOUNT.holdings.portfolioTwd)) : null,
  }));
  if (!acc.expect) throw new Error("讀不到 MM_ACCOUNT.holdings.portfolioTwd — mocks/account.js 沒載入？");
  if (acc.shown !== acc.expect) {
    throw new Error(`總資產與帳戶來源不符：畫面 ${acc.shown} vs mocks/account.js ${acc.expect}`
      + "（宿主 App 顯示的必須是麥麥講的同一個帳戶，不能寫死）");
  }
  console.log(`總資產一致 OK：NT$${Number(acc.expect).toLocaleString("en-US")}（來自 mocks/account.js）`);

  // ── 4. 誠實斷言 B：抓不到行情時不得編造價格 ─────────────────────
  await page.waitForFunction(() => {
    const el = document.getElementById("mkt-src");
    return el && el.textContent !== "讀取中…";
  }, { timeout: 8000 });
  const tickers = await page.$$eval("[data-ticker]", (els) => els.map((e) => ({
    sym: e.dataset.ticker,
    quote: e.querySelector(".q").textContent.trim(),
    tag: e.querySelector(".t").textContent.trim(),
  })));
  if (tickers.length !== 4) throw new Error(`行情列應有 4 列，實際 ${tickers.length}（選擇器失準會造成假通過）`);
  const fabricated = tickers.filter((t) => /\d/.test(t.quote));
  if (fabricated.length) {
    throw new Error(`離線時行情出現數字：${fabricated.map((t) => `${t.sym}=${t.quote}`).join("、")}`
      + "。抓不到 /market 就只能顯示「—」，不得編造或用寫死的價格墊檔");
  }
  const badTag = tickers.filter((t) => t.tag !== "未串接");
  if (badTag.length) throw new Error(`行情列未標「未串接」：${badTag.map((t) => `${t.sym}(${t.tag})`).join("、")}`);
  const srcNote = await page.$eval("#mkt-src", (e) => e.textContent);
  if (!srcNote.includes("未串接")) throw new Error(`行情區標題未說明未串接：${srcNote}`);
  console.log(`行情誠實 OK：離線時四格皆「—」並標未串接（「${srcNote}」）`);

  // ── 5. 兩個入口各自的目標頁（防止指回舊版）──────────────────────
  await page.click(".qi.mm");
  await page.waitForFunction(() => document.getElementById("wv").classList.contains("on"));
  const gridSrc = await page.$eval("#frame", (e) => e.getAttribute("src"));
  if (gridSrc !== ENTRY_GRID) throw new Error(`九宮格入口應開 ${ENTRY_GRID}，實際：${gridSrc}`);
  if ((await page.$eval("#hostname", (e) => e.textContent.trim())) !== "MAX") throw new Error("返回鍵未顯示當前宿主名稱");
  await page.click("#back");
  await page.waitForFunction(() => !document.getElementById("wv").classList.contains("on"));
  await page.waitForFunction(() => document.getElementById("frame").getAttribute("src") === "about:blank", { timeout: 3000 });
  console.log(`九宮格入口 OK：開 ${ENTRY_GRID} → 返回鍵標 MAX → 關閉後 iframe 卸載`);

  await page.click(".mmtab");
  await page.waitForFunction(() => document.getElementById("wv").classList.contains("on"));
  const tabSrc = await page.$eval("#frame", (e) => e.getAttribute("src"));
  if (tabSrc !== ENTRY_TAB) {
    throw new Error(`底部分頁入口應開 ${ENTRY_TAB}，實際：${tabSrc}`
      + "（index.html 是舊的主程式，Screen 6 首頁才是現在的產品畫面）");
  }
  // 麥麥要真的在 iframe 裡渲染出來，不是空白框。
  // 這裡原本 click 完就直接找 frame，是個競態——iframe 還沒掛上就查會偶發紅字
  // （home.html 多載幾支 script 就更容易輸）。改成等它出現，超時才算真的失敗。
  await page.waitForFunction(
    () => [...document.querySelectorAll("iframe")].some((f) => (f.src || "").includes("home.html")),
    { timeout: 8000 }
  );
  const fr = page.frames().find((f) => f.url().includes("home.html"));
  if (!fr) throw new Error("WebView 內找不到 home.html 的 frame");
  await fr.waitForSelector("#home-greeting-title", { timeout: 8000 });
  const greeting = await fr.$eval("#home-greeting-title", (e) => e.textContent.trim());
  if (!greeting) throw new Error("WebView 內首頁未渲染出招呼語");
  console.log(`底部分頁入口 OK：開 Screen 6 首頁，WebView 內已渲染（「${greeting.slice(0, 18)}」）`);

  // ── 6. 誠實標示必須常駐（含 WebView 開啟時）─────────────────────
  const simOk = await page.evaluate(() => {
    const el = document.querySelector(".simbar");
    if (!el) return false;
    const st = getComputedStyle(el), r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.height > 0
      && /非官方/.test(el.textContent);
  });
  if (!simOk) throw new Error("「非官方 App 畫面」標示在 WebView 開啟時不可見——不能讓人誤認為官方產品截圖");
  await page.click("#back");
  await page.waitForFunction(() => !document.getElementById("wv").classList.contains("on"));
  console.log("誠實標示 OK：宿主與 WebView 兩種狀態都看得到「非官方 App 畫面」");

  // ── 7. 未實作的宿主功能要說明，不能是死路 ──────────────────────
  await page.click('[data-noop="現貨"]');
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("on"));
  const toastTxt = await page.$eval("#toast", (e) => e.textContent);
  if (!toastTxt.includes("未實作")) throw new Error(`未實作提示文字不對：${toastTxt}`);
  console.log(`未實作項目 OK：點了會說明而非無反應（「${toastTxt}」）`);

  // ── 8. 觸控目標 ≥44px ─────────────────────────────────────────
  // 例外：.simbar 的兩個切換鈕是給講者用的控制列，不是模擬 App 的一部分。
  // 把那條列拉到 44px 會讓誠實標示反客為主吃掉畫面；現場要穩定切換可用 ?host=mc。
  const small = await page.$$eval("button:not(.simbar button)", (ns) =>
    ns.filter((n) => n.offsetParent !== null).map((n) => {
      const r = n.getBoundingClientRect();
      return { t: (n.textContent || "").trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((x) => x.w < 44 || x.h < 44));
  if (small.length) throw new Error(`觸控目標小於 44px：${small.map((s) => `${s.t} ${s.w}x${s.h}`).join("；")}`);
  console.log("觸控目標 OK：App 內可點元素全部 ≥44px（示意列的切換鈕為記錄在案的例外）");

  if (jsErrors.length) throw new Error(`JS 例外：${jsErrors.slice(0, 3).join("；")}`);
  await page.close();

  // ── 9. PWA：precache 清單不得與實際目錄脫節 ─────────────────────
  // 這條是純檔案比對，不用瀏覽器。清單是產生的（npm run build:sw），
  // 忘了重跑就會有檔案沒被快取——而破口只在真的斷網時現形，也就是決賽現場。
  {
    const swAssetsPath = path.join(ROOT, "sw-assets.js");
    if (!fs.existsSync(swAssetsPath)) throw new Error("frontend/sw-assets.js 不存在 → 跑 npm run build:sw");
    const listed = new Set(JSON.parse(/self\.SW_ASSETS = (\[[\s\S]*?\]);/.exec(fs.readFileSync(swAssetsPath, "utf8"))[1]));
    const SKIP = new Set(["sw.js", "sw-assets.js", "brand/README.md"]);
    // 這份清單必須與 scripts/build_sw_manifest.js 的 EXT 一致，兩邊是各自寫死的。
    // .mp4 是入口動畫 01–03 幕的素材（brand/intro-shot1-3.mp4）。
    const EXT = new Set([".html", ".js", ".css", ".png", ".svg", ".webmanifest", ".jpg", ".webp", ".mp4"]);
    const actual = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else actual.push(path.relative(ROOT, p).split(path.sep).join("/"));
      }
    })(ROOT);
    const want = actual.filter((f) => !SKIP.has(f) && EXT.has(path.extname(f).toLowerCase()));
    const missing = want.filter((f) => !listed.has(f));
    const stale = [...listed].filter((f) => !want.includes(f));
    if (missing.length || stale.length) {
      throw new Error(`sw-assets.js 與實際目錄脫節 → 跑 npm run build:sw\n    `
        + (missing.length ? `清單缺少：${missing.join("、")}  ` : "")
        + (stale.length ? `清單多餘：${stale.join("、")}` : ""));
    }
    console.log(`precache 清單 OK：${want.length} 個檔與目錄一致`);
  }

  // ── 10. PWA：manifest 與圖示 ──────────────────────────────────
  // 另開一個沒有 route 攔截的 context——攔截會干擾 service worker 的請求
  const pwa = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await pwa.newPage();
  {
    const r = await pp.request.get(`${base}/manifest.webmanifest`);
    if (!r.ok()) throw new Error(`manifest.webmanifest 取不到：${r.status()}`);
    const m = await r.json();
    if (m.display !== "standalone") throw new Error(`manifest.display 應為 standalone，實際：${m.display}`);
    if (!m.start_url) throw new Error("manifest 沒有 start_url");
    if (!Array.isArray(m.icons) || !m.icons.length) throw new Error("manifest 沒有 icons");
    for (const ic of m.icons) {
      const ir = await pp.request.get(`${base}/${ic.src}`);
      if (!ir.ok()) throw new Error(`圖示 ${ic.src} 取不到：${ir.status()}（主畫面會是空白方塊）`);
    }
    // 頁面要真的引用 manifest 與 apple-touch-icon，光有檔案不會讓它可安裝
    await pp.goto(`${base}/host-app.html`, { waitUntil: "load" });
    const links = await pp.evaluate(() => ({
      manifest: !!document.querySelector('link[rel="manifest"]'),
      apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
      capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]'),
    }));
    for (const [k, v] of Object.entries(links)) if (!v) throw new Error(`host-app.html 缺少 PWA 標籤：${k}`);
    console.log(`PWA manifest OK：standalone、start_url=${m.start_url}、${m.icons.length} 個圖示皆可取得`);
  }

  // ── 11. PWA：斷網後仍打得開（決賽保險的實際驗證）─────────────────
  {
    await pp.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 })
      .catch(() => { throw new Error("service worker 沒有接管頁面 —— 離線備援不會生效"); });
    await pwa.setOffline(true);
    await pp.reload({ waitUntil: "load" });
    const offline = await pp.evaluate(() => ({
      wm: document.querySelector(".wm") ? document.querySelector(".wm").dataset.name : null,
      asset: document.querySelector(".ast .v") ? document.querySelector(".ast .v").textContent.trim() : null,
    }));
    if (offline.wm !== "MAX") throw new Error("斷網後頁面沒渲染出來 —— service worker 快取沒生效");
    if (!/\d/.test(offline.asset || "")) throw new Error(`斷網後總資產讀不到：${offline.asset}`);
    // 斷網時麥麥也要進得去（WebView 內的頁面同樣來自快取）
    await pp.click(".mmtab");
    await pp.waitForFunction(() => document.getElementById("wv").classList.contains("on"));
    const ofr = pp.frames().find((f) => f.url().includes("home.html"));
    if (!ofr) throw new Error("斷網時 WebView 內找不到 home.html");
    await ofr.waitForSelector("#home-greeting-title", { timeout: 10000 });
    await pwa.setOffline(false);
    console.log(`斷網實測 OK：拔網路後 host-app 與麥麥首頁都從快取開得起來（資產 ${offline.asset}）`);
  }
  await pwa.close();

  await browser.close();
  server.close();
  console.log("全部通過 ✅");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
