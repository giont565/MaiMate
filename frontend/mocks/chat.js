/* Screen 7 對話用的固定 mock：知識庫條目、工具的使用者語言說法、空白對話的起手式。
 * 這裡**不放任何個人化數字**——持倉／交易／歸因一律由 Screen 6 既有 Adapter 現算，
 * 才不會出現「Screen 6 說 0.7 筆、Screen 7 說 4 次」這種前後頁互相打臉的狀況。
 * 不使用 Math.random：同一問題永遠得到同一結果。 */
"use strict";

window.MM_CHAT_MOCK = {
  /* 工具名 → 使用者語言（規格禁止顯示 tool name／JSON／trace） */
  toolLabels: {
    portfolio: "正在查看你的持倉摘要",
    transactions: "正在比較最近交易節奏",
    market: "正在整理相關市場資料",
    attribution: "正在拆解帳戶變化來源",
    planAlignment: "正在對照你原本的投資方向",
    similarMoment: "正在查找過去相似情況",
    knowledge: "正在確認金融名詞",
    profile: "正在讀取你的投資樣貌設定",
    homeInsight: "正在調出首頁那張卡的原始依據",
    insightRoute: "正在整理深入分析的入口",
  },
  toolDoneLabels: {
    portfolio: "持倉摘要",
    transactions: "最近交易行為",
    market: "市場資料",
    attribution: "帳戶變化來源",
    planAlignment: "原本的投資方向",
    similarMoment: "過去相似情況",
    knowledge: "金融知識庫",
    profile: "投資樣貌設定",
    homeInsight: "首頁洞察依據",
    insightRoute: "深入分析入口",
  },

  /* 知識庫（教育內容，不含任何個人資料；來源標示為教材名稱與更新日期） */
  knowledgeBase: [
    {
      id: "kb_concentration",
      keywords: ["資產集中", "集中", "配置集中", "concentration"],
      title: "什麼是資產集中",
      excerpt: "資產集中指的是資金明顯偏向少數幾種資產。集中度高時，單一資產的價格變化會更明顯地帶動整體帳戶；集中度低則相反。集中本身沒有好壞，重點是它是否符合你原本的投資方式。",
      sourceId: "MaiMate 投資名詞教材",
      updatedAt: "2026-06-30",
    },
    {
      id: "kb_market_depth",
      keywords: ["市場深度", "深度", "掛單簿", "depth"],
      title: "什麼是市場深度",
      excerpt: "市場深度是指在不同價格上，市場累積的買賣掛單數量。深度足夠時，較大的委託比較不會一次推動價格；深度不足時，同樣金額造成的價格變動會比較大。",
      sourceId: "MaiMate 投資名詞教材",
      updatedAt: "2026-06-30",
    },
    {
      id: "kb_order_type",
      keywords: ["市價單", "限價單", "市價", "限價"],
      title: "市價單和限價單的差別",
      excerpt: "市價單以當下可成交的價格立即成交，成交快但價格不確定；限價單指定價格，價格明確但不保證成交。兩者沒有優劣，取決於你更在意成交速度還是成交價格。",
      sourceId: "MaiMate 交易基礎教材",
      updatedAt: "2026-06-30",
    },
    {
      id: "kb_weight_volatility",
      keywords: ["持倉比例", "占比", "波動", "為什麼會影響"],
      title: "持倉比例為什麼影響帳戶波動",
      excerpt: "帳戶的整體變化，是各項資產變化依其占比加權後的結果。占比越高的資產，同樣的漲跌幅對整體帳戶的影響就越大，這是加權計算的性質，與該資產本身好壞無關。",
      sourceId: "MaiMate 投資名詞教材",
      updatedAt: "2026-06-30",
    },
    {
      id: "kb_fee",
      keywords: ["手續費", "maker", "taker", "費率"],
      title: "MAX 的掛單與吃單手續費",
      excerpt: "MAX 現貨的掛單（maker）費率為 0.08%，吃單（taker）費率為 0.16%。掛單是把委託掛在簿上等待成交，吃單則是直接吃掉簿上既有的委託。",
      sourceId: "MAX 官方費率說明",
      updatedAt: "2026-06-30",
    },
  ],

  /* 直接開啟聊天時的起手式（規格 §6 情境三） */
  emptyState: {
    title: "今天想從哪裡開始？",
    subtitle: "問麥麥市場、持倉、交易習慣或金融名詞都可以。決定始終在你手上。",
    quickQuestions: [
      { id: "q_today_relevant", text: "今天有哪些市場變化和我的持倉有關？" },
      { id: "q_portfolio_impact", text: "為什麼 BTC 會影響我的帳戶比較多？" },
      { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
      { id: "q_concentration_basics", text: "什麼是資產集中？" },
    ],
  },

  /* 安全邊界的替代回答（規格 §18；文字固定，不由模型生成） */
  safetyResponses: {
    restrictedRecommendation: {
      message: "我不能替你決定買入或賣出，但可以幫你整理目前主要持倉對帳戶的影響、你原本的投資目標，以及近期市場有哪些值得理解的變化。",
      alternatives: [
        { id: "alt_impact", text: "查看主要持倉對我的帳戶影響" },
        { id: "alt_plan", text: "回顧我原本的投資方向" },
        { id: "alt_market", text: "解釋近期市場變化" },
      ],
    },
    restrictedExecution: {
      message: "MaiMate 不會替你下單。我可以先幫你整理這個金額相對於目前持倉的比例，以及你原本設定的投資方向。",
      alternatives: [
        { id: "alt_ratio", text: "這筆金額占我目前持倉多少？" },
        { id: "alt_plan", text: "回顧我原本的投資方向" },
      ],
    },
    sensitiveCredential: {
      message: "我不會顯示、儲存或索取 API Key、私鑰或助記詞。這些資訊只該留在你自己手上。",
      alternatives: [{ id: "alt_privacy", text: "查看 MaiMate 怎麼使用我的資料" }],
    },
    fraudOrAbuse: {
      message: "這件事我沒辦法協助。麥麥能做的是解釋市場資訊、整理你的投資紀錄，以及說明金融名詞。",
      alternatives: [{ id: "alt_market", text: "解釋近期市場變化" }],
    },
    selfWorth: {
      message: "一段交易結果不能定義你的能力。麥麥可以幫你回顧資料裡出現的習慣與變化，但不會替你評分或貼標籤。",
      alternatives: [
        { id: "alt_behavior", text: "回顧我的交易習慣" },
        { id: "alt_plan", text: "回顧我原本的投資方向" },
      ],
    },
    unsupported: {
      message: "這個問題我目前沒有可靠的資料可以回答，所以不替你猜。你可以換個問法，或先看看和你帳戶有關的變化。",
      alternatives: [{ id: "alt_today", text: "今天有哪些變化和我有關？" }],
    },
  },
};
