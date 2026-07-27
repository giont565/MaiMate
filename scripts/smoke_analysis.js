/* Screen 4/5 smoke：路由、Job 恢復、結果真實性、修正隔離、錯誤狀態、A11y 與 RWD。 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4",
};
const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/onboarding.html" : req.url.split("?")[0];
  const file = path.join(ROOT, requestPath);
  fs.readFile(file, (error, buffer) => {
    if (error) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buffer);
  });
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validState(overrides) {
  const now = Date.now();
  return Object.assign({
    currentScreen: 4,
    consent: {
      consentVersion: "demo-1.0",
      requiredScopes: ["portfolio", "transactions"],
      optionalScopes: ["fundingHistory"],
      grantedScopes: ["portfolio", "transactions", "fundingHistory"],
      source: "demo",
      grantedAt: new Date(now).toISOString(),
    },
    portfolioSource: "mock",
    profile: {
      questionnaireVersion: "demo-1.0",
      experienceLevel: "exploring",
      investmentGoals: ["longTermGrowth", "steadyHabit"],
      holdingHorizon: "mediumLong",
      volatilityResponse: "investigate",
      helpPriorities: ["riskAlerts", "planReview", "dailyDigest"],
      communicationStyle: "concise",
      status: "completed",
      completedAt: new Date(now).toISOString(),
    },
    demoSession: {
      id: "obs_demo_smoke",
      dataVersion: "steady-planner-existing-8-v1",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
    },
  }, overrides || {});
}

async function seed(page, value) {
  await page.goto(page.base + "/onboarding.html#/consent");
  await page.evaluate((state) => {
    localStorage.clear();
    localStorage.setItem("mm_onboarding", JSON.stringify(state));
  }, value);
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mm_onboarding") || "{}"));
}

async function openResult(page) {
  await page.goto(page.base + "/onboarding.html#/profile-result");
  await page.waitForSelector("#profile-result-content:not([hidden])");
}

async function assertNoHorizontalScroll(page, width) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 844 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > width) throw new Error(`${width}px 出現水平捲動：${scrollWidth}`);
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    try { browser = await chromium.launch(); }
    catch (error) {
      if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
      else throw error;
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.base = base;
    await page.route("**/api/v1/**", (route) => route.abort());

    // 1. Screen 5 Session／授權／問卷 Route Guard。
    await seed(page, {});
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForURL(/welcome\.html$/);
    const invalidSession = validState();
    invalidSession.demoSession.expiresAt = "not-a-date";
    await seed(page, invalidSession);
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForURL(/welcome\.html$/);
    await seed(page, validState({ consent: undefined }));
    await page.goto(`${base}/onboarding.html#/analyzing`);
    await page.waitForFunction(() => location.hash === "#/consent");
    await seed(page, validState({ profile: { questionnaireVersion: "demo-1.0", status: "inProgress" } }));
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForFunction(() => location.hash === "#/profile");
    console.log("1 Route Guard OK：Screen 5 無 Session→Screen 1；未授權→Screen 2；問卷未完成→Screen 3");

    // 1b. PR #28 舊版合法狀態沒有 demoSession 時應就地遷移，不誤判過期。
    const legacyState = validState();
    delete legacyState.demoSession;
    await seed(page, legacyState);
    await page.goto(`${base}/onboarding.html#/analyzing`);
    await page.waitForSelector(".analysis-stage.running");
    let saved = await readState(page);
    if (!saved.demoSession || saved.demoSession.dataVersion !== "steady-planner-existing-8-v1" ||
        await page.locator("#session-expired.on").count())
      throw new Error("PR #28 舊狀態缺 demoSession 時未正確遷移");
    console.log("1b Legacy State OK：缺少 demoSession 的既有合法狀態就地遷移，不清除授權／問卷");

    // 2–4. 建立 Job、同版本不重複、刷新恢復；running 不能進 Screen 5。
    await seed(page, validState());
    await page.goto(`${base}/onboarding.html#/analyzing`);
    await page.waitForSelector(".analysis-stage.running");
    saved = await readState(page);
    const firstJobId = saved.analysisJob.id;
    if (!firstJobId || saved.analysisJob.dataVersion !== "steady-planner-existing-8-v1") throw new Error("Analysis Job 建立異常");
    await page.evaluate(() => { location.hash = "#/profile-result"; });
    await page.waitForFunction(() => location.hash === "#/analyzing");
    await page.reload();
    await page.waitForSelector(".analysis-stage.running, .analysis-stage.completed");
    saved = await readState(page);
    if (saved.analysisJob.id !== firstJobId) throw new Error("刷新後重複建立 Job");
    console.log("2–4 Job OK：建立一次、running 阻擋 Screen 5、刷新恢復同一 Job");

    // 5–9. 完成後正確顯示 Result，所有數字只來自現有 8 筆 Mock。
    await page.waitForFunction(() => location.hash === "#/profile-result", null, { timeout: 7000 });
    await page.waitForSelector("#profile-result-content:not([hidden])");
    saved = await readState(page);
    const completedBase = clone(saved);
    if (saved.analysisJob.id !== firstJobId || saved.analysisJob.status !== "succeeded") throw new Error("分析完成 Job 異常");
    if (saved.profileResult.coverage.transactionCount !== 8 || saved.profileResult.coverage.questionnaireAnswerCount !== 6) throw new Error("Coverage 數量異常");
    const allocation = saved.profileResult.dimensions.find((item) => item.key === "allocationPattern");
    const evidenceText = allocation.evidence.map((item) => item.value).join("/");
    if (!evidenceText.includes("52%") || !evidenceText.includes("72%") || evidenceText.includes("78%")) throw new Error(`配置證據異常：${evidenceText}`);
    const holding = saved.profileResult.dimensions.find((item) => item.key === "holdingPattern");
    const volatility = saved.profileResult.dimensions.find((item) => item.key === "volatilityBehavior");
    if (holding.dataSufficient || volatility.dataSufficient || !holding.descriptor.includes("更多資料")) throw new Error("資料不足面向被硬產生結論");
    const resultText = await page.locator("#profile-result-content").innerText();
    if (!resultText.includes(saved.profileResult.profileHeadline) || !resultText.includes(saved.profileResult.summary)) throw new Error("Headline 或 Summary 未呈現 API 結果");
    if (!resultText.includes("示範資料") || !resultText.includes("8 筆交易") || !resultText.includes("4 項持有資產") || !resultText.includes("6 題補充回答")) throw new Error("動態 Coverage Chips 或示範標示缺失");
    if (/48 筆|96 天|1\.6 倍|前兩項.*78%/.test(resultText)) throw new Error("頁面出現規格範例的虛構數字");
    const tagCount = await page.locator("#profile-tags .profile-tag").count();
    if (tagCount < 3 || tagCount > 5) throw new Error(`Profile Tags 數量異常：${tagCount}`);
    console.log("5–9 Result OK：Headline／Summary／Tags／8 筆／52%／72% 可追溯；不足處不補造");

    // 10. 四張 reusable Dimension 可展開、Evidence 有來源、Accordion ARIA 完整。
    const cards = page.locator(".dimension");
    if (await cards.count() !== 4) throw new Error("Profile Dimension 不是四張");
    for (let index = 0; index < 4; index += 1) {
      const card = cards.nth(index);
      const toggle = card.locator(".dimension-toggle");
      const controls = await toggle.getAttribute("aria-controls");
      if (!controls || await page.locator("#" + controls).count() !== 1) throw new Error("Dimension 缺 aria-controls 對應 panel");
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await card.locator(".dimension-body").waitFor({ state: "visible" });
      if (!await card.locator(".dimension-body").isVisible()) throw new Error(`Dimension ${index + 1} 無法展開`);
    }
    const sourceCount = await page.locator(".evidence small").count();
    if (sourceCount < 4) throw new Error("Evidence 缺資料來源");
    const accordionA11y = await page.evaluate(() => {
      const body = document.querySelector(".dimension-body");
      return {
        transition: getComputedStyle(body).transitionDuration,
        overallRole: document.getElementById("overall-options").getAttribute("role"),
        overallLabelledBy: document.getElementById("overall-options").getAttribute("aria-labelledby"),
      };
    });
    if (!accordionA11y.transition.includes("0.2s") || accordionA11y.overallRole !== "group" || accordionA11y.overallLabelledBy !== "overall-title")
      throw new Error("Dimension 動畫或整體回饋群組語意缺失");
    console.log("10 Dimension OK：四張皆可展開，Evidence 與來源可讀，ARIA panel 對應完整");

    // 11. 分析依據由 Result/Coverage 產生，Sheet 管理焦點並復原。
    await page.click("#header-profile-basis");
    await page.waitForFunction(() => document.getElementById("basis-root").classList.contains("sheet-open"));
    const basis = await page.locator("#basis-content").innerText();
    if (!basis.includes("8 筆交易紀錄") || !basis.includes("4 項") || !basis.includes(saved.profileResult.resultVersion) ||
        !basis.includes("資料完整程度") || basis.includes("Internal Job ID")) throw new Error("分析依據內容異常");
    const focusInSheet = await page.evaluate(() => document.getElementById("basis-root").contains(document.activeElement));
    if (!focusInSheet) throw new Error("Bottom Sheet 開啟後焦點未移入");
    await page.keyboard.press("Shift+Tab");
    if (!await page.evaluate(() => document.getElementById("basis-root").contains(document.activeElement))) throw new Error("Bottom Sheet 焦點逸出");
    await page.keyboard.press("Escape");
    if (await page.evaluate(() => document.activeElement.id) !== "header-profile-basis") throw new Error("Bottom Sheet 關閉後未復原焦點");
    const usageTrigger = page.locator(".footer-links [data-usage]");
    await usageTrigger.click();
    await page.waitForFunction(() => document.getElementById("usage-root").classList.contains("sheet-open"));
    if (!await page.evaluate(() => document.getElementById("usage-root").contains(document.activeElement))) throw new Error("資料使用 Sheet 未接上焦點管理");
    await page.keyboard.press("Escape");
    if (!await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-usage"))) throw new Error("資料使用 Sheet 未復原焦點");
    console.log("11 Basis/Usage Sheet OK：內容動態、無內部識別碼，焦點可限制並復原");

    // 12. Screen 5 返回 Screen 4 只查看已完成結果，不重跑分析。
    await page.click("#btn-back");
    await page.waitForFunction(() => location.hash === "#/analyzing");
    await page.waitForSelector("#analysis-complete.on");
    saved = await readState(page);
    if (saved.analysisJob.id !== firstJobId || saved.analysisJob.status !== "succeeded") throw new Error("返回 Screen 4 後重跑分析");
    await page.click("#btn-view-result");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#/analyzing");
    await page.waitForSelector("#analysis-complete.on");
    saved = await readState(page);
    if (saved.analysisJob.id !== firstJobId || saved.analysisJob.status !== "succeeded") throw new Error("瀏覽器返回後重跑分析");
    await page.click("#btn-view-result");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    console.log("12 返回 OK：頁首與瀏覽器返回都顯示既有完成狀態，Job ID 不變");

    // 12b. 慢速請求完成時若使用者已離開，不得把路由拉回 Screen 5。
    await page.evaluate(() => {
      const profile = window.MM_INVESTMENT_SERVICES.profile;
      const original = profile.getProfileResult.bind(profile);
      profile.getProfileResult = async () => {
        await new Promise((resolve) => { window.__releaseSlowProfileProbe = resolve; });
        profile.getProfileResult = original;
        return original();
      };
      location.hash = "#/analyzing";
    });
    await page.waitForFunction(() => typeof window.__releaseSlowProfileProbe === "function");
    await page.evaluate(() => { location.hash = "#/profile"; });
    await page.waitForFunction(() => location.hash === "#/profile");
    await page.evaluate(() => window.__releaseSlowProfileProbe());
    await page.waitForTimeout(120);
    if (!page.url().endsWith("#/profile")) throw new Error("離開 Screen 4 後，慢速請求仍改寫路由");
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForSelector("#profile-result-content:not([hidden])");
    console.log("12b Async Route OK：離開 Screen 4 後忽略晚到的請求結果");

    // 13–16. Correction：穩定代碼、200 字、失敗保留、原始／有效樣貌分離。
    const originalAllocationDescriptor = completedBase.profileResult.dimensions.find((item) => item.key === "allocationPattern").descriptor;
    await page.locator('[data-dimension="allocationPattern"] [data-feedback="partiallyAccurate"]').click();
    await page.waitForFunction(() => document.getElementById("correction-root").classList.contains("sheet-open"));
    if (await page.locator("#correction-options button").count() !== 5) throw new Error("配置修正選項不完整");
    if (await page.locator("#correction-options").getAttribute("role") !== "group" ||
        await page.locator("#correction-options").getAttribute("aria-labelledby") !== "correction-sheet-title")
      throw new Error("Correction options 缺可存取群組名稱");
    await page.click('[data-correction="temporary_state"]');
    await page.fill("#correction-note", "這是近期配置調整。".repeat(30));
    const noteLength = await page.inputValue("#correction-note").then((value) => value.length);
    if (noteLength !== 200 || await page.locator("#correction-count").innerText() !== "0") throw new Error("自由文字未限制 200 字或剩餘字數錯誤");
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(true));
    await page.click("#btn-save-correction");
    await page.waitForFunction(() => document.getElementById("correction-error").textContent.includes("內容還在"));
    if ((await page.inputValue("#correction-note")).length !== 200) throw new Error("回饋失敗後自由文字消失");
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(false));
    await page.click("#btn-save-correction");
    await page.waitForFunction(() => !document.getElementById("correction-root").classList.contains("sheet-open"));
    saved = await readState(page);
    const correction = saved.profileFeedback.allocationPattern;
    const effectiveAllocation = saved.effectiveProfile.dimensions.find((item) => item.key === "allocationPattern");
    if (correction.feedbackValue !== "partiallyAccurate" || correction.selectedCorrection !== "temporary_state") throw new Error("Correction 未使用穩定資料值");
    if (saved.profileResult.dimensions.find((item) => item.key === "allocationPattern").descriptor !== originalAllocationDescriptor) throw new Error("Correction 覆寫了原始分析");
    if (!effectiveAllocation.correctionApplied || effectiveAllocation.effectiveDescriptor === originalAllocationDescriptor) throw new Error("Effective Profile 未真正套用修正");
    if (await page.locator('[data-dimension="allocationPattern"] .dim-desc').innerText() !== effectiveAllocation.effectiveDescriptor ||
        !await page.locator("#profile-headline").innerText().then((text) => text.includes("補充的情境")))
      throw new Error("Screen 5 未顯示 effectiveProfile");
    if (!await page.locator("#btn-profile-confirm").innerText().then((text) => text.includes("儲存樣貌"))) throw new Error("有修正時 CTA 未更新");
    console.log("13–16 Correction OK：穩定代碼／200 字／失敗保留；original 不變、effective 套用修正");

    // 17. 一般 Feedback 失敗仍保留選擇並可重送。
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(true));
    await page.locator('[data-dimension="tradingRhythm"] [data-feedback="accurate"]').click();
    await page.waitForFunction(() => document.querySelector('[data-dimension="tradingRhythm"] .feedback-status').textContent.includes("選擇還在"));
    if (await page.locator('[data-dimension="tradingRhythm"] [data-feedback="accurate"]').getAttribute("aria-pressed") !== "true") throw new Error("Feedback 失敗後 optimistic 選擇消失");
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(false));
    await page.locator('[data-dimension="tradingRhythm"] .feedback-status button').click();
    await page.waitForFunction(() => document.querySelector('[data-dimension="tradingRhythm"] .feedback-status').textContent.includes("已記下"));
    saved = await readState(page);
    if (saved.profileFeedback.tradingRhythm.feedbackValue !== "accurate") throw new Error("Feedback 重送未保存");
    if (saved.effectiveProfile.userCorrections.length !== 1 ||
        saved.effectiveProfile.userCorrections[0].dimensionKey !== "allocationPattern")
      throw new Error("accurate/unsure 被誤存為 UserProfileCorrection");
    console.log("17 Feedback OK：失敗時選擇不消失，恢復後可重新送出");

    // 18. 整體回饋獨立保存；需要調整會導向尚未回饋面向。
    await page.locator("#overall-feedback-card").scrollIntoViewIfNeeded();
    await page.click('[data-overall="needsRevision"]');
    await page.waitForFunction(() => document.getElementById("overall-feedback-status").textContent.includes("已記下"));
    saved = await readState(page);
    if (saved.overallFeedback.value !== "needsRevision" || saved.profileFeedback.overallFeedback) throw new Error("整體與單一面向回饋未分開保存");
    console.log("18 Overall Feedback OK：獨立保存，needsRevision 觸發未回饋面向定位");

    // 18b. 儲存中的回饋只送一次，終止操作會等待並互斥。
    await seed(page, completedBase);
    await openResult(page);
    await page.evaluate(() => {
      const profile = window.MM_INVESTMENT_SERVICES.profile;
      const originalDimension = profile.submitDimensionFeedback.bind(profile);
      const originalOverall = profile.submitOverallFeedback.bind(profile);
      const originalConfirm = profile.confirmProfile.bind(profile);
      const timeline = { dimensionCalls: 0, overallCalls: 0, confirmCalls: 0, events: [] };
      const saveTimeline = () => sessionStorage.setItem("smoke_feedback_timeline", JSON.stringify(timeline));
      profile.submitDimensionFeedback = async (...args) => {
        timeline.dimensionCalls += 1;
        timeline.events.push("dimension:start");
        saveTimeline();
        await new Promise((resolve) => { window.__releaseDimensionFeedback = resolve; });
        timeline.events.push("dimension:end");
        saveTimeline();
        return originalDimension(...args);
      };
      profile.submitOverallFeedback = async (...args) => {
        timeline.overallCalls += 1;
        timeline.events.push("overall:start");
        saveTimeline();
        await new Promise((resolve) => { window.__releaseOverallFeedback = resolve; });
        timeline.events.push("overall:end");
        saveTimeline();
        return originalOverall(...args);
      };
      profile.confirmProfile = async (...args) => {
        timeline.confirmCalls += 1;
        timeline.events.push("confirm");
        saveTimeline();
        return originalConfirm(...args);
      };
      saveTimeline();
    });
    await page.locator('[data-dimension="tradingRhythm"] [data-feedback="accurate"]').click();
    await page.click('[data-overall="mostlyAccurate"]');
    await page.waitForFunction(() => typeof window.__releaseDimensionFeedback === "function" && typeof window.__releaseOverallFeedback === "function");
    if (!await page.locator('[data-dimension="allocationPattern"] [data-feedback="accurate"]').isDisabled() ||
        !await page.locator('[data-overall="accurate"]').isDisabled())
      throw new Error("回饋送出中仍可跨面向或快速切換選項");
    await page.click("#btn-profile-confirm");
    await page.waitForTimeout(80);
    const waitingTimeline = await page.evaluate(() => JSON.parse(sessionStorage.getItem("smoke_feedback_timeline")));
    if (waitingTimeline.dimensionCalls !== 1 || waitingTimeline.overallCalls !== 1 || waitingTimeline.confirmCalls !== 0 ||
        !await page.locator("#btn-profile-later").isDisabled())
      throw new Error("確認未等待既有回饋，或終止操作未互斥");
    await page.evaluate(() => {
      window.__releaseDimensionFeedback();
      window.__releaseOverallFeedback();
    });
    await page.waitForURL(/home\.html\?src=onboarding/);
    const completedTimeline = await page.evaluate(() => JSON.parse(sessionStorage.getItem("smoke_feedback_timeline")));
    if (completedTimeline.confirmCalls !== 1 ||
        completedTimeline.events.indexOf("confirm") < completedTimeline.events.indexOf("dimension:end") ||
        completedTimeline.events.indexOf("confirm") < completedTimeline.events.indexOf("overall:end"))
      throw new Error("回饋完成前送出 confirm，或 confirm 重複送出");
    console.log("18b Request Coordination OK：Dimension/Overall 各送一次，Confirm 等待完成且與稍後操作互斥");

    // 19. 首次未選 Overall，主 CTA 依 3A 自動存 accurate，並使用 Service nextRoute。
    await seed(page, completedBase);
    await openResult(page);
    await page.click("#btn-profile-confirm");
    await page.waitForURL(/home\.html\?src=onboarding/);
    saved = await readState(page);
    if (saved.overallFeedback.value !== "accurate" || saved.profileResult.status !== "confirmed" || !saved.profileResult.confirmedAt ||
        saved.currentScreen !== 6 || saved.profileConfirmationReminder) throw new Error("預設 accurate 或確認狀態未保存");
    if (!saved.effectiveProfile || saved.effectiveProfile.originalResultId !== saved.profileResult.id) throw new Error("確認時未建立 effectiveProfile");
    console.log("19 Confirm OK：未選整體回饋→accurate；Service nextRoute→Screen 6；effectiveProfile 已建立");

    // 20. 已確認結果可重看，CTA 更新且刷新仍 confirmed。
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForSelector("#profile-result-content:not([hidden])");
    if (await page.locator("#btn-profile-confirm").innerText() !== "進入我的 MaiMate" || !await page.locator("#btn-profile-later").isHidden()) throw new Error("已確認 CTA 狀態異常");
    await page.reload();
    await page.waitForSelector("#profile-result-content:not([hidden])");
    saved = await readState(page);
    if (saved.profileResult.status !== "confirmed" || await page.locator("#btn-profile-confirm").innerText() !== "進入我的 MaiMate") throw new Error("刷新後 confirmed 狀態遺失");
    await page.locator('[data-dimension="allocationPattern"] .dimension-toggle').click();
    await page.locator('[data-dimension="allocationPattern"] [data-feedback="partiallyAccurate"]').click();
    await page.click('[data-correction="temporary_state"]');
    await page.click("#btn-save-correction");
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem("mm_onboarding") || "{}");
      return state.profileResult && state.profileResult.status === "revised";
    });
    if (!await page.locator("#btn-profile-confirm").innerText().then((text) => text.includes("儲存樣貌")) ||
        await page.locator("#btn-profile-later").isHidden())
      throw new Error("已確認結果修正後仍顯示 confirmed CTA");
    await page.locator('[data-dimension="allocationPattern"] [data-feedback="accurate"]').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem("mm_onboarding") || "{}");
      return state.profileResult && state.profileResult.status === "confirmed" &&
        state.effectiveProfile && state.effectiveProfile.userCorrections.length === 0;
    });
    if (await page.locator("#btn-profile-confirm").innerText() !== "進入我的 MaiMate") throw new Error("移除全部修正後未恢復 confirmed CTA");
    console.log("20 Confirmed 回訪 OK：CTA 動態更新，刷新後狀態保留");

    // 20b. 修改授權範圍會讓舊 Analysis/Result 失效，不沿用舊樣貌。
    await seed(page, completedBase);
    await openResult(page);
    await page.click("#footer-consent-settings");
    await page.waitForFunction(() => location.hash === "#/consent");
    await page.uncheck('input[data-scope="fundingHistory"]');
    if (!await page.locator("#btn-consent").innerText().then((text) => text.includes("儲存授權設定"))) throw new Error("授權異動 CTA 未更新");
    await page.click("#btn-consent");
    await page.waitForFunction(() => location.hash === "#/profile");
    saved = await readState(page);
    if (saved.analysisJob || saved.profileResult || saved.consent.grantedScopes.includes("fundingHistory")) throw new Error("授權異動後沿用舊 Analysis/Result");
    console.log("20b 授權更新 OK：新 scopes 保存，舊 Job/Result/effectiveProfile 全部失效");

    // 21. 稍後確認仍進 Screen 6，保持 draft 並建立 effective/reminder。
    await seed(page, completedBase);
    await openResult(page);
    await page.click("#btn-profile-later");
    await page.waitForURL(/home\.html\?src=onboarding/);
    saved = await readState(page);
    if (saved.profileResult.status !== "draft" || !saved.profileConfirmationReminder || !saved.effectiveProfile || saved.currentScreen !== 6)
      throw new Error("稍後確認沒有保留 draft/effective/reminder");
    console.log("21 Continue OK：draft 保留、effective 建立、Screen 6 reminder 狀態已存");

    // 22. Result 載入失敗有重試；選擇連線恢復後可載入。
    await seed(page, completedBase);
    await openResult(page);
    await page.evaluate(async () => {
      window.MM_INVESTMENT_SERVICES.setFailureMode(true);
      await window.MM_ANALYSIS_UI.renderProfileResult();
    });
    await page.waitForSelector("#profile-result-load-error:not([hidden])");
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(false));
    await page.click("#btn-profile-reload");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    console.log("22 Load Error OK：結果保留、錯誤狀態可重新載入");

    // 23. Job succeeded 但 Result 不存在，只重建結果、不重新分析。
    const missingResult = clone(completedBase);
    delete missingResult.profileResult;
    delete missingResult.profileFeedback;
    delete missingResult.effectiveProfile;
    await seed(page, missingResult);
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForSelector("#profile-result-missing:not([hidden])");
    const completedJobId = missingResult.analysisJob.id;
    await page.click("#btn-profile-missing-back");
    await page.waitForFunction(() => location.hash === "#/analyzing");
    await page.waitForSelector("#analysis-complete.on");
    saved = await readState(page);
    if (saved.analysisJob.id !== completedJobId || saved.profileResult) throw new Error("完成 Job 缺 Result 時，返回 Screen 4 自動重跑或重建");
    await page.click("#btn-view-result");
    await page.waitForSelector("#profile-result-missing:not([hidden])");
    await page.click("#btn-profile-rebuild");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    saved = await readState(page);
    if (saved.analysisJob.id !== completedJobId || saved.analysisJob.status !== "succeeded" || !saved.profileResult) throw new Error("Result 重建時重跑了分析");
    console.log("23 Missing Result OK：重建 deterministic result，未重跑原始資料");

    // 24. Job failed 且無舊結果顯示失敗狀態，可選展示結果。
    const failedState = clone(missingResult);
    failedState.analysisJob.status = "failed";
    failedState.analysisJob.errorCode = "DEMO_ANALYSIS_UNAVAILABLE";
    await seed(page, failedState);
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForSelector("#profile-result-missing:not([hidden])");
    if (!await page.locator("#profile-missing-title").innerText().then((text) => text.includes("沒有分析完成"))) throw new Error("failed/no result 未顯示指定狀態");
    const failedJobId = failedState.analysisJob.id;
    await page.click("#btn-profile-missing-back");
    await page.waitForFunction(() => location.hash === "#/analyzing");
    await page.waitForSelector("#analysis-error.on");
    saved = await readState(page);
    if (saved.analysisJob.id !== failedJobId || saved.analysisJob.status !== "failed") throw new Error("Failed Job 刷新／返回後被自動重試");
    await page.evaluate(() => window.MM_INVESTMENT_SERVICES.setFailureMode(true));
    await page.click("#btn-analysis-fallback");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    saved = await readState(page);
    if (saved.profileResult.generatedBy !== "fallbackTemplate") throw new Error("展示結果未標示 fallbackTemplate");
    console.log("24 Failed State OK：不露內部錯誤，可使用展示結果");

    const previousResultState = clone(completedBase);
    previousResultState.analysisJob.id = "analysis_failed_new";
    previousResultState.analysisJob.status = "failed";
    previousResultState.analysisJob.errorCode = "DEMO_ANALYSIS_UNAVAILABLE";
    await seed(page, previousResultState);
    await page.goto(`${base}/onboarding.html#/analyzing`);
    await page.waitForSelector("#analysis-error.on");
    if (!await page.locator("#analysis-error-title").innerText().then((text) => text.includes("最新分析暫時沒有完成")) ||
        await page.locator("#btn-analysis-fallback").innerText() !== "查看上次結果")
      throw new Error("Failed Job 有舊結果時未提供查看上次結果狀態");
    const previousProfileId = previousResultState.profileResult.id;
    await page.click("#btn-analysis-fallback");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    saved = await readState(page);
    if (saved.profileResult.id !== previousProfileId || saved.profileResult.generatedBy === "fallbackTemplate")
      throw new Error("查看上次結果時覆寫了既有 Profile Result");
    if (!await page.locator("#profile-data-chips").innerText().then((text) => text.includes("上次成功整理結果")))
      throw new Error("failed job 的合法舊結果未明確標示");
    console.log("24b Old Result OK：只接受同 dataVersion 舊結果，並明確標示");

    // 25. Limited Coverage 使用初步樣貌，不用假數字補滿。
    const limitedState = clone(missingResult);
    await seed(page, limitedState);
    await page.goto(`${base}/onboarding.html#/profile-result`);
    await page.waitForSelector("#profile-result-missing:not([hidden])");
    await page.evaluate(() => {
      window.__smokeTransactions = window.MM_ONBOARDING_MOCK.demoTransactions;
      window.__smokePortfolio = window.MM_ONBOARDING_MOCK.demoPortfolio;
      window.MM_ONBOARDING_MOCK.demoTransactions = [];
      window.MM_ONBOARDING_MOCK.demoPortfolio = null;
    });
    await page.click("#btn-profile-rebuild");
    await page.waitForSelector("#profile-result-content:not([hidden])");
    const limitedText = await page.locator("#profile-result-content").innerText();
    saved = await readState(page);
    if (saved.profileResult.coverage.coverage !== "limited" || !limitedText.includes("初步樣貌") || !limitedText.includes("還需要更多資料"))
      throw new Error("Limited Coverage 呈現異常");
    if (/48 筆|96 天|1\.6 倍|0 筆|0 個日期/.test(limitedText)) throw new Error("Limited Coverage 把未知資料顯示成零或虛構結論");
    await page.click("#header-profile-basis");
    const limitedBasis = await page.locator("#basis-content").innerText();
    if (!limitedBasis.includes("持有資產：未使用持倉資料") || limitedBasis.includes("持有資產：0 項"))
      throw new Error("Limited Basis 把未使用持倉資料顯示成 0 項");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.MM_ONBOARDING_MOCK.demoTransactions = window.__smokeTransactions;
      window.MM_ONBOARDING_MOCK.demoPortfolio = window.__smokePortfolio;
      delete window.__smokeTransactions;
      delete window.__smokePortfolio;
    });
    console.log("25 Limited OK：資料不足顯示初步樣貌，沒有空白假數據");

    // 26. 375/390 無橫捲，Sticky CTA 不遮最後一段；reduced-motion 不自動延遲跳頁。
    await seed(page, completedBase);
    await openResult(page);
    for (const width of [375, 390]) await assertNoHorizontalScroll(page, width);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const overlap = await page.evaluate(() => {
      const footer = document.querySelector(".footer-note").getBoundingClientRect();
      const sticky = document.getElementById("profile-result-actions").getBoundingClientRect();
      return footer.bottom > sticky.top + 1;
    });
    if (overlap) throw new Error("Sticky CTA 遮住頁尾內容");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, validState());
    await page.goto(`${base}/onboarding.html#/analyzing`);
    await page.waitForSelector("#analysis-complete.on", { timeout: 7000 });
    await page.waitForTimeout(900);
    if (!page.url().endsWith("#/analyzing") || !await page.locator("#btn-view-result").isVisible()) throw new Error("reduced-motion 下仍自動跳頁或 CTA 不可操作");
    console.log("26 RWD/A11y OK：375/390 無橫捲、Sticky 不遮內容、reduced-motion 不自動跳頁");

    // 27. Analytics 只允許事件名／questionId。
    const events = await page.evaluate(() => JSON.parse(localStorage.getItem("mm_events") || "[]"));
    for (const event of events) {
      if (Object.keys(event).some((key) => !["e", "q", "src", "intent", "tool", "style", "status", "guard"].includes(key))) throw new Error("Analytics 出現未允許欄位");
    }
    const serializedEvents = JSON.stringify(events);
    if (/analysis_demo|obs_demo|temporary_state|近期配置|BTC|372000|api.?key|prompt/i.test(serializedEvents))
      throw new Error("Analytics 含識別碼、修正、金融或敏感內容");
    console.log("27 Analytics OK：僅事件名／questionId，不含 timestamp、metadata 或自由文字");

    // 27b. 正式 Analysis Adapter 將精簡 POST 回應正規化並保存為共用 AnalysisJob。
    const formalAnalysisCalls = [];
    const formalAnalysisPattern = "**/api/v1/maimate/analysis-jobs**";
    await page.route(formalAnalysisPattern, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      formalAnalysisCalls.push({ method: request.method(), pathname });
      const body = request.method() === "POST"
        ? {
            analysisJobId: "analysis_formal_001",
            status: "queued",
            progress: 0,
            currentStage: "dataPreparation",
            nextRoute: "/maimate/analyzing",
          }
        : {
            id: "analysis_formal_001",
            status: "running",
            progress: 60,
            currentStage: "behaviorAnalysis",
            stages: [
              { key: "dataPreparation", status: "completed" },
              { key: "portfolioAnalysis", status: "completed" },
              { key: "behaviorAnalysis", status: "running" },
              { key: "questionnaireMerge", status: "pending" },
              { key: "profileGeneration", status: "pending" },
            ],
          };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const formalAnalysisValue = await page.evaluate(async () => {
      const analysis = window.MM_INVESTMENT_SERVICES.formalAdapters.analysis;
      const started = await analysis.startAnalysis({
        onboardingSessionId: "obs_formal",
        consentVersion: "demo-1.0",
        questionnaireVersion: "demo-1.0",
        dataVersion: "formal-data-v1",
      });
      const polled = await analysis.getAnalysisJob(started.id);
      return {
        started,
        polled,
        stored: JSON.parse(localStorage.getItem("mm_onboarding") || "{}").analysisJob,
      };
    });
    await page.unroute(formalAnalysisPattern);
    if (formalAnalysisCalls.length !== 2 || formalAnalysisCalls[0].method !== "POST" || formalAnalysisCalls[1].method !== "GET" ||
        formalAnalysisValue.started.id !== "analysis_formal_001" || formalAnalysisValue.started.stages.length !== 5 ||
        formalAnalysisValue.started.dataVersion !== "formal-data-v1" || formalAnalysisValue.polled.progress !== 60 ||
        formalAnalysisValue.polled.stages[2].status !== "running" || formalAnalysisValue.stored.id !== "analysis_formal_001")
      throw new Error("正式 Analysis Adapter 未正規化／保存 API 回應");
    console.log("27b Analysis API OK：精簡 POST 與完整 GET 都正規化為共用 AnalysisJob 並保存");

    // 28. 正式 API Adapter 的 method/path/body 對齊 contract，不外送 client-only createdAt。
    const formalCalls = [];
    const formalPattern = "**/api/v1/maimate/profile-results/**";
    await page.route(formalPattern, async (route) => {
      const request = route.request();
      formalCalls.push({
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        body: request.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profileResult: {}, effectiveProfile: {}, saved: true, nextRoute: "/maimate/home" }),
      });
    });
    await page.evaluate(async () => {
      const profile = window.MM_INVESTMENT_SERVICES.formalAdapters.profile;
      await profile.submitDimensionFeedback("profile demo", "allocationPattern", {
        value: "partiallyAccurate",
        selectedCorrection: "temporary_state",
        note: "補充",
        createdAt: "client-only",
      });
      await profile.submitOverallFeedback("profile demo", { value: "mostlyAccurate", createdAt: "client-only" });
      await profile.confirmProfile("profile demo", { overallFeedback: "mostlyAccurate", acceptEffectiveProfile: true });
      await profile.continueWithoutConfirmation("profile demo");
    });
    await page.unroute(formalPattern);
    if (formalCalls.length !== 4 ||
        formalCalls[0].method !== "PATCH" || !formalCalls[0].pathname.endsWith("/dimensions/allocationPattern") ||
        "createdAt" in formalCalls[0].body ||
        formalCalls[1].method !== "PATCH" || !formalCalls[1].pathname.endsWith("/feedback") ||
        formalCalls[2].method !== "POST" || !formalCalls[2].pathname.endsWith("/confirm") ||
        formalCalls[2].body.acceptEffectiveProfile !== true ||
        formalCalls[3].method !== "POST" || !formalCalls[3].pathname.endsWith("/continue"))
      throw new Error("正式 Profile API Adapter contract 不一致");
    console.log("28 API Contract OK：PATCH/POST adapters 的 path、method、body 對齊規格");

    // 28b. 正式 GET 同時支援 raw result、context envelope 與不存在結果。
    let formalGetReply = { status: 200, body: JSON.stringify(completedBase.profileResult) };
    const formalGetPattern = "**/api/v1/maimate/profile-result";
    await page.route(formalGetPattern, async (route) => {
      const fulfill = { status: formalGetReply.status };
      if (formalGetReply.body !== undefined) {
        fulfill.contentType = "application/json";
        fulfill.body = formalGetReply.body;
      }
      await route.fulfill(fulfill);
    });
    let formalGetValue = await page.evaluate(() => window.MM_INVESTMENT_SERVICES.formalAdapters.profile.getProfileResult());
    if (!formalGetValue || formalGetValue.id !== completedBase.profileResult.id) throw new Error("正式 GET 無法讀取 raw Profile Result");
    const formalCorrection = {
      id: "correction_formal",
      resultId: completedBase.profileResult.id,
      dimensionKey: "allocationPattern",
      feedbackValue: "partiallyAccurate",
      selectedCorrection: "temporary_state",
      createdAt: new Date().toISOString(),
    };
    const effectiveProfile = {
      originalResultId: completedBase.profileResult.id,
      effectiveHeadline: "已依使用者補充調整的樣貌",
      dimensions: [],
      supportPlan: [],
      userCorrections: [formalCorrection],
      updatedAt: new Date().toISOString(),
    };
    formalGetReply = {
      status: 200,
      body: JSON.stringify({
        profileResult: completedBase.profileResult,
        effectiveProfile,
        dimensionFeedback: { allocationPattern: formalCorrection },
        userCorrections: [formalCorrection],
        overallFeedback: { value: "mostlyAccurate", createdAt: new Date().toISOString() },
        profileConfirmationReminder: true,
      }),
    };
    formalGetValue = await page.evaluate(() => window.MM_INVESTMENT_SERVICES.formalAdapters.profile.getProfileContext());
    if (formalGetValue.effectiveProfile.effectiveHeadline !== effectiveProfile.effectiveHeadline ||
        formalGetValue.dimensionFeedback.length !== 1 || formalGetValue.corrections.length !== 1 ||
        formalGetValue.overallFeedback.value !== "mostlyAccurate" || !formalGetValue.profileConfirmationReminder)
      throw new Error("正式 GET envelope 未還原 effective/correction/overall context");
    for (const reply of [
      { status: 404, body: "" },
      { status: 204 },
      { status: 200, body: "" },
    ]) {
      formalGetReply = reply;
      formalGetValue = await page.evaluate(() => window.MM_INVESTMENT_SERVICES.formalAdapters.profile.getProfileContext());
      if (formalGetValue.profileResult !== null) throw new Error(`正式 GET ${reply.status} 空結果未正規化為 null`);
    }
    formalGetReply = { status: 500, body: JSON.stringify({ error: "server" }) };
    const serverErrorRejected = await page.evaluate(async () => {
      try {
        await window.MM_INVESTMENT_SERVICES.formalAdapters.profile.getProfileContext();
        return false;
      } catch (_) {
        return true;
      }
    });
    await page.unroute(formalGetPattern);
    if (!serverErrorRejected) throw new Error("正式 GET 將 500 誤判為不存在結果");
    console.log("28b Profile GET OK：raw/envelope 可讀，404/204/empty→missing，500 保持錯誤");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(page, completedBase);
    await openResult(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "smoke_profile_result.png", fullPage: true });
    await page.screenshot({ path: "smoke_analysis.png", fullPage: false });
    await browser.close();
    server.close();
    console.log("Screen 4/5 全部通過 ✅（smoke_analysis.png／smoke_profile_result.png）");
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    server.close();
    throw error;
  }
})().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
