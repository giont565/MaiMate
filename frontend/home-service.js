/* Screen 6 Adapter / Service Layer。
 * UI 只呼叫 window.MM_HOME_SERVICES.home，不直接讀取任何 Mock。
 * TODO(正式 API)：正式 MAX 行情、MaiCoin/MAX 帳戶資料與後端 Home Pipeline
 * 完成後，將 active service 切換為 MaiMatePersonalizedHomeService。
 */
"use strict";

const MM_HOME_ANALYTICS_EVENTS = Object.freeze([
  "maimate_home_viewed",
  "maimate_today_relevant_opened",
  "maimate_today_relevant_question_clicked",
  "maimate_plan_alignment_opened",
  "maimate_account_attribution_opened",
  "maimate_similar_moment_opened",
  "maimate_home_insight_opened",
  "maimate_contextual_question_clicked",
  "maimate_learning_opened",
  "maimate_home_module_dismissed",
  "maimate_home_module_snoozed",
  "maimate_home_refreshed",
  "maimate_chat_entry_clicked",
  "maimate_home_load_failed",
]);

const mmHomeRuntime = {
  failRequests: false,
  failedModuleTypes: new Set(),
  cache: null,
};
const MM_HOME_SESSION_CACHE_KEY = "mm_home_cache";
const MM_HOME_SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

function mmHomeRound(value, digits) {
  const factor = 10 ** (digits || 0);
  return Math.round(Number(value) * factor) / factor;
}

function mmHomeDaysBetween(from, to) {
  const difference = Date.parse(to) - Date.parse(from);
  return Number.isFinite(difference) ? Math.max(0, Math.round(difference / 86400000)) : null;
}

function mmHomePercent(value, digits) {
  return mmHomeRound(Number(value) * 100, Number.isInteger(digits) ? digits : 0) + "%";
}

/* 歸因的 marketPrice 項可能缺席（後端少回、或資料不足）；
 * 缺席時只讓這一格顯示「資料不足」，不要讓整頁掉到錯誤畫面。 */
function mmHomeMarketPriceRatioText(attribution) {
  const item = attribution && Array.isArray(attribution.contributors)
    ? attribution.contributors.find((c) => c && c.category === "marketPrice")
    : null;
  return item && Number.isFinite(Number(item.contributionRatio))
    ? mmHomePercent(item.contributionRatio)
    : "資料不足";
}

function mmHomeState() {
  return OnboardingStore.read();
}

function mmHomeStorage(state) {
  const source = state && state.home && typeof state.home === "object" ? state.home : {};
  return {
    preferences: Object.assign({ amountsHidden: false }, source.preferences || {}),
    moduleState: {
      dismissed: Object.assign({}, source.moduleState && source.moduleState.dismissed || {}),
      snoozed: Object.assign({}, source.moduleState && source.moduleState.snoozed || {}),
    },
  };
}

function mmHomeWriteStorage(next) {
  const current = mmHomeStorage(mmHomeState());
  const cleanNext = Object.assign({}, next || {});
  delete cleanNext.cache;
  const patch = Object.assign({}, current, cleanNext);
  OnboardingStore.write({ home: patch });
  return patch;
}

function mmHomeClearPersonalizedCache() {
  mmHomeRuntime.cache = null;
  try { sessionStorage.removeItem(MM_HOME_SESSION_CACHE_KEY); }
  catch (_) {}
  const storage = mmHomeStorage(mmHomeState());
  mmHomeWriteStorage({
    preferences: storage.preferences,
    moduleState: storage.moduleState,
  });
}

function mmHomeDropLegacyPersistentCache() {
  const state = mmHomeState();
  if (!state.home || !state.home.cache) return;
  const storage = mmHomeStorage(state);
  OnboardingStore.write({
    home: {
      preferences: storage.preferences,
      moduleState: storage.moduleState,
    },
  });
}

mmHomeDropLegacyPersistentCache();

function mmHomeError(code, route) {
  const error = new Error(code);
  error.code = code;
  if (route) error.redirectRoute = route;
  return error;
}

function mmHomeTrack(name, metadata) {
  if (!MM_HOME_ANALYTICS_EVENTS.includes(name)) return;
  const questionId = metadata && metadata.questionId ? String(metadata.questionId) : "";
  const safe = MM_HOME_SAFE_EVENT_ID.test(questionId) ? { questionId } : undefined;
  if (typeof track === "function") track(name, safe);
}

const PortfolioAdapter = Object.freeze({
  /** @param {Object} state */
  read(state) {
    const consent = state.consent;
    const granted = consent && Array.isArray(consent.grantedScopes) ? consent.grantedScopes : [];
    if (!consent || consent.revokedAt || !granted.includes("portfolio")) {
      return {
        available: false,
        assetCount: 0,
        assets: [],
        topAsset: null,
        topAssetRatio: null,
        topTwoAssetsRatio: null,
      };
    }
    const source = window.MM_ONBOARDING_MOCK && window.MM_ONBOARDING_MOCK.demoPortfolio;
    const assets = source && Array.isArray(source.assets)
      ? source.assets.map((asset) => ({
        symbol: String(asset.symbol),
        weight: Number(asset.weight),
      })).filter((asset) => asset.symbol && Number.isFinite(asset.weight) && asset.weight >= 0)
        .sort((a, b) => b.weight - a.weight)
      : [];
    if (!assets.length) {
      return {
        available: false,
        assetCount: 0,
        assets: [],
        topAsset: null,
        topAssetRatio: null,
        topTwoAssetsRatio: null,
      };
    }
    const total = assets.reduce((sum, asset) => sum + asset.weight, 0);
    window.MM_HOME_CORE.assert(Math.abs(total - 1) <= 0.011, "INVALID_PORTFOLIO_WEIGHTS");
    return {
      available: true,
      assetCount: assets.length,
      assets,
      topAsset: assets[0].symbol,
      topAssetRatio: assets[0].weight,
      topTwoAssetsRatio: assets.slice(0, 2).reduce((sum, asset) => sum + asset.weight, 0),
    };
  },
});

const TransactionAdapter = Object.freeze({
  /** @param {Object} state @param {string} asOf */
  read(state, asOf) {
    const consent = state.consent;
    const granted = consent && Array.isArray(consent.grantedScopes) ? consent.grantedScopes : [];
    if (!consent || consent.revokedAt || !granted.includes("transactions")) {
      return {
        available: false,
        count: 0,
        transactions: [],
        recent30Count: null,
        previous30Count: null,
        averagePerMonth: null,
        lastTransactionAt: null,
        lastTransactionDaysAgo: null,
        activeDays: 0,
      };
    }
    const raw = window.MM_ONBOARDING_MOCK && Array.isArray(window.MM_ONBOARDING_MOCK.demoTransactions)
      ? window.MM_ONBOARDING_MOCK.demoTransactions
      : [];
    const transactions = raw.map((item) => ({
      time: String(item.time),
      symbol: String(item.symbol),
      side: item.side,
    })).filter((item) => Number.isFinite(Date.parse(item.time)))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (!transactions.length) {
      return {
        available: true,
        count: 0,
        transactions: [],
        recent30Count: 0,
        previous30Count: 0,
        averagePerMonth: 0,
        lastTransactionAt: null,
        lastTransactionDaysAgo: null,
        activeDays: 0,
      };
    }
    const referenceTime = Date.parse(asOf);
    window.MM_HOME_CORE.assert(Number.isFinite(referenceTime), "INVALID_HOME_REFERENCE_TIME");
    const recentStart = referenceTime - 30 * 86400000;
    const previousStart = referenceTime - 60 * 86400000;
    const recent30Count = transactions.filter((item) => {
      const timestamp = Date.parse(item.time);
      return timestamp > recentStart && timestamp <= referenceTime;
    }).length;
    const previous30Count = transactions.filter((item) => {
      const timestamp = Date.parse(item.time);
      return timestamp > previousStart && timestamp <= recentStart;
    }).length;
    const first = transactions[0].time;
    const last = transactions[transactions.length - 1].time;
    const coverageDays = Math.max(30, mmHomeDaysBetween(first, last) + 1);
    const coverageMonths = Math.max(1, coverageDays / 30.4375);
    return {
      available: true,
      count: transactions.length,
      transactions,
      recent30Count,
      previous30Count,
      averagePerMonth: mmHomeRound(transactions.length / coverageMonths, 1),
      lastTransactionAt: last,
      lastTransactionDaysAgo: mmHomeDaysBetween(last, asOf),
      activeDays: new Set(transactions.map((item) => item.time.slice(0, 10))).size,
    };
  },
});

const MarketDataAdapter = Object.freeze({
  read() {
    const source = window.MM_HOME_MOCK && window.MM_HOME_MOCK.marketContext;
    window.MM_HOME_CORE.assert(source && source.id && Array.isArray(source.assets), "HOME_MARKET_CONTEXT_UNAVAILABLE");
    const assets = source.assets.map((asset) => ({
      symbol: String(asset.symbol),
      changeRatio: Number(asset.changeRatio),
      impactLevel: asset.impactLevel,
      sourceLabel: String(asset.sourceLabel || "示範市場情境"),
    }));
    assets.forEach((asset) => {
      window.MM_HOME_CORE.assert(
        asset.symbol && Number.isFinite(asset.changeRatio) &&
        ["low", "medium", "high"].includes(asset.impactLevel),
        "INVALID_HOME_MARKET_CONTEXT"
      );
    });
    return {
      id: String(source.id),
      observedAt: String(source.observedAt),
      periodStart: String(source.periodStart),
      periodEnd: String(source.periodEnd),
      primaryAsset: String(source.primaryAsset),
      volatilityLevel: source.volatilityLevel,
      assets,
      event: Object.assign({}, source.event),
    };
  },
});

const EffectiveProfileAdapter = Object.freeze({
  /** @param {Object} state @param {boolean} limited */
  read(state, limited) {
    const result = state.profileResult || null;
    const effective = state.effectiveProfile || null;
    const questionnaire = state.profile || null;
    const resultStatus = result && ["draft", "confirmed", "revised"].includes(result.status)
      ? result.status
      : "draft";
    const communicationStyle = questionnaire &&
      ["guided", "concise", "analytical"].includes(questionnaire.communicationStyle)
      ? questionnaire.communicationStyle
      : "guided";
    const version = effective && effective.updatedAt
      ? "effective-" + effective.updatedAt
      : result && result.resultVersion ? result.resultVersion : "profile-pending";
    const effectiveDimensions = effective && Array.isArray(effective.dimensions)
      ? effective.dimensions.map((dimension) => ({
        key: dimension.key,
        originalDescriptor: String(dimension.originalDescriptor || ""),
        effectiveDescriptor: String(dimension.effectiveDescriptor || dimension.originalDescriptor || ""),
        effectiveExplanation: String(dimension.effectiveExplanation || ""),
        correctionApplied: Boolean(dimension.correctionApplied),
      }))
      : [];
    const correctedDimensions = effectiveDimensions.filter((dimension) => dimension.correctionApplied);
    const supportPlan = effective && Array.isArray(effective.supportPlan)
      ? effective.supportPlan.map((item) => ({
        id: String(item.id),
        title: String(item.title),
        description: String(item.description),
        source: item.source,
      }))
      : result && Array.isArray(result.supportPlan)
        ? result.supportPlan.map((item) => ({
          id: String(item.id),
          title: String(item.title),
          description: String(item.description),
          source: item.source,
        }))
        : [];
    const originalPlanItems = [];
    correctedDimensions.forEach((dimension) => {
      originalPlanItems.push({
        id: "plan-effective-" + dimension.key,
        label: "已確認的樣貌：" + dimension.effectiveDescriptor,
        source: "effectiveProfile",
      });
    });
    const goals = questionnaire && Array.isArray(questionnaire.investmentGoals)
      ? questionnaire.investmentGoals
      : [];
    const goalLabels = {
      longTermGrowth: "長期累積資產",
      lifeGoal: "為生活目標準備",
      steadyHabit: "建立穩定習慣",
      marketLiteracy: "學看市場數據",
      behaviorReview: "檢視交易行為",
      exploringGoal: "仍在探索適合的方向",
    };
    goals.forEach((goal) => {
      if (goalLabels[goal]) {
        originalPlanItems.push({
          id: "plan-goal-" + goal,
          label: goalLabels[goal],
          source: "questionnaire",
        });
      }
    });
    const holdingLabels = {
      short: "偏好短期持有",
      mediumShort: "偏好數週到數月持有",
      mediumLong: "偏好中長期持有",
      long: "偏好長期持有",
      flexible: "持有期間依情況調整",
    };
    if (questionnaire && holdingLabels[questionnaire.holdingHorizon]) {
      originalPlanItems.push({
        id: "plan-holding-" + questionnaire.holdingHorizon,
        label: holdingLabels[questionnaire.holdingHorizon],
        source: "questionnaire",
      });
    }
    const volatilityLabels = {
      investigate: "市場波動時先了解原因",
      followPlan: "市場波動時先對照原本計畫",
      reduceExposure: "市場波動時先確認風險",
      anxiousChecking: "市場波動時希望多一點陪伴",
      unsure: "市場波動時先從解釋開始",
    };
    if (questionnaire && volatilityLabels[questionnaire.volatilityResponse]) {
      originalPlanItems.push({
        id: "plan-volatility-" + questionnaire.volatilityResponse,
        label: volatilityLabels[questionnaire.volatilityResponse],
        source: "questionnaire",
      });
    }
    return {
      result,
      effective,
      questionnaire,
      profileStatus: limited ? "limited" : resultStatus,
      communicationStyle,
      effectiveProfileVersion: version,
      originalPlanItems: originalPlanItems.slice(0, 4),
      effectiveDimensions,
      correctedDimensions,
      supportPlan,
      correctionCount: effective && Array.isArray(effective.userCorrections)
        ? effective.userCorrections.length
        : 0,
    };
  },
});

const AttributionAdapter = Object.freeze({
  read(portfolio, market) {
    if (!portfolio.available || !market) return null;
    const source = window.MM_HOME_MOCK && window.MM_HOME_MOCK.attributionInput;
    if (!source || !Array.isArray(source.components) || !source.components.length) return null;
    const categories = new Set();
    const components = source.components.map((item) => {
      const units = Number(item.effectUnits);
      window.MM_HOME_CORE.assert(
        item.id && item.label && Number.isFinite(units) && units >= 0 &&
        ["marketPrice", "allocation", "recentTrades", "funding", "other"].includes(item.category) &&
        !categories.has(item.category),
        "INVALID_HOME_ATTRIBUTION_INPUT"
      );
      categories.add(item.category);
      return Object.assign({}, item, { effectUnits: units });
    });
    const total = components.reduce((sum, item) => sum + item.effectUnits, 0);
    if (!(total > 0)) return null;

    /*
     * 使用 largest remainder 將上游影響值轉為 basis points，確保前端收到的
     * contributionRatio 精確加總為 1；UI 不再自行修補 rounding。
     */
    const scaled = components.map((item, index) => {
      const exact = item.effectUnits / total * 10000;
      return { index, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remainderUnits = 10000 - scaled.reduce((sum, item) => sum + item.floor, 0);
    scaled.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .forEach((item) => {
        if (remainderUnits > 0) {
          scaled[item.index].floor += 1;
          remainderUnits -= 1;
        }
      });
    const contributors = components.map((item, index) => ({
      id: String(item.id),
      category: item.category,
      label: String(item.label),
      contributionRatio: scaled[index].floor / 10000,
      explanation: String(item.explanation || ""),
    }));
    const result = {
      title: "今天的帳戶變化從哪裡來？",
      summary: "",
      attributionType: source.type === "calculated" ? "calculated" : "estimated",
      contributors,
      evidence: [
        {
          id: "attribution-period",
          label: "估算期間",
          value: "最近 24 小時",
          source: "marketContext",
        },
        {
          id: "attribution-top-asset",
          label: "目前主要持倉",
          value: portfolio.topAsset + " 約 " + mmHomePercent(portfolio.topAssetRatio),
          source: "portfolio",
        },
      ],
      periodStart: String(source.periodStart),
      periodEnd: String(source.periodEnd),
    };
    return window.MM_HOME_CORE.validateAttribution(result);
  },
});

const SimilarMomentAdapter = Object.freeze({
  read(transactionMetrics) {
    const source = window.MM_HOME_MOCK && window.MM_HOME_MOCK.similarMomentInput;
    if (!source || !transactionMetrics.available || !Array.isArray(source.transactionRefs)) return null;
    const historical = source.transactionRefs.map((time) =>
      transactionMetrics.transactions.find((item) => item.time === time)
    );
    if (historical.some((item) => !item)) return null;
    const directions = new Set(historical.map((item) => item.side));
    const symbols = [...new Set(historical.map((item) => item.symbol))];
    const currentStart = Date.parse(source.currentContext.startDate);
    const currentEnd = Date.parse(source.currentContext.endDate);
    const currentTrades = transactionMetrics.transactions.filter((item) => {
      const time = Date.parse(item.time);
      return time >= currentStart && time <= currentEnd;
    });
    const userBehaviorThen = [
      "1 月 8 日至 9 日共有 " + historical.length + " 筆 " + symbols.join("、") + " 交易紀錄。",
    ];
    if (directions.has("buy") && directions.has("sell")) {
      userBehaviorThen.push("當時紀錄同時包含賣出與買入。");
    }
    const userBehaviorNow = currentTrades.length
      ? ["這次市場情境期間共有 " + currentTrades.length + " 筆交易紀錄。"]
      : ["這次市場情境期間尚未出現新增交易。"];
    return {
      id: String(source.id),
      title: String(source.title),
      currentContext: window.MM_HOME_CORE.clone(source.currentContext),
      historicalContext: window.MM_HOME_CORE.clone(source.historicalContext),
      similarities: source.similarities.slice(),
      differences: source.differences.slice(),
      userBehaviorThen,
      userBehaviorNow,
      summary: "",
      disclaimer: String(source.disclaimer),
      confidence: source.confidence,
    };
  },
});

const LearningContentAdapter = Object.freeze({
  read(portfolio, limited) {
    const source = window.MM_HOME_MOCK && window.MM_HOME_MOCK.learningContent;
    window.MM_HOME_CORE.assert(source && source.id && source.route, "HOME_LEARNING_CONTENT_UNAVAILABLE");
    if (limited || !portfolio.available) {
      return {
        id: String(source.id),
        title: "如何分辨市場變化與帳戶配置影響？",
        durationLabel: "約 " + Number(source.durationMinutes || 3) + " 分鐘",
        description: "先從一般概念開始，看懂市場價格與資產配置如何影響帳戶。",
        recommendationReason: "目前個人化資料已停止更新，這裡只使用一般知識說明。",
        route: String(source.route),
      };
    }
    return {
      id: String(source.id),
      title: String(source.title),
      durationLabel: "約 " + Number(source.durationMinutes || 3) + " 分鐘",
      description: String(source.descriptionTemplate),
      recommendationReason: "因為 " + portfolio.topAsset + " 目前約占你的資產 " + mmHomePercent(portfolio.topAssetRatio) + "。",
      route: String(source.route),
    };
  },
});

const ConversationContextAdapter = Object.freeze({
  /** @param {Object} input */
  action(input) {
    const action = {
      id: String(input.id),
      type: input.type,
      label: String(input.label),
      route: input.route,
      question: input.question,
      context: Object.assign({}, input.context || {}),
    };
    return window.MM_HOME_CORE.validateAction(action);
  },
  destination(action) {
    return window.MM_HOME_CORE.actionDestination(action);
  },
});

function mmHomeReadPriorTopWeight(symbol) {
  const snapshot = window.MM_HOME_MOCK &&
    window.MM_HOME_MOCK.snapshots &&
    window.MM_HOME_MOCK.snapshots.priorPortfolio;
  if (!snapshot || !Array.isArray(snapshot.weights)) return null;
  const item = snapshot.weights.find((weight) => weight.symbol === symbol);
  return item && Number.isFinite(Number(item.weight)) ? Number(item.weight) : null;
}

function mmHomeValidateStructuredOutput(source, facts) {
  window.MM_HOME_CORE.assert(source && typeof source === "object", "INVALID_HOME_AI_OUTPUT");
  window.MM_HOME_CORE.assert(
    source.todayRelevant &&
    typeof source.todayRelevant.headline === "string" &&
    typeof source.todayRelevant.explanation === "string" &&
    typeof source.planAlignmentSummary === "string" &&
    typeof source.attributionSummary === "string" &&
    typeof source.similarMomentSummary === "string" &&
    Array.isArray(source.contextualQuestions),
    "INVALID_HOME_AI_SCHEMA"
  );
  source.contextualQuestions.forEach((question) => {
    window.MM_HOME_CORE.assert(
      question && question.id && typeof question.text === "string" &&
      ["market", "portfolio", "behavior", "education", "history"].includes(question.contextType),
      "INVALID_HOME_AI_QUESTION"
    );
  });
  window.MM_HOME_CORE.validateNarrative(source);
  const topPercent = mmHomePercent(facts.portfolio.topAssetRatio);
  const marketPercent = mmHomePercent(facts.primaryMarket.changeRatio, 1);
  window.MM_HOME_CORE.assert(
    source.todayRelevant.explanation.includes(topPercent) &&
    source.todayRelevant.explanation.includes(marketPercent),
    "HOME_AI_NUMBER_MISMATCH"
  );
  const claimsEqualTradingWindows = /相同|都是同樣|一樣多/.test(source.todayRelevant.headline);
  window.MM_HOME_CORE.assert(
    !claimsEqualTradingWindows ||
    facts.transactions.recent30Count === facts.transactions.previous30Count,
    "HOME_AI_BEHAVIOR_MISMATCH"
  );
  return window.MM_HOME_CORE.clone(source);
}

function mmHomeRuleNarrative(facts) {
  const portfolio = facts.portfolio;
  const transactions = facts.transactions;
  const primaryMarket = facts.primaryMarket;
  return {
    todayRelevant: {
      headline: portfolio.topAsset + " 是你今天帳戶變化的主要來源；最近 30 天共有 " +
        transactions.recent30Count + " 筆交易。",
      explanation: "示範行情中 " + portfolio.topAsset + " 今日約變動 " +
        mmHomePercent(primaryMarket.changeRatio, 1) + "，且約占目前資產 " +
        mmHomePercent(portfolio.topAssetRatio) + "；這裡只整理關聯，不提供買賣指令。",
    },
    planAlignmentSummary: "可確認的交易節奏沒有明顯增加；持有時間仍需要更多資料才能完整對照。",
    attributionSummary: "依目前示範資料估算，帳戶變化主要來自市場價格與主要持倉的組合影響。",
    similarMomentSummary: "兩次情境只有部分可比；資產與變動幅度不同，這次目前沒有新增交易。",
    contextualQuestions: [
      { id: "question_btc_impact", text: "為什麼主要持倉會影響我的帳戶比較多？", contextType: "portfolio" },
      { id: "question_market_source", text: "今天的變化主要是市場造成的嗎？", contextType: "market" },
      { id: "question_rhythm", text: "我最近的交易節奏有變快嗎？", contextType: "behavior" },
    ],
  };
}

function mmHomeNarrative(facts) {
  try {
    return {
      value: mmHomeValidateStructuredOutput(window.MM_HOME_MOCK.aiStructuredOutput, facts),
      generatedBy: "rulesAndAi",
    };
  } catch (_) {
    return {
      value: mmHomeRuleNarrative(facts),
      generatedBy: "fallbackTemplate",
    };
  }
}

function mmHomeContext(moduleId, profile, extra) {
  return Object.assign({
    source: "home_module",
    moduleId,
    profileVersion: profile.effectiveProfileVersion,
  }, extra || {});
}

function mmHomeModule(input) {
  return {
    id: input.id,
    type: input.type,
    priority: input.priority || "normal",
    position: input.position,
    visible: true,
    dismissible: Boolean(input.dismissible),
    payload: input.payload,
    actions: input.actions || [],
  };
}

function mmHomeApplyModuleState(modules, state) {
  const stored = mmHomeStorage(state).moduleState;
  const now = Date.now();
  return modules.map((module) => {
    const dismissed = Boolean(stored.dismissed[module.id]);
    const snoozedUntil = Date.parse(stored.snoozed[module.id]);
    const snoozed = Number.isFinite(snoozedUntil) && snoozedUntil > now;
    return Object.assign({}, module, {
      visible: module.visible && !dismissed && !snoozed,
    });
  }).sort((a, b) => a.position - b.position);
}

function mmHomeOptionalModuleValue(type, builder) {
  try {
    if (mmHomeRuntime.failedModuleTypes.has(type)) throw new Error("HOME_MODULE_TEST_FAILURE");
    return { value: builder(), error: false };
  } catch (error) {
    console.warn("[MaiMate Home] optional module unavailable", type, error && error.message);
    return { value: null, error: true };
  }
}

function mmHomeBuildLimitedResponse(state) {
  const source = window.MM_HOME_MOCK;
  const profile = EffectiveProfileAdapter.read(state, true);
  const learningState = mmHomeOptionalModuleValue(
    "learningRecommendation",
    () => LearningContentAdapter.read({ available: false }, true)
  );
  const learning = learningState.value;
  const modules = [
    mmHomeModule({
      id: "module_authorization_notice",
      type: "systemNotice",
      priority: "high",
      position: 1,
      payload: {
        title: "個人化資料已停止更新",
        message: "你仍可使用一般市場解釋與金融知識功能，但新的帳戶分析需要重新授權。",
      },
      actions: [
        ConversationContextAdapter.action({
          id: "open-authorization-settings",
          type: "navigate",
          label: "查看授權設定",
          route: "/maimate/settings",
        }),
      ],
    }),
    mmHomeModule({
      id: "module_contextual_questions",
      type: "contextualQuestions",
      priority: "normal",
      position: 2,
      payload: {
        title: "從這裡繼續問",
        questions: [
          { id: "question_general_market", text: "市場價格變化通常怎麼影響帳戶？", contextType: "education" },
          { id: "question_financial_term", text: "什麼是持倉占比？", contextType: "education" },
        ],
      },
      actions: [
        ConversationContextAdapter.action({
          id: "question_general_market",
          type: "openChat",
          label: "市場價格變化通常怎麼影響帳戶？",
          route: "/maimate/chat",
          question: "市場價格變化通常怎麼影響帳戶？",
          context: { source: "home_contextual_question", questionId: "question_general_market", moduleId: "module_contextual_questions" },
        }),
        ConversationContextAdapter.action({
          id: "question_financial_term",
          type: "openChat",
          label: "什麼是持倉占比？",
          route: "/maimate/chat",
          question: "什麼是持倉占比？",
          context: { source: "home_contextual_question", questionId: "question_financial_term", moduleId: "module_contextual_questions" },
        }),
      ],
    }),
    mmHomeModule({
      id: "module_learning",
      type: "learningRecommendation",
      priority: "normal",
      position: 3,
      payload: learning || {
        title: "今天適合看懂的一件事",
        error: true,
        message: "學習內容暫時沒有整理完成。",
      },
      actions: learning ? [
        ConversationContextAdapter.action({
          id: "open-learning",
          type: "openInsight",
          label: "開始了解",
          route: learning.route,
          context: { source: "learning_recommendation", moduleId: "module_learning" },
        }),
      ] : [
        ConversationContextAdapter.action({
          id: "retry-learning",
          type: "retry",
          label: "重新整理",
          context: { source: "learning_recommendation", moduleId: "module_learning" },
        }),
      ],
    }),
  ];
  return window.MM_HOME_CORE.validateResponse({
    user: {
      userId: source.user.userId,
      displayName: source.user.displayName,
      demoMode: Boolean(source.user.demoMode),
      profileStatus: "limited",
      communicationStyle: profile.communicationStyle,
      effectiveProfileVersion: profile.effectiveProfileVersion,
    },
    greeting: window.MM_HOME_CORE.buildGreeting(source.user.displayName),
    modules: mmHomeApplyModuleState(modules, state),
    navigation: {
      activeTab: "home",
      tabs: source.navigation.tabs.map((tab) => Object.assign({}, tab, { active: tab.id === "home" })),
    },
    dataStatus: {
      portfolioUpdatedAt: source.snapshots.portfolioUpdatedAt,
      marketUpdatedAt: source.marketContext.observedAt,
      profileUpdatedAt: state.profileResult && state.profileResult.updatedAt,
      authorizationStatus: "revoked",
      analysisCoverage: "limited",
    },
    generatedAt: source.generatedAt,
    nextRefreshAt: source.nextRefreshAt,
  });
}

function mmHomeBuildResponse(state) {
  const source = window.MM_HOME_MOCK;
  window.MM_HOME_CORE.assert(source && source.dataVersion, "HOME_MOCK_UNAVAILABLE");
  const market = MarketDataAdapter.read();
  const portfolio = PortfolioAdapter.read(state);
  const transactions = TransactionAdapter.read(state, market.observedAt);
  const profile = EffectiveProfileAdapter.read(state, false);
  window.MM_HOME_CORE.assert(portfolio.available && transactions.available, "HOME_PERSONAL_DATA_UNAVAILABLE");
  const primaryMarket = market.assets.find((asset) => asset.symbol === portfolio.topAsset) ||
    market.assets.find((asset) => asset.symbol === market.primaryAsset);
  window.MM_HOME_CORE.assert(primaryMarket, "HOME_PRIMARY_MARKET_UNAVAILABLE");
  const facts = { market, portfolio, transactions, profile, primaryMarket };
  const narrative = mmHomeNarrative(facts);
  const attributionState = mmHomeOptionalModuleValue(
    "accountAttribution",
    () => AttributionAdapter.read(portfolio, market)
  );
  const similarMomentState = mmHomeOptionalModuleValue(
    "similarMoment",
    () => SimilarMomentAdapter.read(transactions)
  );
  const learningState = mmHomeOptionalModuleValue(
    "learningRecommendation",
    () => LearningContentAdapter.read(portfolio, false)
  );
  const attribution = attributionState.value;
  const similarMoment = similarMomentState.value;
  const learning = learningState.value;
  const priorTopWeight = mmHomeReadPriorTopWeight(portfolio.topAsset);
  const topWeightChange = priorTopWeight == null ? null : portfolio.topAssetRatio - priorTopWeight;
  const correctionDimensionLabels = {
    tradingRhythm: "投資節奏",
    holdingPattern: "持有方式",
    allocationPattern: "配置樣貌",
    volatilityBehavior: "波動習慣",
  };
  const correctionSummary = profile.correctedDimensions.length
    ? " 已納入你對" + profile.correctedDimensions
      .map((dimension) => "「" + (correctionDimensionLabels[dimension.key] || "投資樣貌") + "」")
      .join("、") + "的補充。"
    : "";
  const correctedAllocation = profile.effectiveDimensions.find((dimension) =>
    dimension.key === "allocationPattern" && dimension.correctionApplied
  );
  const correctedRhythm = profile.effectiveDimensions.find((dimension) =>
    dimension.key === "tradingRhythm" && dimension.correctionApplied
  );
  const supportContext = profile.supportPlan[0] || null;
  const resultCoverage = state.profileResult && state.profileResult.coverage
    ? state.profileResult.coverage.coverage
    : "limited";

  const modules = [];
  const add = (builder) => modules.push(builder);

  add(mmHomeModule({
    id: "module_today_relevant",
    type: "todayRelevant",
    priority: "high",
    position: 1,
    payload: {
      title: "今天，什麼和你有關？",
      headline: narrative.value.todayRelevant.headline,
      explanation: narrative.value.todayRelevant.explanation,
      relatedAssets: [portfolio.topAsset],
      impactLevels: {
        market: primaryMarket.impactLevel,
        allocation: portfolio.topAssetRatio >= 0.5 ? "high" : portfolio.topAssetRatio >= 0.35 ? "medium" : "low",
        behavior: transactions.recent30Count <= transactions.previous30Count ? "low" : "medium",
      },
      evidence: [
        {
          id: "today-market-change",
          label: portfolio.topAsset + " 今日變動",
          value: mmHomePercent(primaryMarket.changeRatio, 1) + "（示範資料）",
          source: "marketContext",
        },
        {
          id: "today-allocation",
          label: portfolio.topAsset + " 持倉占比",
          value: "約 " + mmHomePercent(portfolio.topAssetRatio),
          source: "portfolio",
        },
        {
          id: "today-recent-trades",
          label: "最近 30 天交易",
          value: transactions.recent30Count + " 筆",
          source: "transactions",
        },
        {
          id: "today-previous-trades",
          label: "前一個 30 天交易",
          value: transactions.previous30Count + " 筆",
          source: "transactions",
        },
      ],
      updatedAt: market.observedAt,
      dataFreshness: "fresh",
      generatedBy: narrative.generatedBy,
    },
    actions: [
      ConversationContextAdapter.action({
        id: "open-impact",
        type: "openInsight",
        label: "看它怎麼影響我",
        route: "/maimate/insights/today-impact",
        context: mmHomeContext("module_today_relevant", profile, {
          source: "today_relevant_hero",
          relatedAsset: portfolio.topAsset,
          relatedInsightId: "insight_market_impact",
          marketContextId: market.id,
        }),
      }),
      ConversationContextAdapter.action({
        id: "question-btc-impact",
        type: "openChat",
        label: "為什麼 " + portfolio.topAsset + " 影響比較大？",
        route: "/maimate/chat",
        question: "為什麼 " + portfolio.topAsset + " 會影響我的帳戶比較多？",
        context: mmHomeContext("module_today_relevant", profile, {
          source: "today_relevant_hero",
          questionId: "question_btc_impact",
          relatedAsset: portfolio.topAsset,
          relatedInsightId: "insight_market_impact",
          marketContextId: market.id,
        }),
      }),
      ConversationContextAdapter.action({
        id: "question-recent-change",
        type: "openChat",
        label: "最近的我有改變嗎？",
        route: "/maimate/chat",
        question: "最近的交易節奏和原本有什麼不同？",
        context: mmHomeContext("module_today_relevant", profile, {
          source: "today_relevant_hero",
          questionId: "question_recent_change",
          relatedAsset: portfolio.topAsset,
        }),
      }),
      ConversationContextAdapter.action({
        id: "question-similar-before",
        type: "openChat",
        label: "這種情況以前發生過嗎？",
        route: "/maimate/chat",
        question: "這種情況以前發生過嗎？",
        context: mmHomeContext("module_today_relevant", profile, {
          source: "today_relevant_hero",
          questionId: "question_similar_before",
          relatedMomentId: similarMoment ? similarMoment.id : "",
        }),
      }),
    ],
  }));

  const recentBehaviorItems = [
    {
      id: "behavior-recent-trades",
      label: "最近 30 天 " + transactions.recent30Count + " 筆，前一個 30 天 " + transactions.previous30Count + " 筆",
      trend: transactions.recent30Count === transactions.previous30Count
        ? "stable"
        : transactions.recent30Count > transactions.previous30Count ? "increased" : "decreased",
    },
    {
      id: "behavior-allocation",
      label: topWeightChange == null
        ? "主要持倉目前約占 " + mmHomePercent(portfolio.topAssetRatio)
        : "主要持倉比前期快照提高 " + Math.round(topWeightChange * 100) + " 個百分點",
      trend: topWeightChange == null ? "unknown" : topWeightChange > 0.005 ? "increased" : "stable",
    },
    {
      id: "behavior-holding",
      label: "持有時間仍需更多完整買賣紀錄",
      trend: "unknown",
    },
  ];
  add(mmHomeModule({
    id: "module_plan_alignment",
    type: "planAlignment",
    priority: "high",
    position: 2,
    payload: {
      title: "原本的我 vs 最近的我",
      originalPlanItems: profile.originalPlanItems,
      recentBehaviorItems,
      status: profile.originalPlanItems.length ? "partiallyAligned" : "insufficientData",
      summary: narrative.value.planAlignmentSummary + correctionSummary,
      evidence: [
        {
          id: "alignment-questionnaire",
          label: "原本方向",
          value: profile.originalPlanItems.length ? "來自補充問卷" : "尚未完成補充問卷",
          source: "questionnaire",
        },
        {
          id: "alignment-recent-trades",
          label: "最近 30 天交易",
          value: transactions.recent30Count + " 筆",
          source: "transactions",
        },
        {
          id: "alignment-allocation",
          label: "主要持倉",
          value: portfolio.topAsset + " 約 " + mmHomePercent(portfolio.topAssetRatio),
          source: "portfolio",
        },
        ...(profile.correctedDimensions.length ? [{
          id: "alignment-user-corrections",
          label: "已納入的樣貌補充",
          value: profile.correctedDimensions.length + " 項",
          source: "effectiveProfile",
        }] : []),
      ],
    },
    actions: [
      ConversationContextAdapter.action({
        id: "open-plan-alignment",
        type: "openInsight",
        label: "查看完整對照",
        route: "/maimate/insights/plan-alignment",
        context: mmHomeContext("module_plan_alignment", profile, { source: "plan_alignment" }),
      }),
    ],
  }));

  if (attributionState.error) {
    add(mmHomeModule({
      id: "module_account_attribution",
      type: "accountAttribution",
      priority: "normal",
      position: 3,
      payload: {
        title: "今天的帳戶變化從哪裡來？",
        error: true,
        message: "這一段暫時沒有整理完成。",
      },
      actions: [
        ConversationContextAdapter.action({
          id: "retry-account-attribution",
          type: "retry",
          label: "重新整理",
          context: { source: "account_attribution", moduleId: "module_account_attribution" },
        }),
      ],
    }));
  } else if (attribution) {
    attribution.summary = narrative.value.attributionSummary;
    add(mmHomeModule({
      id: "module_account_attribution",
      type: "accountAttribution",
      priority: "normal",
      position: 3,
      payload: attribution,
      actions: [
        ConversationContextAdapter.action({
          id: "open-account-change",
          type: "openInsight",
          label: "看完整原因",
          route: "/maimate/insights/account-change",
          context: mmHomeContext("module_account_attribution", profile, {
            source: "account_attribution",
            relatedAsset: portfolio.topAsset,
            marketContextId: market.id,
          }),
        }),
      ],
    }));
  } else {
    add(mmHomeModule({
      id: "module_account_attribution",
      type: "accountAttribution",
      priority: "normal",
      position: 3,
      payload: {
        title: "今天的帳戶變化從哪裡來？",
        unavailable: true,
        message: "目前資料不足以拆解帳戶變化來源。",
      },
      actions: [],
    }));
  }

  if (similarMomentState.error) {
    add(mmHomeModule({
      id: "module_similar_moment",
      type: "similarMoment",
      priority: "normal",
      position: 4,
      payload: {
        title: "這個情況，你以前遇過",
        error: true,
        message: "相似時刻暫時沒有整理完成。",
      },
      actions: [
        ConversationContextAdapter.action({
          id: "retry-similar-moment",
          type: "retry",
          label: "重新整理",
          context: { source: "similar_moment", moduleId: "module_similar_moment" },
        }),
      ],
    }));
  } else if (similarMoment) {
    similarMoment.summary = narrative.value.similarMomentSummary;
    add(mmHomeModule({
      id: "module_similar_moment",
      type: "similarMoment",
      priority: "normal",
      position: 4,
      payload: similarMoment,
      actions: [
        ConversationContextAdapter.action({
          id: "open-similar-moment",
          type: "openInsight",
          label: "比較兩次情況",
          route: "/maimate/insights/similar-moment",
          context: mmHomeContext("module_similar_moment", profile, {
            source: "similar_moment",
            relatedMomentId: similarMoment.id,
            relatedAsset: portfolio.topAsset,
          }),
        }),
      ],
    }));
  } else {
    add(mmHomeModule({
      id: "module_similar_moment",
      type: "similarMoment",
      priority: "normal",
      position: 4,
      payload: {
        title: "目前沒有足夠相似紀錄",
        unavailable: true,
        message: "麥麥不會為了湊出結果，硬把不同情況說成一樣。",
      },
      actions: [],
    }));
  }

  const insights = [
    {
      id: "insight_market_impact",
      type: "marketImpact",
      title: "主要持倉仍是帳戶變化的關鍵",
      summary: portfolio.topAsset + " 約占目前資產 " + mmHomePercent(portfolio.topAssetRatio) + "，今天的主要變化也和它有關。",
      explanation: "持倉占比較高時，該資產的價格變化會更容易反映在帳戶整體變化上；這是關聯說明，不代表好壞。",
      priority: "high",
      evidence: [
        {
          id: "insight-top-weight",
          label: portfolio.topAsset + " 持倉占比",
          value: "約 " + mmHomePercent(portfolio.topAssetRatio),
          source: "portfolio",
        },
        {
          id: "insight-market-attribution",
          label: "市場價格估算影響",
          // 後端若少回 marketPrice 這一項，只讓這一格顯示「資料不足」，不得讓整頁掛掉
          value: mmHomeMarketPriceRatioText(attribution),
          source: "marketContext",
        },
      ],
      contextualQuestions: [
        { id: "question_concentration_impact", text: "為什麼占比會放大影響？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
        { id: "question_allocation_change", text: "我的配置最近有變嗎？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
      ],
      dismissible: true,
    },
    {
      id: "insight_trading_rhythm",
      type: "tradingRhythmChange",
      title: "近期交易節奏沒有明顯增加",
      summary: "最近 30 天 " + transactions.recent30Count + " 筆、前一個 30 天 " +
        transactions.previous30Count + " 筆交易；現有 " +
        transactions.count + " 筆紀錄平均每月約 " + transactions.averagePerMonth + " 筆。",
      explanation: "目前只比較可見交易日期，不從頻率推測操作原因或心理狀態。" +
        (correctedRhythm ? " 你先前補充：「" + correctedRhythm.effectiveDescriptor + "」；原始交易筆數仍會保留。" : ""),
      priority: "normal",
      evidence: [
        {
          id: "insight-recent-count",
          label: "最近 30 天",
          value: transactions.recent30Count + " 筆交易",
          source: "transactions",
        },
        {
          id: "insight-monthly-average",
          label: "現有紀錄平均每月",
          value: "約 " + transactions.averagePerMonth + " 筆",
          source: "transactions",
        },
        {
          id: "insight-previous-count",
          label: "前一個 30 天",
          value: transactions.previous30Count + " 筆交易",
          source: "transactions",
        },
      ],
      contextualQuestions: [
        { id: "question_active_months", text: "哪些月份的交易比較集中？", contextType: "behavior", relatedInsightId: "insight_trading_rhythm" },
        { id: "question_volatility_records", text: "目前有足夠資料比較波動期間嗎？", contextType: "behavior", relatedInsightId: "insight_trading_rhythm" },
      ],
      dismissible: true,
    },
  ];
  if (correctedAllocation) {
    insights[0].explanation += " 你先前補充：「" + correctedAllocation.effectiveDescriptor +
      "」；" + mmHomePercent(portfolio.topAssetRatio) + " 的原始持倉比例不會被改寫。";
  }
  const insightActions = insights.flatMap((insight) =>
    insight.contextualQuestions.map((question) =>
      ConversationContextAdapter.action({
        id: question.id,
        type: "openChat",
        label: question.text,
        route: "/maimate/chat",
        question: question.text,
        context: mmHomeContext("module_personalized_insights", profile, {
          source: "personalized_insight",
          questionId: question.id,
          relatedInsightId: insight.id,
          insightType: insight.type,
          relatedAsset: insight.id === "insight_market_impact" ? portfolio.topAsset : "",
        }),
      })
    )
  );
  insightActions.push(
    ConversationContextAdapter.action({
      id: "dismiss-personalized-insights",
      type: "dismiss",
      label: "先收起",
      context: { source: "personalized_insight", moduleId: "module_personalized_insights" },
    }),
    ConversationContextAdapter.action({
      id: "snooze-personalized-insights",
      type: "snooze",
      label: "稍後提醒",
      context: { source: "personalized_insight", moduleId: "module_personalized_insights" },
    })
  );
  add(mmHomeModule({
    id: "module_personalized_insights",
    type: "personalizedInsight",
    priority: "normal",
    position: 5,
    dismissible: true,
    payload: {
      insights,
      personalizationNote: supportContext
        ? "依你目前的設定，麥麥會「" + supportContext.title + "」：" + supportContext.description
        : "",
    },
    actions: insightActions,
  }));

  const contextualQuestions = narrative.value.contextualQuestions.slice(0, 5).map((question) => ({
    id: String(question.id),
    text: String(question.text),
    contextType: question.contextType,
    relatedInsightId: question.relatedInsightId,
    relatedMomentId: question.relatedMomentId,
  }));
  add(mmHomeModule({
    id: "module_contextual_questions",
    type: "contextualQuestions",
    priority: "normal",
    position: 6,
    payload: { title: "從這裡繼續問", questions: contextualQuestions },
    actions: contextualQuestions.map((question) =>
      ConversationContextAdapter.action({
        id: question.id,
        type: "openChat",
        label: question.text,
        route: "/maimate/chat",
        question: question.text,
        context: mmHomeContext("module_contextual_questions", profile, {
          source: "home_contextual_question",
          questionId: question.id,
          relatedModuleId: "module_contextual_questions",
          relatedInsightId: question.relatedInsightId || "",
          relatedMomentId: question.relatedMomentId || "",
          relatedAsset: question.contextType === "portfolio" ? portfolio.topAsset : "",
        }),
      })
    ),
  }));

  add(mmHomeModule({
    id: "module_learning",
    type: "learningRecommendation",
    priority: "normal",
    position: 7,
    payload: learning || {
      title: "今天適合看懂的一件事",
      error: true,
      message: "學習內容暫時沒有整理完成。",
    },
    actions: learning ? [
      ConversationContextAdapter.action({
        id: "open-learning",
        type: "openInsight",
        label: "開始了解",
        route: learning.route,
        context: mmHomeContext("module_learning", profile, {
          source: "learning_recommendation",
          relatedAsset: portfolio.topAsset,
        }),
      }),
    ] : [
      ConversationContextAdapter.action({
        id: "retry-learning",
        type: "retry",
        label: "重新整理",
        context: mmHomeContext("module_learning", profile, { source: "learning_recommendation" }),
      }),
    ],
  }));

  const preferences = mmHomeStorage(state).preferences;
  add(mmHomeModule({
    id: "module_account_snapshot",
    type: "accountSnapshot",
    priority: "low",
    position: 8,
    payload: {
      title: "你的帳戶概況",
      assetCount: portfolio.assetCount,
      topAsset: portfolio.topAsset,
      topAssetRatio: portfolio.topAssetRatio,
      topTwoAssetsRatio: portfolio.topTwoAssetsRatio,
      lastTransactionAt: transactions.lastTransactionAt,
      lastTransactionDaysAgo: transactions.lastTransactionDaysAgo,
      updatedAt: source.snapshots.portfolioUpdatedAt,
      supportsAmountVisibility: true,
      amountsHidden: Boolean(preferences.amountsHidden),
    },
    actions: [
      ConversationContextAdapter.action({
        id: "open-allocation",
        type: "openInsight",
        label: "查看配置說明",
        route: "/maimate/insights/account-change",
        context: mmHomeContext("module_account_snapshot", profile, {
          source: "account_snapshot",
          relatedAsset: portfolio.topAsset,
        }),
      }),
    ],
  }));

  if (state.profileConfirmationReminder || profile.profileStatus === "draft") {
    add(mmHomeModule({
      id: "module_profile_status",
      type: "profileStatus",
      priority: "normal",
      position: 9,
      payload: {
        title: "你的投資樣貌還沒確認",
        message: "目前已先套用初步設定，你可以隨時回去看看是否符合自己。",
        status: "draft",
      },
      actions: [
        ConversationContextAdapter.action({
          id: "confirm-profile",
          type: "navigate",
          label: "確認投資樣貌",
          route: "/maimate/profile-result",
        }),
      ],
    }));
  } else if (resultCoverage === "limited") {
    add(mmHomeModule({
      id: "module_profile_status",
      type: "dataStatus",
      priority: "low",
      position: 9,
      payload: {
        title: "麥麥還在累積對你的了解",
        message: "目前資料較少，部分分析會先保持保留，之後會逐步更新。",
        status: "limited",
      },
      actions: [],
    }));
  }

  const response = {
    user: {
      userId: source.user.userId,
      displayName: source.user.displayName,
      demoMode: Boolean(source.user.demoMode),
      profileStatus: profile.profileStatus,
      communicationStyle: profile.communicationStyle,
      effectiveProfileVersion: profile.effectiveProfileVersion,
    },
    greeting: window.MM_HOME_CORE.buildGreeting(source.user.displayName),
    modules: mmHomeApplyModuleState(modules, state),
    navigation: {
      activeTab: "home",
      tabs: source.navigation.tabs.map((tab) => Object.assign({}, tab, { active: tab.id === "home" })),
    },
    dataStatus: {
      portfolioUpdatedAt: source.snapshots.portfolioUpdatedAt,
      marketUpdatedAt: market.observedAt,
      profileUpdatedAt: state.profileResult && state.profileResult.updatedAt,
      authorizationStatus: state.consent && state.consent.source === "demo" ? "demo" : "active",
      analysisCoverage: ["full", "sufficient", "limited"].includes(resultCoverage) ? resultCoverage : "limited",
    },
    generatedAt: source.generatedAt,
    nextRefreshAt: source.nextRefreshAt,
  };
  return window.MM_HOME_CORE.validateResponse(response);
}

function mmHomeDataVersion(state, access) {
  const source = window.MM_HOME_MOCK;
  const storage = mmHomeStorage(state);
  return [
    source && source.dataVersion,
    source && source.narrativeVersion,
    state.demoSession && state.demoSession.dataVersion,
    state.profileResult && state.profileResult.id,
    state.profileResult && state.profileResult.status,
    state.profileResult && state.profileResult.updatedAt,
    state.effectiveProfile && state.effectiveProfile.updatedAt,
    state.consent && state.consent.revokedAt ? "revoked" : "authorized",
    access.status,
    storage.preferences.amountsHidden ? "hidden" : "visible",
    JSON.stringify(storage.moduleState),
  ].join("|");
}

function mmHomeSaveCache(response, dataVersion) {
  const sanitized = window.MM_HOME_CORE.sanitizeResponse(response);
  const cache = {
    cacheVersion: window.MM_HOME_CORE.CACHE_VERSION,
    dataVersion,
    cachedAt: new Date().toISOString(),
    response: sanitized,
  };
  mmHomeRuntime.cache = window.MM_HOME_CORE.clone(cache);
  try { sessionStorage.setItem(MM_HOME_SESSION_CACHE_KEY, JSON.stringify(cache)); }
  catch (_) {}
  /* 清除舊版曾寫入 mm_onboarding 的完整首頁 response。 */
  const storage = mmHomeStorage(mmHomeState());
  mmHomeWriteStorage({ preferences: storage.preferences, moduleState: storage.moduleState });
  return window.MM_HOME_CORE.clone(sanitized);
}

function mmHomeReadCache(dataVersion, options) {
  let cache = mmHomeRuntime.cache;
  if (!cache) {
    try { cache = JSON.parse(sessionStorage.getItem(MM_HOME_SESSION_CACHE_KEY) || "null"); }
    catch (_) { cache = null; }
    if (cache) mmHomeRuntime.cache = window.MM_HOME_CORE.clone(cache);
  }
  const cachedAt = cache && Date.parse(cache.cachedAt);
  const age = Number.isFinite(cachedAt) ? Math.max(0, Date.now() - cachedAt) : Infinity;
  const prefix = options && options.dataVersionPrefix;
  if (!cache ||
      cache.cacheVersion !== window.MM_HOME_CORE.CACHE_VERSION ||
      (dataVersion != null && cache.dataVersion !== dataVersion) ||
      (prefix && !String(cache.dataVersion || "").startsWith(prefix)) ||
      age > window.MM_HOME_CORE.CACHE_TTL_MS) {
    mmHomeClearPersonalizedCache();
    return null;
  }
  try {
    const response = window.MM_HOME_CORE.validateResponse(window.MM_HOME_CORE.clone(cache.response));
    response.greeting = window.MM_HOME_CORE.buildGreeting(response.user.displayName);
    return response;
  } catch (_) {
    mmHomeClearPersonalizedCache();
    return null;
  }
}

function mmHomeReadFormalCache(state, access) {
  const response = mmHomeReadCache(null, { dataVersionPrefix: "formal|" });
  if (!response) return null;
  const expectedStatus = access.status === "limited"
    ? "limited"
    : state.profileResult && state.profileResult.status;
  const expectedAuthorization = access.status === "limited" ? "revoked" : null;
  if ((expectedStatus && response.user.profileStatus !== expectedStatus) ||
      (expectedAuthorization && response.dataStatus.authorizationStatus !== expectedAuthorization)) {
    mmHomeClearPersonalizedCache();
    return null;
  }
  return response;
}

async function mmHomeBootstrapDirectDemo() {
  const query = new URLSearchParams(location.search || "");
  if (query.get("demo") !== "STEADY_PLANNER") return;
  const state = mmHomeState();
  if (state.profileResult && state.analysisJob && state.analysisJob.status === "succeeded" &&
      state.demoPersonaId === "STEADY_PLANNER" &&
      state.demoSession && !OnboardingStore.isDemoSessionExpired(state.demoSession)) return;
  const bootstrap = window.MM_INVESTMENT_SERVICES &&
    window.MM_INVESTMENT_SERVICES.demo &&
    window.MM_INVESTMENT_SERVICES.demo.bootstrapHomeDemo;
  if (typeof bootstrap !== "function") throw mmHomeError("HOME_DEMO_BOOTSTRAP_UNAVAILABLE", "welcome.html");
  await bootstrap("STEADY_PLANNER");
}

async function mmHomeEvaluatePreparedAccess() {
  await mmHomeBootstrapDirectDemo();
  const state = mmHomeState();
  const access = window.MM_HOME_CORE.evaluateHomeAccess(state, location.search || "");
  if (access.status === "redirect") throw mmHomeError(access.reason, access.route);
  if (access.status === "limited") mmHomeClearPersonalizedCache();
  return { state: mmHomeState(), access };
}

/** @type {MaiMateHomeService} */
const MockMaiMateHomeService = {
  async getHome() {
    const prepared = await mmHomeEvaluatePreparedAccess();
    const dataVersion = mmHomeDataVersion(prepared.state, prepared.access);
    const cached = mmHomeReadCache(dataVersion);
    if (cached) {
      Promise.resolve()
        .then(() => this.refreshHome())
        .then((response) => {
          window.dispatchEvent(new CustomEvent("maimate:home-updated", { detail: response }));
        })
        .catch(() => {});
      return cached;
    }
    return this.refreshHome();
  },
  async refreshHome() {
    if (mmHomeRuntime.failRequests) throw mmHomeError("HOME_LOAD_FAILED");
    const prepared = await mmHomeEvaluatePreparedAccess();
    let response;
    try {
      response = prepared.access.status === "limited"
        ? mmHomeBuildLimitedResponse(prepared.state)
        : mmHomeBuildResponse(prepared.state);
    } catch (error) {
      mmHomeTrack("maimate_home_load_failed");
      throw error;
    }
    const dataVersion = mmHomeDataVersion(prepared.state, prepared.access);
    return mmHomeSaveCache(response, dataVersion);
  },
  async dismissModule(moduleId) {
    const id = String(moduleId || "");
    window.MM_HOME_CORE.assert(id.length > 0, "INVALID_HOME_MODULE_ID");
    const response = await this.getHome();
    const module = response.modules.find((item) => item.id === id);
    window.MM_HOME_CORE.assert(module && module.dismissible, "HOME_MODULE_NOT_DISMISSIBLE");
    const storage = mmHomeStorage(mmHomeState());
    storage.moduleState.dismissed[id] = new Date().toISOString();
    delete storage.moduleState.snoozed[id];
    mmHomeWriteStorage({ moduleState: storage.moduleState });
    mmHomeClearPersonalizedCache();
  },
  async snoozeModule(moduleId, duration) {
    const id = String(moduleId || "");
    window.MM_HOME_CORE.assert(id.length > 0, "INVALID_HOME_MODULE_ID");
    const response = await this.getHome();
    const module = response.modules.find((item) => item.id === id);
    window.MM_HOME_CORE.assert(module && module.dismissible, "HOME_MODULE_NOT_SNOOZABLE");
    const storage = mmHomeStorage(mmHomeState());
    storage.moduleState.snoozed[id] = new Date(
      Date.now() + window.MM_HOME_CORE.parseSnoozeDuration(duration)
    ).toISOString();
    delete storage.moduleState.dismissed[id];
    mmHomeWriteStorage({ moduleState: storage.moduleState });
    mmHomeClearPersonalizedCache();
  },
  async updateAmountVisibility(hidden) {
    const storage = mmHomeStorage(mmHomeState());
    storage.preferences.amountsHidden = Boolean(hidden);
    mmHomeWriteStorage({ preferences: storage.preferences });
    mmHomeClearPersonalizedCache();
  },
};

async function mmHomeFetchJson(path, options) {
  const response = await fetch((window.API_BASE || "") + path, Object.assign({
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  }, options || {}));
  if (!response.ok) throw mmHomeError("HOME_API_REQUEST_FAILED");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function mmHomeStoreFormalResponse(payload) {
  const response = window.MM_HOME_CORE.sanitizeResponse(payload);
  const dataVersion = [
    "formal",
    response.user.effectiveProfileVersion,
    response.generatedAt,
    response.dataStatus.portfolioUpdatedAt || "",
    response.dataStatus.marketUpdatedAt || "",
  ].join("|");
  return mmHomeSaveCache(response, dataVersion);
}

/** @type {MaiMateHomeService} */
const MaiMatePersonalizedHomeService = {
  async getHome() {
    const state = mmHomeState();
    const access = window.MM_HOME_CORE.evaluateHomeAccess(state, location.search || "");
    const cached = access.status === "redirect" ? null : mmHomeReadFormalCache(state, access);
    if (cached) {
      Promise.resolve()
        .then(() => this.refreshHome())
        .then((response) => {
          window.dispatchEvent(new CustomEvent("maimate:home-updated", { detail: response }));
        })
        .catch(() => {});
      return cached;
    }
    const payload = await mmHomeFetchJson("/api/v1/maimate/home");
    return mmHomeStoreFormalResponse(payload);
  },
  async refreshHome() {
    const payload = await mmHomeFetchJson("/api/v1/maimate/home/refresh", { method: "POST" });
    return mmHomeStoreFormalResponse(payload);
  },
  async dismissModule(moduleId) {
    await mmHomeFetchJson(
      "/api/v1/maimate/home/modules/" + encodeURIComponent(moduleId) + "/dismiss",
      { method: "POST" }
    );
    mmHomeClearPersonalizedCache();
  },
  async snoozeModule(moduleId, duration) {
    await mmHomeFetchJson(
      "/api/v1/maimate/home/modules/" + encodeURIComponent(moduleId) + "/snooze",
      { method: "POST", body: JSON.stringify({ duration: String(duration) }) }
    );
    mmHomeClearPersonalizedCache();
  },
  async updateAmountVisibility(hidden) {
    await mmHomeFetchJson("/api/v1/maimate/preferences/privacy", {
      method: "PATCH",
      body: JSON.stringify({ hidden: Boolean(hidden) }),
    });
    const storage = mmHomeStorage(mmHomeState());
    storage.preferences.amountsHidden = Boolean(hidden);
    mmHomeWriteStorage({ preferences: storage.preferences });
    mmHomeClearPersonalizedCache();
  },
};

const activeHomeService = window.MM_USE_FORMAL_HOME === true
  ? MaiMatePersonalizedHomeService
  : MockMaiMateHomeService;

window.MM_HOME_SERVICES = Object.freeze({
  home: activeHomeService,
  mock: MockMaiMateHomeService,
  formal: MaiMatePersonalizedHomeService,
  adapters: Object.freeze({
    portfolio: PortfolioAdapter,
    transactions: TransactionAdapter,
    market: MarketDataAdapter,
    effectiveProfile: EffectiveProfileAdapter,
    similarMoment: SimilarMomentAdapter,
    attribution: AttributionAdapter,
    learning: LearningContentAdapter,
    conversationContext: ConversationContextAdapter,
  }),
  async evaluateAccess() {
    try {
      return (await mmHomeEvaluatePreparedAccess()).access;
    } catch (error) {
      if (error.redirectRoute) {
        return { status: "redirect", route: error.redirectRoute, reason: error.code || error.message };
      }
      throw error;
    }
  },
  getCachedHome() {
    try {
      const state = mmHomeState();
      const access = window.MM_HOME_CORE.evaluateHomeAccess(state, location.search || "");
      if (access.status === "redirect") return null;
      if (activeHomeService === MaiMatePersonalizedHomeService) {
        return mmHomeReadFormalCache(state, access);
      }
      return mmHomeReadCache(mmHomeDataVersion(state, access));
    } catch (_) {
      return null;
    }
  },
  clearCache: mmHomeClearPersonalizedCache,
  findAction(response, moduleId, actionId) {
    return window.MM_HOME_CORE.findAction(response, moduleId, actionId);
  },
  actionDestination(action) {
    return ConversationContextAdapter.destination(action);
  },
  trackEvent: mmHomeTrack,
  setFailureMode(value) {
    mmHomeRuntime.failRequests = Boolean(value);
  },
  setModuleFailure(type, value) {
    window.MM_HOME_CORE.assert(window.MM_HOME_CORE.MODULE_TYPES.includes(type), "INVALID_HOME_MODULE_TYPE");
    if (value) mmHomeRuntime.failedModuleTypes.add(type);
    else mmHomeRuntime.failedModuleTypes.delete(type);
    mmHomeClearPersonalizedCache();
  },
});
