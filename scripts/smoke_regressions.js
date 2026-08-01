/* 迴歸煙測：2026-07-27 對抗性審查抓到的六個缺陷，逐項鎖住不准回頭。
 *   1. 「先看示範帳戶」不得永久毀掉使用者的問卷作答（快照＋「我的」可換回）
 *   2. profile 讀取失敗但本機已有同版本結果 → 顯示「查看上次結果」，不謊報分析失敗
 *   3. 切換展示結果不得清空使用者已填的修正／回饋
 *   4. 入口頁沒有上一頁時，返回鍵必須隱藏（不得落到 about:blank）
 *   5. 從「我的」進 onboarding，返回鍵要回設定頁（不是行銷入口頁／分析中畫面）
 *   6. attribution 少了 marketPrice 項時只該該格顯示「資料不足」，整頁不得掛掉
 *      ＋ file:// 直接開檔時導覽必須可用（零建置天條）
 * 用法：npm run smoke:regressions */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".mp4": "video/mp4" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "welcome.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mm_onboarding") || "{}"));

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

  // ── 1. 「先看示範帳戶」不得毀掉使用者作答
  await page.goto(`${base}/onboarding.html#/consent`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/onboarding.html#/consent`);
  await page.click("#btn-demo-data");
  await page.waitForFunction(() => location.hash === "#/profile");
  // 真人作答（與示範人格 habitual/concise/longTermGrowth+steadyHabit 不同）
  for (const v of ["advanced", "marketLiteracy", "long", "followPlan", "termExplain", "analytical"]) {
    await page.click(`.chip[data-v="${v}"]`);
    await page.click("#btn-next");
  }
  let st = await store(page);
  const own = st.draft ? st.draft.answers : null;
  if (!own || own.experienceLevel !== "advanced") throw new Error("前置失敗：使用者作答未存成草稿");
  await page.evaluate(() => { // 直接落成 completed profile，模擬走完問卷
    const s = JSON.parse(localStorage.getItem("mm_onboarding"));
    s.profile = { questionnaireVersion: "demo-1.0", experienceLevel: "advanced", investmentGoals: ["marketLiteracy"],
      holdingHorizon: "long", volatilityResponse: "followPlan", helpPriorities: ["termExplain"],
      communicationStyle: "analytical", status: "completed", completedAt: new Date().toISOString() };
    delete s.draft; delete s.demoPersonaId;
    s.consent.source = "internal";
    localStorage.setItem("mm_onboarding", JSON.stringify(s));
  });
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector(".bottom-nav");
  st = await store(page);
  const snap = await page.evaluate(() => localStorage.getItem("mm_onboarding_user_snapshot"));
  // 示範帳戶＝示範的歷史投資資料 ＋ 使用者自己的問卷人格（不再覆寫成固定示範人格）
  if (st.profile.experienceLevel !== "advanced" || st.profile.communicationStyle !== "analytical")
    throw new Error(`示範帳戶蓋掉了使用者的問卷人格：${JSON.stringify(st.profile)}`);
  if (st.portfolioSource !== "mock" || !st.profileResult) throw new Error("示範帳戶未套用示範歷史資料");
  if (snap) throw new Error("沒有覆寫任何東西時不該留快照");
  console.log("1 示範帳戶 OK：沿用使用者問卷人格（advanced/analytical）＋示範歷史投資資料，未留多餘快照");

  // ── 1c. 三種版面：預設跟著問卷 Q6，改選會記住
  const styleDefault = await page.evaluate(() => ({
    body: document.body.dataset.homeStyle,
    pressed: [...document.querySelectorAll("[data-style]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.style),
    hint: document.getElementById("home-style-hint").textContent,
  }));
  if (styleDefault.body !== "analytical" || styleDefault.pressed.join() !== "analytical")
    throw new Error(`版面預設未跟著問卷答案：${JSON.stringify(styleDefault)}`);
  if (!styleDefault.hint.includes("問卷")) throw new Error(`版面提示文案異常：${styleDefault.hint}`);
  await page.click('[data-style="concise"]');
  await page.waitForFunction(() => document.body.dataset.homeStyle === "concise");
  const conciseHides = await page.evaluate(() => {
    const el = document.querySelector(".evidence-list") || document.querySelector(".module-note");
    return el ? getComputedStyle(el).display : "none";
  });
  if (conciseHides !== "none") throw new Error("「成長陪跑」（concise）未收起解釋／證據區塊");
  await page.reload();
  await page.waitForSelector(".bottom-nav");
  const remembered = await page.evaluate(() => ({ body: document.body.dataset.homeStyle, hint: document.getElementById("home-style-hint").textContent }));
  if (remembered.body !== "concise" || !remembered.hint.includes("已記住"))
    throw new Error(`版面選擇未被記住：${JSON.stringify(remembered)}`);
  console.log("1c 三種版面 OK：預設＝問卷 Q6（analytical）、改選 concise 會收起解釋且刷新後記住");

  // ── 5. 「我的」→ 資料授權 → 返回回到設定頁
  await page.goto(`${base}/settings.html`);
  await page.click("#btn-consent");
  await page.waitForURL(/onboarding\.html\?from=settings#\/consent/);
  await page.click("#btn-back");
  await page.waitForURL(/settings\.html/);
  console.log("5 返回路徑 OK：我的→資料授權→返回→設定頁（不再掉回入口頁）");

  // ── 1b. 只有「答到一半就被示範人格覆蓋」時才需要快照＋還原
  await page.goto(`${base}/onboarding.html#/consent`);
  await page.evaluate(() => { // 未完成的作答（status=inProgress）→ 會被示範人格覆蓋
    localStorage.clear();
    localStorage.setItem("mm_onboarding", JSON.stringify({
      profile: { questionnaireVersion: "demo-1.0", experienceLevel: "beginner", investmentGoals: [],
        holdingHorizon: "short", volatilityResponse: "unsure", helpPriorities: [],
        communicationStyle: "guided", status: "inProgress" },
    }));
  });
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector(".bottom-nav");
  st = await store(page);
  if (st.profile.experienceLevel !== "habitual") throw new Error("未完成作答時應套用預設示範人格");
  await page.goto(`${base}/settings.html`);
  const restoreHidden = await page.$eval("#btn-restore", (e) => e.hidden);
  if (restoreHidden) throw new Error("作答被覆蓋時應顯示「換回我自己的設定」");
  await page.click("#btn-restore");
  await page.waitForURL(/home\.html/);
  st = await store(page);
  const snapAfter = await page.evaluate(() => localStorage.getItem("mm_onboarding_user_snapshot"));
  if (st.profile.experienceLevel !== "beginner") throw new Error("換回設定後仍是示範人格");
  if (snapAfter) throw new Error("換回後快照應清除");
  console.log("1b 換回設定 OK：未完成作答被覆蓋→有快照可還原（beginner），還原後快照已清");

  // ── 2+3. 讀取失敗但已有同版本結果 → 查看上次結果，且修正不被清空
  await page.goto(`${base}/onboarding.html#/consent`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector(".bottom-nav");
  await page.goto(`${base}/onboarding.html#/profile-result`);
  await page.waitForSelector("#profile-result:not([hidden])", { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { // 模擬使用者已填的修正／回饋
    const s = JSON.parse(localStorage.getItem("mm_onboarding"));
    s.profileFeedback = { "dimension-rhythm": { value: "partiallyAccurate", createdAt: new Date().toISOString() } };
    s.overallFeedback = { value: "partiallyAccurate", createdAt: new Date().toISOString() };
    localStorage.setItem("mm_onboarding", JSON.stringify(s));
  });
  await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(true));
  await page.goto(`${base}/onboarding.html#/analyzing`);
  await page.waitForSelector("#analysis-error:not([hidden])", { timeout: 15000 });
  const errTitle = await page.$eval("#analysis-error-title", (e) => e.textContent);
  const fallbackLabel = await page.$eval("#btn-analysis-fallback", (e) => e.textContent);
  if (errTitle !== "最新分析暫時沒有完成" || fallbackLabel !== "查看上次結果")
    throw new Error(`讀取失敗被誤報成分析失敗：${errTitle}／${fallbackLabel}`);
  console.log("2 讀取失敗 OK：顯示「最新分析暫時沒有完成」＋「查看上次結果」，不謊報分析失敗");

  // 直接驗 useDemoFallback 本身：切換展示結果不得清空修正
  const kept = await page.evaluate(async () => {
    await window.MM_INVESTMENT_SERVICES.analysis.useDemoFallback();
    const s = JSON.parse(localStorage.getItem("mm_onboarding"));
    return { fb: s.profileFeedback, overall: s.overallFeedback, hasResult: Boolean(s.profileResult) };
  });
  if (!kept.hasResult) throw new Error("展示結果未產生");
  if (!kept.fb || !kept.fb["dimension-rhythm"] || !kept.overall)
    throw new Error(`切換展示結果清掉了使用者的修正：${JSON.stringify(kept)}`);
  console.log("3 展示結果 OK：使用者的 dimension 修正與整體回饋都被保留");

  // ── 4. 入口頁沒有上一頁 → 返回鍵隱藏
  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fresh.goto(`${base}/welcome.html`);
  await fresh.waitForFunction(() => document.getElementById("btn-cta").textContent !== "載入中…");
  const backHidden = await fresh.$eval("#btn-back", (e) => e.hidden);
  if (!backHidden) throw new Error("入口頁無上一頁時返回鍵仍顯示（會掉到 about:blank）");
  await fresh.close();
  console.log("4 入口返回鍵 OK：沒有上一頁時隱藏");

  // ── 6a. attribution 缺 marketPrice → 只該格「資料不足」，整頁仍正常
  await page.goto(`${base}/home.html`);
  const degraded = await page.evaluate(() => {
    const raw = JSON.parse(JSON.stringify(window.MM_HOME_MOCK ? window.MM_HOME_MOCK : {}));
    return typeof window.mmHomeMarketPriceRatioText === "function"
      ? {
          missing: window.mmHomeMarketPriceRatioText({ contributors: [{ category: "holdingChange", contributionRatio: 0.4 }] }),
          nullish: window.mmHomeMarketPriceRatioText(null),
          ok: window.mmHomeMarketPriceRatioText({ contributors: [{ category: "marketPrice", contributionRatio: 0.62 }] }),
          _raw: Boolean(raw),
        }
      : null;
  });
  if (!degraded) throw new Error("mmHomeMarketPriceRatioText 未定義（guard 未生效）");
  if (degraded.missing !== "資料不足" || degraded.nullish !== "資料不足" || degraded.ok !== "62%")
    throw new Error(`attribution guard 行為異常：${JSON.stringify(degraded)}`);
  console.log("6a attribution guard OK：缺 marketPrice→「資料不足」、有值→62%，不再整頁掛掉");

  // ── 6b. file:// 直接開檔時導覽必須可用
  const filePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 用 settings.html：home.html 在無 session 時本來就會導回 Screen 1，測不到路由解析
  await filePage.goto("file://" + path.join(ROOT, "settings.html"));
  const fileRoutes = await filePage.evaluate(() => ({
    proto: location.protocol,
    home: Boolean(window.MM_NAVIGATION.resolveRoute("/maimate/home")),
    chat: Boolean(window.MM_NAVIGATION.resolveRoute("/maimate/chat")),
    ext: window.MM_NAVIGATION.resolveRoute("https://evil.example/x"),
  }));
  if (fileRoutes.proto !== "file:") throw new Error("測試未在 file:// 下執行");
  if (!fileRoutes.home || !fileRoutes.chat) throw new Error("file:// 下導覽解析失敗（所有按鈕會靜默無反應）");
  if (fileRoutes.ext) throw new Error("外部網址不該被解析成可導覽路由");
  await filePage.close();
  console.log("6b file:// OK：本地路由可解析、外部網址仍被擋");

  await browser.close();
  server.close();
  console.log("迴歸煙測全部通過 ✅");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
