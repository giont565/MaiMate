/* Screen 6｜MaiMate 投資導航首頁煙測
 * - 自架靜態 HTTP server，不依賴正式後端。
 * - 驗證 truth-first Demo、Route Guard、模組降級、Cache、導航 Context、
 *   正式 API contract、RWD、Safe Area 與 reduced motion。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4",
};
const FIXED_NOW = "2026-07-27T09:00:00+08:00";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch (_) { res.writeHead(400); return res.end("bad request"); }
    const relative = pathname === "/" ? "welcome.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (error) {
    if (fs.existsSync("/opt/pw-browsers/chromium")) {
      return chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    }
    throw error;
  }
}

async function addFixedClock(context) {
  await context.addInitScript((fixed) => {
    const NativeDate = Date;
    const fixedTime = NativeDate.parse(fixed);
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedTime]));
      }
      static now() { return fixedTime; }
    }
    FixedDate.parse = NativeDate.parse;
    FixedDate.UTC = NativeDate.UTC;
    window.Date = FixedDate;
  }, FIXED_NOW);
}

async function openDemo(page, base) {
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector("#home-content:not([hidden])");
  await page.waitForSelector("#today-relevant-card");
}

async function state(page) {
  return page.evaluate(() => OnboardingStore.read());
}

async function clearHomeCache(page) {
  await page.evaluate(() => {
    if (window.MM_HOME_SERVICES && typeof MM_HOME_SERVICES.clearCache === "function") {
      MM_HOME_SERVICES.clearCache();
    } else {
      sessionStorage.removeItem("mm_home_cache");
    }
  });
}

function collectKeys(value, target) {
  if (!value || typeof value !== "object") return target;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, target));
    return target;
  }
  Object.entries(value).forEach(([key, child]) => {
    target.push(key);
    collectKeys(child, target);
  });
  return target;
}

(async () => {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    /* 1. 無 Session 不得進完整首頁。 */
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Taipei" });
      await addFixedClock(context);
      const page = await context.newPage();
      await page.goto(`${base}/home.html`);
      await page.waitForURL(/welcome\.html$/);
      console.log("1 Route Guard OK：無 Session → Screen 1");
      await context.close();
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "Asia/Taipei",
      reducedMotion: "reduce",
    });
    await addFixedClock(context);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    /* 2–8. Demo bootstrap、Greeting、核心模組、truth-first 數字。 */
    await openDemo(page, base);
    const bootstrapped = await state(page);
    assert(bootstrapped.currentScreen === 6, "Demo 未建立 Screen 6 狀態");
    assert(bootstrapped.demoPersonaId === "STEADY_PLANNER", "Demo Persona 未保存");
    assert(bootstrapped.analysisJob && bootstrapped.analysisJob.status === "succeeded", "Demo Analysis Job 未完成");
    assert(bootstrapped.profileResult && bootstrapped.profileResult.status === "confirmed", "Demo Profile Result 未沿用正式型別");
    assert(bootstrapped.effectiveProfile && bootstrapped.effectiveProfile.originalResultId === bootstrapped.profileResult.id,
      "Demo 未建立同一套 Effective Profile");
    assert(!pageErrors.length, `首頁載入錯誤：${pageErrors.join("；")}`);

    const greeting = await page.locator("#home-greeting-title").innerText();
    assert(greeting.includes("早安") && greeting.includes("Leon"), `上午 Greeting 錯誤：${greeting}`);
    const periods = await page.evaluate(() => ({
      morning: MM_HOME_CORE.buildGreeting("Leon", new Date("2026-07-27T09:00:00+08:00")).period,
      afternoon: MM_HOME_CORE.buildGreeting("Leon", new Date("2026-07-27T14:00:00+08:00")).period,
      evening: MM_HOME_CORE.buildGreeting("Leon", new Date("2026-07-27T20:00:00+08:00")).period,
    }));
    assert(periods.morning === "morning" && periods.afternoon === "afternoon" && periods.evening === "evening",
      `Greeting 時段錯誤：${JSON.stringify(periods)}`);
    console.log("2–3 Demo／Greeting OK：固定 Persona，同一 Profile Model，三時段正確");

    /* 期望值一律由真實帳戶（frontend/mocks/account.js ← data/health_report.json）現推，
     * 不再寫死；換一份報告時煙測會跟著換，不會退回抄舊數字。 */
    const account = await page.evaluate(() => window.MM_ACCOUNT);
    const topRatioText = String(Math.round(account.holdings.topPct * 10) / 10) + "%";
    const primaryMarketAsset = await page.evaluate(() => MM_HOME_MOCK.marketContext.primaryAsset);
    const marketChangeText = await page.evaluate(() => {
      const asset = MM_HOME_SERVICES.adapters.market.read().assets
        .find((item) => item.symbol === MM_HOME_MOCK.marketContext.primaryAsset);
      return Math.round(asset.changeRatio * 1000) / 10 + "%";
    });

    const response = await page.evaluate(() => MM_HOME_UI.getResponse());
    const module = (type) => response.modules.find((item) => item.type === type);
    const today = module("todayRelevant");
    const plan = module("planAlignment");
    const attribution = module("accountAttribution");
    const similar = module("similarMoment");
    const snapshot = module("accountSnapshot");
    assert(today && plan && attribution && similar && snapshot, "首頁核心模組缺漏");
    assert(today.payload.relatedAssets[0] === account.holdings.topCurrency.toUpperCase(),
      "Today Relevant 未連結最大持有標的（真實帳戶為現金 TWD）");
    assert(today.payload.explanation.includes(marketChangeText) && today.payload.explanation.includes(topRatioText),
      `Today Relevant 未同時包含市場與持倉證據：${today.payload.explanation}`);
    /* 市場那格必須講示範行情的主要資產，不得寫成「TWD 今日變動」（現金沒有行情）。 */
    const marketEvidence = today.payload.evidence.find((item) => item.id === "today-market-change");
    assert(marketEvidence && marketEvidence.label.startsWith(primaryMarketAsset) &&
      !marketEvidence.label.startsWith(account.holdings.topCurrency.toUpperCase()),
    `Today 市場證據仍掛在最大持有上（現金沒有行情）：${marketEvidence && marketEvidence.label}`);
    assert(today.payload.evidence.some((item) => item.id === "today-recent-trades" &&
        item.value === account.trades.latestMonthCount + " 筆" && item.label.includes(account.trades.latestMonth)) &&
      today.payload.evidence.some((item) => item.id === "today-previous-trades" &&
        item.value === account.trades.previousMonthCount + " 筆" && item.label.includes(account.trades.previousMonth)),
    `Today Relevant 未包含以「月」為單位的近期／前期行為證據：${JSON.stringify(today.payload.evidence)}`);
    assert(today.payload.impactLevels.market === "medium" &&
      today.payload.impactLevels.allocation === "high" &&
      today.payload.impactLevels.behavior === "low", "Today impact level 錯誤");
    assert(today.payload.generatedBy === "rulesAndAi", "合法 Structured Output 未通過驗證");

    assert(plan.payload.status !== "aligned" || !plan.payload.summary.includes("分數"), "Plan Alignment 不應成為評分");
    assert(plan.payload.recentBehaviorItems.some((item) =>
      item.label.includes(account.trades.latestMonth) && item.label.includes(account.trades.latestMonthCount + " 筆") &&
      item.label.includes(account.trades.previousMonth) && item.label.includes(account.trades.previousMonthCount + " 筆")),
    `Plan Alignment 沒有真實行為對照：${JSON.stringify(plan.payload.recentBehaviorItems)}`);
    assert(plan.payload.recentBehaviorItems.some((item) => item.label.includes("持有時間仍需更多")),
      "持有資料不足時仍下了結論");

    /* 有 change_attribution（issue #29 重跑後才有）就必須逐項對上報告；沒有就必須走「資料不足」。 */
    const reportAttribution = account.changeAttribution;
    if (reportAttribution) {
      const byCategory = {};
      attribution.payload.contributors.forEach((item) => { byCategory[item.category] = item; });
      /* 報告的 netDeposit 在前端對應 funding，比重必須一字不差地對上報告。 */
      const CATEGORY_MAP = { netDeposit: "funding", marketPrice: "marketPrice", realizedPnl: "recentTrades" };
      reportAttribution.contributors.forEach((source) => {
        const shown = byCategory[CATEGORY_MAP[source.category]];
        assert(shown, `歸因缺少報告有的來源：${source.category}`);
        assert(Math.round(shown.contributionRatio * 1000) / 10 === source.pct,
          `歸因比重和報告不符：${source.category} 畫面 ${shown.contributionRatio} vs 報告 ${source.pct}%`);
      });
      assert(attribution.payload.attributionType === "estimated",
        `報告標 ${reportAttribution.type}，畫面卻宣稱是精算：${attribution.payload.attributionType}`);
      assert(!attribution.payload.unavailable, "報告已有歸因值卻仍顯示資料不足");
    } else {
      assert(attribution.payload.unavailable === true && !attribution.payload.contributors,
        `報告缺明細時仍產生歸因比例：${JSON.stringify(attribution.payload)}`);
    }

    const worstSell = account.opportunityCost.worstSell;
    assert(similar.payload.historicalContext.startDate.startsWith(worstSell.date),
      `相似時刻未使用報告裡唯一有明細的那筆賣出：${similar.payload.historicalContext.startDate}`);
    const behaviorThen = similar.payload.userBehaviorThen.join("");
    assert(behaviorThen.includes(worstSell.currency.toUpperCase()) &&
      behaviorThen.includes(String(worstSell.sell_price)) &&
      behaviorThen.includes(Math.round(worstSell.missed_twd).toLocaleString("en-US")),
    `相似時刻沒有對上 ${worstSell.date} 的賣出紀錄：${behaviorThen}`);
    assert(!/\d+\s*筆/.test(behaviorThen), `報告沒有逐筆明細，相似時刻不得宣稱交易筆數：${behaviorThen}`);

    assert(snapshot.payload.topAsset === account.holdings.topCurrency.toUpperCase() &&
      snapshot.payload.topAssetRatio === account.holdings.topPct / 100 &&
      snapshot.payload.topAssetLabel.includes("現金"),
    `Account Snapshot 最大持有與報告不一致：${JSON.stringify(snapshot.payload)}`);
    /* 持有項數只能等於報告快照的項數；報告沒有快照時必須是 null（畫面顯示「報告未提供」）。
     * 最後交易日期報告始終沒有（只有每月聚合），永遠是 null，不得補值。 */
    const holdingsSnapshot = account.holdingsSnapshot;
    const expectedAssetCount = holdingsSnapshot ? holdingsSnapshot.holdings.length : null;
    assert(snapshot.payload.assetCount === expectedAssetCount &&
      (holdingsSnapshot ? snapshot.payload.topTwoAssetsRatio > 0 : snapshot.payload.topTwoAssetsRatio === null),
    `Account Snapshot 持有項數與報告不符（應為 ${expectedAssetCount}）：${JSON.stringify(snapshot.payload)}`);
    assert(snapshot.payload.lastTransactionAt === null && snapshot.payload.lastTransactionDaysAgo === null &&
      snapshot.payload.latestTransactionLabel.includes(account.trades.latestMonth),
    `Account Snapshot 把報告沒有的欄位補成了假值：${JSON.stringify(snapshot.payload)}`);
    const fullText = await page.locator("body").innerText();
    /* 前四項是規格範例的虛構數字；後四項是舊示範帳戶（BTC 52%／前兩項 72%／30 天單位）的殘留。 */
    ["78%", "96 天", "1.6 倍", "最近 30 天", "52%", "72%", "0.7 筆", "16 天前"].forEach((forbidden) => {
      assert(!fullText.includes(forbidden), `首頁出現不相符示範數字：${forbidden}`);
    });
    assert(fullText.includes(topRatioText) && fullText.includes(account.trades.latestMonth),
      "首頁沒有顯示真實帳戶的持倉占比或資料月份");
    assert(!/投資健康分|雷達圖|排行榜|保守型|積極型|FOMO|恐慌型|韭菜|衝動/.test(fullText),
      "首頁出現禁止的分數／人格／心理標籤");
    console.log(`4–8 核心價值 OK：市場＋持倉＋行為、Plan 對照、歸因資料不足、${worstSell.date} 回放、` +
      `${topRatioText}／${account.trades.latestMonthCount} 筆 truth-first`);

    /* 9. Cache、Analytics 與金融資料邊界。 */
    const persisted = await state(page);
    assert(!(persisted.home && persisted.home.cache && persisted.home.cache.response),
      "完整首頁 Response 不應長期寫入 mm_onboarding");
    const sessionCache = JSON.parse(await page.evaluate(() => sessionStorage.getItem("mm_home_cache") || "null"));
    assert(sessionCache && sessionCache.response, "首頁未建立短期 session 快取");
    const cacheKeys = collectKeys(sessionCache, []).map((key) => key.toLowerCase());
    ["rawtransactions", "rawportfolio", "holdings", "totalassetvalue", "accountid", "apikey", "secret", "prompt", "note"]
      .forEach((key) => assert(!cacheKeys.includes(key), `快取含敏感欄位：${key}`));
    const cached = await page.evaluate(() => MM_HOME_SERVICES.getCachedHome());
    assert(cached && cached.modules.length, "快取無法先行讀取");
    const cacheBoundary = await page.evaluate(async () => {
      const raw = JSON.parse(sessionStorage.getItem("mm_home_cache"));
      MM_HOME_SERVICES.clearCache();
      raw.cachedAt = new Date(Date.now() - MM_HOME_CORE.CACHE_TTL_MS - 1000).toISOString();
      sessionStorage.setItem("mm_home_cache", JSON.stringify(raw));
      const expiredRejected = MM_HOME_SERVICES.getCachedHome() === null;
      await MM_HOME_SERVICES.home.refreshHome();
      const fresh = JSON.parse(sessionStorage.getItem("mm_home_cache"));
      MM_HOME_SERVICES.clearCache();
      fresh.dataVersion += "|stale";
      sessionStorage.setItem("mm_home_cache", JSON.stringify(fresh));
      const versionRejected = MM_HOME_SERVICES.getCachedHome() === null;
      await MM_HOME_SERVICES.home.refreshHome();
      return { expiredRejected, versionRejected };
    });
    assert(cacheBoundary.expiredRejected && cacheBoundary.versionRejected,
      `快取 TTL/dataVersion 未生效：${JSON.stringify(cacheBoundary)}`);
    let events = JSON.parse(await page.evaluate(() => localStorage.getItem("mm_events") || "[]"));
    events.forEach((event) => assert(Object.keys(event).every((key) => ["e", "q", "src", "intent", "tool", "style", "status", "guard"].includes(key)),
      `Analytics 含未允許欄位：${JSON.stringify(event)}`));
    const analyticsBoundary = await page.evaluate(() => {
      MM_HOME_SERVICES.trackEvent("maimate_contextual_question_clicked", { questionId: "不是 stable id" });
      const stored = JSON.parse(localStorage.getItem("mm_events") || "[]");
      const last = stored[stored.length - 1] || {};
      const response = MM_HOME_CORE.clone(MM_HOME_UI.getResponse());
      const module = response.modules.find((item) => item.type === "contextualQuestions");
      module.actions[0].context.questionId = "自由文字 question";
      let rejected = false;
      try { MM_HOME_CORE.validateResponse(response); }
      catch (_) { rejected = true; }
      return { invalidQuestionIdStored: Boolean(last.q), rejected };
    });
    assert(!analyticsBoundary.invalidQuestionIdStored && analyticsBoundary.rejected,
      `Analytics/Action questionId 邊界失效：${JSON.stringify(analyticsBoundary)}`);
    console.log("9 Cache／Analytics OK：短期 session cache 驗 TTL/dataVersion；事件僅 e／q");

    /* 10. 單一模組故障、Refresh 不重跑 onboarding analysis。 */
    const moduleIsolation = await page.evaluate(async () => {
      const before = OnboardingStore.read().analysisJob.id;
      let analysisCalls = 0;
      const original = MM_INVESTMENT_SERVICES.analysis.startAnalysis;
      MM_INVESTMENT_SERVICES.analysis.startAnalysis = async () => {
        analysisCalls += 1;
        throw new Error("SHOULD_NOT_RUN");
      };
      MM_HOME_SERVICES.setModuleFailure("similarMoment", true);
      const degraded = await MM_HOME_SERVICES.home.refreshHome();
      MM_HOME_SERVICES.setModuleFailure("similarMoment", false);
      const refreshed = await MM_HOME_SERVICES.home.refreshHome();
      MM_INVESTMENT_SERVICES.analysis.startAnalysis = original;
      return {
        before,
        after: OnboardingStore.read().analysisJob.id,
        analysisCalls,
        hasToday: degraded.modules.some((item) => item.type === "todayRelevant"),
        hasSimilarWhenFailed: degraded.modules.some((item) =>
          item.type === "similarMoment" && item.payload && item.payload.error
        ),
        restored: refreshed.modules.some((item) =>
          item.type === "similarMoment" && !(item.payload && item.payload.error)
        ),
      };
    });
    assert(moduleIsolation.before === moduleIsolation.after && moduleIsolation.analysisCalls === 0,
      "Refresh 重跑了 onboarding analysis");
    assert(moduleIsolation.hasToday && moduleIsolation.hasSimilarWhenFailed && moduleIsolation.restored,
      "單一模組故障拖垮整頁或無法恢復");
    console.log("10 Module isolation／Refresh OK：不重跑 Screen 4");

    /* 11. dismiss／snooze／privacy preference 保存。 */
    const preferenceResult = await page.evaluate(async () => {
      const state = OnboardingStore.read();
      OnboardingStore.write({
        home: Object.assign({}, state.home || {}, {
          cache: null,
          moduleState: { dismissed: {}, snoozed: {} },
          preferences: { amountsHidden: false },
        }),
      });
      await MM_HOME_SERVICES.home.dismissModule("module_personalized_insights");
      let stored = OnboardingStore.read().home;
      const dismissed = Boolean(stored.moduleState.dismissed.module_personalized_insights);
      stored.moduleState.dismissed = {};
      OnboardingStore.write({ home: Object.assign({}, stored, { cache: null }) });
      await MM_HOME_SERVICES.home.snoozeModule("module_personalized_insights", "PT24H");
      stored = OnboardingStore.read().home;
      const snoozed = Date.parse(stored.moduleState.snoozed.module_personalized_insights) > Date.now();
      await MM_HOME_SERVICES.home.updateAmountVisibility(true);
      stored = OnboardingStore.read().home;
      return { dismissed, snoozed, hidden: stored.preferences.amountsHidden };
    });
    assert(preferenceResult.dismissed && preferenceResult.snoozed && preferenceResult.hidden,
      `模組／Privacy 設定未保存：${JSON.stringify(preferenceResult)}`);
    await page.evaluate(() => {
      const current = OnboardingStore.read();
      OnboardingStore.write({
        home: Object.assign({}, current.home || {}, {
          cache: null,
          moduleState: { dismissed: {}, snoozed: {} },
          preferences: { amountsHidden: false },
        }),
      });
    });
    console.log("11 Dismiss／Snooze／Privacy OK");

    /* 12. Draft 可進首頁並回 Screen 5。 */
    await page.evaluate(() => {
      const current = OnboardingStore.read();
      current.profileResult.status = "draft";
      delete current.profileResult.confirmedAt;
      OnboardingStore.write({
        profileResult: current.profileResult,
        profileConfirmationReminder: true,
        home: Object.assign({}, current.home || {}, { cache: null }),
      });
    });
    await page.goto(`${base}/home.html?src=onboarding`);
    await page.waitForSelector("#home-profile-status-card");
    assert((await page.locator("#home-profile-status-card").innerText()).includes("還沒確認"), "Draft 未顯示非阻斷提示");
    await page.locator("#home-profile-status-card .module-action").click();
    await page.waitForURL(/onboarding\.html#\/profile-result/);
    console.log("12 Draft Profile OK：可進首頁並返回 Screen 5");

    /* 13. 授權撤回只顯示 Limited Home，一般知識仍可用。 */
    await page.goto(`${base}/home.html?src=onboarding`);
    await page.waitForSelector("#home-content:not([hidden])");
    await page.evaluate(() => {
      const current = OnboardingStore.read();
      current.consent.revokedAt = new Date().toISOString();
      OnboardingStore.write({
        consent: current.consent,
        home: Object.assign({}, current.home || {}, { cache: null }),
      });
    });
    await page.reload();
    await page.waitForSelector("#home-profile-status-card");
    const limitedText = await page.locator("#home-content").innerText();
    assert(limitedText.includes("個人化資料已停止更新"), "撤回授權未顯示 Limited Home");
    assert(!await page.locator("#today-relevant-card").count(), "撤回授權仍顯示個人化 Today");
    assert(await page.locator("#contextual-question-section").count() &&
      await page.locator("#contextual-learning-card").count(), "Limited Home 未保留一般問答／學習");
    const limitedResponse = await page.evaluate(() => MM_HOME_UI.getResponse());
    assert(limitedResponse.user.profileStatus === "limited" &&
      limitedResponse.dataStatus.authorizationStatus === "revoked", "Limited Home status 錯誤");
    console.log("13 Authorization revoked OK：不更新個人分析，保留一般知識");

    /* 還原 confirmed state。 */
    await page.evaluate(() => {
      const current = OnboardingStore.read();
      delete current.consent.revokedAt;
      current.profileResult.status = "confirmed";
      current.profileResult.confirmedAt = new Date().toISOString();
      OnboardingStore.write({
        consent: current.consent,
        profileResult: current.profileResult,
        profileConfirmationReminder: false,
        home: Object.assign({}, current.home || {}, { cache: null }),
      });
    });
    await openDemo(page, base);

    /* 14. 資料不足模組不補假比例／假歷史。 */
    await page.evaluate(() => {
      const response = MM_HOME_CORE.clone(MM_HOME_UI.getResponse());
      const attribution = response.modules.find((item) => item.type === "accountAttribution");
      attribution.payload = { title: "今天的帳戶變化從哪裡來？", unavailable: true };
      const similar = response.modules.find((item) => item.type === "similarMoment");
      similar.payload = { title: "目前沒有足夠相似紀錄", unavailable: true };
      MM_HOME_UI.renderHome(response, { background: true });
    });
    assert(await page.locator("#account-attribution-empty").count() &&
      !await page.locator("#attribution-bar-list").count(), "歸因不足時仍補假比例");
    assert(await page.locator("#similar-moment-empty").count(), "相似資料不足時未顯示空狀態");
    await page.evaluate(() => {
      const response = MM_HOME_CORE.clone(MM_HOME_UI.getResponse());
      const questions = response.modules.find((item) => item.type === "contextualQuestions");
      questions.actions = [];
      MM_HOME_UI.renderHome(response, { background: true });
    });
    assert(await page.locator("#contextual-question-list .contextual-question").first().isDisabled(),
      "缺少後端 Action 時前端仍自行拼接 Context/Route");
    await page.reload();
    await page.waitForSelector("#today-relevant-card");
    console.log("14 Limited modules OK：不補假比例／相似紀錄");

    /* 15. 正式 API method/path/body contract。 */
    const formalCalls = [];
    const formalResponse = await page.evaluate(() => MM_HOME_UI.getResponse());
    await page.route("**/api/v1/maimate/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      formalCalls.push({
        method: request.method(),
        pathname,
        body: request.postData() ? request.postDataJSON() : null,
      });
      if (pathname === "/api/v1/maimate/home" || pathname === "/api/v1/maimate/home/refresh") {
        return route.fulfill({ json: formalResponse });
      }
      return route.fulfill({ status: 204, body: "" });
    });
    await page.evaluate(async () => {
      const formal = MM_HOME_SERVICES.formal;
      await formal.getHome();
      await formal.refreshHome();
      await formal.dismissModule("module demo");
      await formal.snoozeModule("module demo", "PT24H");
      await formal.updateAmountVisibility(true);
    });
    await page.unroute("**/api/v1/maimate/**");
    assert(formalCalls.length === 5, `正式 API 呼叫數錯誤：${formalCalls.length}`);
    assert(formalCalls[0].method === "GET" && formalCalls[0].pathname === "/api/v1/maimate/home", "GET Home contract 錯誤");
    assert(formalCalls[1].method === "POST" && formalCalls[1].pathname === "/api/v1/maimate/home/refresh", "Refresh contract 錯誤");
    assert(formalCalls[2].pathname.endsWith("/module%20demo/dismiss") && formalCalls[2].method === "POST", "Dismiss contract 錯誤");
    assert(formalCalls[3].pathname.endsWith("/module%20demo/snooze") &&
      formalCalls[3].body.duration === "PT24H", "Snooze contract 錯誤");
    assert(formalCalls[4].method === "PATCH" &&
      formalCalls[4].pathname === "/api/v1/maimate/preferences/privacy" &&
      formalCalls[4].body.hidden === true, "Privacy contract 錯誤");
    console.log("15 Formal Home API contract OK");

    /* 16. Route allowlist。 */
    const routes = await page.evaluate(() => ({
      home: MM_NAVIGATION.resolveRoute("/maimate/home"),
      localHome: MM_NAVIGATION.resolveRoute("home.html?src=onboarding"),
      profile: MM_NAVIGATION.resolveRoute("/maimate/profile-result"),
      consent: MM_NAVIGATION.resolveRoute("/maimate/consent"),
      js: MM_NAVIGATION.resolveRoute("javascript:alert(1)"),
      external: MM_NAVIGATION.resolveRoute("https://example.com/maimate/home"),
      protocolRelative: MM_NAVIGATION.resolveRoute("//example.com/maimate/home"),
      query: MM_NAVIGATION.resolveRoute("/maimate/home?next=evil"),
    }));
    assert(routes.home === "home.html" && routes.localHome === "home.html?src=onboarding" &&
      routes.profile === "onboarding.html#/profile-result" &&
      routes.consent === "onboarding.html#/consent", `合法 route mapping 錯誤：${JSON.stringify(routes)}`);
    assert(routes.js == null && routes.external == null && routes.protocolRelative == null && routes.query == null,
      `危險 route 未拒絕：${JSON.stringify(routes)}`);
    console.log("16 Navigation allowlist OK");

    /* 17. 首頁問題 → Screen 7：預填、來源卡、不自動送出，按送出才帶 Context。 */
    let chatRequest = null;
    const health = {
      chase_index: { buy_above_ma_pct: 65, buy_total: 2350 },
      opportunity_cost: { total_missed_twd: 26598877 },
      concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12" } },
      cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
    };
    // 結尾錨在 `?` 或字串尾：`**/health*` 會連 health-core.js／market-core.js
    // 一起攔下來當成 API 回 JSON，瀏覽器只會丟一個看不出原因的 SyntaxError。
    await page.route(/\/health(\?|$)/, (route) => route.fulfill({ json: health }));
    await page.route(/\/market(\?|$)/, (route) => {
      const market = new URL(route.request().url()).searchParams.get("market");
      route.fulfill({ json: { kind: "ticker", market, data: { last: "100" } } });
    });
    await page.route("**/chat", (route) => {
      chatRequest = route.request().postDataJSON();
      route.fulfill({ json: { reply: "已收到問題。", messages: [], mode: "growth", tool_trail: [] } });
    });
    await page.locator("#contextual-question-list .contextual-question").first().click();
    await page.waitForURL(/chat\.html$/);
    await page.waitForSelector("#ctx-banner:not([hidden])");
    const prefill = await page.inputValue("#q");
    assert(prefill.length > 0, "Screen 7 未預填問題");
    assert(!decodeURIComponent(page.url()).includes(prefill), "完整問題出現在 URL");
    assert(await page.locator(".bubble-user").count() === 0, "Screen 7 自動送出了問題");
    await page.click("#chat-send");
    await page.waitForFunction(() => document.querySelectorAll(".bubble-user").length === 1);
    console.log("17 Screen 7 Context OK：來源卡＋預填，確認後才送出");

    /* 18. Learning → Screen 8 detail，Bottom Nav → Settings 不 404。 */
    await openDemo(page, base);
    await page.locator("#contextual-learning-card .module-action").click();
    await page.waitForURL(/insights\.html$/);
    await page.waitForSelector("#detail-root:not([hidden])");
    // Screen 8 已改為真實頁面：名詞頁標題取自共用知識庫（「什麼是資產集中」）
    assert((await page.locator("#hero-title").innerText()).includes("資產集中"), "Learning 未開啟對應 Screen 8");
    assert(await page.locator("#source-card:not([hidden])").count(), "Screen 8 未顯示來源卡");
    await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
    await page.waitForSelector("#today-relevant-card");
    await page.locator('[data-home-nav="/maimate/settings"]').click();
    await page.waitForURL(/settings\.html$/);
    assert(await page.locator("#btn-profile").count(), "Settings Placeholder 404 或內容缺漏");
    console.log("18 Screen 8／Settings routes OK");

    /* 19–20. 375/390 RWD、第一屏、Sticky CTA、Reduced Motion。 */
    await page.setViewportSize({ width: 375, height: 812 });
    await openDemo(page, base);
    const layout = await page.evaluate(() => {
      /* 這條原本寫死 plan-alignment-card。整合健檢卡之後模組順序改了（健檢在最前），
         但這條斷言真正要守的是「第一屏看得到下一張卡的開頭」＝使用者知道還能往下捲，
         所以改成檢查第二張模組卡，不綁特定型別。 */
      const plan = document.querySelectorAll("#home-modules .module-card")[1].getBoundingClientRect();
      const chat = document.getElementById("persistent-chat-entry").getBoundingClientRect();
      const nav = document.getElementById("home-bottom-nav").getBoundingClientRect();
      const mascot = document.querySelector("#personal-greeting img");
      return {
        scrollWidth: document.documentElement.scrollWidth,
        planTop: plan.top,
        viewportHeight: innerHeight,
        chatBottom: chat.bottom,
        navTop: nav.top,
        mascotAnimation: getComputedStyle(mascot).animationDuration,
      };
    });
    assert(layout.scrollWidth <= 375, `375px 出現水平捲動：${layout.scrollWidth}`);
    assert(layout.planTop < layout.viewportHeight, `第一屏看不到第二張模組卡的開頭：${layout.planTop}`);
    assert(layout.chatBottom <= layout.navTop + 1, "Sticky Chat 與 Bottom Navigation 重疊");
    assert(parseFloat(layout.mascotAnimation) <= 0.001 || layout.mascotAnimation === "0s",
      `Reduced Motion 仍有非必要動畫：${layout.mascotAnimation}`);
    await page.focus("#home-chat-input");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const stickyLayout = await page.evaluate(() => {
      const input = document.getElementById("home-chat-input").getBoundingClientRect();
      const chat = document.getElementById("persistent-chat-entry").getBoundingClientRect();
      const lastModule = document.querySelector("#home-modules > :last-child").getBoundingClientRect();
      const sheet = getComputedStyle(document.querySelector("#notification-sheet .sheet"));
      const toast = getComputedStyle(document.getElementById("home-toast"));
      const shimmer = getComputedStyle(document.querySelector(".skeleton-line"), "::after");
      const navRoutes = [...document.querySelectorAll("[data-home-tab]")].map((button) => button.dataset.homeNav);
      return {
        inputHeight: input.height,
        lastModuleBottom: lastModule.bottom,
        chatTop: chat.top,
        sheetTransition: parseFloat(sheet.transitionDuration),
        toastTransition: parseFloat(toast.transitionDuration),
        shimmerAnimation: parseFloat(shimmer.animationDuration),
        navRoutes,
      };
    });
    assert(stickyLayout.inputHeight >= 44, `Chat input 點擊區不足 44px：${stickyLayout.inputHeight}`);
    assert(stickyLayout.lastModuleBottom <= stickyLayout.chatTop + 2,
      `Quick Chat 展開後遮住最後模組：${JSON.stringify(stickyLayout)}`);
    assert(stickyLayout.sheetTransition <= 0.001 && stickyLayout.toastTransition <= 0.001 &&
      stickyLayout.shimmerAnimation <= 0.001, `Reduced Motion 未涵蓋 Sheet/Toast/Skeleton：${JSON.stringify(stickyLayout)}`);
    assert(stickyLayout.navRoutes.join("|") ===
      "/maimate/home|/maimate/insights|/maimate/chat|/maimate/settings",
    `Bottom Navigation 未使用 Response routes：${stickyLayout.navRoutes}`);
    await page.click("#home-notifications");
    assert(await page.getAttribute("#home-notifications", "aria-expanded") === "true", "通知按鈕未更新 aria-expanded");
    await page.keyboard.press("Escape");
    assert(await page.getAttribute("#home-notifications", "aria-expanded") === "false", "通知關閉後 aria-expanded 未復原");
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "390px 出現水平捲動");
    await page.screenshot({ path: "smoke_home.png", fullPage: true });
    console.log("19–20 RWD／Reduced Motion OK：375×812、390×844");

    /* 21. 整頁載入失敗保留一般 Chat 入口。 */
    await page.evaluate(async () => {
      MM_HOME_SERVICES.clearCache();
      MM_HOME_SERVICES.setFailureMode(true);
      await MM_HOME_UI.loadHome();
    });
    await page.waitForSelector("#home-error:not([hidden])");
    assert(await page.locator("#home-error-chat").count(), "整頁錯誤沒有一般 Chat 入口");
    assert(await page.evaluate(() => document.activeElement && document.activeElement.id === "home-error"),
      "整頁錯誤未通知或移焦給輔助科技");
    await page.evaluate(() => MM_HOME_SERVICES.setFailureMode(false));
    console.log("21 Home error state OK");

    events = JSON.parse(await page.evaluate(() => localStorage.getItem("mm_events") || "[]"));
    events.forEach((event) => assert(Object.keys(event).every((key) => ["e", "q", "src", "intent", "tool", "style", "status", "guard"].includes(key)),
      `互動後 Analytics 含未允許欄位：${JSON.stringify(event)}`));
    assert(!pageErrors.length, `整合過程 pageerror：${pageErrors.join("；")}`);

    /* 22. Session／Consent／Questionnaire／Job／Result 一致性 Route Guard。 */
    {
      const guardContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Taipei" });
      await addFixedClock(guardContext);
      const guardPage = await guardContext.newPage();
      await openDemo(guardPage, base);
      const validState = await guardPage.evaluate(() => OnboardingStore.read());
      const scenarios = [
        { id: "missingResult", expected: /onboarding\.html#\/analyzing/ },
        { id: "queued", expected: /onboarding\.html#\/analyzing/ },
        { id: "missingConsent", expected: /onboarding\.html#\/consent/ },
        { id: "missingTransactions", expected: /onboarding\.html#\/consent/ },
        { id: "missingQuestionnaire", expected: /onboarding\.html#\/profile/ },
        { id: "jobMismatch", expected: /onboarding\.html#\/analyzing/ },
        { id: "dataVersionMismatch", expected: /onboarding\.html#\/analyzing/ },
        { id: "effectiveMismatch", expected: /onboarding\.html#\/profile-result/ },
        { id: "expiredSession", expected: /welcome\.html$/ },
      ];
      for (const scenario of scenarios) {
        await guardPage.evaluate(({ snapshot, id }) => {
          const next = JSON.parse(JSON.stringify(snapshot));
          if (id === "missingResult") {
            delete next.profileResult;
            delete next.effectiveProfile;
          }
          if (id === "queued") next.analysisJob.status = "queued";
          if (id === "missingConsent") delete next.consent;
          if (id === "missingTransactions") {
            next.consent.source = "internal";
            next.consent.grantedScopes = ["portfolio"];
          }
          if (id === "missingQuestionnaire") delete next.profile;
          if (id === "jobMismatch") next.profileResult.analysisJobId = "analysis_stale";
          if (id === "dataVersionMismatch") next.analysisJob.dataVersion += "_stale";
          if (id === "effectiveMismatch") next.effectiveProfile.originalResultId = "profile_stale";
          if (id === "expiredSession") next.demoSession.expiresAt = "2026-07-26T00:00:00+08:00";
          delete next.home;
          localStorage.setItem("mm_onboarding", JSON.stringify(next));
          sessionStorage.removeItem("mm_home_cache");
        }, { snapshot: validState, id: scenario.id });
        await guardPage.goto(`${base}/home.html?src=onboarding`);
        await guardPage.waitForURL(scenario.expected);
      }
      await guardPage.evaluate((snapshot) => {
        const next = JSON.parse(JSON.stringify(snapshot));
        next.profileResult.status = "revised";
        delete next.home;
        localStorage.setItem("mm_onboarding", JSON.stringify(next));
        sessionStorage.removeItem("mm_home_cache");
      }, validState);
      await guardPage.goto(`${base}/home.html?src=onboarding`);
      await guardPage.waitForSelector("#today-relevant-card");
      const revisedStatus = await guardPage.evaluate(() => MM_HOME_UI.getResponse().user.profileStatus);
      assert(revisedStatus === "revised", "revised Profile 未套用 EffectiveInvestmentProfile");
      console.log("22 Route Guard OK：Session／Consent／問卷／queued／版本／effective mismatch；revised 可進首頁");
      await guardContext.close();
    }

    await context.close();
    console.log("Screen 6 全部煙測通過 ✅");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error("FAIL:", error.stack || error.message);
  process.exitCode = 1;
});
