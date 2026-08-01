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
  /* /health 的結果。這是整條新線上唯一真的會連到後端的資料——其餘模組打的
     /api/v1/maimate/* 後端沒有實作，一律落回 mocks/home.js。 */
  health: null,
  healthPromise: null,
  healthNotified: false,
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

/* 占比一律保留一位小數：報告寫 98.6%，畫面不准四捨五入成 99%
 * （整數本來就不會補 .0，例如 0.52 →「52%」）。 */
function mmHomeRatio(value) {
  return mmHomePercent(value, 1);
}

/** 最大持有的顯示名稱：現金帳戶要說「現金（TWD）」，不是光一個「TWD」 */
function mmHomeTopLabel(portfolio) {
  return String((portfolio && (portfolio.topAssetLabel || portfolio.topAsset)) || "主要持有");
}

/* 期間標籤：報告只有每月聚合，任何地方都不得寫成「最近 30 天」。 */
function mmHomeRecentPeriodLabel(transactions) {
  return transactions.recentPeriodLabel ? "最近一個月（" + transactions.recentPeriodLabel + "）" : "最近一個月";
}

function mmHomePreviousPeriodLabel(transactions) {
  return transactions.previousPeriodLabel ? "前一個月（" + transactions.previousPeriodLabel + "）" : "前一個月";
}

/** 期間買賣總筆數（帶千分位）；報告沒有交易日期分布，所以不談「交易日數」 */
function mmHomeTradeTotalText(transactions) {
  return Number(transactions.count).toLocaleString("en-US") + " 筆";
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

/* 三種版面＝問卷 Q6 的三種溝通風格（呈現偏好，不是投資人格分類）：
 *   guided     安心白話——保留解釋段落，少一點數字
 *   concise    成長陪跑——只留結論與摘要
 *   analytical 專業效率——解釋與證據數字全展開
 *
 * 三個標籤與 app.js 的 MODE_LABELS 同名同序，改一邊 smoke:home:integration 會紅。 */
const MM_HOME_STYLES = ["guided", "concise", "analytical"];

/** 目前套用的版面：使用者在首頁選過就以他的選擇為準，否則跟著問卷 Q6 的答案 */
function mmHomeResolveStyle(state) {
  const chosen = mmHomeStorage(state).preferences.presentationStyle;
  if (MM_HOME_STYLES.includes(chosen)) return { style: chosen, source: "userChoice" };
  // effectiveProfile 只承載 dimension 修正，溝通風格仍以問卷答案為準
  const fromProfile = (state.effectiveProfile && state.effectiveProfile.communicationStyle) ||
    (state.profile && state.profile.communicationStyle);
  return MM_HOME_STYLES.includes(fromProfile)
    ? { style: fromProfile, source: "questionnaire" }
    : { style: "guided", source: "default" };
}

function mmHomeStorage(state) {
  const source = state && state.home && typeof state.home === "object" ? state.home : {};
  return {
    // presentationStyle 未設定＝跟著問卷 Q6 的溝通風格走（見 mmHomeResolveStyle）
    preferences: Object.assign({ amountsHidden: false, presentationStyle: null }, source.preferences || {}),
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
        // 顯示名稱（例如「現金（TWD）」）與是否為現金，決定文案要說「集中」還是「資金多在現金」
        label: String(asset.label || asset.symbol),
        isCash: Boolean(asset.isCash),
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
      topAssetLabel: assets[0].label,
      topAssetIsCash: assets[0].isCash,
      topAssetRatio: assets[0].weight,
      topTwoAssetsRatio: assets.slice(0, 2).reduce((sum, asset) => sum + asset.weight, 0),
      /* issue #29 重跑後報告才有各幣種快照；沒有時只有最大持有標的，其餘未細分。 */
      breakdownAvailable: Boolean(source && source.breakdownAvailable),
      asOfMonth: source && source.asOfMonth,
      snapshotAsOf: (source && source.snapshotAsOf) || null,
      snapshotMethod: (source && source.snapshotMethod) || null,
      /* 前期快照：Screen 8 的期間對照要用，報告沒有就是 null（不得由前端推估）。 */
      previousAsOfMonth: (source && source.previousAsOfMonth) || null,
      previousTopAssetRatio: Number.isFinite(Number(source && source.previousTopWeight))
        ? Number(source.previousTopWeight)
        : null,
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
    /* 真實帳戶報告只有「每月交易次數」，沒有逐筆明細（官方 CSV 不進 git）。
     * 因此比較單位是「月」而不是滾動 30 天，欄位語意見 periodLabel。 */
    const activity = window.MM_ONBOARDING_MOCK && window.MM_ONBOARDING_MOCK.tradeActivity;
    if (!activity || !Number.isFinite(Number(activity.total))) {
      return {
        available: true,
        count: 0,
        transactions: [],
        detailAvailable: false,
        recent30Count: 0,
        previous30Count: 0,
        averagePerMonth: 0,
        lastTransactionAt: null,
        lastTransactionDaysAgo: null,
        activeDays: null,
      };
    }
    const referenceTime = Date.parse(asOf);
    window.MM_HOME_CORE.assert(Number.isFinite(referenceTime), "INVALID_HOME_REFERENCE_TIME");
    return {
      available: true,
      count: Number(activity.total),
      transactions: [],            // 逐筆明細不可用
      detailAvailable: false,
      periodUnit: "month",
      recentPeriodLabel: activity.latestMonth,
      previousPeriodLabel: activity.previousMonth,
      recent30Count: Number(activity.latestMonthCount),
      previous30Count: Number(activity.previousMonthCount),
      averagePerMonth: Number(activity.averagePerMonth),
      buyTotal: Number(activity.buyTotal),
      sellTotal: Number(activity.sellTotal),
      /* 每月買賣筆數（Screen 8 交易節奏圖用真值畫柱狀，不重新取樣、不內插）。 */
      perMonth: Object.assign({}, activity.perMonth),
      byCurrency: Object.assign({}, activity.byCurrency),
      busiestMonth: activity.busiestMonth,
      /* 報告只給每月筆數，沒有「最後一筆交易」的日期——用資料期間末日冒充會是編造，
       * 所以留 null，畫面改顯示 periodLabel（例如「2025-12 共 375 筆」）。 */
      periodEnd: activity.periodEnd,
      lastTransactionAt: null,
      lastTransactionDaysAgo: null,
      activeDays: null,            // 報告未提供交易日期分布
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
      /* 下游文案要用這個標籤講期間，不得自己寫死「今天」。 */
      periodLabel: source.period ? source.period + " 整月" : "最近 24 小時",
      attributionType: source.type === "calculated" ? "calculated" : "estimated",
      contributors,
      evidence: [
        {
          /* 期間必須照上游給的來源寫，不得寫死成「最近 24 小時」——
           * health_report 的歸因是整月聚合，寫死會讓畫面數字對不上期間。 */
          id: "attribution-period",
          label: "估算期間",
          value: source.period ? source.period + " 整月" : "最近 24 小時",
          source: "marketContext",
        },
        {
          id: "attribution-top-asset",
          label: "目前最大持有",
          value: mmHomeTopLabel(portfolio) + " 約 " + mmHomeRatio(portfolio.topAssetRatio),
          source: "portfolio",
        },
      ],
      periodStart: String(source.periodStart),
      periodEnd: String(source.periodEnd),
    };
    return window.MM_HOME_CORE.validateAttribution(result);
  },
});

/** 交易節奏標題／摘要一律由實際筆數決定 */
function mmHomeRhythmTitle(transactions) {
  const recent = Number(transactions.recent30Count);
  const previous = Number(transactions.previous30Count);
  if (!Number.isFinite(recent) || !Number.isFinite(previous)) return "交易節奏還需要更多紀錄";
  if (recent > previous) return "最近的交易次數比前一個月多";
  if (recent < previous) return "最近的交易次數比前一個月少";
  return "近期交易節奏沒有明顯增加";
}

/** 由實際交易時間推出「1 月 8 日至 9 日」這類期間標籤 */
function mmHomeDateRangeLabel(times) {
  const dates = times.map((time) => new Date(time)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return "當時";
  const first = dates[0];
  const last = dates[dates.length - 1];
  const label = (date) => (date.getMonth() + 1) + " 月 " + date.getDate() + " 日";
  if (first.getMonth() === last.getMonth() && first.getDate() === last.getDate()) return label(first);
  return first.getMonth() === last.getMonth()
    ? label(first) + "至 " + last.getDate() + " 日"
    : label(first) + "至 " + label(last);
}

const SimilarMomentAdapter = Object.freeze({
  /* 真實帳戶報告裡唯一有明細的事件＝機會成本最大的那筆賣出（含日期、幣種、賣價、年末價）。
   * 相似時刻一律以它為準，不再依賴逐筆交易明細（報告沒有）。 */
  read(transactionMetrics) {
    const source = window.MM_HOME_MOCK && window.MM_HOME_MOCK.similarMomentInput;
    const sell = window.MM_ONBOARDING_MOCK && window.MM_ONBOARDING_MOCK.notableSell;
    if (!source || !transactionMetrics.available || !sell || !sell.date) return null;
    const symbol = String(sell.currency || "").toUpperCase();
    const periodLabel = mmHomeDateRangeLabel([sell.date]);
    const priceRatio = Number(sell.sell_price) > 0
      ? (Number(sell.eoy_price) - Number(sell.sell_price)) / Number(sell.sell_price)
      : null;
    const missedText = Number.isFinite(Number(sell.missed_twd))
      ? "NT$" + Math.round(Number(sell.missed_twd)).toLocaleString("en-US")
      : null;
    const userBehaviorThen = [
      periodLabel + "你賣出了 " + symbol + "，成交價 " + sell.sell_price + "。",
    ];
    if (missedText) {
      userBehaviorThen.push("到年末價格為 " + sell.eoy_price + "，這筆賣出的機會成本約 " + missedText + "。");
    }
    const userBehaviorNow = ["目前的交易明細沒有進入這份報告，所以這次的行為無法逐筆對照。"];
    const historicalContext = window.MM_HOME_CORE.clone(source.historicalContext);
    historicalContext.relatedAssets = [symbol];
    historicalContext.periodLabel = periodLabel;
    historicalContext.marketChangeSummary = priceRatio == null
      ? "當時的價格變化沒有足夠紀錄可以推算。"
      : symbol + " 在 " + periodLabel + "的賣出價 " + sell.sell_price + "，年末為 " + sell.eoy_price +
        "（約 " + mmHomePercent(priceRatio, 1) + "）。";
    return {
      id: String(source.id),
      title: String(source.title),
      currentContext: window.MM_HOME_CORE.clone(source.currentContext),
      historicalContext,
      similarities: source.similarities.slice(),
      differences: source.differences.slice(),
      userBehaviorThen,
      userBehaviorNow,
      /* 給 Screen 7 引用用的原始欄位：回答裡出現的數字必須查得到來源。 */
      sourceEvent: {
        periodLabel,
        symbol,
        sellPrice: sell.sell_price,
        endOfYearPrice: sell.eoy_price,
        missedText,
        priceChangeText: priceRatio == null ? null : mmHomePercent(priceRatio, 1),
      },
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
      recommendationReason: portfolio.topAssetIsCash
        ? "因為你的資金約有 " + mmHomeRatio(portfolio.topAssetRatio) + " 停在" +
          mmHomeTopLabel(portfolio) + "，這一課用占比說明資產比重怎麼影響帳戶變化。"
        : "因為 " + mmHomeTopLabel(portfolio) + " 目前約占你的資產 " + mmHomeRatio(portfolio.topAssetRatio) + "。",
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
  // 佔比允許整數或一位小數兩種寫法（報告本身給到一位小數，例如 98.6%）
  const topPercent = mmHomePercent(facts.portfolio.topAssetRatio);
  const topPercentPrecise = mmHomePercent(facts.portfolio.topAssetRatio, 1);
  const marketPercent = mmHomePercent(facts.primaryMarket.changeRatio, 1);
  window.MM_HOME_CORE.assert(
    (source.todayRelevant.explanation.includes(topPercent) ||
     source.todayRelevant.explanation.includes(topPercentPrecise)) &&
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

/* 帳戶變化來源：報告補上 change_attribution（issue #29）後才講得出來源比重。
 * 報告標 type=estimated（殘差法），所以一律說「估算」，不得寫成會計歸因。 */
function mmHomeAttributionSummary() {
  const attribution = window.MM_ACCOUNT && window.MM_ACCOUNT.changeAttribution;
  if (!attribution || !Array.isArray(attribution.contributors) || !attribution.contributors.length) {
    return "這份報告沒有各幣種持倉明細，因此不拆解帳戶變化來源。";
  }
  const lead = attribution.contributors.slice().sort((a, b) => Number(b.pct) - Number(a.pct))[0];
  const label = lead.category === "netDeposit" ? "出入金淨額"
    : lead.category === "marketPrice" ? "市價波動"
      : lead.category;
  return attribution.period + " 的帳戶變化約有 " + lead.pct + "% 來自" + label +
    "，屬依報告聚合值的估算，不等同正式會計損益。";
}

function mmHomeRuleNarrative(facts) {
  const portfolio = facts.portfolio;
  const transactions = facts.transactions;
  const primaryMarket = facts.primaryMarket;
  const topLabel = mmHomeTopLabel(portfolio);
  const topRatio = mmHomeRatio(portfolio.topAssetRatio);
  const marketRatio = mmHomePercent(primaryMarket.changeRatio, 1);
  /* 現金占比高＝資金多停在現金（保守），語意和「持倉過度集中」相反，文案不得混用。 */
  return {
    todayRelevant: {
      headline: portfolio.topAssetIsCash
        ? "你的資金主要停在" + topLabel + "，市場變動對整體帳戶的直接影響有限。"
        : topLabel + " 是你今天帳戶變化的主要來源。",
      explanation: "示範行情中 " + primaryMarket.symbol + " 今日約變動 " + marketRatio +
        "；你目前最大的一筆是" + topLabel + "，約占 " + topRatio +
        "。這裡只整理關聯，不提供買賣指令。",
    },
    planAlignmentSummary: mmHomeRhythmTitle(transactions).replace("最近的交易次數", "可確認的交易次數") +
      "；持有時間仍需要更多資料才能完整對照。",
    attributionSummary: mmHomeAttributionSummary(),
    similarMomentSummary: "只有一次留有完整明細的紀錄可以回顧；資產與變動幅度都和這次不同。",
    contextualQuestions: [
      {
        id: "question_cash_impact",
        text: portfolio.topAssetIsCash ? "資金停在現金對我的帳戶有什麼影響？" : "為什麼最大持有會影響我的帳戶比較多？",
        contextType: "portfolio",
      },
      { id: "question_market_source", text: "今天的市場變化跟我有關嗎？", contextType: "market" },
      { id: "question_rhythm", text: "我的交易頻率算高嗎？", contextType: "behavior" },
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
          /* 市場那一格要講示範行情的主要資產（BTC），不是帳戶的最大持有——
           * 帳戶最大持有是現金時，「TWD 今日變動」是不存在的東西。 */
          id: "today-market-change",
          label: primaryMarket.symbol + " 今日變動",
          value: mmHomePercent(primaryMarket.changeRatio, 1) + "（示範資料）",
          source: "marketContext",
        },
        {
          id: "today-allocation",
          label: mmHomeTopLabel(portfolio) + " 占比",
          value: "約 " + mmHomeRatio(portfolio.topAssetRatio),
          source: "portfolio",
        },
        {
          id: "today-recent-trades",
          label: mmHomeRecentPeriodLabel(transactions) + "買賣",
          value: transactions.recent30Count + " 筆",
          source: "transactions",
        },
        {
          id: "today-previous-trades",
          label: mmHomePreviousPeriodLabel(transactions) + "買賣",
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
        id: "question-top-asset-impact",
        type: "openChat",
        /* 現金帳戶問「為什麼 TWD 影響比較大？」是錯的問題——資金停在現金代表影響變小。 */
        label: portfolio.topAssetIsCash
          ? "資金停在現金有什麼影響？"
          : "為什麼 " + mmHomeTopLabel(portfolio) + " 影響比較大？",
        route: "/maimate/chat",
        question: portfolio.topAssetIsCash
          ? "資金停在現金對我的帳戶有什麼影響？"
          : "為什麼 " + mmHomeTopLabel(portfolio) + " 會影響我的帳戶比較多？",
        context: mmHomeContext("module_today_relevant", profile, {
          source: "today_relevant_hero",
          questionId: "question_cash_impact",
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
      label: mmHomeRecentPeriodLabel(transactions) + " " + transactions.recent30Count + " 筆，" +
        mmHomePreviousPeriodLabel(transactions) + " " + transactions.previous30Count + " 筆",
      trend: transactions.recent30Count === transactions.previous30Count
        ? "stable"
        : transactions.recent30Count > transactions.previous30Count ? "increased" : "decreased",
    },
    {
      /* 前後期都直接列出實際占比，不換算成「幾個百分點」——避免百分比與百分點混用。 */
      id: "behavior-allocation",
      label: topWeightChange == null
        ? mmHomeTopLabel(portfolio) + "目前約占 " + mmHomeRatio(portfolio.topAssetRatio)
        : mmHomeTopLabel(portfolio) + "目前約占 " + mmHomeRatio(portfolio.topAssetRatio) +
          "，前期快照為 " + mmHomeRatio(priorTopWeight),
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
          label: mmHomeRecentPeriodLabel(transactions) + "買賣",
          value: transactions.recent30Count + " 筆",
          source: "transactions",
        },
        {
          id: "alignment-allocation",
          label: "最大持有",
          value: mmHomeTopLabel(portfolio) + " 約 " + mmHomeRatio(portfolio.topAssetRatio),
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
      /* 現金占比高＝資金多停在現金，不是「持倉過度集中」；兩者結論相反，不可共用文案。 */
      title: portfolio.topAssetIsCash ? "你的資金主要停在現金" : "最大持有仍是帳戶變化的關鍵",
      summary: portfolio.topAssetIsCash
        ? mmHomeTopLabel(portfolio) + "約占目前資產 " + mmHomeRatio(portfolio.topAssetRatio) +
          "，所以市場價格變動反映到整體帳戶的幅度有限。"
        : mmHomeTopLabel(portfolio) + " 約占目前資產 " + mmHomeRatio(portfolio.topAssetRatio) + "，今天的主要變化也和它有關。",
      explanation: portfolio.topAssetIsCash
        ? "帳戶整體變化是各項資產依占比加權的結果；資金多在現金時，加密資產的漲跌帶動整體帳戶的幅度會比較小。這是關聯說明，不代表好壞。"
        : "持倉占比較高時，該資產的價格變化會更容易反映在帳戶整體變化上；這是關聯說明，不代表好壞。",
      priority: "high",
      evidence: [
        {
          id: "insight-top-weight",
          label: mmHomeTopLabel(portfolio) + " 占比（" + (portfolio.asOfMonth || "最新月份") + "）",
          value: "約 " + mmHomeRatio(portfolio.topAssetRatio),
          source: "portfolio",
        },
        {
          id: "insight-other-weight",
          // 報告只有最大持有一項，其餘未細分——不得為了畫面把它拆成看似精確的比例
          label: "其餘資產（未細分）",
          value: portfolio.breakdownAvailable
            ? "約 " + mmHomeRatio(1 - portfolio.topAssetRatio)
            : "約 " + mmHomeRatio(1 - portfolio.topAssetRatio) + "，報告未提供各幣種比例",
          source: "portfolio",
        },
        ...(attribution ? [{
          id: "insight-market-attribution",
          label: "市場價格估算影響",
          // 後端若少回 marketPrice 這一項，只讓這一格顯示「資料不足」，不得讓整頁掛掉
          value: mmHomeMarketPriceRatioText(attribution),
          source: "marketContext",
        }] : []),
      ],
      contextualQuestions: portfolio.topAssetIsCash
        ? [
          { id: "question_cash_impact", text: "資金停在現金對我的帳戶有什麼影響？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
          { id: "question_allocation_change", text: "我的配置最近有變嗎？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
        ]
        : [
          { id: "question_concentration_impact", text: "為什麼占比會放大影響？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
          { id: "question_allocation_change", text: "我的配置最近有變嗎？", contextType: "portfolio", relatedInsightId: "insight_market_impact" },
        ],
      dismissible: true,
    },
    {
      id: "insight_trading_rhythm",
      type: "tradingRhythmChange",
      // 標題跟著實際筆數走，不預設「沒有增加」（換資料就會說反話）
      title: mmHomeRhythmTitle(transactions),
      summary: mmHomeRecentPeriodLabel(transactions) + " " + transactions.recent30Count + " 筆、" +
        mmHomePreviousPeriodLabel(transactions) + " " + transactions.previous30Count +
        " 筆買賣；期間共 " + mmHomeTradeTotalText(transactions) + "，平均每月約 " +
        transactions.averagePerMonth + " 筆。",
      explanation: "目前只比較報告提供的每月買賣筆數，不從頻率推測操作原因或心理狀態。" +
        (correctedRhythm ? " 你先前補充：「" + correctedRhythm.effectiveDescriptor + "」；原始交易筆數仍會保留。" : ""),
      priority: "normal",
      evidence: [
        {
          id: "insight-recent-count",
          label: mmHomeRecentPeriodLabel(transactions),
          value: transactions.recent30Count + " 筆買賣",
          source: "transactions",
        },
        {
          id: "insight-monthly-average",
          label: "期間平均每月",
          value: "約 " + transactions.averagePerMonth + " 筆",
          source: "transactions",
        },
        {
          id: "insight-previous-count",
          label: mmHomePreviousPeriodLabel(transactions),
          value: transactions.previous30Count + " 筆買賣",
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
      "」；" + mmHomeRatio(portfolio.topAssetRatio) + " 的原始持倉比例不會被改寫。";
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
      /* 報告沒有各幣種持倉明細，「持有幾項資產」是未知數：留 null 讓畫面顯示「—」，
       * 不得把「最大持有＋其餘未細分」數成 2 項當作事實。 */
      assetCount: portfolio.breakdownAvailable ? portfolio.assetCount : null,
      assetCountLabel: portfolio.breakdownAvailable ? null : "報告未提供",
      topAsset: portfolio.topAsset,
      topAssetLabel: mmHomeTopLabel(portfolio),
      topAssetRatio: portfolio.topAssetRatio,
      topTwoAssetsRatio: portfolio.breakdownAvailable ? portfolio.topTwoAssetsRatio : null,
      /* 報告只有每月筆數，沒有最後一筆交易的日期 → 改顯示可對照的期間與筆數。 */
      lastTransactionAt: transactions.lastTransactionAt,
      lastTransactionDaysAgo: transactions.lastTransactionDaysAgo,
      latestTransactionLabel: transactions.recentPeriodLabel
        ? transactions.recentPeriodLabel + " 共 " + transactions.recent30Count + " 筆"
        : "報告未提供",
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

  /* ── 新線第一批吃真後端的模組：健康分（/health）與行情（/market）──
   *
   * 健檢排最前面：這是 index.html 一路以來的敘事順序，也是簡報鏡 1 的內容。
   * 行情排最後面：它是參考資料不是個人化敘事，而且 Screen 6 規格要求第一屏必須
   * 看得到 Plan Alignment 的開頭（smoke_home 有斷言）——兩張大卡都塞在最上面會把它
   * 擠出視窗。index.html 的順序同樣是「健檢 → 洞察 → 行情」，這裡保持一致。
   *
   * 既有 position 1–9 寫死在十七處，逐一改號碼容易漏一個造成撞號，所以統一位移，
   * 相對順序完全不變。 */
  const health = mmHomeRuntime.health
    || { source: "demo", report: window.MM_HOME_HEALTH_MOCK || null };
  const leadModules = [];

  if (health.report) {
    leadModules.push(mmHomeModule({
      id: "module_health_score",
      type: "healthScore",
      priority: "high",
      position: 1,
      /* 只帶原始報告與來源，分數不預先算好——算在 health-core.js，
         否則快取裡會躺一個跟畫面不一致的舊分數。 */
      /* 標題不用「投資健康分」——那是 MM_HOME_PROHIBITED_NARRATIVE 明文擋掉的詞
         （不替使用者評等）。index.html 用的是舊措辭，兩頁用語目前刻意不同。 */
      payload: { title: "行為健檢", source: health.source, report: health.report },
      actions: [{
        id: "health_score_ask",
        type: "openChat",
        label: "問麥麥這些數字怎麼來的",
        question: "這張行為健檢的數字是怎麼算出來的？",
        context: mmHomeContext("module_health_score", profile),
      }],
    }));
  }

  modules.forEach((module) => { module.position += leadModules.length; });
  modules.unshift(...leadModules);

  const lastPosition = modules.reduce((max, m) => Math.max(max, m.position), 0);
  modules.push(mmHomeModule({
    id: "module_market_watch",
    type: "marketWatch",
    priority: "normal",
    position: lastPosition + 1,
    payload: window.MM_MARKET_CORE.buildPayload({
      /* 沒有 API_BASE 就直接進誠實的空狀態，不要送出註定失敗的請求再閃一次錯誤。 */
      live: Boolean(window.API_BASE),
    }),
    actions: [],
  }));

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
    /* 健康分來源要進版本字串：demo→live 切換時快取必須失效，
       否則後端恢復了畫面還一直掛著「示範資料」。 */
    mmHomeRuntime.health ? mmHomeRuntime.health.source : "pending",
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

/* 取 /health。失敗（沒設 API_BASE、斷網、後端掛）就回 demo 並標記來源，
 * 由畫面明說是示範資料。這裡刻意不 throw：健康分取不到不該讓整個首頁進錯誤頁，
 * 其餘八個模組跟 /health 沒有關係。 */
async function mmHomeFetchHealth() {
  const fallback = { source: "demo", report: window.MM_HOME_HEALTH_MOCK || null };
  if (!window.API_BASE) return fallback;
  /* 一定要有逾時。整個首頁的渲染排在這個 await 後面，而場地網路每 5 次連線掉 1 次
     （CLAUDE.md 待辦：TLS 被 reset，ping 不掉）。沒有逾時就會卡在骨架畫面出不來——
     那比顯示示範資料嚴重得多。2.5 秒取不到就先走 demo，重新整理還有機會拿到。 */
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2500);
  try {
    const report = await mmHomeFetchJson("/health", { signal: abort.signal });
    /* 至少要有一個 health-core 算得動的子項，否則當作沒拿到——
       回一個空物件進去只會畫出一張全是「—」的卡，比誠實地說示範資料更難懂。 */
    const usable = report && typeof report === "object"
      && (report.chase_index || report.realized_pnl || report.cash_flow_behavior);
    return usable ? { source: "live", report } : fallback;
  } catch (_) {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/* 首次渲染絕對不能排在 /health 後面。整個首頁只有健康分那一張卡跟 /health 有關，
 * 讓另外八個模組陪著等一趟網路往返是錯的——場地網路不穩時使用者會盯著骨架畫面。
 * 所以：先用示範資料把畫面畫出來，真資料回來了再走既有的背景更新路徑換上去
 * （和 getHome() 拿快取後回頭 refresh 的作法同一套）。 */
function mmHomeStartHealthLoad() {
  if (mmHomeRuntime.healthPromise) return mmHomeRuntime.healthPromise;
  mmHomeRuntime.healthPromise = mmHomeFetchHealth().then((result) => {
    mmHomeRuntime.health = result;
    /* 只有真的拿到線上資料才值得重畫一次；本來就是 demo 就別動畫面。 */
    if (result.source === "live" && !mmHomeRuntime.healthNotified) {
      mmHomeRuntime.healthNotified = true;
      Promise.resolve()
        .then(() => MockMaiMateHomeService.refreshHome())
        .then((response) => {
          window.dispatchEvent(new CustomEvent("maimate:home-updated", { detail: response }));
        })
        .catch(() => {});
    }
    return result;
  });
  return mmHomeRuntime.healthPromise;
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
    mmHomeStartHealthLoad();   // 不 await：首次用示範資料先畫，真資料回來再背景換上
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
  /** @param {"guided"|"concise"|"analytical"|null} style 傳 null＝改回跟著問卷答案 */
  async updatePresentationStyle(style) {
    const storage = mmHomeStorage(mmHomeState());
    storage.preferences.presentationStyle = MM_HOME_STYLES.includes(style) ? style : null;
    mmHomeWriteStorage({ preferences: storage.preferences });
    return storage.preferences.presentationStyle;
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
  /* TODO(正式 API)：版面偏好之後應併入 PATCH /api/v1/maimate/preferences；
   * 它只影響呈現密度、不影響資料，所以先在本地保存即可。 */
  async updatePresentationStyle(style) {
    const storage = mmHomeStorage(mmHomeState());
    storage.preferences.presentationStyle = MM_HOME_STYLES.includes(style) ? style : null;
    mmHomeWriteStorage({ preferences: storage.preferences });
    return storage.preferences.presentationStyle;
  },
};

const activeHomeService = window.MM_USE_FORMAL_HOME === true
  ? MaiMatePersonalizedHomeService
  : MockMaiMateHomeService;

window.MM_HOME_SERVICES = Object.freeze({
  styles: Object.freeze(MM_HOME_STYLES.slice()),
  /** 目前該用哪一種版面（使用者選過→他的選擇；否則→問卷 Q6；再否則→guided） */
  currentStyle() { return mmHomeResolveStyle(mmHomeState()); },
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
