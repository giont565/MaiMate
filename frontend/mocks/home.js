/* Screen 6 專用、版本化的上游示範輸入。
 * 帳戶持倉與交易仍只取自 mocks/onboarding.js；本檔只補市場情境、
 * 前期快照、歸因模型輸入、學習內容與路由，不複製第二份帳戶資料。
 */
"use strict";

/* 把報告的 change_attribution 轉成 Adapter 吃的 components 形狀。
 * effectUnits 直接用報告的金額（絕對值），比重由 Adapter 自己算，
 * 前端不重算也不四捨五入，避免出現和報告對不上的第二套數字。 */
function mmHomeBuildAttributionInput() {
  const attribution = window.MM_ACCOUNT && window.MM_ACCOUNT.changeAttribution;
  if (!attribution || !Array.isArray(attribution.contributors) || !attribution.contributors.length) return null;
  const MAP = {
    marketPrice: { category: "marketPrice", label: "市價波動" },
    netDeposit: { category: "funding", label: "出入金淨額" },
    realizedPnl: { category: "recentTrades", label: "近期交易" },
  };
  const components = attribution.contributors
    .map((item) => {
      const mapped = MAP[item.category];
      if (!mapped) return null;
      return {
        id: "attr_" + item.category,
        label: mapped.label,
        category: mapped.category,
        effectUnits: Math.abs(Number(item.value_twd)),
      };
    })
    .filter(Boolean)
    /* 由大到小排序：下游一律拿 contributors[0] 當「主要來源」，順序錯了文案就會說反。 */
    .sort((a, b) => b.effectUnits - a.effectUnits);
  if (!components.length) return null;
  /* 報告的 period 是月份（2025-12），Adapter 要 ISO 日期，換算成該月起訖。 */
  const [year, month] = String(attribution.period).split("-").map(Number);
  const monthStart = attribution.period + "-01T00:00:00+08:00";
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) + "T23:59:59+08:00";
  return {
    id: "attribution_health_report_" + attribution.period,
    period: attribution.period,
    periodStart: monthStart,
    periodEnd: monthEnd,
    /* 報告標 estimated＝殘差法估算，UI 必須照實說，不得寫成會計歸因。 */
    type: attribution.type === "calculated" ? "calculated" : "estimated",
    note: attribution.note || "",
    components,
  };
}

window.MM_HOME_MOCK = Object.freeze({
  dataVersion: "home-context-health-report-2025-v1",
  narrativeVersion: "home-narrative-rules-v1",
  generatedAt: "2025-12-31T16:00:00+08:00",
  nextRefreshAt: "2025-12-31T16:30:00+08:00",
  user: {
    userId: "demo-user-001",
    displayName: "壹踢",
    demoMode: true,
  },
  snapshots: {
    portfolioUpdatedAt: "2025-12-31T15:50:00+08:00",
    /* 前期快照＝health_report.json 的 2025-11 月最大持有（TWD 98.5%），非杜撰 */
    priorPortfolio: {
      id: "portfolio_snapshot_health_report_2025_11",
      observedAt: "2025-11-30T16:00:00+08:00",
      weights: [
        { symbol: "TWD", weight: 0.985 },
        { symbol: "OTHER", weight: 0.015 },
      ],
    },
  },
  marketContext: {
    id: "market_context_demo_20251231",
    observedAt: "2025-12-31T16:00:00+08:00",
    periodStart: "2025-12-30T16:00:00+08:00",
    periodEnd: "2025-12-31T16:00:00+08:00",
    primaryAsset: "BTC",
    volatilityLevel: "medium",
    assets: [
      {
        symbol: "BTC",
        changeRatio: -0.018,
        impactLevel: "medium",
        sourceLabel: "示範行情（非真實報價）",
      },
      {
        symbol: "ETH",
        changeRatio: -0.006,
        impactLevel: "low",
        sourceLabel: "示範行情（非真實報價）",
      },
      {
        symbol: "DOGE",
        changeRatio: 0.004,
        impactLevel: "low",
        sourceLabel: "示範行情（非真實報價）",
      },
      {
        symbol: "USDT",
        changeRatio: 0,
        impactLevel: "low",
        sourceLabel: "示範行情（非真實報價）",
      },
    ],
    event: {
      id: "market_event_demo_btc_move",
      title: "BTC 今日出現中等幅度變動",
      sourceLabel: "示範市場情境",
    },
  },
  /* 帳戶變化歸因：直接取 health_report.json 的 change_attribution（issue #29 重跑後才有）。
   * 報告只給 marketPrice／netDeposit 兩類，netDeposit 對應 Adapter 的 funding。
   * 報告沒這段時維持 null，Adapter 回 null，畫面顯示「資料不足」——不用估算值假裝拆得出來。 */
  attributionInput: mmHomeBuildAttributionInput(),
  similarMomentInput: {
    id: "moment_health_report_20250108",
    title: "這個情況，你以前遇過",
    confidence: "low",
    currentContext: {
      startDate: "2025-12-30T16:00:00+08:00",
      endDate: "2025-12-31T16:00:00+08:00",
      relatedAssets: ["BTC"],
      marketChangeSummary: "BTC 今日約變動 -1.8%（示範行情，非真實報價）。",
    },
    /* 期間與內容由 SimilarMomentAdapter 依 health_report 的 worst_single_sell 現算 */
    historicalContext: {
      startDate: "2025-01-08T00:00:00+08:00",
      endDate: "2025-01-08T23:59:59+08:00",
      relatedAssets: ["DOGE"],
      marketChangeSummary: "",
    },
    similarities: [
      "兩次都遇到關注資產出現較明顯的價格變化。",
      "兩次都是在有既有部位的情況下需要做決定。",
    ],
    differences: [
      "當時處理的是 DOGE，這次示範行情的主要變動在 BTC。",
      "當時有完整的賣出紀錄可回顧，這次的逐筆交易明細不在這份報告裡。",
    ],
    disclaimer: "相似情境只用來回顧，不代表市場會重複，也不是買賣建議。",
  },
  /* 教材本身是一般知識（占比如何影響帳戶變化），對現金為主的帳戶同樣成立；
   * 標題不預設使用者「持倉集中」，那是這個帳戶沒有的結論。 */
  learningContent: {
    id: "learning_concentration_basics",
    title: "資產占比怎麼影響帳戶變化？",
    durationMinutes: 3,
    descriptionTemplate: "用你目前的資金分布當例子，看懂占比和帳戶整體變化的關係。",
    route: "/maimate/insights/concentration-basics",
  },
  navigation: {
    tabs: [
      { id: "home", label: "首頁", route: "/maimate/home" },
      { id: "insights", label: "洞察", route: "/maimate/insights" },
      { id: "chat", label: "問麥麥", route: "/maimate/chat" },
      { id: "settings", label: "我的", route: "/maimate/settings" },
    ],
  },
  aiStructuredOutput: {
    todayRelevant: {
      headline: "你的資金目前主要停在現金，市場變動對帳戶的直接影響有限。",
      explanation: "2025 年 12 月的紀錄顯示最大持有是現金（TWD），占比約 98.6%；示範行情中 BTC 今日約變動 -1.8%，但你的加密部位很小，因此帳戶不會跟著明顯移動。",
    },
    planAlignmentSummary: "可確認的是交易相當頻繁，而資金多數時間停在現金；持有時間仍需要逐筆紀錄才能完整對照。",
    /* 依 health_report 的 change_attribution（2025-12，殘差法估算）；
     * 報告標 estimated，所以一律說「估算」，不得寫成會計歸因。 */
    attributionSummary: "2025-12 的帳戶變化約有 99.7% 來自出入金淨額、0.3% 來自市價波動，屬依報告聚合值的估算，不等同正式會計損益。",
    similarMomentSummary: "2025 年 1 月那筆 DOGE 賣出是報告裡唯一有明細的事件，可以拿來回顧當時的決定。",
    contextualQuestions: [
      { id: "question_cash_impact", text: "資金停在現金對我的帳戶有什麼影響？", contextType: "portfolio" },
      { id: "question_market_source", text: "今天的市場變化跟我有關嗎？", contextType: "market" },
      { id: "question_rhythm", text: "我的交易頻率算高嗎？", contextType: "behavior" },
      { id: "question_similar", text: "1 月那筆 DOGE 賣出，當時發生什麼？", contextType: "history", relatedMomentId: "moment_health_report_20250108" },
      { id: "question_plan", text: "目前可確認的行為和我的長期目標一致嗎？", contextType: "behavior" },
    ],
  },
});

/* /health 取不到時的離線備援。數字逐格對齊 app.js 的 MOCK.health（2025 真實紀錄，
 * 見 CLAUDE.md「真實數據已驗證」），因為同一個健康分不能在兩頁長得不一樣。
 * 用到它時 payload.source 會是 "demo"，畫面必須明示是示範資料——這條線的重點就是
 * 不要再有「畫面全都正常但資料是假的」。 */
window.MM_HOME_HEALTH_MOCK = Object.freeze({
  chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
  opportunity_cost: { total_missed_twd: 26598877 },
  realized_pnl: { total_realized_twd: 117482, loss_trades: 493, profit_trades: 981 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12", top_currency: "twd" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
});
