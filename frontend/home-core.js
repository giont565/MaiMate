/* MaiMate Screen 6 共用型別、驗證與安全工具。
 * 零建置靜態 SPA：型別使用 JSDoc；UI 只透過 MM_HOME_SERVICES 取資料。
 */
"use strict";

/** @typedef {'todayRelevant'|'planAlignment'|'accountAttribution'|'similarMoment'|'personalizedInsight'|'contextualQuestions'|'learningRecommendation'|'accountSnapshot'|'profileStatus'|'dataStatus'|'systemNotice'} HomeModuleType */
/** @typedef {'low'|'normal'|'high'|'urgent'} ModulePriority */
/** @typedef {'navigate'|'openChat'|'openInsight'|'openBottomSheet'|'retry'|'dismiss'|'snooze'} HomeActionType */
/** @typedef {'morning'|'afternoon'|'evening'} GreetingPeriod */
/** @typedef {'draft'|'confirmed'|'revised'|'limited'} HomeProfileStatus */
/** @typedef {'guided'|'concise'|'analytical'} HomeCommunicationStyle */
/** @typedef {'fresh'|'stale'|'partial'} HomeDataFreshness */
/** @typedef {'aligned'|'partiallyAligned'|'different'|'insufficientData'} AlignmentStatus */

/** @typedef {{id:string,label:string,value?:string,source:'portfolio'|'transactions'|'fundingHistory'|'questionnaire'|'marketContext'|'effectiveProfile'}} HomeEvidencePoint */
/** @typedef {{id:string,type:HomeActionType,label:string,route?:string,question?:string,context?:Record<string,string>}} HomeAction */
/** @typedef {{userId:string,displayName?:string,demoMode:boolean,profileStatus:HomeProfileStatus,communicationStyle:HomeCommunicationStyle,effectiveProfileVersion:string}} HomeUserContext */
/** @typedef {{title:string,subtitle:string,period:GreetingPeriod,brandSubtitle?:string}} HomeGreeting */
/** @typedef {{id:string,type:HomeModuleType,priority:ModulePriority,position:number,visible:boolean,dismissible:boolean,payload:Object,actions:HomeAction[],expiresAt?:string}} HomeModule */
/** @typedef {{id:string,label:string,route:string,active:boolean}} HomeNavigationTab */
/** @typedef {{activeTab:'home'|'insights'|'chat'|'settings',tabs:HomeNavigationTab[]}} HomeNavigation */
/** @typedef {{portfolioUpdatedAt?:string,marketUpdatedAt?:string,profileUpdatedAt?:string,authorizationStatus:'demo'|'active'|'revoked'|'limited',analysisCoverage:'full'|'sufficient'|'limited'}} HomeDataStatus */
/** @typedef {{user:HomeUserContext,greeting:HomeGreeting,modules:HomeModule[],navigation:HomeNavigation,dataStatus:HomeDataStatus,generatedAt:string,nextRefreshAt?:string}} MaiMateHomeResponse */

/** @typedef {{title:string,headline:string,explanation:string,relatedAssets:string[],impactLevels:{market:'low'|'medium'|'high',allocation:'low'|'medium'|'high',behavior:'low'|'medium'|'high'},evidence:HomeEvidencePoint[],updatedAt:string,dataFreshness:HomeDataFreshness,generatedBy:'rules'|'rulesAndAi'|'fallbackTemplate'}} TodayRelevantPayload */
/** @typedef {{id:string,label:string,source:'questionnaire'|'effectiveProfile'}} PlanItem */
/** @typedef {{id:string,label:string,trend:'stable'|'increased'|'decreased'|'changed'|'unknown'}} BehaviorItem */
/** @typedef {{title:string,originalPlanItems:PlanItem[],recentBehaviorItems:BehaviorItem[],status:AlignmentStatus,summary:string,evidence:HomeEvidencePoint[]}} PlanAlignmentPayload */
/** @typedef {{id:string,category:'marketPrice'|'allocation'|'recentTrades'|'funding'|'other',label:string,contributionRatio:number,explanation:string}} AccountChangeContributor */
/** @typedef {{title:string,summary:string,attributionType:'estimated'|'calculated',contributors:AccountChangeContributor[],evidence:HomeEvidencePoint[],periodStart:string,periodEnd:string}} AccountAttributionPayload */
/** @typedef {{startDate:string,endDate:string,relatedAssets:string[],marketChangeSummary:string,portfolioSimilarity?:number}} MarketMoment */
/** @typedef {{id:string,title:string,currentContext:MarketMoment,historicalContext:MarketMoment,similarities:string[],differences:string[],userBehaviorThen:string[],userBehaviorNow:string[],summary:string,disclaimer:string,confidence:'high'|'medium'|'low'}} SimilarMomentPayload */
/** @typedef {{id:string,text:string,contextType:'market'|'portfolio'|'behavior'|'education'|'history',relatedInsightId?:string,relatedMomentId?:string}} ContextualQuestion */
/** @typedef {{id:string,type:'allocationChange'|'tradingRhythmChange'|'holdingPatternChange'|'volatilityBehavior'|'planAlignment'|'fundingPattern'|'marketImpact'|'dataQuality'|'learningOpportunity',title:string,summary:string,explanation:string,priority:ModulePriority,evidence:HomeEvidencePoint[],contextualQuestions:ContextualQuestion[],dismissible:boolean}} HomeInsight */
/** @typedef {{insights:HomeInsight[]}} PersonalizedInsightPayload */

/** @typedef {{cacheVersion:string,dataVersion:string,cachedAt:string,response:MaiMateHomeResponse}} MaiMateHomeCache */
/** @typedef {{amountsHidden:boolean}} MaiMateHomePreferences */
/** @typedef {{dismissed:Record<string,string>,snoozed:Record<string,string>}} MaiMateHomeModuleState */
/** @typedef {{getHome:()=>Promise<MaiMateHomeResponse>,refreshHome:()=>Promise<MaiMateHomeResponse>,dismissModule:(moduleId:string)=>Promise<void>,snoozeModule:(moduleId:string,duration:string)=>Promise<void>,updateAmountVisibility:(hidden:boolean)=>Promise<void>}} MaiMateHomeService */

const MM_HOME_CACHE_VERSION = "maimate-home-cache-v1";
const MM_HOME_CACHE_TTL_MS = 30 * 60 * 1000;
const MM_HOME_MODULE_TYPES = Object.freeze([
  /* healthScore／marketWatch 是新線上第一批吃真後端的模組（/health、/market）。
     其餘型別打的 /api/v1/maimate/* 後端還沒有，永遠落回 mocks/home.js。 */
  "healthScore",
  "marketWatch",
  "todayRelevant",
  "planAlignment",
  "accountAttribution",
  "similarMoment",
  "personalizedInsight",
  "contextualQuestions",
  "learningRecommendation",
  "accountSnapshot",
  "profileStatus",
  "dataStatus",
  "systemNotice",
]);
const MM_HOME_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const MM_HOME_ACTION_TYPES = Object.freeze([
  "navigate",
  "openChat",
  "openInsight",
  "openBottomSheet",
  "retry",
  "dismiss",
  "snooze",
]);
const MM_HOME_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const MM_HOME_SAFE_ASSET = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const MM_HOME_CONTEXT_RULES = Object.freeze({
  source: MM_HOME_SAFE_ID,
  questionId: MM_HOME_SAFE_ID,
  moduleId: MM_HOME_SAFE_ID,
  relatedModuleId: MM_HOME_SAFE_ID,
  relatedInsightId: MM_HOME_SAFE_ID,
  relatedMomentId: MM_HOME_SAFE_ID,
  marketContextId: MM_HOME_SAFE_ID,
  profileVersion: MM_HOME_SAFE_ID,
  resultVersion: MM_HOME_SAFE_ID,
  insightType: MM_HOME_SAFE_ID,
  relatedAsset: MM_HOME_SAFE_ASSET,
});
const MM_HOME_PROHIBITED_NARRATIVE = Object.freeze([
  "保證",
  "一定會",
  "最佳",
  "立即調整",
  "建議買入",
  "建議賣出",
  "現在是機會",
  "現在要停損",
  "你錯過行情",
  "保守型",
  "積極型",
  "高風險型",
  "投資健康分",
  "FOMO",
  "恐慌型",
  "衝動型",
  "保證獲利",
  "一定會漲",
  "一定會跌",
  "最佳買點",
  "最佳賣點",
  "應該買入",
  "應該賣出",
  "現在做多",
  "現在做空",
  "幫你自動下單",
  "投資健康分數",
]);
const MM_HOME_SENSITIVE_CACHE_KEYS = Object.freeze([
  "accountid",
  "apikey",
  "secret",
  "prompt",
  "tokenusage",
  "modelreasoning",
  "chainofthought",
  "totalassetvalue",
  "rawportfolio",
  "rawtransactions",
  "holdings",
  "transactions",
  "freetext",
  "note",
]);

function mmHomeClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mmHomeAssert(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function mmHomeIsIsoDate(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function mmHomeIsPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mmHomeValidateContext(context) {
  if (context == null) return;
  mmHomeAssert(mmHomeIsPlainObject(context), "INVALID_HOME_ACTION_CONTEXT");
  Object.entries(context).forEach(([key, value]) => {
    const rule = MM_HOME_CONTEXT_RULES[key];
    mmHomeAssert(Boolean(rule) && typeof value === "string", "INVALID_HOME_ACTION_CONTEXT");
    if (value.length > 0) mmHomeAssert(rule.test(value), "INVALID_HOME_ACTION_CONTEXT");
  });
}

/** @param {HomeAction} action @returns {HomeAction} */
function mmHomeValidateAction(action) {
  mmHomeAssert(mmHomeIsPlainObject(action), "INVALID_HOME_ACTION");
  mmHomeAssert(typeof action.id === "string" && MM_HOME_SAFE_ID.test(action.id), "INVALID_HOME_ACTION");
  mmHomeAssert(MM_HOME_ACTION_TYPES.includes(action.type), "INVALID_HOME_ACTION_TYPE");
  mmHomeAssert(typeof action.label === "string" && action.label.length > 0, "INVALID_HOME_ACTION");
  if (action.route != null) mmHomeAssert(typeof action.route === "string" && action.route.length > 0, "INVALID_HOME_ACTION_ROUTE");
  if (action.question != null) mmHomeAssert(typeof action.question === "string" && action.question.length > 0, "INVALID_HOME_ACTION_QUESTION");
  mmHomeValidateContext(action.context);
  return action;
}

function mmHomeValidateEvidence(evidence) {
  mmHomeAssert(Array.isArray(evidence), "INVALID_HOME_EVIDENCE");
  const ids = new Set();
  evidence.forEach((item) => {
    mmHomeAssert(mmHomeIsPlainObject(item), "INVALID_HOME_EVIDENCE");
    mmHomeAssert(typeof item.id === "string" && item.id.length > 0 && !ids.has(item.id), "INVALID_HOME_EVIDENCE");
    mmHomeAssert(typeof item.label === "string" && item.label.length > 0, "INVALID_HOME_EVIDENCE");
    mmHomeAssert(["portfolio", "transactions", "fundingHistory", "questionnaire", "marketContext", "effectiveProfile"].includes(item.source), "INVALID_HOME_EVIDENCE_SOURCE");
    if (item.value != null) mmHomeAssert(typeof item.value === "string", "INVALID_HOME_EVIDENCE");
    ids.add(item.id);
  });
  return evidence;
}

function mmHomeValidateNarrative(value) {
  const texts = [];
  const walk = (current, key) => {
    if (typeof current === "string" && [
      "headline",
      "summary",
      "explanation",
      "title",
      "text",
      "message",
      "description",
      "recommendationReason",
      "label",
      "question",
      "disclaimer",
      "marketChangeSummary",
    ].includes(key)) {
      texts.push(current);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item) => walk(item, key));
      return;
    }
    if (mmHomeIsPlainObject(current)) {
      Object.entries(current).forEach(([childKey, childValue]) => walk(childValue, childKey));
    }
  };
  walk(value, "");
  texts.forEach((text) => {
    MM_HOME_PROHIBITED_NARRATIVE.forEach((phrase) => {
      mmHomeAssert(!text.includes(phrase), "HOME_PROHIBITED_NARRATIVE");
    });
  });
  return value;
}

/** @param {AccountAttributionPayload} payload */
function mmHomeValidateAttribution(payload) {
  mmHomeAssert(mmHomeIsPlainObject(payload), "INVALID_HOME_ATTRIBUTION");
  mmHomeAssert(payload.attributionType === "estimated" || payload.attributionType === "calculated", "INVALID_HOME_ATTRIBUTION");
  mmHomeAssert(Array.isArray(payload.contributors) && payload.contributors.length > 0, "INVALID_HOME_ATTRIBUTION");
  let sum = 0;
  const ids = new Set();
  payload.contributors.forEach((item) => {
    mmHomeAssert(mmHomeIsPlainObject(item), "INVALID_HOME_ATTRIBUTION");
    mmHomeAssert(typeof item.id === "string" && item.id.length > 0 && !ids.has(item.id), "INVALID_HOME_ATTRIBUTION");
    mmHomeAssert(["marketPrice", "allocation", "recentTrades", "funding", "other"].includes(item.category), "INVALID_HOME_ATTRIBUTION");
    mmHomeAssert(Number.isFinite(item.contributionRatio) && item.contributionRatio >= 0 && item.contributionRatio <= 1, "INVALID_HOME_ATTRIBUTION_RATIO");
    sum += item.contributionRatio;
    ids.add(item.id);
  });
  mmHomeAssert(Math.abs(sum - 1) <= 0.011, "INVALID_HOME_ATTRIBUTION_TOTAL");
  mmHomeAssert(mmHomeIsIsoDate(payload.periodStart) && mmHomeIsIsoDate(payload.periodEnd), "INVALID_HOME_ATTRIBUTION_PERIOD");
  mmHomeValidateEvidence(payload.evidence || []);
  return payload;
}

function mmHomeValidateModulePayload(module) {
  const payload = module.payload;
  mmHomeAssert(mmHomeIsPlainObject(payload), "INVALID_HOME_MODULE_PAYLOAD");
  if (payload.error) return;
  /* healthScore 的 payload 只帶「資料從哪來」與報告本身，分數不預先算好放進來——
     算在 health-core.js，兩頁共用同一顆，避免快取裡躺一個跟畫面不一致的舊分數。 */
  if (module.type === "healthScore") {
    mmHomeAssert(["live", "demo"].includes(payload.source), "INVALID_HEALTH_SOURCE");
    mmHomeAssert(mmHomeIsPlainObject(payload.report), "INVALID_HEALTH_REPORT");
  }
  if (module.type === "marketWatch") {
    mmHomeAssert(
      typeof window !== "undefined" && window.MM_MARKET_CORE
        ? window.MM_MARKET_CORE.validate(payload)
        : Array.isArray(payload.markets) && payload.markets.length > 0,
      "INVALID_MARKET_WATCH"
    );
  }
  if (module.type === "todayRelevant") {
    mmHomeAssert(typeof payload.headline === "string" && typeof payload.explanation === "string", "INVALID_TODAY_RELEVANT");
    mmHomeAssert(Array.isArray(payload.relatedAssets), "INVALID_TODAY_RELEVANT");
    mmHomeAssert(mmHomeIsPlainObject(payload.impactLevels), "INVALID_TODAY_RELEVANT");
    ["market", "allocation", "behavior"].forEach((key) => {
      mmHomeAssert(["low", "medium", "high"].includes(payload.impactLevels[key]), "INVALID_TODAY_RELEVANT_IMPACT");
    });
    mmHomeAssert(["fresh", "stale", "partial"].includes(payload.dataFreshness), "INVALID_TODAY_RELEVANT_FRESHNESS");
    mmHomeAssert(["rules", "rulesAndAi", "fallbackTemplate"].includes(payload.generatedBy), "INVALID_TODAY_RELEVANT_GENERATOR");
    mmHomeAssert(mmHomeIsIsoDate(payload.updatedAt), "INVALID_TODAY_RELEVANT_TIME");
    mmHomeValidateEvidence(payload.evidence || []);
  }
  if (module.type === "planAlignment") {
    mmHomeAssert(["aligned", "partiallyAligned", "different", "insufficientData"].includes(payload.status), "INVALID_PLAN_ALIGNMENT");
    mmHomeAssert(Array.isArray(payload.originalPlanItems) && Array.isArray(payload.recentBehaviorItems), "INVALID_PLAN_ALIGNMENT");
    mmHomeValidateEvidence(payload.evidence || []);
  }
  if (module.type === "accountAttribution" && !payload.unavailable) mmHomeValidateAttribution(payload);
  if (module.type === "similarMoment" && !payload.unavailable) {
    mmHomeAssert(typeof payload.id === "string" && payload.id.length > 0, "INVALID_SIMILAR_MOMENT");
    mmHomeAssert(mmHomeIsPlainObject(payload.currentContext) && mmHomeIsPlainObject(payload.historicalContext), "INVALID_SIMILAR_MOMENT");
    mmHomeAssert(["high", "medium", "low"].includes(payload.confidence), "INVALID_SIMILAR_MOMENT");
    mmHomeAssert(typeof payload.disclaimer === "string" && payload.disclaimer.length > 0, "INVALID_SIMILAR_MOMENT");
  }
  if (module.type === "personalizedInsight") {
    mmHomeAssert(Array.isArray(payload.insights) && payload.insights.length <= 2, "INVALID_HOME_INSIGHTS");
    payload.insights.forEach((insight) => {
      mmHomeAssert(typeof insight.id === "string" && typeof insight.title === "string", "INVALID_HOME_INSIGHT");
      mmHomeAssert(MM_HOME_PRIORITIES.includes(insight.priority), "INVALID_HOME_INSIGHT");
      mmHomeValidateEvidence(insight.evidence || []);
    });
  }
}

/** @param {MaiMateHomeResponse} response @returns {MaiMateHomeResponse} */
function mmHomeValidateResponse(response) {
  mmHomeAssert(mmHomeIsPlainObject(response), "INVALID_HOME_RESPONSE");
  mmHomeAssert(mmHomeIsPlainObject(response.user), "INVALID_HOME_USER");
  mmHomeAssert(typeof response.user.userId === "string" && response.user.userId.length > 0, "INVALID_HOME_USER");
  mmHomeAssert(typeof response.user.demoMode === "boolean", "INVALID_HOME_USER");
  mmHomeAssert(["draft", "confirmed", "revised", "limited"].includes(response.user.profileStatus), "INVALID_HOME_PROFILE_STATUS");
  mmHomeAssert(["guided", "concise", "analytical"].includes(response.user.communicationStyle), "INVALID_HOME_COMMUNICATION_STYLE");
  mmHomeAssert(typeof response.user.effectiveProfileVersion === "string", "INVALID_HOME_PROFILE_VERSION");
  mmHomeAssert(mmHomeIsPlainObject(response.greeting), "INVALID_HOME_GREETING");
  mmHomeAssert(typeof response.greeting.title === "string" && typeof response.greeting.subtitle === "string", "INVALID_HOME_GREETING");
  mmHomeAssert(["morning", "afternoon", "evening"].includes(response.greeting.period), "INVALID_HOME_GREETING");
  mmHomeAssert(Array.isArray(response.modules), "INVALID_HOME_MODULES");
  const moduleIds = new Set();
  response.modules.forEach((module) => {
    mmHomeAssert(mmHomeIsPlainObject(module), "INVALID_HOME_MODULE");
    mmHomeAssert(typeof module.id === "string" && module.id.length > 0 && !moduleIds.has(module.id), "INVALID_HOME_MODULE_ID");
    mmHomeAssert(MM_HOME_MODULE_TYPES.includes(module.type), "INVALID_HOME_MODULE_TYPE");
    mmHomeAssert(MM_HOME_PRIORITIES.includes(module.priority), "INVALID_HOME_MODULE_PRIORITY");
    mmHomeAssert(Number.isInteger(module.position) && module.position > 0, "INVALID_HOME_MODULE_POSITION");
    mmHomeAssert(typeof module.visible === "boolean" && typeof module.dismissible === "boolean", "INVALID_HOME_MODULE");
    mmHomeAssert(Array.isArray(module.actions), "INVALID_HOME_ACTIONS");
    module.actions.forEach(mmHomeValidateAction);
    if (module.expiresAt != null) mmHomeAssert(mmHomeIsIsoDate(module.expiresAt), "INVALID_HOME_MODULE_EXPIRY");
    mmHomeValidateModulePayload(module);
    moduleIds.add(module.id);
  });
  mmHomeAssert(mmHomeIsPlainObject(response.navigation) && Array.isArray(response.navigation.tabs), "INVALID_HOME_NAVIGATION");
  response.navigation.tabs.forEach((tab) => {
    mmHomeAssert(typeof tab.id === "string" && typeof tab.label === "string" && typeof tab.route === "string", "INVALID_HOME_NAVIGATION");
  });
  mmHomeAssert(mmHomeIsPlainObject(response.dataStatus), "INVALID_HOME_DATA_STATUS");
  mmHomeAssert(["demo", "active", "revoked", "limited"].includes(response.dataStatus.authorizationStatus), "INVALID_HOME_AUTHORIZATION_STATUS");
  mmHomeAssert(["full", "sufficient", "limited"].includes(response.dataStatus.analysisCoverage), "INVALID_HOME_COVERAGE");
  mmHomeAssert(mmHomeIsIsoDate(response.generatedAt), "INVALID_HOME_GENERATED_TIME");
  if (response.nextRefreshAt != null) mmHomeAssert(mmHomeIsIsoDate(response.nextRefreshAt), "INVALID_HOME_REFRESH_TIME");
  mmHomeValidateNarrative(response);
  return response;
}

function mmHomeSanitizeValue(value, key) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => mmHomeSanitizeValue(item, key));
  const clean = {};
  Object.entries(value).forEach(([childKey, childValue]) => {
    const normalized = childKey.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    if (MM_HOME_SENSITIVE_CACHE_KEYS.includes(normalized)) return;
    clean[childKey] = mmHomeSanitizeValue(childValue, childKey);
  });
  return clean;
}

/** @param {MaiMateHomeResponse} response @returns {MaiMateHomeResponse} */
function mmHomeSanitizeResponse(response) {
  const clean = /** @type {MaiMateHomeResponse} */ (mmHomeSanitizeValue(mmHomeClone(response), ""));
  return mmHomeValidateResponse(clean);
}

/** @param {string=} displayName @param {Date=} at @returns {HomeGreeting} */
function mmHomeBuildGreeting(displayName, at) {
  const date = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date();
  const hour = date.getHours();
  const safeName = typeof displayName === "string" ? displayName.trim().slice(0, 30) : "";
  const suffix = safeName ? "，" + safeName : "";
  if (hour < 12) {
    return {
      title: "早安" + suffix + "。",
      subtitle: "今天先看一件和你有關的事。",
      period: "morning",
      brandSubtitle: "市場一直在變，麥麥會陪你一起看懂。",
    };
  }
  if (hour < 18) {
    return {
      title: "午安" + suffix + "。",
      subtitle: "麥麥幫你整理好今天和你有關的重點。",
      period: "afternoon",
      brandSubtitle: "市場一直在變，麥麥會陪你一起看懂。",
    };
  }
  return {
    title: "晚上好" + suffix + "。",
    subtitle: "我們一起回顧今天的市場和帳戶。",
    period: "evening",
    brandSubtitle: "市場一直在變，麥麥會陪你一起看懂。",
  };
}

function mmHomeParseSnoozeDuration(duration) {
  const value = String(duration || "").trim().toLowerCase();
  const simple = value.match(/^(\d+)(m|h|d)$/);
  if (simple) {
    const unit = simple[2] === "m" ? 60000 : simple[2] === "h" ? 3600000 : 86400000;
    return Math.max(60000, Number(simple[1]) * unit);
  }
  const iso = value.match(/^pt(\d+)(m|h)$/);
  if (iso) return Number(iso[1]) * (iso[2] === "m" ? 60000 : 3600000);
  if (value === "tomorrow") return 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/** @param {MaiMateHomeResponse} response @param {string} moduleId @param {string=} actionId */
function mmHomeFindAction(response, moduleId, actionId) {
  const module = response && Array.isArray(response.modules)
    ? response.modules.find((item) => item.id === moduleId)
    : null;
  if (!module) return null;
  return actionId
    ? module.actions.find((action) => action.id === actionId) || null
    : module.actions[0] || null;
}

/** @param {HomeAction} action */
function mmHomeActionDestination(action) {
  mmHomeValidateAction(action);
  return {
    type: action.type,
    route: action.route || null,
    question: action.question || null,
    context: Object.assign({}, action.context || {}),
  };
}

/** @param {Object} state @param {string=} locationSearch */
function mmHomeEvaluateAccess(state, locationSearch) {
  const current = mmHomeIsPlainObject(state) ? state : {};
  const query = new URLSearchParams(locationSearch || "");
  const directDemo = query.get("demo") === "STEADY_PLANNER";
  const session = current.demoSession;
  const sessionExpiresAt = session && Date.parse(session.expiresAt);
  const validDemoSession = Boolean(
    session &&
    session.id &&
    session.dataVersion &&
    Number.isFinite(sessionExpiresAt) &&
    sessionExpiresAt > Date.now()
  );
  const validInternalSession = Boolean(
    current.session &&
    current.session.id &&
    (!current.session.expiresAt || Date.parse(current.session.expiresAt) > Date.now())
  );
  if (!validDemoSession && !validInternalSession) {
    return {
      status: "redirect",
      route: "welcome.html",
      reason: directDemo ? "DEMO_BOOTSTRAP_REQUIRED" : "HOME_SESSION_REQUIRED",
    };
  }
  const consent = current.consent;
  const revoked = Boolean(consent && consent.revokedAt);
  if (revoked && current.profileResult) {
    return { status: "limited", reason: "HOME_AUTHORIZATION_REVOKED" };
  }
  const grantedScopes = consent && Array.isArray(consent.grantedScopes) ? consent.grantedScopes : [];
  const demoAuthorized = validDemoSession && consent && consent.source === "demo";
  const hasRequiredScopes = ["portfolio", "transactions"].every((scope) => grantedScopes.includes(scope));
  if (!consent || (!demoAuthorized && !hasRequiredScopes)) {
    return { status: "redirect", route: "onboarding.html#/consent", reason: "HOME_CONSENT_REQUIRED" };
  }
  const questionnaireReady = Boolean(
    current.profile &&
    (current.profile.status === "completed" || current.profile.status === "skipped")
  );
  if (!questionnaireReady) {
    return { status: "redirect", route: "onboarding.html#/profile", reason: "HOME_PROFILE_QUESTIONNAIRE_REQUIRED" };
  }
  const job = current.analysisJob;
  if (!job || !current.profileResult || job.status === "queued" || job.status === "running") {
    return { status: "redirect", route: "onboarding.html#/analyzing", reason: "HOME_PROFILE_REQUIRED" };
  }
  if (job.status === "failed" && !current.profileResult) {
    return { status: "redirect", route: "onboarding.html#/analyzing", reason: "HOME_ANALYSIS_FAILED" };
  }
  const result = current.profileResult;
  const sessionDataVersion = session && session.dataVersion;
  const versionMismatch = Boolean(
    result.analysisJobId !== job.id ||
    (sessionDataVersion && job.dataVersion && sessionDataVersion !== job.dataVersion) ||
    (result.dataVersion && job.dataVersion && result.dataVersion !== job.dataVersion)
  );
  if (versionMismatch) {
    return { status: "redirect", route: "onboarding.html#/analyzing", reason: "HOME_PROFILE_VERSION_MISMATCH" };
  }
  if (current.effectiveProfile && current.effectiveProfile.originalResultId !== result.id) {
    return { status: "redirect", route: "onboarding.html#/profile-result", reason: "HOME_EFFECTIVE_PROFILE_MISMATCH" };
  }
  return {
    status: "full",
    reason: current.profileResult.status === "draft" ? "HOME_PROFILE_DRAFT" : "HOME_READY",
  };
}

window.MM_HOME_CORE = Object.freeze({
  CACHE_VERSION: MM_HOME_CACHE_VERSION,
  CACHE_TTL_MS: MM_HOME_CACHE_TTL_MS,
  MODULE_TYPES: MM_HOME_MODULE_TYPES,
  PRIORITIES: MM_HOME_PRIORITIES,
  ACTION_TYPES: MM_HOME_ACTION_TYPES,
  clone: mmHomeClone,
  assert: mmHomeAssert,
  validateAction: mmHomeValidateAction,
  validateAttribution: mmHomeValidateAttribution,
  validateResponse: mmHomeValidateResponse,
  validateNarrative: mmHomeValidateNarrative,
  sanitizeResponse: mmHomeSanitizeResponse,
  buildGreeting: mmHomeBuildGreeting,
  parseSnoozeDuration: mmHomeParseSnoozeDuration,
  findAction: mmHomeFindAction,
  actionDestination: mmHomeActionDestination,
  evaluateHomeAccess: mmHomeEvaluateAccess,
});
