/* Screen 8｜深入了解：型別、路由解析、Route Guard、區塊結構驗證。
 * 原則（與 Screen 1–7 同一套天條）：
 *   - 數字一律由 Adapter 現推或取自 window.MM_ACCOUNT；報告沒有的顯示「資料不足」，不畫假圖表
 *   - 禁語掃描與數字一致性沿用 window.MM_CHAT_CORE，不在這裡重寫第二套
 *   - 不出現買賣建議、心理標籤、投資能力／風險等級／健康分數、Chain of Thought、工具原名
 *   - 百分比與百分點嚴格分開：98.5% → 98.6% 是「提高 0.1 個百分點」
 */
"use strict";

/** @typedef {'personal'|'knowledge'} InsightKind */
/** @typedef {'personal'|'general'|'limited'|'lastKnown'} InsightAccessMode */
/** @typedef {{id:string, label:string, value:string, sourceLabel:string, updatedAt?:string}} InsightSource */
/** @typedef {{conclusion:string, primaryMetric?:{label:string, value:string, note?:string}}} InsightHero */
/** @typedef {'text'|'metricList'|'allocationBar'|'stackedBar'|'rhythmTimeline'|'comparison'|'knowledgeExplanation'|'evidenceList'|'limitationList'|'insufficientData'} InsightSectionType */
/** @typedef {{id:string, type:InsightSectionType, payload:Object}} InsightSection */
/** @typedef {{id:string, text:string}} InsightLimitation */
/** @typedef {{id:string, insightId:string, title:string, summary:string}} RelatedTerm */
/** @typedef {{id:string, kind:InsightKind, title:string, question:string, source:InsightSource,
 *   hero:InsightHero, whyItMatters:{title:string, paragraphs:string[]},
 *   sections:InsightSection[], simpleExplanation:{title:string, paragraphs:string[]},
 *   evidence:InsightSource[], limitations:InsightLimitation[], relatedTerms:RelatedTerm[],
 *   suggestedQuestions:{id:string, text:string}[], actions:{id:string, label:string, type:string}[],
 *   dataStatus:'available'|'insufficient', notice?:string}} InsightDetail */

(function initInsightsCore() {
  const SECTION_TYPES = [
    "text", "metricList", "allocationBar", "stackedBar", "rhythmTimeline", "comparison",
    "knowledgeExplanation", "evidenceList", "limitationList", "insufficientData",
  ];

  /* 白名單：路由只認這 11 個 id，任何其他字串（含 ../、%2e）一律拒絕。 */
  const PERSONAL_INSIGHTS = [
    "cash-concentration", "trading-rhythm", "notable-sell",
    "plan-alignment", "account-change", "holding-pattern",
  ];
  const KNOWLEDGE_INSIGHTS = [
    "concentration-basics", "market-depth", "order-types",
    "weight-volatility", "fee-basics",
  ];
  const ALL_INSIGHTS = PERSONAL_INSIGHTS.concat(KNOWLEDGE_INSIGHTS);
  const ID_PATTERN = /^[a-z][a-z0-9-]{1,46}[a-z0-9]$/;
  /* 控制字元與空白：用 charCode 組出來，原始碼裡不放實體控制字元。 */
  const RE_UNSAFE_CHARS = new RegExp(
    "[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "\\s]");

  /** @param {string} id @returns {InsightKind|null} */
  function insightKind(id) {
    if (KNOWLEDGE_INSIGHTS.includes(id)) return "knowledge";
    if (PERSONAL_INSIGHTS.includes(id)) return "personal";
    return null;
  }

  /**
   * 從 /maimate/insights/:id 取出 insightId。
   * 只接受白名單 id：路徑穿越（..、%2e%2e、反斜線）、查詢字串、fragment 一律回 null。
   * @param {string} route
   * @returns {{insightId:string|null, canonical:string}|null}
   */
  function parseInsightRoute(route) {
    if (typeof route !== "string") return null;
    const raw = route.trim();
    if (!raw || raw.length > 256) return null;
    if (raw.includes("\\") || raw.includes("?") || raw.includes("#") ||
        raw.includes("..") || RE_UNSAFE_CHARS.test(raw) ||
        /%(?:2e|2f|5c)/i.test(raw)) return null;
    const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
    if (path === "/maimate/insights") return { insightId: null, canonical: path };
    const match = /^\/maimate\/insights\/([^/]+)$/.exec(path);
    if (!match) return null;
    const id = match[1];
    if (!ID_PATTERN.test(id) || !ALL_INSIGHTS.includes(id)) return null;
    return { insightId: id, canonical: "/maimate/insights/" + id };
  }

  /**
   * Route Guard。Screen 8 和 Screen 7 不同：沒有 session 也不趕人走——
   * 名詞類仍然可讀（用一般例子），個人化類則降為 limited 並說明原因。
   *   personal   已授權：可帶入帳戶數字
   *   general    名詞類但沒有（或已撤回）個人資料授權：只用一般例子
   *   limited    個人化類但沒有授權：不顯示任何帳戶數字
   *   lastKnown  授權已撤回：顯示最後保存的結果，並標示已停止更新
   * @param {Object} state @param {string} insightId
   */
  function evaluateInsightAccess(state, insightId) {
    const kind = insightKind(insightId);
    if (!kind) return { status: "notFound", mode: "limited", kind: null };
    const consent = state && state.consent;
    const granted = consent && Array.isArray(consent.grantedScopes) ? consent.grantedScopes : [];
    const revoked = Boolean(consent && consent.revokedAt);
    const authorized = Boolean(consent) && !revoked &&
      granted.includes("portfolio") && granted.includes("transactions");

    if (authorized) return { status: "ok", mode: "personal", kind };
    if (revoked) {
      return kind === "knowledge"
        ? { status: "ok", mode: "general", kind, notice: "資料授權已撤回，以下用一般例子說明。" }
        : { status: "ok", mode: "lastKnown", kind, notice: "資料授權已撤回，以下是撤回前最後保存的結果，已停止更新。" };
    }
    return kind === "knowledge"
      ? { status: "ok", mode: "general", kind, notice: "目前沒有使用你的帳戶資料，以下用一般例子說明。" }
      : { status: "ok", mode: "limited", kind, notice: "這一頁需要你的帳戶資料才能顯示，目前尚未取得授權。" };
  }

  const isText = (value) => typeof value === "string" && value.trim().length > 0;
  const isTextList = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);
  const isNumber = (value) => Number.isFinite(Number(value));
  const isLabelValueList = (value) => Array.isArray(value) && value.length > 0 &&
    value.every((item) => item && isText(item.label) && isText(item.value));
  /* 圖表標題必須是一個問句：使用者是帶著問題來的，標題要接住那個問題。 */
  const isQuestion = (value) => isText(value) && /[？?]$/.test(value.trim());

  const SECTION_RULES = {
    text: (p) => isTextList(p.paragraphs),
    metricList: (p) => isText(p.title) && isLabelValueList(p.items),
    allocationBar: (p) => isQuestion(p.title) && isText(p.summary) &&
      Array.isArray(p.items) && p.items.length > 0 &&
      p.items.every((item) => item && isText(item.label) && isText(item.valueText) &&
        isNumber(item.pct) && Number(item.pct) >= 0 && Number(item.pct) <= 100),
    /* stackedBar：一條 100% 的橫條切成數段，用在「某一段極度獨大」的分布
     * （並列橫條會變成一條滿的加幾條看不見的線）。各段 pct 必須合計 100±0.5，
     * 不足或超過就是上游算錯，寧可整段不渲染也不畫一條對不上的圖。 */
    stackedBar: (p) => isQuestion(p.title) && isText(p.summary) &&
      Array.isArray(p.items) && p.items.length > 0 &&
      p.items.every((item) => item && isText(item.label) && isText(item.valueText) &&
        isNumber(item.pct) && Number(item.pct) >= 0 && Number(item.pct) <= 100) &&
      Math.abs(p.items.reduce((sum, item) => sum + Number(item.pct), 0) - 100) <= 0.5,
    rhythmTimeline: (p) => isQuestion(p.title) && isText(p.summary) &&
      isNumber(p.averageValue) && isText(p.averageText) &&
      Array.isArray(p.items) && p.items.length > 0 &&
      p.items.every((item) => item && isText(item.label) && isText(item.valueText) && isNumber(item.value)),
    comparison: (p) => isText(p.title) && isLabelValueList(p.items),
    knowledgeExplanation: (p) => isText(p.title) && isTextList(p.paragraphs),
    evidenceList: (p) => isText(p.title) && isLabelValueList(p.items),
    limitationList: (p) => isText(p.title) && isTextList(p.items),
    insufficientData: (p) => isText(p.title) && isText(p.reason) && isTextList(p.missing) &&
      Array.isArray(p.alternatives) &&
      p.alternatives.every((item) => item && isText(item.id) && isText(item.label)),
  };

  /** 單一區塊是否結構完整（UI 只渲染通過的） */
  function isValidSection(section) {
    if (!section || typeof section !== "object") return false;
    if (!isText(section.id) || !SECTION_TYPES.includes(section.type)) return false;
    if (!section.payload || typeof section.payload !== "object") return false;
    const rule = SECTION_RULES[section.type];
    try { return Boolean(rule && rule(section.payload)); }
    catch (_) { return false; }
  }

  /** @param {InsightSection[]} sections @returns {InsightSection[]} 只回傳通過驗證的區塊 */
  function validateSections(sections) {
    return Array.isArray(sections) ? sections.filter(isValidSection) : [];
  }

  /** 圖表區塊（會畫出視覺元素的那幾類）——資料不足時畫面上一個都不該有 */
  const CHART_SECTION_TYPES = Object.freeze(["allocationBar", "stackedBar", "rhythmTimeline"]);

  window.MM_INSIGHTS_CORE = Object.freeze({
    SECTION_TYPES: Object.freeze(SECTION_TYPES.slice()),
    CHART_SECTION_TYPES,
    PERSONAL_INSIGHTS: Object.freeze(PERSONAL_INSIGHTS.slice()),
    KNOWLEDGE_INSIGHTS: Object.freeze(KNOWLEDGE_INSIGHTS.slice()),
    ALL_INSIGHTS: Object.freeze(ALL_INSIGHTS.slice()),
    insightKind,
    parseInsightRoute,
    evaluateInsightAccess,
    isValidSection,
    validateSections,
    /* 護欄沿用 Screen 7 的同一套實作，不另外維護第二份禁語表與數字檢查。 */
    scanForbidden: (value) => window.MM_CHAT_CORE.scanForbidden(value),
    validateNumberConsistency: (text, evidence) =>
      window.MM_CHAT_CORE.validateNumberConsistency(text, evidence),
    sanitizeEventMeta: (meta) => window.MM_CHAT_CORE.sanitizeEventMeta(meta),
  });
})();
