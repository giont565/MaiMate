/* Screen 1（welcome.html）煙測：
 *   1. 首屏骨架：44px 主標／品牌 hero 圖／對話證據卡（示範資料標籤＋回覆膠囊）／CTA
 *   2. 入口狀態機：CTA 四態文案（新用戶→續接→已完成→錯誤）＋鍵盤可及
 *   3. 第二屏：授權→對答→開始 進度線、承諾摺疊（麥麥不會做的事）、法遵連結
 *   4. Help bottom sheet 開合＋法律 placeholder sheet
 *   5. 事件記錄：entry_viewed/help_opened/privacy_opened 有記、不含敏感欄位
 *   6. 360px 不跑版；API 斷線回退 mock（離線保險）；三個導向（CTA／示範帳戶／證據卡膠囊）
 * 用法：npm run smoke:welcome */
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

  // 後端斷線劇本：entry-context 一律 abort → 必須回退離線 mock（決賽保險）
  await page.route("**/entry-context*", (r) => r.abort());

  await page.goto(`${base}/welcome.html`);
  await page.waitForFunction(() => document.getElementById("btn-cta").textContent !== "載入中…");
  await page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem("mm_events") || "[]");
    events.push({ e: "legacy_event", q: "experienceLevel", t: "legacy-time", metadata: "must-be-removed" });
    localStorage.setItem("mm_events", JSON.stringify(events));
  });

  // 1. 首屏骨架
  const h2 = await page.$eval(".hero h2", (e) => e.textContent);
  if (!h2.includes("市場一直在變")) throw new Error(`Hero 標題異常：${h2}`);
  const heroImg = await page.$eval(".stage .avatar", (e) => ({ src: e.src, w: e.naturalWidth }));
  if (!heroImg.src.includes("maimate_hero.png") || heroImg.w !== 290) throw new Error(`hero 圖異常：${JSON.stringify(heroImg)}`);
  const bubTag = await page.$eval(".bubble .tag", (e) => e.textContent);
  if (bubTag !== "示範資料") throw new Error(`證據卡標籤異常：${bubTag}`);
  const bubMsg = await page.$eval(".bubble .msg", (e) => e.textContent);
  if (!bubMsg.includes("DOGE") || !bubMsg.includes("NT$31")) throw new Error(`證據卡訊息異常：${bubMsg}`);
  const pills = await page.$$eval(".bubble .pills button", (els) => els.map((e) => e.textContent));
  if (pills.length !== 2 || pills[0] !== "好，帶我看看") throw new Error(`回覆膠囊異常：${pills}`);
  console.log("首屏骨架 OK：44px 主標、品牌 hero 圖、證據卡（示範資料標籤＋雙膠囊）");

  // 2. 證據卡「先不用」→ 麥麥溫和回覆
  await page.click("#pill-no");
  const reply = await page.$eval("#bubble-reply", (e) => ({ txt: e.textContent, show: getComputedStyle(e).display }));
  if (reply.show === "none" || !reply.txt.includes("需要我的時候")) throw new Error(`「先不用」回覆異常：${JSON.stringify(reply)}`);
  console.log("證據卡互動 OK：「先不用」收到麥麥回覆");

  // 3. 入口動畫缺檔 → splash 不得卡住頁面
  const splashOn = await page.$eval("#splash", (e) => e.classList.contains("on"));
  if (splashOn) throw new Error("intro.mp4 不存在時 splash 不應顯示");
  console.log("splash 缺檔自動跳過 OK");

  // 4. CTA 狀態機（API 斷線→mock→新用戶）＋徽章循環＋鍵盤可及
  const cta0 = await page.$eval("#btn-cta", (e) => e.textContent);
  if (cta0 !== "開始和麥麥認識彼此") throw new Error(`新用戶 CTA 異常：${cta0}`);
  await page.click("#state-badge");
  const cta1 = await page.$eval("#btn-cta", (e) => e.textContent);
  await page.click("#state-badge");
  const cta2 = await page.$eval("#btn-cta", (e) => e.textContent);
  await page.focus("#state-badge");
  await page.keyboard.press("Enter"); // 鍵盤切到 ERROR
  const cta3 = await page.$eval("#btn-cta", (e) => e.textContent);
  const errCls = await page.$eval("#btn-cta", (e) => e.className);
  const hint = await page.$eval("#cta-hint", (e) => e.textContent);
  if (cta1 !== "繼續和麥麥認識彼此" || cta2 !== "進入我的 MaiMate" || cta3 !== "重新載入") throw new Error(`CTA 循環異常：${cta1}/${cta2}/${cta3}`);
  if (!errCls.includes("err") || !hint.includes("暫時無法確認")) throw new Error("錯誤態樣式/文案異常");
  await page.keyboard.press("Enter"); // 回到新用戶（重新載入→init→mock）
  await page.waitForFunction(() => document.getElementById("btn-cta").textContent === "開始和麥麥認識彼此");
  console.log("CTA 四態 OK：新用戶→續接→已完成→錯誤（鍵盤可切、錯誤文案對）");

  // 5. 第二屏：進度線＋承諾摺疊
  const flow = await page.$$eval(".flow .n", (els) => els.map((e) => e.textContent));
  if (flow.join("/") !== "授權/對答/開始") throw new Error(`進度線異常：${flow}`);
  const promiseOpen0 = await page.$eval("details.promise", (e) => e.open);
  if (promiseOpen0) throw new Error("承諾摺疊預設不應展開");
  await page.click("details.promise summary");
  const promise = await page.$eval("details.promise", (e) => ({ open: e.open, txt: e.textContent, n: e.querySelectorAll("li").length }));
  if (!promise.open || promise.n !== 4 || !promise.txt.includes("不會擅自替你下單") || !promise.txt.includes("不報明牌")) throw new Error(`承諾內容異常：${promise.n}`);
  console.log("第二屏 OK：授權→對答→開始、承諾摺疊×4（含不下單/不報明牌）");

  // 6. Help bottom sheet
  await page.click("#btn-help");
  await page.waitForFunction(() => document.getElementById("help-root").classList.contains("sheet-open"));
  const helpTxt = await page.$eval("#help-root .sbody", (e) => e.textContent);
  for (const key of ["麥麥可以幫你什麼", "麥麥不會做什麼", "我的資料如何使用", "我可以停止使用嗎", "不提供特定幣種的買賣推薦"])
    if (!helpTxt.includes(key)) throw new Error(`Help 缺區塊：${key}`);
  await page.click("#help-root .sfoot .btn-cta"); // 我了解了
  const helpOpen = await page.$eval("#help-root", (e) => e.classList.contains("sheet-open"));
  if (helpOpen) throw new Error("Help sheet 未關閉");
  console.log("Help sheet OK：四區塊齊、「我了解了」關閉");

  // 7. 法律 placeholder sheet
  await page.click('[data-legal="隱私說明"]');
  await page.waitForFunction(() => document.getElementById("legal-root").classList.contains("sheet-open"));
  const legalTitle = await page.$eval("#legal-title", (e) => e.textContent);
  if (legalTitle !== "隱私說明") throw new Error(`法律 sheet 標題異常：${legalTitle}`);
  await page.keyboard.press("Escape");
  const legalOpen = await page.$eval("#legal-root", (e) => e.classList.contains("sheet-open"));
  if (legalOpen) throw new Error("Esc 未關閉法律 sheet");
  console.log("法律 placeholder sheet OK（Esc 可關）");

  // 8. 事件記錄：只保留事件名，不含時間或敏感欄位
  const events = await page.evaluate(() => localStorage.getItem("mm_events") || "[]");
  for (const ev of ["maimate_entry_viewed", "maimate_help_opened", "maimate_privacy_opened", "maimate_demo_bubble_no"])
    if (!events.includes(ev)) throw new Error(`事件未記錄：${ev}`);
  const parsedEvents = JSON.parse(events);
  for (const event of parsedEvents)
    if (Object.keys(event).some((key) => !["e", "q", "src", "intent", "tool", "style", "status", "guard"].includes(key))) throw new Error("Screen 1 Analytics 出現未允許欄位");
  const cleanedLegacy = parsedEvents.find((event) => event.e === "legacy_event");
  if (!cleanedLegacy || cleanedLegacy.q !== "experienceLevel") throw new Error("Screen 1 Analytics 清洗舊格式時遺失允許的 questionId");
  if (/token|balance|volume/i.test(events)) throw new Error("事件記錄疑似含敏感欄位");
  console.log("分析事件 OK：四事件有記，且只含事件名／既有 questionId");

  // 9. 360px 不跑版
  await page.setViewportSize({ width: 360, height: 800 });
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollW > 360) throw new Error(`360px 出現橫向捲動：scrollWidth=${scrollW}`);
  await page.setViewportSize({ width: 390, height: 844 });
  console.log("360px 不跑版 OK");

  /* 9b. 觸控目標 ≥44px（#13）。
   * 熱區 = 自身盒子 ∪ ::after 覆蓋層——徽章／頁尾連結／底線文字鈕刻意保留小視覺，
   * 用透明 ::after 放大可點範圍。用 computedStyle 讀 pseudo 尺寸而不是 elementFromPoint：
   * 後者只在可視區內有效，頁尾的連結會量到錯的值（實測過，會假通過）。 */
  const taps = await page.evaluate(() => {
    const measure = (node) => {
      const rect = node.getBoundingClientRect();
      const after = getComputedStyle(node, "::after");
      return {
        w: Math.max(rect.width, parseFloat(after.width) || 0),
        h: Math.max(rect.height, parseFloat(after.height) || 0),
        rect,
      };
    };
    const label = (node) => (node.id ? "#" + node.id : node.tagName.toLowerCase()) +
      ' "' + (node.textContent || "").trim().slice(0, 10) + '"';
    const nodes = [...document.querySelectorAll("button, a, [role=button]")].filter((n) => n.offsetParent !== null);
    const zones = nodes.map((node) => ({ node, label: label(node), ...measure(node) }));
    const small = zones.filter((z) => z.h < 44 || z.w < 44)
      .map((z) => `${z.label} → ${Math.round(z.w)}x${Math.round(z.h)}`);
    /* 放大熱區最容易出的錯是「兩個控件的熱區疊在一起，點哪個都不確定」。
     * 同一個 sheet 之外的元素兩兩比對；不同 sheet 的關閉鈕會重疊是正常的
     * （同時只有一個 sheet 開著），所以用最近的 .sheet 祖先分組後排除同位比較。 */
    const clashes = [];
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i], b = zones[j];
        if (a.node.closest(".sheet") !== b.node.closest(".sheet")) continue;
        const ay = a.rect.top + a.rect.height / 2, by = b.rect.top + b.rect.height / 2;
        const ox = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const oy = Math.min(ay + a.h / 2, by + b.h / 2) - Math.max(ay - a.h / 2, by - b.h / 2);
        if (ox > 0.5 && oy > 0.5) clashes.push(`${a.label} × ${b.label} 重疊 ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }
    return { count: zones.length, small, clashes };
  });
  if (taps.small.length) throw new Error(`觸控目標小於 44px：${taps.small.join("；")}`);
  if (taps.clashes.length) throw new Error(`熱區互相重疊，點擊會不確定：${taps.clashes.join("；")}`);
  console.log(`觸控目標 OK：${taps.count} 個可點元素熱區皆 ≥44px 且互不重疊`);

  await page.screenshot({ path: "smoke_welcome.png", fullPage: true });

  // 10. 三個導向：示範帳戶／主 CTA／證據卡「好，帶我看看」（後兩者接 Screen 2 資料授權頁）
  await page.click("#btn-demo");
  await page.waitForURL(/home\.html\?demo=STEADY_PLANNER/);
  await page.goto(`${base}/welcome.html`);
  await page.waitForFunction(() => document.getElementById("btn-cta").textContent === "開始和麥麥認識彼此");
  await page.click("#btn-cta");
  await page.waitForURL(/onboarding\.html#\/consent/);
  await page.goto(`${base}/welcome.html`);
  await page.waitForFunction(() => document.getElementById("btn-cta").textContent === "開始和麥麥認識彼此");
  await page.click("#pill-yes");
  await page.waitForURL(/onboarding\.html#\/consent/);
  console.log("導向 OK：示範帳戶→home.html?demo=STEADY_PLANNER；主 CTA／「好，帶我看看」→onboarding.html#/consent");

  await browser.close();
  server.close();
  console.log("全部通過 ✅（截圖 smoke_welcome.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
