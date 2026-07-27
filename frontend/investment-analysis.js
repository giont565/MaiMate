/* Screen 4/5 確定性分析與 Service Layer。
 * UI 只呼叫 MM_INVESTMENT_SERVICES；不直接讀取 window.MM_ONBOARDING_MOCK。
 * TODO(正式 API)：將 active services 換成 MaiCoinInvestmentAnalysisService /
 * MaiCoinInvestmentProfileService。真正 Bedrock narrative 與 Guardrails 屬後端。
 */
"use strict";

const ANALYSIS_RULES = Object.freeze({
  concentratedTopRatio: 0.5,
  moderatelyConcentratedTopRatio: 0.35,
  minimumClosedLotsForHoldingPattern: 3,
  minimumMarkedTradesForVolatilityPattern: 4,
  clusteredGapDays: 2,
  fullCoverageMinimumTransactions: 24,
  sufficientCoverageMinimumTransactions: 8,
  stageDurationMs: 650,
});

const ANALYSIS_STAGE_DEFINITIONS = Object.freeze([
  { key: "dataPreparation", title: "整理你授權的資料", description: "確認持倉、交易紀錄與可用的資料範圍。" },
  { key: "portfolioAnalysis", title: "看看資產怎麼分布", description: "整理持有項目、占比與集中情況。" },
  { key: "behaviorAnalysis", title: "回顧買賣與持有節奏", description: "觀察交易頻率、持有時間與可確認的行為模式。" },
  { key: "questionnaireMerge", title: "對照你的目標與偏好", description: "把帳戶紀錄和補充問卷放在一起理解。" },
  { key: "profileGeneration", title: "整理成你的投資樣貌", description: "將觀察結果轉成適合你的白話摘要。" },
]);

const analysisRuntime = {
  failRequests: false,
  narrativeAvailable: true,
};

function round(value, digits) {
  const factor = 10 ** (digits || 0);
  return Math.round(value * factor) / factor;
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function currentAuthorizedData() {
  const state = OnboardingStore.read();
  const mock = window.MM_ONBOARDING_MOCK;
  const scopes = state.consent ? state.consent.grantedScopes : [];
  /* 真實帳戶報告只有聚合值：交易給每月次數，入出金給筆數與比例，
   * 逐筆明細（transactions）一律是空陣列——需要明細的指標會照規則顯示「資料不足」。 */
  return {
    portfolio: scopes.includes("portfolio") ? mock.demoPortfolio : null,
    transactions: [],
    tradeActivity: scopes.includes("transactions") ? mock.tradeActivity : null,
    behavior: scopes.includes("transactions") ? mock.behavior : null,
    funding: scopes.includes("fundingHistory") && mock.behavior
      ? { withdrawalCount: mock.behavior.withdrawalCount, withdrawalsAfterDropPct: mock.behavior.withdrawalsAfterDropPct }
      : null,
    notableSell: scopes.includes("transactions") ? mock.notableSell : null,
    profile: state.profile || null,
  };
}

function calculateCoverage(data) {
  const activity = data.tradeActivity;
  const tradeCount = activity ? Number(activity.total) : 0;
  const months = activity && activity.perMonth ? Object.keys(activity.perMonth).length : 0;
  const coverageDays = months ? Math.round(months * 30.4375) : 0;
  const missingFields = [];
  if (!data.portfolio) missingFields.push("portfolio");
  if (!tradeCount) missingFields.push("transactions");
  if (!data.funding) missingFields.push("fundingHistory");
  if (!data.profile || data.profile.status !== "completed") missingFields.push("questionnaire");
  let coverage = "limited";
  if (tradeCount >= ANALYSIS_RULES.fullCoverageMinimumTransactions && data.portfolio && data.profile && data.profile.status === "completed") coverage = "full";
  else if (tradeCount >= ANALYSIS_RULES.sufficientCoverageMinimumTransactions && data.portfolio) coverage = "sufficient";
  return {
    coverage,
    portfolioAvailable: Boolean(data.portfolio),
    transactionCount: tradeCount,
    transactionCoverageDays: coverageDays,
    transactionDetailAvailable: false,
    fundingHistoryAvailable: Boolean(data.funding),
    questionnaireCompleted: Boolean(data.profile && data.profile.status === "completed"),
    questionnaireAnswerCount: data.profile && data.profile.status === "completed"
      ? ["experienceLevel", "investmentGoals", "holdingHorizon", "volatilityResponse", "helpPriorities", "communicationStyle"]
        .filter((key) => data.profile[key] != null).length
      : 0,
    /* 報告只給「最大持有標的與占比」，其餘未細分 → 持有幾項資產是未知數，
     * 留 null 讓畫面顯示「報告未提供」，不得把「最大持有＋其餘」數成 2 項當事實。 */
    assetBreakdownAvailable: Boolean(data.portfolio && data.portfolio.breakdownAvailable),
    assetCount: data.portfolio && data.portfolio.breakdownAvailable ? data.portfolio.assets.length : null,
    missingFields,
  };
}

function calculateAllocation(data) {
  if (!data.portfolio || !data.portfolio.assets.length) {
    return {
      assetCount: null, topAssetRatio: null, topTwoAssetsRatio: null, allocationByAsset: [],
      concentrationLevel: "insufficientData", topAssetLabel: null, topAssetIsCash: false, breakdownAvailable: false,
    };
  }
  const allocation = data.portfolio.assets.map((asset) => ({
    symbol: asset.symbol,
    label: String(asset.label || asset.symbol),
    isCash: Boolean(asset.isCash),
    ratio: Number(asset.weight),
    refValue: Number(asset.refValue),
  })).sort((a, b) => b.ratio - a.ratio);
  const top = allocation[0].ratio;
  const breakdownAvailable = Boolean(data.portfolio.breakdownAvailable);
  return {
    assetCount: breakdownAvailable ? allocation.length : null,
    topAssetRatio: top,
    topAssetLabel: allocation[0].label,
    /* 最大持有是現金＝資金多停在現金（保守），和「持倉過度集中」語意相反，不可共用文案。 */
    topAssetIsCash: allocation[0].isCash,
    breakdownAvailable,
    // 沒有各幣種比例時，「前兩項合計」等於「最大持有＋其餘」＝100%，是廢話也是誤導
    topTwoAssetsRatio: breakdownAvailable
      ? allocation.slice(0, 2).reduce((sum, item) => sum + item.ratio, 0)
      : null,
    allocationByAsset: allocation,
    concentrationLevel: top >= ANALYSIS_RULES.concentratedTopRatio
      ? "concentrated"
      : top >= ANALYSIS_RULES.moderatelyConcentratedTopRatio ? "moderatelyConcentrated" : "diversified",
  };
}

function calculateTrading(data) {
  /* 交易節奏改由每月聚合算：報告有每月次數與買賣總數，
   * 但沒有逐筆時間 → 交易日數、間隔中位數、群聚比例一律留 null（不猜）。 */
  const activity = data.tradeActivity;
  if (!activity || !Number(activity.total)) {
    return { tradesPerMonth: null, activeTradingDays: null, medianDaysBetweenTrades: null, buySellRatio: null, clusteredTradeRatio: null, tradingRhythm: "insufficientData" };
  }
  const tradesPerMonth = round(Number(activity.averagePerMonth), 1);
  const buys = Number(activity.buyTotal);
  const sells = Number(activity.sellTotal);
  let tradingRhythm = "occasional";
  if (tradesPerMonth >= 8) tradingRhythm = "active";
  else if (tradesPerMonth >= 2) tradingRhythm = "regular";
  return {
    tradesPerMonth,
    activeTradingDays: null,
    medianDaysBetweenTrades: null,
    buySellRatio: sells ? round(buys / sells, 1) : null,
    clusteredTradeRatio: null,
    tradingRhythm,
  };
}

function calculateHolding(data) {
  const lots = {};
  const closedDays = [];
  data.transactions.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).forEach((tx) => {
    lots[tx.symbol] = lots[tx.symbol] || [];
    if (tx.side === "buy") lots[tx.symbol].push({ amount: Number(tx.amount), time: tx.time });
    if (tx.side !== "sell") return;
    let remaining = Number(tx.amount);
    while (remaining > 0 && lots[tx.symbol].length) {
      const lot = lots[tx.symbol][0];
      const used = Math.min(remaining, lot.amount);
      closedDays.push(daysBetween(lot.time, tx.time));
      lot.amount -= used;
      remaining -= used;
      if (lot.amount <= 1e-12) lots[tx.symbol].shift();
    }
  });
  const enough = closedDays.length >= ANALYSIS_RULES.minimumClosedLotsForHoldingPattern;
  if (!enough) {
    return { estimatedMedianHoldingDays: null, closedLotCount: closedDays.length, holdingPattern: "insufficientData" };
  }
  const med = median(closedDays);
  return {
    estimatedMedianHoldingDays: round(med, 0),
    closedLotCount: closedDays.length,
    holdingPattern: med < 30 ? "shortTerm" : med <= 180 ? "mediumTerm" : "longTerm",
  };
}

function calculateVolatility(data) {
  const marked = data.transactions.filter((item) => typeof item.marketRegime === "string");
  if (marked.length < ANALYSIS_RULES.minimumMarkedTradesForVolatilityPattern) {
    return { markedTradeCount: marked.length, volatilityBehavior: "insufficientData" };
  }
  return { markedTradeCount: marked.length, volatilityBehavior: "mixed" };
}

function supportPlanFromProfile(profile) {
  const priorities = profile && Array.isArray(profile.helpPriorities) ? profile.helpPriorities : [];
  const plan = [];
  if (profile && profile.communicationStyle === "concise") {
    plan.push({ id: "communication-concise", title: "先說重點", description: "先提供三行內的摘要，需要時再展開數據與名詞。", priority: 1, source: "questionnaire" });
  } else if (profile && profile.communicationStyle === "analytical") {
    plan.push({ id: "communication-analytical", title: "保留數據脈絡", description: "呈現計算依據與更多背景，方便你深入查看。", priority: 1, source: "questionnaire" });
  } else {
    plan.push({ id: "communication-guided", title: "先用白話說明", description: "減少術語，補上簡單例子與每個數據代表的意思。", priority: 1, source: "questionnaire" });
  }
  if (priorities.includes("newsToHoldings")) {
    plan.push({ id: "support-market-context", title: "先連結主要持倉", description: "市場有明顯變化時，先說明哪些主要持倉可能受到影響。", priority: 2, source: "questionnaire" });
  }
  if (priorities.includes("riskAlerts")) {
    plan.push({ id: "support-concentration", title: "提醒配置變化", description: "主要資產占比變化較大時，提醒你查看目前配置。", priority: 2, source: "questionnaire" });
  }
  if (priorities.includes("planReview")) {
    plan.push({ id: "support-plan-review", title: "回顧原本目標", description: "回顧可確認的交易節奏，是否與你設定的目標一致。", priority: 2, source: "questionnaire" });
  }
  if (priorities.includes("termExplain")) {
    plan.push({ id: "support-terms", title: "補充名詞背景", description: "遇到專有名詞時，先用白話補充背景與例子。", priority: 3, source: "questionnaire" });
  }
  if (priorities.includes("dailyDigest")) {
    plan.push({ id: "support-digest", title: "每天只留重要資訊", description: "先整理少量重點，避免一次出現過多資訊。", priority: 3, source: "questionnaire" });
  }
  if (priorities.includes("habitInsight")) {
    plan.push({ id: "support-habit", title: "用紀錄整理節奏", description: "只引用可確認的資料，不替你貼人格或能力標籤。", priority: 3, source: "questionnaire" });
  }
  if (plan.length === 1) {
    plan.push({ id: "support-evidence", title: "附上資料依據", description: "每個觀察都保留來源，讓你知道麥麥為什麼這樣整理。", priority: 2, source: "profile" });
    plan.push({ id: "support-update", title: "隨資料慢慢更新", description: "資料增加後再更新樣貌，不把這次結果永久定型。", priority: 3, source: "profile" });
  }
  return plan.slice(0, 4);
}

function profileTagsFromMetrics(coverage, allocation, trading, profile) {
  const tags = [];
  /* 節奏標籤跟著實際頻率走（不是只有 occasional 才給標籤，否則高頻帳戶會沒有節奏標籤）。 */
  if (trading.tradingRhythm === "occasional") tags.push({ id: "occasional-rhythm", label: "偶爾調整持倉", sourceDimension: "tradingRhythm" });
  else if (trading.tradingRhythm === "regular") tags.push({ id: "regular-rhythm", label: "有固定的交易節奏", sourceDimension: "tradingRhythm" });
  else if (trading.tradingRhythm === "active") tags.push({ id: "active-rhythm", label: "交易相當頻繁", sourceDimension: "tradingRhythm" });
  /* 最大持有是現金＝資金多停在現金，不是「持倉集中」——兩者結論相反。 */
  if (allocation.topAssetIsCash) tags.push({ id: "cash-heavy-allocation", label: "資金主要停在現金", sourceDimension: "allocationPattern" });
  else if (allocation.concentrationLevel === "concentrated") tags.push({ id: "concentrated-allocation", label: "主要持倉較集中", sourceDimension: "allocationPattern" });
  if (!coverage.transactionDetailAvailable && coverage.transactionCount) {
    tags.push({ id: "aggregate-only", label: "只有聚合資料，無逐筆明細" });
  }
  if (coverage.missingFields.includes("questionnaire")) tags.push({ id: "questionnaire-pending", label: "問卷稍後補充" });
  else if (profile && profile.communicationStyle === "concise") tags.push({ id: "concise-style", label: "偏好先看重點" });
  else if (profile && profile.communicationStyle === "analytical") tags.push({ id: "analytical-style", label: "偏好多一點數據" });
  else tags.push({ id: "guided-style", label: "偏好白話解釋" });
  if (coverage.coverage !== "full") tags.push({ id: "data-growing", label: "部分資料仍在累積" });
  return tags.slice(0, 5);
}

function correctionCopy(dimensionKey, correctionCode) {
  const copy = {
    tradingRhythm: {
      recurring_contribution: ["主要依固定安排投入", "你補充多數交易來自固定安排；麥麥會保留原始交易日期，同時把這個情境納入後續說明。"],
      recent_event: ["近期節奏受特殊事件影響", "近期交易較集中可能與特殊事件有關；這是你的補充，不會改寫原始交易紀錄。"],
      platform_transfer: ["近期因平台或資產轉換較集中", "你補充近期操作與平台或資產轉換有關；後續說明會先區分這段特殊情境。"],
      frequency_lower: ["平常交易頻率比近期更低", "你認為目前資料高估了平常交易頻率；麥麥會把這項修正與原始數據並列使用。"],
      frequency_higher: ["平常交易頻率比資料顯示更高", "你認為目前資料未涵蓋全部交易；麥麥會標記資料範圍限制，不補造缺少的紀錄。"],
      other: ["交易節奏需要更多背景", "你補充目前描述未涵蓋全部情境；麥麥會保留原始結果並在後續說明中標記。"],
    },
    holdingPattern: {
      planned_longer: ["原本計畫持有更久", "你補充原本的持有計畫較長；這是目標背景，不會被描述成已發生的持有行為。"],
      different_purposes: ["不同資產有不同用途", "你補充不同資產的持有目的不一；後續不會用單一時間標籤概括全部部位。"],
      conversion_only: ["部分交易只是轉換", "你補充部分買賣屬於資產轉換；麥麥會在解釋持有節奏時保留這個背景。"],
      timing_mismatch: ["持有時間描述仍需調整", "你認為目前推估不符合實際情況；原始推估仍保留，後續以資料不足方式呈現。"],
      other: ["持有方式需要更多背景", "你補充目前描述未涵蓋全部情境；麥麥不會勉強替你定型。"],
    },
    allocationPattern: {
      specific_purpose: ["部分資產有特定用途", "你補充部分資產另有用途；原始持倉比例仍保留，後續說明會附上這項背景。"],
      external_assets: ["還有其他平台資產未納入", "你補充目前資料未涵蓋其他平台資產；麥麥會明示資料範圍，不推算缺少的配置。"],
      rebalancing: ["近期正在調整配置", "你補充目前配置仍在調整中；後續會把它描述為目前快照，而不是固定狀態。"],
      temporary_state: ["目前只是短期配置", "你補充這是短期狀態；原始比例仍保留，後續不會把它永久定型。"],
      other: ["配置樣貌需要更多背景", "你補充目前描述未涵蓋全部情境；麥麥會保留原始結果與你的修正。"],
    },
    volatilityBehavior: {
      checking_only: ["通常只是查看，沒有操作", "你補充市場變化時多半只是查看；這項自述會與帳戶交易紀錄分開呈現。"],
      recent_need: ["近期有特殊需求", "你補充近期行為受特殊需求影響；麥麥不會把它概括成固定習慣。"],
      questionnaire_closer: ["問卷回答更接近實際情況", "你認為問卷自述更符合自己；後續會明確標示它來自你的回答。"],
      records_closer: ["交易紀錄更接近實際情況", "你認為帳戶紀錄較能代表近期狀況；後續仍不會從交易推測心理狀態。"],
      other: ["波動習慣需要更多資料", "你補充目前描述仍不完整；麥麥會保留資料不足的結論。"],
    },
  };
  return copy[dimensionKey] && copy[dimensionKey][correctionCode];
}

function buildEffectiveProfile(original, corrections) {
  const correctionList = Object.values(corrections || {});
  const appliedCorrections = correctionList.filter((item) => item.selectedCorrection || item.note);
  const effectiveDimensions = original.dimensions.map((dimension) => {
    const correction = correctionList.find((item) => item.dimensionKey === dimension.key);
    const applied = correction && correction.selectedCorrection ? correctionCopy(dimension.key, correction.selectedCorrection) : null;
    return {
      key: dimension.key,
      originalDescriptor: dimension.descriptor,
      effectiveDescriptor: applied ? applied[0] : dimension.descriptor,
      effectiveExplanation: applied ? applied[1] : dimension.explanation,
      correctionApplied: Boolean(applied),
    };
  });
  const supportPlan = original.supportPlan.slice();
  if (appliedCorrections.length) {
    supportPlan.unshift({
      id: "support-user-context",
      title: "先帶入你補充的情境",
      description: "後續說明會保留原始數據，同時把你確認過的背景一起納入。",
      priority: 0,
      source: "userCorrection",
    });
  }
  return {
    originalResultId: original.id,
    effectiveHeadline: appliedCorrections.length ? "麥麥會保留原始資料，也把你補充的情境一起記下來。" : original.profileHeadline,
    dimensions: effectiveDimensions,
    supportPlan: supportPlan.slice(0, 4),
    userCorrections: appliedCorrections,
    updatedAt: new Date().toISOString(),
  };
}

function fallbackResult(job, data, generatedBy) {
  const coverage = calculateCoverage(data);
  const allocation = calculateAllocation(data);
  const trading = calculateTrading(data);
  const holding = calculateHolding(data);
  const volatility = calculateVolatility(data);
  /* 占比保留一位小數：報告寫 98.6%，不得四捨五入成 99%（整數不補 .0）。 */
  const asPct = (ratio) => {
    if (ratio == null) return null;
    const value = Math.round(Number(ratio) * 1000) / 10;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
  const topPct = asPct(allocation.topAssetRatio);
  const topTwoPct = asPct(allocation.topTwoAssetsRatio);
  const otherPct = allocation.topAssetRatio == null ? null : asPct(1 - allocation.topAssetRatio);
  const topLabel = allocation.topAssetLabel || "最大持有";
  const cashHeavy = Boolean(allocation.topAssetIsCash);
  const periodMonths = coverage.transactionCoverageDays ? Math.max(1, Math.round(coverage.transactionCoverageDays / 30.4375)) : 0;
  const tradingDataSufficient = coverage.transactionCount >= ANALYSIS_RULES.sufficientCoverageMinimumTransactions;
  /** @type {ProfileDimension[]} */
  const dimensions = [
    {
      key: "tradingRhythm",
      title: "你的投資節奏",
      descriptor: !coverage.transactionCount
        ? "還需要更多資料"
        : trading.tradingRhythm === "active" ? "交易相當頻繁"
        : trading.tradingRhythm === "regular" ? "有固定的交易節奏"
        : "偶爾調整，交易間隔較長",
      summary: !coverage.transactionCount
        ? "目前沒有可用的交易紀錄，無法整理交易節奏。"
        : !coverage.transactionDetailAvailable
        ? "目前只描述報告提供的每月買賣筆數，不直接推測操作原因。"
        : trading.tradingRhythm === "occasional"
        ? "這段期間的交易分散在不同日期，沒有每天頻繁進出。"
        : "目前只描述可確認的交易時間，不直接推測操作原因。",
      explanation: !coverage.transactionCount
        ? "交易紀錄尚未授權或目前不可用，麥麥不會把未知情況當成沒有交易。"
        : !coverage.transactionDetailAvailable
        ? "這份報告只有每月買賣筆數，沒有逐筆交易時間；麥麥只比較月份之間的多寡，不把頻率直接解讀成情緒。"
        : trading.tradingRhythm === "occasional"
        ? "這段期間的交易分布在不同日期，沒有呈現每天頻繁進出的情況。"
        : "麥麥只描述目前可見的交易時間，不把頻率直接解讀成情緒。",
      evidence: coverage.transactionCount ? [
        { id: "trades-per-month", label: "平均每月買賣", value: trading.tradesPerMonth == null ? "資料不足" : "約 " + trading.tradesPerMonth + " 筆", source: "transactions" },
        { id: "trade-total", label: "期間買賣總筆數", value: coverage.transactionCount.toLocaleString("en-US") + " 筆", source: "transactions" },
        { id: "coverage-period", label: "資料涵蓋", value: periodMonths ? "約 " + periodMonths + " 個月" : "資料不足", source: "transactions" },
      ] : [],
      dataSufficient: tradingDataSufficient,
    },
    {
      key: "holdingPattern",
      title: "你的持有方式",
      descriptor: holding.holdingPattern === "insufficientData" ? "還需要更多資料" : "以目前已完成交易估算",
      summary: holding.holdingPattern === "insufficientData"
        ? !coverage.transactionCount
          ? "目前沒有可用的交易紀錄，無法推算主要持有時間。"
          : !coverage.transactionDetailAvailable
          ? "這份報告沒有逐筆買賣紀錄，無法推算主要持有時間。"
          : "目前可配對的完整買賣紀錄太少，無法穩定推算主要持有時間。"
        : "這項結果只使用可配對的完整買賣紀錄。",
      explanation: holding.holdingPattern === "insufficientData"
        ? !coverage.transactionCount
          ? "交易紀錄尚未授權或目前不可用，麥麥不會用假設補出持有時間。"
          : !coverage.transactionDetailAvailable
          // 沒有逐筆明細時「只有 0 組」會被讀成「你沒有完整交易」，那是誤導
          ? "推算持有時間需要把每一筆買入和賣出配對，而這份報告只有每月聚合數字，沒有逐筆紀錄。"
          : "目前只有 " + holding.closedLotCount + " 組可配對的完整買賣紀錄，還無法穩定判斷主要持有時間。"
        : "這是由可配對的買賣紀錄推算，不包含尚未賣出的部位。",
      evidence: holding.holdingPattern === "insufficientData" ? [] : [
        { id: "holding-median", label: "推估持有中位數", value: holding.estimatedMedianHoldingDays + " 天", source: "transactions" },
      ],
      dataSufficient: holding.holdingPattern !== "insufficientData",
    },
    {
      key: "allocationPattern",
      title: "你的配置樣貌",
      /* 最大持有是現金＝資金多停在現金（保守），不是「集中在少數資產」。 */
      descriptor: topPct == null
        ? "還需要更多資料"
        : cashHeavy ? "資金主要停在現金"
        : allocation.concentrationLevel === "concentrated" ? "主要集中在少數資產" : "配置分布較平均",
      summary: topPct == null
        ? "目前持倉資料不足。"
        : cashHeavy
        ? "資金多數停在現金，市場價格變動反映到帳戶整體的幅度有限。"
        : "目前帳戶的變化，較容易受到主要持倉影響。",
      explanation: topPct == null
        ? "目前沒有足夠持倉資料可整理。"
        : cashHeavy
        ? "帳戶整體變化是各項資產依占比加權的結果；資金多在現金時，加密資產漲跌帶動整體帳戶的幅度會比較小。這只是配置現況，不代表好壞或投資能力。"
        : "目前帳戶的變化較容易受到主要持倉影響。這只是配置現況，不代表好壞或投資能力。",
      evidence: topPct == null ? [] : [
        { id: "top-asset", label: topLabel + " 占比", value: "約 " + topPct + "%", source: "portfolio" },
        allocation.breakdownAvailable
          ? { id: "top-two-assets", label: "前兩項資產合計", value: "約 " + topTwoPct + "%", source: "portfolio" }
          : { id: "other-assets", label: "其餘資產（未細分）", value: "約 " + otherPct + "%", source: "portfolio" },
        allocation.breakdownAvailable
          ? { id: "asset-count", label: "目前持有", value: allocation.assetCount + " 項資產", source: "portfolio" }
          : { id: "asset-count", label: "各幣種持倉比例", value: "報告未提供", source: "portfolio" },
      ],
      dataSufficient: topPct != null,
    },
    {
      key: "volatilityBehavior",
      title: "你面對波動的習慣",
      descriptor: "還需要更多資料",
      summary: coverage.transactionCount
        ? "現有交易紀錄沒有可靠的市場事件標記，無法確認波動期間的操作變化。"
        : "目前沒有可用的交易紀錄，無法確認波動期間的操作變化。",
      explanation: coverage.transactionCount
        ? "交易紀錄沒有可靠的市場事件標記，麥麥不會只靠買賣時間推測你面對波動時的反應。"
        : "交易紀錄尚未授權或目前不可用；若有問卷回答，也只會清楚標示為你的自述。",
      evidence: data.profile && data.profile.status === "completed" ? [
        { id: "declared-volatility", label: "問卷中你表示", value: volatilityQuestionLabel(data.profile.volatilityResponse), source: "questionnaire" },
      ] : [],
      dataSufficient: volatility.volatilityBehavior !== "insufficientData",
    },
  ];
  /* Hero 一句話跟著實際指標走：節奏用 tradingRhythm，配置用「是不是現金」先分流，
   * 寫死文案換一份資料就會和下方 dimension 卡自相矛盾。 */
  const concentrated = !cashHeavy && topPct != null && Number(topPct) >= 40;
  const rhythmPhrase = !coverage.transactionCount
    ? "交易紀錄還不足以描述節奏"
    : trading.tradingRhythm === "active" ? "你目前交易相當頻繁"
    : trading.tradingRhythm === "regular" ? "你目前有固定的交易節奏"
    : "你目前偶爾調整持倉";
  const allocationPhrase = topPct == null
    ? "持倉資料仍不足"
    : cashHeavy ? "資金主要停在現金"
    : concentrated ? "也把較多配置放在主要關注的資產" : "配置分布相對平均";
  const headline = coverage.coverage === "limited"
    ? "麥麥先整理出一個初步樣貌"
    : tradingDataSufficient
      ? rhythmPhrase + "，" + allocationPhrase + "。"
      : "目前紀錄還不多，可以先看出" + allocationPhrase + "。";
  const createdAt = new Date().toISOString();
  const summary = [
    tradingDataSufficient
      ? "這段期間共 " + coverage.transactionCount.toLocaleString("en-US") + " 筆買賣，平均每月約 " + trading.tradesPerMonth + " 筆；"
      : coverage.transactionCount
        ? "目前只有 " + coverage.transactionCount + " 筆可用交易紀錄，還無法穩定整理交易頻率；"
        : "目前沒有可用的交易紀錄，交易節奏仍是未知；",
    topPct == null
      ? "持倉資料尚未授權或目前不可用。"
      : cashHeavy
        ? "最大的一筆是" + topLabel + "，約占 " + topPct + "%，其餘 " + otherPct + "% 報告未細分。"
        : "最大持倉約占 " + topPct + "%，" + (concentrated ? "配置較集中於主要持倉。" : "配置分布相對平均。"),
    "持有時間與波動反應仍需要更多資料才能判斷。",
  ].join("");
  const stablePatterns = [];
  if (coverage.portfolioAvailable) {
    stablePatterns.push(coverage.assetBreakdownAvailable
      ? { id: "stable-asset-count", text: "目前持有 " + coverage.assetCount + " 項資產。", evidenceIds: ["asset-count"], sourceLabels: ["持倉資料"] }
      // 報告只給最大持有標的與占比，說「持有幾項資產」會是編造
      : { id: "stable-top-holding", text: "最大的一筆是" + topLabel + "，約占 " + topPct + "%。", evidenceIds: ["top-asset"], sourceLabels: ["持倉資料"] });
  }
  if (coverage.transactionCount) {
    stablePatterns.push({ id: "stable-trade-total", text: "這段期間共有 " + coverage.transactionCount.toLocaleString("en-US") + " 筆買賣紀錄。", evidenceIds: ["trade-total"], sourceLabels: ["交易紀錄"] });
  }
  if (data.profile && data.profile.status === "completed" && data.profile.investmentGoals.includes("longTermGrowth")) {
    stablePatterns.push({ id: "stable-declared-goal", text: "你在問卷中把長期累積列為目標。", evidenceIds: [], sourceLabels: ["補充問卷"] });
  }
  const attentionPoints = [];
  if (topPct == null) {
    attentionPoints.push({ id: "attention-concentration-limited", text: "目前持倉資料不足，還無法描述配置樣貌。", evidenceIds: [], sourceLabels: [] });
  } else if (cashHeavy) {
    attentionPoints.push({
      id: "attention-concentration",
      text: "資金約 " + topPct + "% 停在" + topLabel + "，市場變動對帳戶整體的直接影響有限。",
      evidenceIds: ["top-asset"],
      sourceLabels: ["持倉資料"],
    });
  } else {
    attentionPoints.push({ id: "attention-concentration", text: "最大持倉目前約占 " + topPct + "%，帳戶變化較容易受它影響。", evidenceIds: ["top-asset"], sourceLabels: ["持倉資料"] });
  }
  attentionPoints.push({
    id: "attention-limited-patterns",
    text: "持有方式與市場波動行為仍需要更多可確認資料。",
    evidenceIds: [],
    sourceLabels: coverage.transactionCount ? ["交易紀錄"] : [],
  });
  return {
    id: "profile_" + job.id.replace("analysis_", ""),
    userId: "demo-user",
    analysisJobId: job.id,
    dataVersion: job.dataVersion,
    resultVersion: "profile-rules-v1",
    status: "draft",
    profileHeadline: headline,
    summary,
    tags: profileTagsFromMetrics(coverage, allocation, trading, data.profile),
    coverage,
    dimensions,
    stablePatterns,
    attentionPoints,
    supportPlan: supportPlanFromProfile(data.profile),
    generatedBy: generatedBy || "rules",
    createdAt,
    updatedAt: createdAt,
  };
}

function volatilityQuestionLabel(value) {
  return {
    investigate: "先找原因再決定",
    followPlan: "依照原本計畫觀察",
    reduceExposure: "先確認是否減少部分部位",
    anxiousChecking: "需要較多解釋與安定資訊",
    unsure: "還不確定會如何反應",
  }[value] || "尚未補充";
}

function validateAnalysisJob(job) {
  if (!job || !job.id || !["queued", "running", "succeeded", "failed"].includes(job.status)) throw new Error("INVALID_ANALYSIS_JOB");
  if (!Array.isArray(job.stages) || job.stages.length !== ANALYSIS_STAGE_DEFINITIONS.length) throw new Error("INVALID_ANALYSIS_STAGES");
  return job;
}

function validateProfileResult(result) {
  if (!result || !result.id || !result.coverage || !result.profileHeadline || !result.summary || !result.updatedAt) throw new Error("INVALID_PROFILE_RESULT");
  if (!Array.isArray(result.tags) || !Array.isArray(result.dimensions) || result.dimensions.length !== 4) throw new Error("INVALID_PROFILE_RESULT");
  if (!Array.isArray(result.stablePatterns) || !Array.isArray(result.attentionPoints) || !Array.isArray(result.supportPlan)) throw new Error("INVALID_PROFILE_RESULT");
  result.dimensions.forEach((dimension) => {
    if (!dimension.key || !dimension.summary || !Array.isArray(dimension.evidence)) throw new Error("INVALID_PROFILE_DIMENSION");
  });
  return result;
}

function createJob(dataVersion) {
  const now = new Date().toISOString();
  return {
    id: "analysis_" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).replaceAll("-", "").slice(0, 12),
    status: "queued",
    progress: 0,
    currentStage: "dataPreparation",
    stages: ANALYSIS_STAGE_DEFINITIONS.map((stage) => ({ key: stage.key, status: "pending" })),
    dataVersion,
    createdAt: now,
    updatedAt: now,
  };
}

function reconcileJob(storedJob) {
  const job = JSON.parse(JSON.stringify(storedJob));
  if (job.status === "failed" || job.status === "succeeded") return job;
  const elapsed = Math.max(0, Date.now() - Date.parse(job.createdAt));
  const total = ANALYSIS_RULES.stageDurationMs * job.stages.length;
  if (analysisRuntime.failRequests && elapsed >= ANALYSIS_RULES.stageDurationMs) {
    job.status = "failed";
    job.errorCode = "DEMO_ANALYSIS_UNAVAILABLE";
    job.progress = Math.min(20, Math.round(elapsed / total * 100));
    job.stages[0].status = "failed";
  } else if (elapsed >= total) {
    job.status = "succeeded";
    job.progress = 100;
    job.currentStage = undefined;
    job.completedAt = new Date(Date.parse(job.createdAt) + total).toISOString();
    job.profileVersion = "profile-rules-v1";
    job.stages.forEach((stage, index) => {
      stage.status = "completed";
      stage.startedAt = new Date(Date.parse(job.createdAt) + index * ANALYSIS_RULES.stageDurationMs).toISOString();
      stage.completedAt = new Date(Date.parse(job.createdAt) + (index + 1) * ANALYSIS_RULES.stageDurationMs).toISOString();
    });
  } else {
    const currentIndex = Math.min(job.stages.length - 1, Math.floor(elapsed / ANALYSIS_RULES.stageDurationMs));
    job.status = "running";
    job.progress = Math.max(1, Math.round(elapsed / total * 100));
    job.currentStage = job.stages[currentIndex].key;
    job.stages.forEach((stage, index) => {
      stage.status = index < currentIndex ? "completed" : index === currentIndex ? "running" : "pending";
    });
  }
  job.updatedAt = new Date().toISOString();
  return job;
}

const MockInvestmentAnalysisService = {
  async startAnalysis(input) {
    await Promise.resolve();
    const state = OnboardingStore.read();
    if (state.analysisJob && state.analysisJob.dataVersion === input.dataVersion && state.analysisJob.status !== "failed") {
      return validateAnalysisJob(reconcileJob(state.analysisJob));
    }
    const job = createJob(input.dataVersion);
    OnboardingStore.write({
      analysisJob: job,
      profileResult: undefined,
      profileFeedback: undefined,
      overallFeedback: undefined,
      effectiveProfile: undefined,
      profileConfirmationReminder: undefined,
      currentScreen: 4,
    });
    return validateAnalysisJob(job);
  },
  async getAnalysisJob(jobId) {
    await Promise.resolve();
    const state = OnboardingStore.read();
    if (!state.analysisJob || state.analysisJob.id !== jobId) throw new Error("ANALYSIS_JOB_NOT_FOUND");
    const previousCompleted = state.analysisJob.stages.filter((stage) => stage.status === "completed").map((stage) => stage.key);
    const job = validateAnalysisJob(reconcileJob(state.analysisJob));
    OnboardingStore.write({ analysisJob: job });
    job.stages.filter((stage) => stage.status === "completed" && !previousCompleted.includes(stage.key))
      .forEach(() => track("maimate_analysis_stage_completed"));
    const storedResult = OnboardingStore.read().profileResult;
    if (job.status === "succeeded" && (!storedResult || storedResult.analysisJobId !== job.id)) {
      let result;
      try {
        result = validateProfileResult(fallbackResult(job, currentAuthorizedData(), analysisRuntime.narrativeAvailable ? "rules" : "fallbackTemplate"));
      } catch (_) {
        result = validateProfileResult(fallbackResult(job, currentAuthorizedData(), "fallbackTemplate"));
      }
      OnboardingStore.write({
        profileResult: result,
        profileFeedback: undefined,
        overallFeedback: undefined,
        effectiveProfile: undefined,
        profileConfirmationReminder: undefined,
        currentScreen: 5,
      });
    }
    return job;
  },
  async retryAnalysis(jobId) {
    const state = OnboardingStore.read();
    if (!state.analysisJob || state.analysisJob.id !== jobId) throw new Error("ANALYSIS_JOB_NOT_FOUND");
    const job = createJob(state.analysisJob.dataVersion);
    job.id = state.analysisJob.id;
    OnboardingStore.write({
      analysisJob: job,
    });
    return job;
  },
  async useDemoFallback() {
    // 使用者明確切換到本機展示結果後，不再讓注入的斷網情境阻擋後續 Profile Service。
    analysisRuntime.failRequests = false;
    const state = OnboardingStore.read();
    const job = state.analysisJob || createJob(OnboardingStore.ensureDemoSession().dataVersion);
    const completedAt = new Date().toISOString();
    job.status = "succeeded";
    job.progress = 100;
    job.currentStage = undefined;
    job.profileVersion = "profile-rules-v1";
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    job.stages = job.stages.map((stage) => Object.assign({}, stage, {
      status: "completed",
      startedAt: stage.startedAt || completedAt,
      completedAt: stage.completedAt || completedAt,
    }));
    const result = validateProfileResult(fallbackResult(job, currentAuthorizedData(), "fallbackTemplate"));
    // 展示結果由同一份授權資料決定性重建、dimension 結構一致，
    // 因此保留使用者既有的修正／回饋——切換展示結果不該清空別人填過的東西。
    OnboardingStore.write({
      analysisJob: job,
      profileResult: result,
      currentScreen: 5,
    });
    return result;
  },
  async rebuildProfileResult() {
    const state = OnboardingStore.read();
    if (!state.analysisJob || state.analysisJob.status !== "succeeded") throw new Error("ANALYSIS_NOT_COMPLETE");
    const result = validateProfileResult(fallbackResult(state.analysisJob, currentAuthorizedData(), "rules"));
    OnboardingStore.write({
      profileResult: result,
      profileFeedback: undefined,
      overallFeedback: undefined,
      effectiveProfile: undefined,
      profileConfirmationReminder: undefined,
      currentScreen: 5,
    });
    return result;
  },
};

const MockInvestmentProfileService = {
  async getProfileResult() {
    if (analysisRuntime.failRequests) throw new Error("MOCK_PROFILE_LOAD_FAILED");
    return OnboardingStore.read().profileResult || null;
  },
  async getProfileContext() {
    if (analysisRuntime.failRequests) throw new Error("MOCK_PROFILE_LOAD_FAILED");
    const state = OnboardingStore.read();
    return {
      profileResult: state.profileResult || null,
      effectiveProfile: state.effectiveProfile || null,
      dimensionFeedback: Object.values(state.profileFeedback || {}),
      corrections: state.effectiveProfile ? state.effectiveProfile.userCorrections.slice() : [],
      overallFeedback: state.overallFeedback || (state.profileResult ? state.profileResult.overallFeedback : null) || null,
      grantedScopes: state.consent ? state.consent.grantedScopes.slice() : [],
      profileConfirmationReminder: Boolean(state.profileConfirmationReminder),
    };
  },
  async submitDimensionFeedback(resultId, dimensionKey, feedback) {
    if (analysisRuntime.failRequests) throw new Error("MOCK_FEEDBACK_FAILED");
    const state = OnboardingStore.read();
    if (!state.profileResult || state.profileResult.id !== resultId) throw new Error("PROFILE_RESULT_NOT_FOUND");
    if (!state.profileResult.dimensions.some((dimension) => dimension.key === dimensionKey)) throw new Error("PROFILE_DIMENSION_NOT_FOUND");
    const correction = {
      id: "correction_" + dimensionKey,
      resultId,
      dimensionKey,
      feedbackValue: feedback.value,
      selectedCorrection: feedback.selectedCorrection,
      note: feedback.note,
      createdAt: feedback.createdAt || new Date().toISOString(),
    };
    const profileFeedback = Object.assign({}, state.profileFeedback || {}, { [dimensionKey]: correction });
    const effectiveProfile = buildEffectiveProfile(state.profileResult, profileFeedback);
    const hasCorrection = effectiveProfile.userCorrections.length > 0;
    const profileResult = Object.assign({}, state.profileResult, {
      status: hasCorrection ? "revised" : state.profileResult.confirmedAt ? "confirmed" : "draft",
      updatedAt: new Date().toISOString(),
    });
    OnboardingStore.write({ profileFeedback, effectiveProfile, profileResult });
    return { profileResult, effectiveProfile, correction, saved: true };
  },
  async submitOverallFeedback(resultId, feedback) {
    if (analysisRuntime.failRequests) throw new Error("MOCK_OVERALL_FEEDBACK_FAILED");
    const state = OnboardingStore.read();
    if (!state.profileResult || state.profileResult.id !== resultId) throw new Error("PROFILE_RESULT_NOT_FOUND");
    const overallFeedback = { value: feedback.value, createdAt: feedback.createdAt || new Date().toISOString() };
    const profileResult = Object.assign({}, state.profileResult, {
      overallFeedback,
      updatedAt: new Date().toISOString(),
    });
    OnboardingStore.write({ overallFeedback, profileResult });
    return { overallFeedback, profileResult, saved: true };
  },
  async confirmProfile(resultId, input) {
    if (analysisRuntime.failRequests) throw new Error("MOCK_CONFIRM_FAILED");
    const state = OnboardingStore.read();
    if (!state.profileResult || state.profileResult.id !== resultId) throw new Error("PROFILE_RESULT_NOT_FOUND");
    const now = new Date().toISOString();
    const overallFeedback = {
      value: input && input.overallFeedback ? input.overallFeedback : (state.overallFeedback ? state.overallFeedback.value : "accurate"),
      createdAt: state.overallFeedback ? state.overallFeedback.createdAt : now,
    };
    const effectiveProfile = buildEffectiveProfile(state.profileResult, state.profileFeedback || {});
    const result = Object.assign({}, state.profileResult, {
      status: "confirmed",
      overallFeedback,
      confirmedAt: now,
      updatedAt: now,
    });
    OnboardingStore.write({
      profileResult: result,
      overallFeedback,
      effectiveProfile,
      profileConfirmationReminder: false,
      currentScreen: 6,
    });
    return {
      status: "confirmed",
      profileResultId: result.id,
      effectiveProfileId: "effective_" + result.id,
      onboardingStatus: "COMPLETED",
      nextStep: "HOME",
      nextRoute: "home.html?src=onboarding",
    };
  },
  async continueWithoutConfirmation(resultId) {
    if (analysisRuntime.failRequests) throw new Error("MOCK_CONTINUE_FAILED");
    const state = OnboardingStore.read();
    if (!state.profileResult || state.profileResult.id !== resultId) throw new Error("PROFILE_RESULT_NOT_FOUND");
    const effectiveProfile = buildEffectiveProfile(state.profileResult, state.profileFeedback || {});
    const profileResult = Object.assign({}, state.profileResult, { status: "draft", updatedAt: new Date().toISOString() });
    // TODO(Screen 6)：首頁接手後讀取 profileConfirmationReminder，顯示非阻斷的「尚未確認」提示。
    OnboardingStore.write({ profileResult, effectiveProfile, profileConfirmationReminder: true, currentScreen: 6 });
    return {
      status: "draft",
      onboardingStatus: "PROFILE_READY",
      nextStep: "HOME",
      nextRoute: "home.html?src=onboarding",
      showProfileConfirmationReminder: true,
    };
  },
};

/* Welcome 的「先看示範」可直接進 Screen 6，但仍必須建立同一套
 * Consent / Questionnaire / AnalysisJob / InvestmentProfileResult /
 * EffectiveInvestmentProfile；不可在首頁另造第二套 Profile。
 * 只有明確的 Demo Persona route 會呼叫此方法。 */
async function bootstrapHomeDemo(personaId) {
  if (personaId !== "STEADY_PLANNER") throw new Error("UNKNOWN_DEMO_PERSONA");
  const existing = OnboardingStore.read();
  const sessionIsValid = existing.demoSession &&
    !OnboardingStore.isDemoSessionExpired(existing.demoSession);
  if (sessionIsValid && existing.demoPersonaId === personaId &&
      existing.profileResult && existing.analysisJob &&
      existing.analysisJob.status === "succeeded") return existing;

  const now = new Date().toISOString();
  const demoSession = OnboardingStore.ensureDemoSession();
  /* 示範帳戶＝示範的歷史投資資料 ＋ 使用者自己的問卷人格。
   * 使用者若已完成問卷，就沿用他的答案（他點進來要看的是「用我的偏好解讀這份帳戶」），
   * 只有從未作答的人才套用預設示範人格。 */
  const ownProfile = existing.profile && existing.profile.status === "completed" && !existing.demoPersonaId
    ? existing.profile
    : null;
  // 只有真的要覆寫別人的作答時才留快照（可在「我的」換回）
  if (!ownProfile) OnboardingStore.snapshotUserState();
  /** @type {ConsentRecord} */
  const consent = {
    consentVersion: window.MM_ONBOARDING_MOCK.consentVersion,
    requiredScopes: ["portfolio", "transactions"],
    optionalScopes: ["fundingHistory", "interactionPersonalization"],
    grantedScopes: ["portfolio", "transactions", "fundingHistory", "interactionPersonalization"],
    source: "demo",
    grantedAt: now,
  };
  /** @type {OnboardingProfile} */
  const profile = ownProfile || {
    questionnaireVersion: window.MM_ONBOARDING_MOCK.questionnaireVersion,
    experienceLevel: "habitual",
    investmentGoals: ["longTermGrowth", "steadyHabit"],
    holdingHorizon: "mediumLong",
    volatilityResponse: "investigate",
    helpPriorities: ["newsToHoldings", "planReview", "termExplain"],
    communicationStyle: "concise",
    status: "completed",
    completedAt: now,
  };
  OnboardingStore.write({
    consent,
    profile,
    portfolioSource: "mock",
    demoSession,
    demoPersonaId: personaId,
    draft: undefined,
  });

  const job = createJob(demoSession.dataVersion);
  job.id = "analysis_home_demo_steady_v1";
  job.status = "succeeded";
  job.progress = 100;
  job.currentStage = undefined;
  job.profileVersion = "profile-rules-v1";
  job.completedAt = now;
  job.updatedAt = now;
  job.stages = job.stages.map((stage) => Object.assign({}, stage, {
    status: "completed",
    startedAt: now,
    completedAt: now,
  }));
  const originalResult = validateProfileResult(
    fallbackResult(job, currentAuthorizedData(), "fallbackTemplate")
  );
  const profileResult = Object.assign({}, originalResult, {
    status: "confirmed",
    confirmedAt: now,
    updatedAt: now,
  });
  const effectiveProfile = buildEffectiveProfile(profileResult, {});
  return OnboardingStore.write({
    currentScreen: 6,
    analysisJob: job,
    profileResult,
    profileFeedback: {},
    overallFeedback: { value: "accurate", createdAt: now },
    effectiveProfile,
    profileConfirmationReminder: false,
  });
}

function normalizeFormalAnalysisJob(payload, previousJob, dataVersion) {
  const raw = payload && payload.analysisJob ? payload.analysisJob : payload || {};
  const previous = previousJob || {};
  const id = raw.id || raw.analysisJobId || previous.id;
  const status = ["queued", "running", "succeeded", "failed"].includes(raw.status) ? raw.status : previous.status || "queued";
  const currentStage = raw.currentStage || previous.currentStage;
  const currentIndex = ANALYSIS_STAGE_DEFINITIONS.findIndex((stage) => stage.key === currentStage);
  const suppliedStages = Array.isArray(raw.stages) ? raw.stages : [];
  const previousStages = Array.isArray(previous.stages) ? previous.stages : [];
  const stages = ANALYSIS_STAGE_DEFINITIONS.map((definition, index) => {
    const supplied = suppliedStages.find((stage) => stage.key === definition.key);
    if (supplied) return Object.assign({}, supplied, { key: definition.key });
    const prior = previousStages.find((stage) => stage.key === definition.key);
    let stageStatus = prior ? prior.status : "pending";
    if (status === "succeeded") stageStatus = "completed";
    else if (status === "queued") stageStatus = "pending";
    else if (currentIndex >= 0) {
      if (index < currentIndex) stageStatus = "completed";
      else if (index === currentIndex) stageStatus = status === "failed" ? "failed" : "running";
      else stageStatus = "pending";
    } else if (status === "failed" && stageStatus === "running") stageStatus = "failed";
    return Object.assign({}, prior || {}, { key: definition.key, status: stageStatus });
  });
  const now = new Date().toISOString();
  const job = {
    id,
    status,
    progress: Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : Number(previous.progress) || 0,
    stages,
    dataVersion: raw.dataVersion || previous.dataVersion || dataVersion,
    createdAt: raw.createdAt || previous.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
  if (currentStage && status !== "succeeded") job.currentStage = currentStage;
  if (raw.profileVersion || previous.profileVersion) job.profileVersion = raw.profileVersion || previous.profileVersion;
  if (raw.completedAt || (status === "succeeded" && previous.completedAt)) job.completedAt = raw.completedAt || previous.completedAt;
  if (raw.errorCode) job.errorCode = raw.errorCode;
  return validateAnalysisJob(job);
}

const MaiCoinInvestmentAnalysisService = {
  async startAnalysis(input) {
    const payload = await fetchJson("/api/v1/maimate/analysis-jobs", { method: "POST", body: JSON.stringify(input) });
    const job = normalizeFormalAnalysisJob(payload, null, input.dataVersion);
    OnboardingStore.write({
      analysisJob: job,
      profileResult: undefined,
      profileFeedback: undefined,
      overallFeedback: undefined,
      effectiveProfile: undefined,
      profileConfirmationReminder: undefined,
      currentScreen: 4,
    });
    return job;
  },
  async getAnalysisJob(jobId) {
    const state = OnboardingStore.read();
    const payload = await fetchJson("/api/v1/maimate/analysis-jobs/" + encodeURIComponent(jobId));
    const job = normalizeFormalAnalysisJob(payload, state.analysisJob, state.demoSession && state.demoSession.dataVersion);
    const patch = { analysisJob: job };
    if (job.status === "succeeded" && state.analysisJob && state.analysisJob.status !== "succeeded") {
      Object.assign(patch, {
        profileResult: undefined,
        profileFeedback: undefined,
        overallFeedback: undefined,
        effectiveProfile: undefined,
        profileConfirmationReminder: undefined,
      });
    }
    OnboardingStore.write(patch);
    return job;
  },
  async retryAnalysis(jobId) {
    const state = OnboardingStore.read();
    const payload = await fetchJson("/api/v1/maimate/analysis-jobs/" + encodeURIComponent(jobId) + "/retry", { method: "POST" });
    const job = normalizeFormalAnalysisJob(payload, state.analysisJob, state.analysisJob && state.analysisJob.dataVersion);
    OnboardingStore.write({ analysisJob: job, currentScreen: 4 });
    return job;
  },
  async rebuildProfileResult() {
    // TODO(正式 API)：後端需定義「只重建 Result、不重跑原始分析」端點後再接入。
    throw new Error("PROFILE_RESULT_REBUILD_API_PENDING");
  },
  async useDemoFallback() {
    // 正式連線不應在未經後端授權時自行建立展示結果。
    throw new Error("DEMO_FALLBACK_UNAVAILABLE");
  },
};

const MaiCoinInvestmentProfileService = {
  async getProfilePayload() {
    return fetchJson("/api/v1/maimate/profile-result", undefined, { notFoundAsNull: true });
  },
  async getProfileResult() {
    const payload = await this.getProfilePayload();
    return payload && payload.profileResult ? payload.profileResult : payload;
  },
  async getProfileContext() {
    const payload = await this.getProfilePayload();
    const profileResult = payload && payload.profileResult ? payload.profileResult : payload;
    if (!profileResult) {
      return {
        profileResult: null,
        effectiveProfile: null,
        dimensionFeedback: [],
        corrections: [],
        overallFeedback: null,
        grantedScopes: [],
        profileConfirmationReminder: false,
      };
    }
    /*
     * TODO(正式 API)：GET 可維持規格中的裸 InvestmentProfileResult；
     * 若要在刷新後還原修正狀態，後端應回傳含下列欄位的相容 envelope。
     */
    const effectiveProfile = payload.effectiveProfile || profileResult.effectiveProfile || null;
    const rawDimensionFeedback = payload.dimensionFeedback || profileResult.dimensionFeedback;
    const dimensionFeedback = Array.isArray(rawDimensionFeedback)
      ? rawDimensionFeedback
      : rawDimensionFeedback && typeof rawDimensionFeedback === "object" ? Object.values(rawDimensionFeedback) : [];
    const corrections = Array.isArray(payload.userCorrections)
      ? payload.userCorrections
      : effectiveProfile && Array.isArray(effectiveProfile.userCorrections) ? effectiveProfile.userCorrections : [];
    return {
      profileResult,
      effectiveProfile,
      dimensionFeedback,
      corrections,
      overallFeedback: payload.overallFeedback || profileResult.overallFeedback || null,
      grantedScopes: Array.isArray(payload.grantedScopes) ? payload.grantedScopes : [],
      profileConfirmationReminder: Boolean(payload.profileConfirmationReminder),
    };
  },
  async submitDimensionFeedback(resultId, dimensionKey, feedback) {
    return fetchJson("/api/v1/maimate/profile-results/" + encodeURIComponent(resultId) + "/dimensions/" + encodeURIComponent(dimensionKey), {
      method: "PATCH",
      body: JSON.stringify({
        value: feedback.value,
        selectedCorrection: feedback.selectedCorrection,
        note: feedback.note,
      }),
    });
  },
  async submitOverallFeedback(resultId, feedback) {
    return fetchJson("/api/v1/maimate/profile-results/" + encodeURIComponent(resultId) + "/feedback", {
      method: "PATCH", body: JSON.stringify({ value: feedback.value }),
    });
  },
  async confirmProfile(resultId, input) {
    return fetchJson("/api/v1/maimate/profile-results/" + encodeURIComponent(resultId) + "/confirm", {
      method: "POST", body: JSON.stringify(input),
    });
  },
  async continueWithoutConfirmation(resultId) {
    return fetchJson("/api/v1/maimate/profile-results/" + encodeURIComponent(resultId) + "/continue", { method: "POST" });
  },
};

async function fetchJson(path, options, settings) {
  const response = await fetch((window.API_BASE || "") + path, Object.assign({
    headers: { "Content-Type": "application/json" },
  }, options || {}));
  if (response.status === 404 && settings && settings.notFoundAsNull) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

window.MM_INVESTMENT_SERVICES = {
  analysis: MockInvestmentAnalysisService,
  profile: MockInvestmentProfileService,
  demo: { bootstrapHomeDemo },
  stageDefinitions: ANALYSIS_STAGE_DEFINITIONS,
  rules: ANALYSIS_RULES,
  setFailureMode(value) { analysisRuntime.failRequests = Boolean(value); },
  setNarrativeAvailable(value) { analysisRuntime.narrativeAvailable = Boolean(value); },
  formalAdapters: { analysis: MaiCoinInvestmentAnalysisService, profile: MaiCoinInvestmentProfileService },
};
