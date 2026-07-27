/* Screen 6 專用、版本化的上游示範輸入。
 * 帳戶持倉與交易仍只取自 mocks/onboarding.js；本檔只補市場情境、
 * 前期快照、歸因模型輸入、學習內容與路由，不複製第二份帳戶資料。
 */
"use strict";

window.MM_HOME_MOCK = Object.freeze({
  dataVersion: "home-context-steady-planner-existing-8-v1",
  narrativeVersion: "home-narrative-rules-v1",
  generatedAt: "2026-07-27T08:30:00+08:00",
  nextRefreshAt: "2026-07-27T09:00:00+08:00",
  user: {
    userId: "demo-user-001",
    displayName: "壹踢",
    demoMode: true,
  },
  snapshots: {
    portfolioUpdatedAt: "2026-07-27T08:20:00+08:00",
    priorPortfolio: {
      id: "portfolio_snapshot_demo_20260627",
      observedAt: "2026-06-27T08:20:00+08:00",
      weights: [
        { symbol: "BTC", weight: 0.49 },
        { symbol: "ETH", weight: 0.22 },
        { symbol: "DOGE", weight: 0.18 },
        { symbol: "USDT", weight: 0.11 },
      ],
    },
  },
  marketContext: {
    id: "market_context_demo_20260727",
    observedAt: "2026-07-27T08:30:00+08:00",
    periodStart: "2026-07-26T08:30:00+08:00",
    periodEnd: "2026-07-27T08:30:00+08:00",
    primaryAsset: "BTC",
    volatilityLevel: "medium",
    assets: [
      {
        symbol: "BTC",
        changeRatio: -0.018,
        impactLevel: "medium",
        sourceLabel: "MAX 示範行情",
      },
      {
        symbol: "ETH",
        changeRatio: -0.006,
        impactLevel: "low",
        sourceLabel: "MAX 示範行情",
      },
      {
        symbol: "DOGE",
        changeRatio: 0.004,
        impactLevel: "low",
        sourceLabel: "MAX 示範行情",
      },
      {
        symbol: "USDT",
        changeRatio: 0,
        impactLevel: "low",
        sourceLabel: "MAX 示範行情",
      },
    ],
    event: {
      id: "market_event_demo_btc_move",
      title: "BTC 今日出現中等幅度變動",
      sourceLabel: "示範市場情境",
    },
  },
  attributionInput: {
    modelVersion: "demo-estimated-attribution-v1",
    type: "estimated",
    periodStart: "2026-07-26T08:30:00+08:00",
    periodEnd: "2026-07-27T08:30:00+08:00",
    /*
     * effectUnits 是後端規則模型產出的無量綱相對影響值。
     * Adapter 會正規化並驗證總和；UI 不會看到這組 raw input。
     */
    components: [
      {
        id: "attribution-market",
        category: "marketPrice",
        label: "市場價格影響",
        effectUnits: 68,
        explanation: "依示範行情與目前持倉曝險估算。",
      },
      {
        id: "attribution-allocation",
        category: "allocation",
        label: "資產配置影響",
        effectUnits: 21,
        explanation: "主要持倉占比較高，放大了它對帳戶變化的影響。",
      },
      {
        id: "attribution-trades",
        category: "recentTrades",
        label: "近期交易影響",
        effectUnits: 7,
        explanation: "最近一次交易形成的部位仍有少量影響。",
      },
      {
        id: "attribution-other",
        category: "other",
        label: "其他",
        effectUnits: 4,
        explanation: "包含四捨五入與目前未細分的示範因素。",
      },
    ],
  },
  similarMomentInput: {
    id: "moment_demo_20260108",
    title: "這個情況，你以前遇過",
    confidence: "low",
    currentContext: {
      startDate: "2026-07-26T08:30:00+08:00",
      endDate: "2026-07-27T08:30:00+08:00",
      relatedAssets: ["BTC"],
      marketChangeSummary: "BTC 今日約變動 -1.8%（示範市場情境）。",
    },
    historicalContext: {
      startDate: "2026-01-08T00:00:00+08:00",
      endDate: "2026-01-09T23:59:59+08:00",
      relatedAssets: ["DOGE"],
      marketChangeSummary: "DOGE 在兩天內約變動 -7.4%（示範市場情境）。",
    },
    transactionRefs: [
      "2026-01-08T22:55:00+08:00",
      "2026-01-09T10:20:00+08:00",
    ],
    similarities: [
      "兩次都遇到關注資產出現較明顯的價格變化。",
      "兩次情境都有既有持倉可能受到影響。",
    ],
    differences: [
      "上次關注的是 DOGE，這次帳戶主要影響來源是 BTC。",
      "這次的示範市場變動幅度較小。",
    ],
    disclaimer: "相似情境只用來回顧，不代表市場會重複，也不是買賣建議。",
  },
  learningContent: {
    id: "learning_concentration_basics",
    title: "為什麼持倉集中會放大帳戶波動？",
    durationMinutes: 3,
    descriptionTemplate: "用你的主要持倉當例子，看懂資產占比和帳戶變化的關係。",
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
      headline: "BTC 是你今天帳戶變化的主要來源；最近 30 天的交易次數和前一個 30 天相同。",
      explanation: "示範行情中 BTC 今日約變動 -1.8%，且約占目前資產 52%；因此帳戶變化主要來自既有持倉，而不是近期新增交易。",
    },
    planAlignmentSummary: "可確認的投入節奏大致相近；主要持倉占比比前期快照提高，但持有時間仍需要更多資料才能完整對照。",
    attributionSummary: "依目前示範資料估算，今天的帳戶變化主要來自市場價格與主要持倉的組合影響，而不是近期交易。",
    similarMomentSummary: "兩次都是關注資產出現價格變化，但資產與幅度不同；這次目前沒有新增交易。",
    contextualQuestions: [
      { id: "question_btc_impact", text: "為什麼 BTC 會影響我的帳戶比較多？", contextType: "portfolio" },
      { id: "question_market_source", text: "今天的變化主要是市場造成的嗎？", contextType: "market" },
      { id: "question_rhythm", text: "我最近的交易節奏有變快嗎？", contextType: "behavior" },
      { id: "question_similar", text: "這次和 1 月那次有什麼不同？", contextType: "history", relatedMomentId: "moment_demo_20260108" },
      { id: "question_plan", text: "目前可確認的行為和我的長期目標一致嗎？", contextType: "behavior" },
    ],
  },
});
