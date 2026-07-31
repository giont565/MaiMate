/* Screen 7｜問麥麥：Service 層（工具、意圖分類、回覆組裝、Guardrails、對話保存、模擬串流）
 * 架構：UI → MaiMateConversationService →（工具層＝Screen 6 既有 Adapter）→ 結構化回覆
 * 天條：
 *   - 個人化數字一律來自工具當次結果；回覆送出前跑數字一致性檢查，對不上就不出。
 *   - 前端不呼叫 Bedrock、不放金鑰；正式版換 BedrockMaiMateConversationService 即可。
 *   - 不提供任何下單／提領／金鑰工具。Golden Path 的下單仍走既有 /chat → prepare_order → 使用者親自確認。
 * 保存策略（決策 5）：對話「清單」長存 localStorage，「內容」只存同分頁 sessionStorage 30 分鐘。
 */
"use strict";

(function initChatService() {
  const CORE = window.MM_CHAT_CORE;
  const MOCK = window.MM_CHAT_MOCK;
  const INDEX_KEY = "mm_chat_index";
  const CONTENT_PREFIX = "mm_chat_msgs_";
  const CONTENT_TTL_MS = 30 * 60 * 1000;

  let idCounter = 0;
  const nextId = (prefix) => prefix + "_" + (++idCounter) + "_" + String(Date.now()).slice(-6);
  /* 占比保留一位小數，和 Screen 4/5/6 一致：報告寫 98.6%，這裡不得寫成 99%
   * （整數不補 .0，例如 0.52 →「52%」）。 */
  const pct = (ratio) => {
    const value = Math.round(Number(ratio) * 1000) / 10;
    return (Number.isInteger(value) ? value : value.toFixed(1)) + "%";
  };
  const state = () => OnboardingStore.read();

  /* ── 對話保存 ── */
  const ConversationStore = {
    listConversations() {
      try {
        const list = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
        return Array.isArray(list) ? list.filter((item) => item && item.status !== "deleted") : [];
      } catch (_) { return []; }
    },
    saveConversation(conversation) {
      const list = this.listConversations().filter((item) => item.id !== conversation.id);
      // 清單只留必要欄位：標題／來源／時間／是否用到個人資料——不含訊息內容
      list.unshift({
        id: conversation.id,
        title: conversation.title,
        source: conversation.source,
        usesPersonalData: Boolean(conversation.usesPersonalData),
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });
      localStorage.setItem(INDEX_KEY, JSON.stringify(list.slice(0, 50)));
      try { sessionStorage.setItem(CONTENT_PREFIX + conversation.id + "_meta", JSON.stringify(conversation)); } catch (_) {}
    },
    getConversation(id) {
      try {
        const raw = sessionStorage.getItem(CONTENT_PREFIX + id + "_meta");
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return this.listConversations().find((item) => item.id === id) || null;
    },
    /** 內容過期＝清單還在、內容不還原（規格 §28「這段展示對話已過期」） */
    readMessages(id) {
      try {
        const raw = sessionStorage.getItem(CONTENT_PREFIX + id);
        if (!raw) return { messages: [], expired: false };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.messages)) return { messages: [], expired: false };
        if (Date.now() - Number(parsed.savedAt || 0) > CONTENT_TTL_MS) {
          sessionStorage.removeItem(CONTENT_PREFIX + id);
          return { messages: [], expired: true };
        }
        return { messages: parsed.messages, expired: false };
      } catch (_) { return { messages: [], expired: false }; }
    },
    writeMessages(id, messages) {
      try {
        sessionStorage.setItem(CONTENT_PREFIX + id, JSON.stringify({ savedAt: Date.now(), messages }));
      } catch (_) {}
    },
    deleteConversation(id) {
      const list = this.listConversations().filter((item) => item.id !== id);
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
      try {
        sessionStorage.removeItem(CONTENT_PREFIX + id);
        sessionStorage.removeItem(CONTENT_PREFIX + id + "_meta");
      } catch (_) {}
    },
  };

  /* ── 工具層：全部呼叫 Screen 6 既有 Adapter，數字自動與首頁一致 ── */
  const adapters = () => window.MM_HOME_SERVICES.adapters;

  const AgentTools = {
    portfolio() {
      const data = adapters().portfolio.read(state());
      if (!data.available) return null;
      return {
        assetCount: data.assetCount,
        topAsset: data.topAsset,
        // 顯示名稱與「是不是現金」決定文案要說「集中」還是「資金多在現金」
        topAssetLabel: data.topAssetLabel || data.topAsset,
        topAssetIsCash: Boolean(data.topAssetIsCash),
        topAssetRatio: data.topAssetRatio,
        topTwoAssetsRatio: data.topTwoAssetsRatio,
        // 報告只有最大持有標的與占比，其餘未細分
        breakdownAvailable: Boolean(data.breakdownAvailable),
        asOfMonth: data.asOfMonth || null,
        assets: data.assets,
      };
    },
    transactions() {
      const market = adapters().market.read();
      const data = adapters().transactions.read(state(), market.observedAt);
      return data.available ? data : null;
    },
    market() { return adapters().market.read(); },
    attribution() {
      const portfolio = adapters().portfolio.read(state());
      return adapters().attribution.read(portfolio, this.market());
    },
    similarMoment() {
      const metrics = this.transactions();
      return metrics ? adapters().similarMoment.read(metrics) : null;
    },
    profile() { return adapters().effectiveProfile.read(state(), false); },
    knowledge(query) {
      const text = String(query || "");
      return MOCK.knowledgeBase.find((entry) => entry.keywords.some((word) => text.includes(word))) || null;
    },
  };

  /* ── 意圖分類（規格 §18 的分類器；安全類優先於一般類）── */
  const INTENT_RULES = [
    { category: "sensitiveCredential", re: /(api\s*key|私鑰|助記詞|secret\s*key|密碼給我|顯示.*金鑰)/i },
    { category: "restrictedExecution", re: /(幫我(下單|買|賣|全倉|全部買|全部賣)|替我下單|自動下單|幫我操作)/ },
    { category: "restrictedRecommendation", re: /(該買|該賣|要不要買|要不要賣|哪個幣.*(漲|好)|會漲|保證獲利|報明牌|買什麼|推薦.*幣)/ },
    { category: "fraudOrAbuse", re: /(規避|繞過|風控|洗錢|假帳號)/ },
    { category: "selfWorth", re: /(我是不是很(爛|差)|我很失敗|我很笨)/ },
    { category: "allowedEducation", re: /(什麼是|名詞|意思是|差別|為什麼.*(比例|占比).*影響|手續費|市價單|限價單|市場深度)/ },
    /* 「1 月那筆 DOGE 賣出，當時發生什麼？」也是回顧題（首頁的 question_similar 會送這句），
     * 少了「當時／那筆／那次」會被誤判成市場題，答出完全無關的內容。 */
    { category: "allowedHistoricalReview", re: /(相似|過去|上一次|以前|之前那次|回顧|當時|那筆|那一次|那次)/ },
    { category: "allowedPersonalAnalysis", re: /(我的|帳戶|持倉|配置|交易節奏|習慣|一致|集中)/ },
  ];

  function classifyIntent(text) {
    const found = INTENT_RULES.find((rule) => rule.re.test(String(text || "")));
    return found ? found.category : "allowedExplanation";
  }

  /* ── 回覆組裝：每個主題都先取工具結果→做證據→再寫文字（文字只能引用證據裡的數字）── */
  const block = (type, payload) => ({ id: nextId("blk"), type, payload });

  function evidenceRef(id, sourceType, label, value, updatedAt) {
    return { id, sourceType, label, value: String(value), updatedAt };
  }

  function answerPortfolioImpact() {
    const portfolio = AgentTools.portfolio();
    const attribution = AgentTools.attribution();
    const market = AgentTools.market();
    if (!portfolio) return null;
    const topLabel = portfolio.topAssetLabel;
    const topPct = pct(portfolio.topAssetRatio);
    const otherPct = pct(1 - portfolio.topAssetRatio);
    const evidence = [
      evidenceRef("ev_top_weight", "portfolio", topLabel + " 占比", topPct, market.observedAt),
      /* 沒有各幣種比例時，「前兩項合計」等於 100%＝廢話且誤導；改列未細分的其餘部位。 */
      portfolio.breakdownAvailable
        ? evidenceRef("ev_top_two", "portfolio", "前兩項資產合計", pct(portfolio.topTwoAssetsRatio), market.observedAt)
        : evidenceRef("ev_other_weight", "portfolio", "其餘資產（報告未細分）", otherPct, market.observedAt),
    ];
    const marketShare = attribution &&
      attribution.contributors.find((item) => item.category === "marketPrice");
    if (marketShare) {
      evidence.push(evidenceRef("ev_attribution", "market", "今日帳戶變化中與市場價格有關的比重",
        pct(marketShare.contributionRatio), attribution.periodEnd));
    }
    /* 三段式：先回答 → 今天的資料（歸因＋交易節奏）→ 因此的結論。
     * 每個數字都先進 evidence 才准出現在文字裡（guardDraft 會逐一核對）。 */
    const tx = AgentTools.transactions();
    if (tx) {
      evidence.push(evidenceRef("ev_recent_month", "transactions",
        "最近一個月（" + tx.recentPeriodLabel + "）買賣", tx.recent30Count + " 筆"));
      evidence.push(evidenceRef("ev_trade_total", "transactions", "期間買賣總筆數",
        Number(tx.count).toLocaleString("en-US") + " 筆"));
      evidence.push(evidenceRef("ev_avg", "transactions", "期間平均每月", tx.averagePerMonth + " 筆"));
    }
    /* 最大持有是現金＝資金多停在現金（市場影響變小），
     * 和「持倉占比高所以影響大」結論相反，兩種說法不可共用。 */
    const directAnswer = portfolio.topAssetIsCash
      ? "你的資金約有 " + topPct + " 停在" + topLabel + "，所以市場變動對整體帳戶的直接影響有限。"
      : "因為 " + topLabel + " 約占你目前資產的 " + topPct +
        "，它的價格變化會比其他單一資產更明顯地反映在整體帳戶上。";
    const paragraphs = [portfolio.topAssetIsCash
      ? "帳戶整體變化，是各項資產的漲跌依占比加權後的結果。資金多在現金時，加密資產的漲跌帶動整體帳戶的幅度就比較小。"
      : "可以把帳戶想成一個籃子。占比越大的資產，移動時越容易帶動整個籃子的變化。"];
    const parts = [];
    if (marketShare) {
      parts.push("今天的資料顯示，帳戶變化中約 " + pct(marketShare.contributionRatio) + " 與市場價格變動有關");
    }
    if (tx) {
      parts.push("這段期間共有 " + Number(tx.count).toLocaleString("en-US") + " 筆買賣，平均每月約 " +
        tx.averagePerMonth + " 筆");
    }
    if (parts.length) paragraphs.push(parts.join("；") + "。");
    if (!portfolio.breakdownAvailable) {
      paragraphs.push("要再往下拆「哪一種資產影響最大」需要各幣種持倉比例，這份報告沒有提供，麥麥就不替你猜。");
    }
    const explanation = paragraphs.join("\n\n");
    const usedTools = ["portfolio"];
    if (marketShare) usedTools.push("attribution", "market");
    if (tx) usedTools.push("transactions");
    return {
      tools: usedTools,
      answer: { directAnswer, explanation },
      blocks: [
        block("metric", {
          title: "目前配置",
          items: [
            { label: topLabel + " 占比", value: topPct },
            portfolio.breakdownAvailable
              ? { label: "前兩項合計", value: pct(portfolio.topTwoAssetsRatio) }
              : { label: "其餘資產（未細分）", value: otherPct },
            portfolio.breakdownAvailable
              ? { label: "持有資產", value: portfolio.assetCount + " 項" }
              : { label: "各幣種持倉比例", value: "報告未提供" },
          ],
        }),
      ],
      evidence,
      limitations: portfolio.breakdownAvailable
        ? ["帳戶變化來源為依目前資料估算，不等同正式會計損益歸因。"]
        : ["這份報告只有最大持有標的與占比，沒有各幣種持倉比例。", "帳戶變化來源為依目前資料估算，不等同正式會計損益歸因。"],
      followUps: [
        { id: "q_allocation_change", text: "我的" + topLabel + "占比最近有變嗎？" },
        { id: "q_attribution_split", text: "今天主要是市場影響，還是我的交易？" },
        { id: "q_concentration_basics", text: "什麼是資產集中？" },
      ],
      insightLinks: [{ id: "insight_allocation_impact", title: "查看完整配置影響", route: "/maimate/insights/cash-concentration" }],
    };
  }

  /* 報告沒有各幣種持倉明細時拆不出變化來源：明說資料不足，
   * 不落到「這個問題我沒辦法回答」的通用模板，也不猜比例。 */
  function answerAttributionUnavailable() {
    const portfolio = AgentTools.portfolio();
    const market = AgentTools.market();
    if (!portfolio) return null;
    const primary = market.assets.find((item) => item.symbol === market.primaryAsset) || market.assets[0];
    const topLabel = portfolio.topAssetLabel;
    const topPct = pct(portfolio.topAssetRatio);
    return {
      tools: ["portfolio", "market"],
      answer: {
        directAnswer: "這份報告沒有各幣種持倉明細，所以麥麥沒辦法拆解今天帳戶變化的來源。",
        explanation: "可以確認的是：目前最大的一筆是" + topLabel + "，約占 " + topPct +
          "；示範行情中 " + primary.symbol + " 今日約變動 " + pct(primary.changeRatio) +
          "。要把變化拆成市場、配置、交易等來源，需要逐項持倉與對應價格，這些不在目前的資料裡。",
      },
      blocks: [
        block("metric", {
          title: "可確認的部分",
          items: [
            { label: topLabel + " 占比", value: topPct },
            { label: primary.symbol + " 今日變動", value: pct(primary.changeRatio) },
            { label: "各幣種持倉比例", value: "報告未提供" },
          ],
        }),
      ],
      evidence: [
        evidenceRef("ev_top_weight", "portfolio", topLabel + " 占比", topPct, market.observedAt),
        evidenceRef("ev_market", "market", primary.symbol + " 今日變動", pct(primary.changeRatio), market.observedAt),
      ],
      limitations: ["這份報告只有最大持有標的與占比，沒有各幣種持倉比例，因此不做變化來源拆解。"],
      followUps: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_portfolio_impact", text: "目前的資金分布對帳戶有什麼影響？" },
      ],
      insightLinks: [{ id: "insight_attribution_gap", title: "看麥麥還缺哪些資料", route: "/maimate/insights/account-change" }],
    };
  }

  function answerAttribution() {
    const attribution = AgentTools.attribution();
    if (!attribution) return answerAttributionUnavailable();
    const evidence = attribution.contributors.map((item, index) =>
      evidenceRef("ev_attr_" + index, "market", item.label, pct(item.contributionRatio), attribution.periodEnd));
    /* 期間本身帶數字（2025-12），一併列進 evidence，否則數字一致性護欄會擋掉整段回答。 */
    evidence.push(evidenceRef("ev_attr_period", "market", "估算期間",
      attribution.periodLabel || "最近 24 小時", attribution.periodEnd));
    /* 期間照上游給的寫：health_report 的歸因是整月聚合，講成「今天」會對不上。 */
    const periodLabel = attribution.periodLabel || "這段期間";
    const main = attribution.contributors[0];
    const trades = attribution.contributors.find((item) => item.category === "recentTrades");
    const funding = attribution.contributors.find((item) => item.category === "funding");
    const directAnswer = periodLabel + "帳戶的變化主要來自「" + main.label + "」，約占 " +
      pct(main.contributionRatio) + "。";
    const explanation = trades
      ? "近期交易的影響約 " + pct(trades.contributionRatio) + "，相對小很多，所以這次變化比較像是市場與配置造成的，而不是你最近做了什麼。"
      : funding && funding === main
        ? "也就是說，帳戶數字的變化主要是資金搬進搬出造成的，不是市場給的報酬——變大不代表投資成果變好。"
        : "其餘來源的比重都比較小。";
    return {
      tools: ["attribution", "market", "portfolio"],
      answer: { directAnswer, explanation },
      blocks: [
        block("comparison", {
          title: "帳戶變化來源",
          items: attribution.contributors.map((item) => ({ label: item.label, value: pct(item.contributionRatio) })),
        }),
      ],
      evidence,
      limitations: [
        "帳戶變化來源為依目前資料估算，不等同正式會計損益歸因。",
        "估算期間為" + periodLabel + "。",
      ],
      followUps: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_portfolio_impact", text: "為什麼主要持倉的影響比較大？" },
      ],
      insightLinks: [{ id: "insight_attribution", title: "查看完整變化來源拆解", route: "/maimate/insights/account-change" }],
    };
  }

  function answerTradingRhythm() {
    const tx = AgentTools.transactions();
    if (!tx) return null;
    /* 報告只有每月聚合，沒有逐筆日期：單位一律是「月」，也不能說「最近一次交易在幾天前」。 */
    const recentLabel = "最近一個月（" + tx.recentPeriodLabel + "）";
    const previousLabel = "前一個月（" + tx.previousPeriodLabel + "）";
    const totalText = Number(tx.count).toLocaleString("en-US") + " 筆";
    const evidence = [
      evidenceRef("ev_recent_month", "transactions", recentLabel + "買賣", tx.recent30Count + " 筆"),
      evidenceRef("ev_prev_month", "transactions", previousLabel + "買賣", tx.previous30Count + " 筆"),
      evidenceRef("ev_avg", "transactions", "期間平均每月", tx.averagePerMonth + " 筆"),
      evidenceRef("ev_total", "transactions", "期間買賣總筆數", totalText),
    ];
    const faster = Number(tx.recent30Count) > Number(tx.previous30Count);
    const directAnswer = faster
      ? "有變快一些：" + recentLabel + " " + tx.recent30Count + " 筆，" + previousLabel + " " + tx.previous30Count + " 筆。"
      : "看起來沒有變快：" + recentLabel + " " + tx.recent30Count + " 筆，" + previousLabel + " " + tx.previous30Count + " 筆。";
    const explanation = "整段期間共 " + totalText + "，平均每月約 " + tx.averagePerMonth +
      " 筆。這份報告只提供每月買賣筆數，沒有逐筆時間，所以麥麥只比較月份之間的多寡，不從次數推測你的心情或動機。";
    return {
      tools: ["transactions"],
      answer: { directAnswer, explanation },
      blocks: [
        block("comparison", {
          title: "交易節奏",
          items: [
            { label: recentLabel, value: tx.recent30Count + " 筆" },
            { label: previousLabel, value: tx.previous30Count + " 筆" },
            { label: "平均每月", value: tx.averagePerMonth + " 筆" },
          ],
        }),
      ],
      evidence,
      limitations: ["這份報告只有每月買賣筆數，沒有逐筆交易時間，因此無法比較交易日分布或持有間隔。"],
      followUps: [
        { id: "q_plan_alignment", text: "我的實際做法和原本的方向一致嗎？" },
        { id: "q_similar_moment", text: "過去遇到類似情況時我怎麼做？" },
      ],
      insightLinks: [{ id: "insight_trading_rhythm", title: "看完整的 12 個月交易節奏", route: "/maimate/insights/trading-rhythm" }],
    };
  }

  function answerPlanAlignment() {
    const profile = AgentTools.profile();
    const tx = AgentTools.transactions();
    if (!profile || !tx) return null;
    // originalPlanItems 是 {id,label,source} 物件，直接 join 會印出 [object Object]
    const plans = profile.originalPlanItems.slice(0, 3)
      .map((item) => (typeof item === "string" ? item : String(item && item.label || "")))
      .filter(Boolean);
    const recentLabel = "最近一個月（" + tx.recentPeriodLabel + "）";
    const evidence = [
      evidenceRef("ev_plan", "questionnaire", "你原本選的方向", plans.join("、") || "尚未填寫"),
      evidenceRef("ev_recent_month", "transactions", recentLabel + "買賣", tx.recent30Count + " 筆"),
      evidenceRef("ev_avg", "transactions", "期間平均每月", tx.averagePerMonth + " 筆"),
    ];
    return {
      tools: ["profile", "transactions"],
      answer: {
        directAnswer: "從目前資料看，你最近的做法和原本設定的方向大致沒有衝突。",
        explanation: "你原本選的是「" + (plans[0] || "尚未填寫") + "」，" + recentLabel + "有 " + tx.recent30Count +
          " 筆買賣，期間平均每月約 " + tx.averagePerMonth + " 筆。麥麥只做對照，不替你打分數，也不會說哪一種比較好。",
      },
      blocks: [
        block("comparison", {
          title: "原本的方向 vs 最近的行為",
          items: [
            { label: "原本的方向", value: plans.join("、") || "尚未填寫" },
            { label: recentLabel, value: tx.recent30Count + " 筆買賣" },
          ],
        }),
      ],
      evidence,
      limitations: ["這是方向上的對照，不是投資能力或績效評分。"],
      followUps: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_portfolio_impact", text: "目前配置對帳戶的影響有多大？" },
      ],
      insightLinks: [{ id: "insight_plan_alignment", title: "看完整的方向對照", route: "/maimate/insights/plan-alignment" }],
    };
  }

  function answerSimilarMoment() {
    const moment = AgentTools.similarMoment();
    if (!moment) return null;
    const source = moment.sourceEvent || {};
    const evidence = [
      evidenceRef("ev_moment", "historicalMoment", "可回顧的紀錄", moment.historicalContext.periodLabel || moment.title),
      evidenceRef("ev_moment_market", "market", "當時市場情況", moment.historicalContext.marketChangeSummary),
    ];
    /* 回答文字會提到這筆賣出的機會成本金額 → 必須先進 evidence，
     * 否則 chat-core 的數字一致性檢查會把整段換成安全模板。 */
    if (source.missedText) {
      evidence.push(evidenceRef("ev_moment_missed", "historicalMoment",
        "這筆賣出的機會成本", source.missedText));
    }
    return {
      tools: ["similarMoment", "transactions"],
      answer: {
        directAnswer: "資料裡找得到一次比較接近的情況：" + (moment.historicalContext.periodLabel || moment.title) + "。",
        explanation: moment.userBehaviorThen.join(" ") + " " + moment.userBehaviorNow.join(" "),
      },
      blocks: [
        block("timeline", {
          title: "那一次 vs 這一次",
          items: [
            { label: "那一次", value: moment.historicalContext.marketChangeSummary },
            { label: "這一次", value: moment.currentContext.marketChangeSummary },
          ],
        }),
      ],
      evidence,
      limitations: [moment.disclaimer, "相似情境只用來回顧，不代表市場會重複。"],
      followUps: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_attribution_split", text: "今天的變化主要來自哪裡？" },
      ],
      insightLinks: [{ id: "insight_similar_moment", title: "比較這次與那次的完整脈絡", route: "/maimate/insights/notable-sell" }],
    };
  }

  /* 知識庫條目 → Screen 8 名詞頁的 insightId（同一份教材，兩個畫面共用） */
  const KB_INSIGHT_ROUTES = {
    kb_concentration: "/maimate/insights/concentration-basics",
    kb_market_depth: "/maimate/insights/market-depth",
    kb_order_type: "/maimate/insights/order-types",
    kb_weight_volatility: "/maimate/insights/weight-volatility",
    kb_fee: "/maimate/insights/fee-basics",
  };

  function answerKnowledge(text) {
    const entry = AgentTools.knowledge(text);
    if (!entry) return null;
    const route = KB_INSIGHT_ROUTES[entry.id] || "/maimate/insights";
    return {
      tools: ["knowledge"],
      answer: { directAnswer: entry.excerpt.split("。")[0] + "。", explanation: entry.excerpt },
      blocks: [
        block("glossaryLink", {
          title: entry.title,
          sourceId: entry.sourceId,
          updatedAt: entry.updatedAt,
          route,
        }),
      ],
      evidence: [evidenceRef("ev_kb_" + entry.id, "knowledgeBase", entry.title, entry.sourceId, entry.updatedAt)],
      limitations: ["這是一般性的名詞說明，沒有帶入你的個人資料。"],
      followUps: [
        { id: "q_portfolio_impact", text: "那我目前的配置狀況如何？" },
        { id: "q_today_relevant", text: "今天有哪些變化和我有關？" },
      ],
      insightLinks: [{ id: "insight_glossary", title: "深入了解「" + entry.title + "」", route }],
    };
  }

  function answerTodayRelevant() {
    const market = AgentTools.market();
    const portfolio = AgentTools.portfolio();
    if (!portfolio) return null;
    /* 報告沒有各幣種持倉比例時，行情資產與持倉的交集會是空的。
     * 這時不得回「BTC 持倉占比 0%」——那是誤導，不是事實。 */
    const held = market.assets.filter((asset) =>
      portfolio.assets.some((item) => item.symbol === asset.symbol));
    const primary = held[0] ||
      market.assets.find((asset) => asset.symbol === market.primaryAsset) ||
      market.assets[0];
    const matched = held.length > 0;
    const topLabel = portfolio.topAssetLabel;
    const topPct = pct(portfolio.topAssetRatio);
    const evidence = [
      evidenceRef("ev_market", "market", primary.symbol + " 今日變動", pct(primary.changeRatio), market.observedAt),
      matched
        ? evidenceRef("ev_top_weight", "portfolio", primary.symbol + " 持倉占比",
          pct((portfolio.assets.find((item) => item.symbol === primary.symbol) || { weight: 0 }).weight), market.observedAt)
        : evidenceRef("ev_top_weight", "portfolio", topLabel + " 占比", topPct, market.observedAt),
    ];
    return {
      tools: ["market", "portfolio"],
      answer: {
        directAnswer: matched
          ? "今天和你比較有關的是 " + primary.symbol + "：變動約 " + pct(primary.changeRatio) + "。"
          : "今天市場上比較明顯的是 " + primary.symbol + "：變動約 " + pct(primary.changeRatio) + "。",
        explanation: matched
          ? "因為它在你的持倉裡占比較高，所以同樣的市場變動，反映到你帳戶上的幅度會比其他資產明顯。"
          : "你目前最大的一筆是" + topLabel + "，約占 " + topPct +
            "；這份報告沒有各幣種持倉比例，所以無法對照你持有多少這項資產。以整體帳戶來看，這類變動的直接影響有限。",
      },
      blocks: [
        block("metric", {
          title: "今天的市場",
          items: (matched ? held : market.assets).slice(0, 3)
            .map((asset) => ({ label: asset.symbol, value: pct(asset.changeRatio) })),
        }),
      ],
      evidence,
      limitations: matched
        ? ["市場資料為示範情境，時間以資料標示為準。"]
        : ["市場資料為示範情境，時間以資料標示為準。", "這份報告沒有各幣種持倉比例，無法逐項對照你持有哪些資產。"],
      followUps: [
        { id: "q_attribution_split", text: "今天帳戶變化主要來自哪裡？" },
        { id: "q_portfolio_impact", text: "目前的資金分布對帳戶有什麼影響？" },
      ],
      insightLinks: [{ id: "insight_cash_concentration", title: "看你的資金目前放在哪裡", route: "/maimate/insights/cash-concentration" }],
    };
  }

  /* 主題路由：先分類再挑答法；答不出來就明說，不猜 */
  function buildTopicAnswer(text, intent) {
    if (intent === "allowedEducation") return answerKnowledge(text) || answerPortfolioImpact();
    if (intent === "allowedHistoricalReview") return answerSimilarMoment();
    if (/節奏|頻率|次數|變快|習慣/.test(text)) return answerTradingRhythm();
    if (/一致|目標|計畫|方向/.test(text)) return answerPlanAlignment();
    if (/來自|來源|市場還是|歸因|變化.*(哪|來)/.test(text)) return answerAttribution();
    if (/今天|最近.*市場|有關/.test(text)) return answerTodayRelevant();
    if (/影響|占比|集中|配置|持倉/.test(text)) return answerPortfolioImpact();
    return answerKnowledge(text) || answerTodayRelevant();
  }

  /* ── 語氣模式：同樣的數字，不同的深度（規格 §9）── */
  /* 版面風格只影響「說明深度與區塊數量」，不影響數字與證據：
   * 證據一律完整保留——文字裡出現的每個數字都必須查得到來源，
   * 截斷證據會讓數字一致性檢查誤判，也讓使用者查不到依據。 */
  function applyCommunicationStyle(draft, style) {
    const result = Object.assign({}, draft);
    if (style === "concise") {
      // 先給重點：保留結論與「今天的資料」那段，收起比喻與延伸說明
      const paragraphs = String(draft.answer.explanation || "").split("\n\n");
      result.answer = {
        directAnswer: draft.answer.directAnswer,
        explanation: paragraphs.length > 1 ? paragraphs.slice(1).join("\n\n") : paragraphs[0] || "",
      };
      result.blocks = draft.blocks.slice(0, 1);
    } else if (style === "guided") {
      result.blocks = draft.blocks.slice(0, 1);
    } // analytical：全部保留
    result.followUps = draft.followUps.slice(0, style === "concise" ? 2 : 4);
    return result;
  }

  /* ── 安全邊界回覆（文字固定，不由模型生成）── */
  function buildSafetyResponse(category) {
    const preset = MOCK.safetyResponses[category] || MOCK.safetyResponses.unsupported;
    return {
      tools: [],
      answer: { directAnswer: preset.message, explanation: "" },
      blocks: [block("boundaryNotice", { category, message: preset.message, alternatives: preset.alternatives })],
      evidence: [],
      limitations: [],
      followUps: preset.alternatives.map((item) => ({ id: item.id, text: item.text })),
      insightLinks: [],
      safetyBoundary: { category, message: preset.message, safeAlternatives: preset.alternatives },
    };
  }

  /* ── 組成最終訊息（含 Guardrails 與數字一致性檢查）── */
  function toAssistantMessage(conversationId, draft, mode) {
    const blocks = [];
    blocks.push(block("summary", { directAnswer: draft.answer.directAnswer }));
    if (draft.answer.explanation) blocks.push(block("text", { text: draft.answer.explanation }));
    draft.blocks.forEach((item) => blocks.push(item));
    // 順序＝本次參考 → 資料限制 → 你也可以接著問 → 深入了解
    if (draft.evidence.length) blocks.push(block("evidence", { items: draft.evidence, sources: draft.tools.slice() }));
    if (draft.limitations.length) blocks.push(block("dataScopeNotice", { items: draft.limitations }));
    if (draft.followUps.length) blocks.push(block("followUpQuestions", { questions: draft.followUps }));
    if (draft.insightLinks.length) blocks.push(block("insightLink", { links: draft.insightLinks }));
    if (mode === "limited") {
      blocks.unshift(block("dataScopeNotice", { items: ["目前未使用個人帳戶資料，以下是一般性的說明。"] }));
    }
    return {
      id: nextId("msg"),
      conversationId,
      role: "assistant",
      blocks,
      status: draft.safetyBoundary ? "blocked" : "completed",
      evidenceIds: draft.evidence.map((item) => item.id),
      toolExecutionIds: draft.tools.slice(),
      createdAt: new Date().toISOString(),
      safetyBoundary: draft.safetyBoundary || null,
    };
  }

  /** 產生前的最後把關：禁語掃描＋數字一致性。任一不過就換安全模板，不回傳原內容。 */
  function guardDraft(draft) {
    const forbidden = CORE.scanForbidden(draft);
    if (!forbidden.ok) {
      return { draft: buildSafetyResponse("restrictedRecommendation"), guard: forbidden.category };
    }
    const text = draft.answer.directAnswer + " " + (draft.answer.explanation || "");
    const numbers = CORE.validateNumberConsistency(text, draft.evidence);
    if (!numbers.ok) {
      return { draft: buildSafetyResponse("unsupported"), guard: "numberConsistency" };
    }
    return { draft, guard: null };
  }

  /* ── Mock 服務（決賽用）── */
  const MockMaiMateConversationService = {
    async createConversation(input) {
      const access = CORE.evaluateChatAccess(state());
      const profile = access.mode === "limited" ? null : AgentTools.profile();
      const now = new Date().toISOString();
      const conversation = {
        id: nextId("conv"),
        title: input && input.title ? String(input.title).slice(0, 40) : "與麥麥的對話",
        status: "active",
        source: (input && input.source) || "direct",
        context: CORE.validateIncomingContext(input && input.context, state()) || {},
        communicationStyle: profile ? profile.communicationStyle : "guided",
        usesPersonalData: access.mode !== "limited",
        createdAt: now,
        updatedAt: now,
      };
      ConversationStore.saveConversation(conversation);
      ConversationStore.writeMessages(conversation.id, []);
      return conversation;
    },

    async getConversation(id) { return ConversationStore.getConversation(id); },
    async listConversations() { return ConversationStore.listConversations(); },
    async listMessages(id) { return ConversationStore.readMessages(id); },

    /** 模擬串流：先跑完工具與驗證，再逐段輸出（規格 §15：不讓模型串到一半才發現數字錯） */
    sendMessage(conversationId, input, handlers) {
      const conversation = ConversationStore.getConversation(conversationId);
      const access = CORE.evaluateChatAccess(state());
      const text = String((input && input.text) || "").slice(0, 1000);
      const style = (conversation && conversation.communicationStyle) || "guided";
      const stored = ConversationStore.readMessages(conversationId).messages;
      const userMessage = {
        id: (input && input.clientMessageId) || nextId("msg"),
        conversationId,
        role: "user",
        blocks: [block("text", { text })],
        status: "completed",
        evidenceIds: [],
        toolExecutionIds: [],
        createdAt: new Date().toISOString(),
      };
      // 重試不得重複建立 user message
      const messages = stored.some((item) => item.id === userMessage.id) ? stored.slice() : stored.concat([userMessage]);
      ConversationStore.writeMessages(conversationId, messages);
      handlers.onAccepted && handlers.onAccepted(userMessage);

      let cancelled = false;
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));

      const intent = classifyIntent(text);
      const isSafety = ["sensitiveCredential", "restrictedExecution", "restrictedRecommendation", "fraudOrAbuse", "selfWorth"].includes(intent);
      let draft = null;
      let guardCategory = null;
      if (isSafety) {
        draft = buildSafetyResponse(intent === "selfWorth" ? "selfWorth" : intent);
        guardCategory = intent;
      } else if (access.mode === "limited") {
        draft = answerKnowledge(text) || buildSafetyResponse("unsupported");
      } else {
        const topic = buildTopicAnswer(text, intent);
        draft = topic ? applyCommunicationStyle(topic, style) : buildSafetyResponse("unsupported");
      }
      const guarded = guardDraft(draft);
      draft = guarded.draft;
      if (guarded.guard) guardCategory = guarded.guard;

      // 工具狀態 → 完成 → 逐段輸出
      draft.tools.forEach((tool, index) => {
        later(() => handlers.onToolStarted && handlers.onToolStarted(tool), 120 * (index + 1));
        later(() => handlers.onToolCompleted && handlers.onToolCompleted(tool), 120 * (index + 1) + 220);
      });
      const afterTools = 120 * (draft.tools.length + 1) + 260;
      later(() => {
        const assistant = toAssistantMessage(conversationId, draft, access.mode);
        handlers.onResponseStarted && handlers.onResponseStarted(assistant);
        const chunks = (draft.answer.directAnswer + (draft.answer.explanation ? "\n" + draft.answer.explanation : "")).match(/.{1,14}/gs) || [];
        chunks.forEach((chunk, index) => later(() => handlers.onDelta && handlers.onDelta(chunk), 45 * (index + 1)));
        later(() => {
          const finalMessages = ConversationStore.readMessages(conversationId).messages.concat([assistant]);
          ConversationStore.writeMessages(conversationId, finalMessages);
          if (conversation) {
            conversation.updatedAt = new Date().toISOString();
            conversation.lastMessageAt = conversation.updatedAt;
            if (conversation.title === "與麥麥的對話" && text) conversation.title = text.slice(0, 20);
            ConversationStore.saveConversation(conversation);
          }
          handlers.onCompleted && handlers.onCompleted(assistant, { intent, guardCategory, style });
        }, 45 * (chunks.length + 1));
      }, afterTools);

      return {
        cancel() {
          cancelled = true;
          timers.forEach(clearTimeout);
          handlers.onCancelled && handlers.onCancelled();
        },
      };
    },

    async submitMessageFeedback(messageId, feedback) {
      // Demo：只記事件，不保存自由文字（規格 §26：Analytics 不記錄文字）
      return { messageId, value: feedback && feedback.value };
    },
    async deleteConversation(id) { ConversationStore.deleteConversation(id); },
  };

  /* ── 正式服務骨架 ──
   * TODO(正式 API)：後端目前只有 POST /chat（一次性 JSON，無 SSE）。
   *   規格的 /api/v1/maimate/conversations/* 與 SSE 事件流尚未存在，
   *   待與 A 包確認後在此實作；介面與 Mock 相同，UI 不需改。
   * TODO(navigation_context)：前端已在 Golden Path 送出，後端尚未消費。 */
  const BedrockMaiMateConversationService = Object.assign({}, MockMaiMateConversationService, {
    _formal: true,
  });

  window.MM_CHAT_SERVICES = Object.freeze({
    conversation: window.MM_USE_FORMAL_CHAT === true ? BedrockMaiMateConversationService : MockMaiMateConversationService,
    mock: MockMaiMateConversationService,
    formal: BedrockMaiMateConversationService,
    tools: AgentTools,
    classifyIntent,
    buildTopicAnswer,
    applyCommunicationStyle,
    guardDraft,
    store: ConversationStore,
  });
})();
