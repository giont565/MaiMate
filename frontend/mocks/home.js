/* Screen 6 專用、版本化的上游示範輸入。
 * 帳戶持倉與交易仍只取自 mocks/onboarding.js；本檔只補市場情境、
 * 前期快照、歸因模型輸入、學習內容與路由，不複製第二份帳戶資料。
 */
"use strict";

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
  /* 帳戶變化歸因：需要各幣種持倉明細才能拆解，但 health_report.json 只給
   * 「最大持有標的與占比」。缺料就不提供輸入，Adapter 會回 null，
   * 首頁該模組顯示「資料不足」——不用估算值假裝拆得出來。 */
  attributionInput: null,
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
    attributionSummary: "這份報告沒有各幣種持倉明細，因此不拆解帳戶變化來源。",
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
