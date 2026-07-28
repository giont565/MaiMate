/* Screen 8（insights.html）煙測——期望值一律從 window.MM_ACCOUNT 現推，不寫死。
 *   1  11 個 insight 都能開啟且不拋例外
 *   2  現金集中度：比例條數值＝帳戶真值；期間對照寫「百分點」不是「%」
 *   3  交易節奏：12 根柱、數值＝perMonth 真值、圖表標題是問句
 *   4  account-change／holding-pattern：資料不足，且畫面上沒有任何圖表元素
 *   5  名詞頁：未授權（清空 localStorage）仍可看，且標示用一般例子、不帶個人數字
 *   6  相關名詞可跳到下一個 insight，返回堆疊保留
 *   7 「你可以接著問」→ 回 Screen 7 且問題已預填（不自動送出）
 *   8  從 Screen 7 進入再返回，conversationId 保留
 *   9  事件只含白名單欄位，無問題原文與金融數字
 *  10  375／390px 無水平捲動；所有按鈕 ≥44px
 *  11  畫面不得出現禁語、假精準相似度、把現金寫成持倉集中
 * 用法：npm run smoke:insights */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "insights.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const ALLOWED_EVENT_KEYS = ["e", "q", "src", "intent", "tool", "style", "status", "guard"];
/* 反向 guard：Screen 4–7 已淘汰的假數字與講反話的說法，一律不得再出現。 */
const HARD_FORBIDDEN = [
  /建議買入|建議賣出|保證獲利|一定會漲|穩賺|必漲|目標價/,
  /韭菜|小白|賭徒|不理性|保守型|積極型|高風險人格/,
  /持倉(過度)?集中|配置(較|過度)?集中|資產過度集中/,
  /相似度\s*\d|\d+(\.\d+)?%\s*相似/,
  /52%|72%|0\.7 筆|16 天前|最近 30 天/,
  /get_portfolio_summary|query_user_history|tool_call|Chain of Thought/,
];
/* 這些詞只有在「被當成結論陳述」時才違規；聲明「這不是投資能力評分」是規格要求的免責。 */
const LABEL_FORBIDDEN = /(投資能力|風險等級|健康分數|紀律分數|績效評分)/;
const NEGATION = /(不是|不代表|不會|不含|沒有|並非|不用|不替)/;

function scanForbiddenText(text, id) {
  for (const pattern of HARD_FORBIDDEN) {
    const hit = text.match(pattern);
    if (hit) throw new Error(`${id} 畫面出現禁用字樣「${hit[0]}」`);
  }
  text.split(/[。\n]/).forEach((sentence) => {
    const hit = sentence.match(LABEL_FORBIDDEN);
    if (hit && !NEGATION.test(sentence)) {
      throw new Error(`${id} 把「${hit[0]}」寫成結論而不是免責：${sentence.slice(0, 40)}`);
    }
  });
}

const assert = (ok, message) => { if (!ok) throw new Error(message); };

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
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // 後端一律斷線：Screen 8 必須在離線下走完
  await page.route("**/api/**", (r) => r.abort());
  await page.route("**/execute-api**", (r) => r.abort());

  const openInsight = async (id) => {
    await page.evaluate((target) => window.MM_INSIGHTS_UI.open(target), id);
    await page.waitForFunction((target) => {
      const detail = window.MM_INSIGHTS_UI.getDetail();
      return Boolean(detail && detail.id === target);
    }, id, { timeout: 10000 });
  };
  const pageText = () => page.$eval("main", (node) => node.textContent);

  // ── 建立 demo session（隊友共用的真實帳戶：data/health_report.json → mocks/account.js）
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector(".bottom-nav", { timeout: 15000 });
  const account = await page.evaluate(() => window.MM_ACCOUNT);
  const oneDecimal = (value) => String(Math.round(value * 10) / 10);
  const TOP_PCT = oneDecimal(account.holdings.topPct) + "%";
  const OTHER_PCT = oneDecimal(account.holdings.otherPct) + "%";
  const PREV_PCT = oneDecimal(account.holdings.previousPct) + "%";
  const DELTA_POINTS = Math.round((account.holdings.topPct - account.holdings.previousPct) * 10) / 10;
  const MONTHS = Object.keys(account.trades.perMonth).sort();
  const AVG_TEXT = account.trades.averagePerMonth + " 筆";
  const LATEST_TEXT = account.trades.latestMonthCount.toLocaleString("en-US") + " 筆";
  const PREV_MONTH_TEXT = account.trades.previousMonthCount.toLocaleString("en-US") + " 筆";
  const TOTAL_TEXT = account.trades.total.toLocaleString("en-US") + " 筆";
  const MISSED_TEXT = "NT$" + Math.round(account.opportunityCost.worstSell.missed_twd).toLocaleString("en-US");
  const ALL_IDS = [
    "cash-concentration", "trading-rhythm", "notable-sell", "plan-alignment",
    "account-change", "holding-pattern",
    "concentration-basics", "market-depth", "order-types", "weight-volatility", "fee-basics",
  ];

  // ── 從首頁用站內路由進入 Screen 8（和真實流程一致，不直接開檔）
  await page.evaluate(() => {
    window.MM_NAVIGATION.openInsight("/maimate/insights/cash-concentration", {
      id: "home_insight_open",
      context: { source: "home_module" },
    });
  });
  await page.waitForURL(/insights\.html/, { timeout: 10000 });
  await page.waitForSelector("#detail-root:not([hidden])", { timeout: 10000 });
  const landed = await page.evaluate(() => window.MM_INSIGHTS_UI.getDetail().id);
  assert(landed === "cash-concentration", `路由未帶入 insight id：${landed}`);
  console.log("路由 OK：/maimate/insights/:id 由 MM_NAVIGATION 解析後進入對應洞察");

  // ── 1. 11 個 insight 都能開啟且不拋例外
  const opened = [];
  for (const id of ALL_IDS) {
    await openInsight(id);
    const view = await page.evaluate(() => ({
      hidden: document.getElementById("detail-root").hidden,
      title: document.getElementById("hero-title").textContent,
      conclusion: document.getElementById("hero-conclusion").textContent,
      why: document.getElementById("why-body").textContent,
      evidence: document.getElementById("evidence-body").textContent,
      terms: document.querySelectorAll("#terms-body .term-item").length,
      asks: document.querySelectorAll("#ask-body button").length,
      simple: document.getElementById("simple-body").textContent,
    }));
    assert(!view.hidden, `${id} 沒有渲染詳情`);
    assert(view.title && view.conclusion.length > 6, `${id} 缺少標題或結論`);
    assert(view.why.length > 10, `${id} 缺少「為什麼這和你有關」`);
    assert(view.simple.length > 6, `${id} 缺少「用簡單一點的方式說」`);
    assert(view.terms >= 2 && view.terms <= 4, `${id} 相關名詞數量不符（2–4）：${view.terms}`);
    assert(view.asks >= 2 && view.asks <= 4, `${id} 追問數量不符（2–4）：${view.asks}`);
    // 11. 禁語與假精準相似度
    scanForbiddenText(await pageText(), id);
    opened.push(id);
  }
  assert(errors.length === 0, `開啟過程拋出例外：${errors[0]}`);
  console.log(`1/11 開啟 OK：${opened.length} 個洞察全部可開、結構完整、無禁語與假精準相似度`);

  // ── 2. 現金集中度：比例條＝帳戶真值；期間對照用「百分點」
  await openInsight("cash-concentration");
  const cash = await page.evaluate(() => ({
    heroConclusion: document.getElementById("hero-conclusion").textContent,
    metric: document.getElementById("metric-value").textContent,
    bars: [...document.querySelectorAll(".alloc-bar")].map((node) => ({
      label: node.querySelector(".row span").textContent,
      value: node.querySelector(".row b").textContent,
      width: node.querySelector(".fill").style.width,
      aria: node.getAttribute("aria-label"),
    })),
    chartTitle: document.querySelector('[data-chart="allocationBar"] h2').textContent,
    chartRole: document.querySelector(".alloc-list").getAttribute("role"),
    chartAria: document.querySelector(".alloc-list").getAttribute("aria-label"),
    kv: [...document.querySelectorAll(".kv")].map((node) => node.textContent),
    all: document.querySelector("main").textContent,
  }));
  assert(cash.bars.length === 2, `比例條數量異常：${cash.bars.length}`);
  assert(cash.bars[0].value === TOP_PCT && cash.bars[0].width === TOP_PCT,
    `最大持有比例條和帳戶真值不符：${JSON.stringify(cash.bars[0])} 應為 ${TOP_PCT}`);
  assert(cash.bars[1].value === OTHER_PCT && cash.bars[1].width === OTHER_PCT,
    `其餘部位比例條和帳戶真值不符：${JSON.stringify(cash.bars[1])} 應為 ${OTHER_PCT}`);
  assert(cash.metric === TOP_PCT, `Hero 主要 Metric 不是帳戶真值：${cash.metric}`);
  assert(/[？?]$/.test(cash.chartTitle.trim()), `圖表標題不是問句：${cash.chartTitle}`);
  assert(cash.chartRole === "img" && cash.chartAria.includes(TOP_PCT), "比例圖缺少 role=img 或文字摘要");
  const deltaRow = cash.kv.find((text) => text.includes("變化"));
  assert(deltaRow && deltaRow.includes(`${Math.abs(DELTA_POINTS)} 個百分點`),
    `期間對照沒有用「個百分點」：${deltaRow}`);
  assert(cash.all.includes(PREV_PCT) && cash.all.includes(TOP_PCT), "期間對照缺少前後兩期真值");
  assert(!/(提高|下降|增加|減少)\s*0?\.?\d+(\.\d+)?%/.test(cash.all), "百分點被寫成百分比");
  assert(/資金主要停在/.test(cash.heroConclusion), `現金結論寫法不符：${cash.heroConclusion}`);
  // 可點看數值
  await page.click(".alloc-bar");
  const readout = await page.$eval('[data-chart="allocationBar"] .chart-readout', (node) => node.textContent);
  assert(readout.includes(TOP_PCT), `點擊比例條沒有顯示數值：${readout}`);
  console.log(`2 現金分布 OK：${TOP_PCT}／${OTHER_PCT} 皆為帳戶真值、${PREV_PCT}→${TOP_PCT} 寫成 ${Math.abs(DELTA_POINTS)} 個百分點、可點看數值`);

  // ── 「用簡單一點的方式說」：三種版面只改深度，數字與結論不得改變
  const styleResults = {};
  for (const style of ["guided", "concise", "analytical"]) {
    await page.evaluate((value) => window.MM_HOME_SERVICES.home.updatePresentationStyle(value), style);
    await openInsight("trading-rhythm");
    await openInsight("cash-concentration");
    styleResults[style] = await page.evaluate(() => ({
      conclusion: document.getElementById("hero-conclusion").textContent,
      metric: document.getElementById("metric-value").textContent,
      simple: document.getElementById("simple-body").textContent,
      paragraphs: document.querySelectorAll("#simple-body p").length,
    }));
  }
  await page.evaluate(() => window.MM_HOME_SERVICES.home.updatePresentationStyle(null));
  for (const style of Object.keys(styleResults)) {
    const result = styleResults[style];
    assert(result.conclusion === styleResults.guided.conclusion, `${style} 版面改動了結論`);
    assert(result.metric === TOP_PCT, `${style} 版面改動了主要 Metric：${result.metric}`);
    assert(result.simple.includes(TOP_PCT) && result.simple.includes(OTHER_PCT),
      `${style} 版面的簡單說法漏掉數字：${result.simple.slice(0, 60)}`);
  }
  assert(styleResults.concise.paragraphs < styleResults.guided.paragraphs ||
    styleResults.analytical.paragraphs !== styleResults.concise.paragraphs,
    "三種版面的說明深度完全一樣，沒有依溝通風格調整");
  console.log(`溝通風格 OK：guided／concise／analytical 段落數 ${styleResults.guided.paragraphs}／${styleResults.concise.paragraphs}／${styleResults.analytical.paragraphs}，數字與結論不變`);

  // ── 3. 交易節奏：12 根柱、真值、標題是問句
  await openInsight("trading-rhythm");
  const rhythm = await page.evaluate(() => ({
    title: document.querySelector('[data-chart="rhythmTimeline"] h2').textContent,
    bars: [...document.querySelectorAll(".rhythm-bar")].map((node) => node.getAttribute("aria-label")),
    heights: [...document.querySelectorAll(".rhythm-bar i")].map((node) => node.style.height),
    role: document.querySelector(".rhythm-chart").getAttribute("role"),
    aria: document.querySelector(".rhythm-chart").getAttribute("aria-label"),
    avg: document.querySelector(".rhythm-avg span").textContent,
    hero: document.getElementById("hero-conclusion").textContent,
    all: document.querySelector("main").textContent,
  }));
  assert(/[？?]$/.test(rhythm.title.trim()), `交易節奏圖標題不是問句：${rhythm.title}`);
  assert(rhythm.bars.length === MONTHS.length && MONTHS.length === 12,
    `柱狀數量不是 12 根：${rhythm.bars.length}`);
  MONTHS.forEach((month, index) => {
    const expected = `${month} ${account.trades.perMonth[month].toLocaleString("en-US")} 筆`;
    assert(rhythm.bars[index] === expected, `第 ${index + 1} 根柱不是真值：${rhythm.bars[index]} 應為 ${expected}`);
  });
  assert(rhythm.heights.every((height) => /%$/.test(height)), "柱狀高度未以百分比呈現");
  assert(rhythm.role === "img" && rhythm.aria.includes(AVG_TEXT), "交易節奏圖缺少 role=img 或文字摘要");
  assert(rhythm.avg.includes(AVG_TEXT), `平均線標示異常：${rhythm.avg}`);
  assert(rhythm.hero.includes(AVG_TEXT) && rhythm.hero.includes(LATEST_TEXT) && rhythm.hero.includes(PREV_MONTH_TEXT),
    `Hero 結論缺少真值：${rhythm.hero}`);
  assert(rhythm.all.includes(TOTAL_TEXT), "整段期間總筆數未出現");
  assert(/交易次數，不是持倉比例|不是持倉比例/.test(rhythm.all), "各幣種交易次數未標明不是持倉比例");
  await page.click(".rhythm-bar:nth-of-type(1)");
  const rhythmReadout = await page.$eval('[data-chart="rhythmTimeline"] .chart-readout', (node) => node.textContent);
  assert(/\d+ 筆/.test(rhythmReadout), `點擊柱狀沒有顯示數值：${rhythmReadout}`);
  console.log(`3 交易節奏 OK：12 根柱全為 perMonth 真值、標題「${rhythm.title}」是問句、平均線 ${AVG_TEXT}、可點看數值`);

  // ── notable-sell：唯一有明細的事件，且明說是回顧不是建議
  await openInsight("notable-sell");
  const sell = await pageText();
  assert(sell.includes(MISSED_TEXT), `機會成本不是帳戶真值：應含 ${MISSED_TEXT}`);
  assert(sell.includes(String(account.opportunityCost.worstSell.sell_price)) &&
    sell.includes(String(account.opportunityCost.worstSell.eoy_price)), "賣出價／年末價未取自帳戶真值");
  assert(/事後回顧/.test(sell) && /不是任何買賣建議|不是買賣建議/.test(sell), "回顧頁未聲明這不是買賣建議");
  console.log(`notable-sell OK：${MISSED_TEXT} 為帳戶真值，並聲明是回顧、非買賣建議`);

  // ── plan-alignment：只用四種狀態字面值，不得出現一致度百分比或分數
  await openInsight("plan-alignment");
  const plan = await page.evaluate(() => ({
    metric: document.getElementById("metric-value").textContent,
    all: document.querySelector("main").textContent,
  }));
  assert(["大致一致", "有部分不同", "明顯不同", "資料不足"].includes(plan.metric),
    `方向對照狀態不是四種字面值之一：${plan.metric}`);
  assert(!/一致度|符合度|\d+\s*分/.test(plan.all), "方向對照出現分數或一致度");
  assert(plan.all.includes(LATEST_TEXT) && plan.all.includes(AVG_TEXT), "方向對照未帶入交易真值");
  console.log(`plan-alignment OK：狀態「${plan.metric}」為列舉字面值、無分數與一致度百分比`);

  // ── 4. 資料不足的兩頁：明說缺什麼，且畫面上沒有任何圖表元素
  for (const id of ["account-change", "holding-pattern"]) {
    await openInsight(id);
    const gap = await page.evaluate(() => ({
      tag: document.querySelector(".gap-card .tag") ? document.querySelector(".gap-card .tag").textContent : "",
      reason: document.querySelector(".gap-card p") ? document.querySelector(".gap-card p").textContent : "",
      missing: [...document.querySelectorAll(".gap-card .bullet li")].map((node) => node.textContent),
      alternatives: [...document.querySelectorAll(".gap-alts button")].map((node) => node.textContent),
      charts: document.querySelectorAll("[data-chart], .alloc-bar, .alloc-list, .rhythm-chart, .rhythm-bar, .fill, .track").length,
      all: document.querySelector("main").textContent,
    }));
    assert(gap.tag === "資料不足", `${id} 未標示資料不足：${gap.tag}`);
    assert(gap.missing.length >= 2, `${id} 未列出缺少的資料`);
    assert(gap.alternatives.length >= 2, `${id} 未提供替代動作`);
    assert(gap.charts === 0, `${id} 資料不足卻仍畫出 ${gap.charts} 個圖表元素`);
    assert(/issue #29/.test(gap.all), `${id} 未說明已向後端請求（issue #29）`);
    assert(!/約\s*\d+(\.\d+)?%\s*(來自|與市場)/.test(gap.all), `${id} 仍給出歸因比重`);
  }
  console.log("4 資料不足 OK：account-change／holding-pattern 皆標示資料不足、列出缺項與替代動作、零圖表元素");

  // ── 6. 相關名詞可跳到下一個 insight，返回堆疊保留
  await openInsight("cash-concentration");
  const firstTerm = await page.$eval("#terms-body .term-item", (node) => node.dataset.termId);
  await page.click("#terms-body .term-item");
  await page.waitForFunction((target) => {
    const detail = window.MM_INSIGHTS_UI.getDetail();
    return Boolean(detail && detail.id === target);
  }, firstTerm, { timeout: 10000 });
  const afterJump = await page.evaluate(() => window.MM_INSIGHTS_UI.getStack());
  assert(afterJump.length >= 2 && afterJump[afterJump.length - 1] === firstTerm,
    `相關名詞跳轉未保留返回堆疊：${JSON.stringify(afterJump)}`);
  await page.click("#ins-back");
  await page.waitForFunction(() => {
    const detail = window.MM_INSIGHTS_UI.getDetail();
    return Boolean(detail && detail.id === "cash-concentration");
  }, null, { timeout: 10000 });
  console.log(`6 相關名詞 OK：跳到「${firstTerm}」後返回原洞察，堆疊保留`);

  // ── 7. 「你可以接著問」→ 回 Screen 7 且問題已預填、未自動送出
  await openInsight("trading-rhythm");
  const askText = await page.$eval("#ask-body button", (node) => node.textContent);
  await page.click("#ask-body button");
  await page.waitForURL(/chat\.html/, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById("q").value.length > 0, null, { timeout: 10000 });
  const prefill = await page.evaluate(() => ({
    value: document.getElementById("q").value,
    answered: document.querySelectorAll(".card-ai").length,
  }));
  assert(prefill.value === askText, `追問未原樣預填：${prefill.value} vs ${askText}`);
  assert(prefill.answered === 0, "預填問題不得自動送出");
  console.log(`7 追問 OK：「${askText}」已預填回 Screen 7，未自動送出`);

  // ── 8. 從 Screen 7 進入 Screen 8 再返回，conversationId 保留
  await page.fill("#q", "目前的資金分布對我的帳戶有什麼影響？");
  await page.click("#chat-send");
  await page.waitForFunction(() => document.getElementById("chat-stop").hidden, null, { timeout: 15000 });
  await page.waitForSelector(".insight-links button", { timeout: 10000 });
  const conversationId = await page.evaluate(() => window.MM_CHAT_UI.getConversation().id);
  await page.click(".insight-links button");
  await page.waitForURL(/insights\.html/, { timeout: 10000 });
  await page.waitForSelector("#detail-root:not([hidden])", { timeout: 10000 });
  const carried = await page.evaluate(() => ({
    conversationId: window.MM_INSIGHTS_UI.getConversationId(),
    insightId: window.MM_INSIGHTS_UI.getDetail().id,
  }));
  assert(carried.conversationId === conversationId,
    `Screen 8 未接到 conversationId：${carried.conversationId} vs ${conversationId}`);
  assert(carried.insightId === "cash-concentration", `對話的深入了解連結指錯洞察：${carried.insightId}`);
  await page.click("#cta-chat");
  await page.waitForURL(/chat\.html/, { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.MM_CHAT_UI.getConversation()), null, { timeout: 10000 });
  const back = await page.evaluate(() => ({
    id: window.MM_CHAT_UI.getConversation().id,
    cards: document.querySelectorAll(".card-ai").length,
  }));
  assert(back.id === conversationId, `返回 Screen 7 沒有回到同一段對話：${back.id} vs ${conversationId}`);
  assert(back.cards > 0, "返回 Screen 7 後原本的回答不見了");
  console.log(`8 來回 OK：Screen 7 →（深入了解）→ Screen 7 仍是同一段對話（${back.cards} 則回答保留）`);

  // ── 9. 事件白名單
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("mm_events") || "[]"));
  const bad = events.find((event) => Object.keys(event).some((key) => !ALLOWED_EVENT_KEYS.includes(key)));
  assert(!bad, `事件含未允許欄位：${JSON.stringify(bad)}`);
  const raw = JSON.stringify(events);
  assert(!/98\.6|312,?924|389\.5|資金分布|DOGE/.test(raw), "事件疑似記錄了問題原文或金融數字");
  for (const name of ["maimate_insight_viewed", "maimate_insight_term_opened",
    "maimate_insight_question_clicked", "maimate_insight_chat_opened",
    "maimate_insight_chart_inspected", "maimate_insight_insufficient_shown"]) {
    assert(raw.includes(name), `事件未記錄：${name}`);
  }
  console.log(`事件 OK：6 類 Screen 8 事件有記、僅列舉值欄位、無問題原文與金融數字（共 ${events.length} 筆）`);

  // ── 10. 375／390px 無水平捲動；所有按鈕 ≥44px
  await page.goto(`${base}/insights.html`);
  await page.waitForSelector("#detail-root:not([hidden]), #index-root:not([hidden])", { timeout: 10000 });
  for (const id of ["cash-concentration", "trading-rhythm", "account-change", "fee-basics"]) {
    await openInsight(id);
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 844 });
      const layout = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        small: [...document.querySelectorAll("button")]
          .filter((node) => node.offsetParent !== null)
          .map((node) => ({ text: (node.textContent || node.getAttribute("aria-label") || "").slice(0, 18),
            h: Math.round(node.getBoundingClientRect().height) }))
          .filter((item) => item.h < 44),
      }));
      assert(layout.scrollW <= width, `${id} 在 ${width}px 出現橫向捲動：${layout.scrollW}`);
      assert(layout.small.length === 0,
        `${id} 在 ${width}px 有點擊區小於 44px：${JSON.stringify(layout.small.slice(0, 3))}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  console.log("10 版面 OK：375／390px 皆無水平捲動，所有可見按鈕 ≥44px");

  // ── 5. 未授權（清空 localStorage）：名詞頁仍可看，且用一般例子、不帶個人數字
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const guestErrors = [];
  guest.on("pageerror", (e) => guestErrors.push(String(e)));
  await guest.route("**/api/**", (r) => r.abort());
  await guest.route("**/execute-api**", (r) => r.abort());
  await guest.goto(`${base}/insights.html`);
  await guest.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await guest.goto(`${base}/insights.html`);
  await guest.waitForSelector("#index-root:not([hidden])", { timeout: 10000 });
  for (const id of ["concentration-basics", "fee-basics"]) {
    await guest.evaluate((target) => window.MM_INSIGHTS_UI.open(target), id);
    await guest.waitForFunction((target) => {
      const detail = window.MM_INSIGHTS_UI.getDetail();
      return Boolean(detail && detail.id === target);
    }, id, { timeout: 10000 });
    const view = await guest.evaluate(() => ({
      why: document.getElementById("why-body").textContent,
      all: document.querySelector("main").textContent,
      notice: document.getElementById("notice-bar").textContent,
    }));
    assert(/一般例子/.test(view.why), `${id} 未授權時沒有標示用一般例子：${view.why}`);
    assert(!view.all.includes(TOP_PCT) && !view.all.includes(TOTAL_TEXT),
      `${id} 未授權時仍出現個人化數字`);
    assert(/沒有使用你的帳戶資料/.test(view.notice + view.why), `${id} 未說明目前沒有使用帳戶資料`);
  }
  // 個人化類在未授權時只顯示說明，不得出現任何帳戶數字或圖表
  await guest.evaluate(() => window.MM_INSIGHTS_UI.open("cash-concentration"));
  await guest.waitForFunction(() => {
    const detail = window.MM_INSIGHTS_UI.getDetail();
    return Boolean(detail && detail.id === "cash-concentration");
  }, null, { timeout: 10000 });
  const guestPersonal = await guest.evaluate(() => ({
    all: document.querySelector("main").textContent,
    charts: document.querySelectorAll("[data-chart], .alloc-bar, .rhythm-bar").length,
  }));
  assert(!guestPersonal.all.includes(TOP_PCT), "未授權時個人化洞察仍顯示帳戶數字");
  assert(guestPersonal.charts === 0, "未授權時個人化洞察仍畫出圖表");
  assert(guestErrors.length === 0, `未授權情境拋出例外：${guestErrors[0]}`);
  console.log("5 未授權 OK：名詞頁仍可看且用一般例子；個人化洞察零數字零圖表");
  await guest.close();

  // ── 授權撤回 → 顯示最後保存結果並標示已停止更新
  await page.goto(`${base}/insights.html`);
  await page.waitForSelector("#detail-root:not([hidden]), #index-root:not([hidden])", { timeout: 10000 });
  await openInsight("cash-concentration");
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("mm_onboarding"));
    stored.consent.revokedAt = new Date().toISOString();
    localStorage.setItem("mm_onboarding", JSON.stringify(stored));
  });
  await page.evaluate(() => window.MM_INSIGHTS_UI.open("cash-concentration"));
  await page.waitForFunction(() => {
    const detail = window.MM_INSIGHTS_UI.getDetail();
    return Boolean(detail && detail.stopped);
  }, null, { timeout: 10000 });
  const revoked = await page.evaluate(() => ({
    notice: document.getElementById("notice-bar").textContent,
    hidden: document.getElementById("notice-bar").hidden,
    all: document.querySelector("main").textContent,
  }));
  assert(!revoked.hidden && /已停止更新/.test(revoked.notice), `撤回授權未標示停止更新：${revoked.notice}`);
  assert(revoked.all.includes(TOP_PCT), "撤回授權後未顯示最後保存的結果");
  console.log("撤回授權 OK：顯示最後保存結果並標示已停止更新");

  assert(errors.length === 0, `頁面拋出例外：${errors[0]}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/insights.html`);
  await page.waitForSelector("#detail-root:not([hidden]), #index-root:not([hidden])", { timeout: 10000 });
  await page.screenshot({ path: "smoke_insights.png", fullPage: true });
  await browser.close();
  server.close();
  console.log("Screen 8 全部煙測通過 ✅（截圖 smoke_insights.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
