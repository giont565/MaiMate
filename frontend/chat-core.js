/* Screen 7｜問麥麥：型別、Route Guard、結構化區塊驗證、Guardrails、分析事件白名單
 * 原則（與 Screen 1–6 同一套天條）：
 *   - 個人化數字一律來自工具結果，回覆不得自行產生金融數字
 *   - 不顯示 Chain of Thought、不顯示工具原名／JSON／Trace
 *   - 不報明牌、不保證獲利、不替使用者下單（下單只能由使用者在確認卡親自確認）
 *   - 分析事件只記列舉值，不記問題原文、回覆原文、金額與持倉
 */
"use strict";

/** @typedef {'user'|'assistant'|'systemNotice'} ChatMessageRole */
/** @typedef {'text'|'summary'|'evidence'|'metric'|'comparison'|'timeline'|'insightLink'|'glossaryLink'|'boundaryNotice'|'followUpQuestions'|'toolStatus'|'dataScopeNotice'} ChatContentBlockType */
/** @typedef {{id:string, type:ChatContentBlockType, payload:Object}} ChatContentBlock */
/** @typedef {'pending'|'streaming'|'completed'|'failed'|'blocked'} ChatMessageStatus */
/** @typedef {{id:string, conversationId:string, role:ChatMessageRole, blocks:ChatContentBlock[], status:ChatMessageStatus, evidenceIds:string[], toolExecutionIds:string[], createdAt:string, updatedAt?:string, feedback?:Object}} ChatMessage */
/** @typedef {{sourceModuleId?:string, sourceInsightId?:string, sourceMomentId?:string, sourceQuestionId?:string, marketContextId?:string, profileVersion?:string, dataVersion?:string}} ConversationContext */
/** @typedef {{id:string, title:string, status:'active'|'archived'|'deleted', source:'direct'|'homeModule'|'suggestedQuestion'|'insight', context:ConversationContext, communicationStyle:'guided'|'concise'|'analytical', usesPersonalData:boolean, createdAt:string, updatedAt:string, lastMessageAt?:string}} Conversation */
/** @typedef {{id:string, sourceType:'portfolio'|'transactions'|'market'|'profile'|'questionnaire'|'knowledgeBase'|'historicalMoment', label:string, value?:string, updatedAt?:string}} EvidenceReference */

(function initChatCore() {
  const BLOCK_TYPES = [
    "text", "summary", "evidence", "metric", "comparison", "timeline",
    "insightLink", "glossaryLink", "boundaryNotice", "followUpQuestions",
    "toolStatus", "dataScopeNotice",
  ];

  /* ── Guardrails：五類（投資建議／憑證／數字一致性／心理標籤／誇張 FOMO）──
   * 命中即代表產生流程出錯：不回傳原始內容，改用安全模板重新生成。 */
  const FORBIDDEN = {
    recommendation: ["建議買入", "建議賣出", "應該買", "應該賣", "該買", "該賣", "務必買", "值得進場", "可以進場", "保證獲利", "穩賺", "必漲", "會漲到", "目標價"],
    credential: ["你的 api key", "你的私鑰", "助記詞是", "secret key 是"],
    psychLabel: ["韭菜", "小白", "新手村", "賭徒", "衝動型人格", "不理性", "投資能力差", "保守型", "積極型", "高風險人格"],
    hype: ["最佳機會", "最後上車", "錯過就沒有", "翻倍", "一定會漲", "絕對安全", "完全匿名", "永不外洩"],
  };

  /** @returns {{ok:boolean, category?:string, hit?:string}} */
  function checkForbidden(text) {
    const flat = String(text || "").toLowerCase();
    for (const [category, words] of Object.entries(FORBIDDEN)) {
      const hit = words.find((word) => flat.includes(word.toLowerCase()));
      if (hit) return { ok: false, category, hit };
    }
    return { ok: true };
  }

  /** 走訪整個回覆物件的所有字串（不限欄位名——審查抓到只檢查特定 key 會漏） */
  function scanForbidden(value, depth) {
    if (depth > 8) return { ok: true };
    if (typeof value === "string") return checkForbidden(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const r = scanForbidden(item, (depth || 0) + 1);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const r = scanForbidden(item, (depth || 0) + 1);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  /* ── 數字一致性：回覆中出現的百分比／金額，必須都能在證據裡找到 ──
   * 這是「AI 不得自行產生金融數字」的機械檢查，不靠自律。 */
  function extractNumbers(text) {
    return String(text || "").match(/\d+(?:\.\d+)?\s*%|NT\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:筆|次|項|天)/g) || [];
  }

  function normalizeNumber(token) {
    return String(token).replace(/\s|,/g, "");
  }

  /** @returns {{ok:boolean, missing?:string[]}} */
  function validateNumberConsistency(answerText, evidence) {
    const allowed = new Set();
    (evidence || []).forEach((item) => {
      extractNumbers(item.value).forEach((n) => allowed.add(normalizeNumber(n)));
      extractNumbers(item.label).forEach((n) => allowed.add(normalizeNumber(n)));
    });
    const missing = extractNumbers(answerText)
      .map(normalizeNumber)
      .filter((n) => !allowed.has(n));
    return missing.length ? { ok: false, missing } : { ok: true };
  }

  /* ── 結構化區塊驗證：UI 只渲染通過驗證的區塊 ── */
  function validateBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return false;
    return blocks.every((block) =>
      block && typeof block.id === "string" && block.id &&
      BLOCK_TYPES.includes(block.type) &&
      block.payload && typeof block.payload === "object");
  }

  /* ── Route Guard ──
   * 回傳 mode 決定這次對話能用到什麼：
   *   personal  完整個人化（已授權＋有樣貌結果）
   *   limited   僅一般金融知識（未授權或已撤回）
   *   general   已授權但樣貌尚未建立：可談帳戶資料，不下個人行為結論
   */
  function evaluateChatAccess(state) {
    if (!state || (!state.consent && !state.profile && !state.demoSession)) {
      return { status: "redirect", route: "welcome.html", reason: "NO_SESSION" };
    }
    const consent = state.consent;
    const granted = consent && Array.isArray(consent.grantedScopes) ? consent.grantedScopes : [];
    const authorized = Boolean(consent) && !consent.revokedAt &&
      granted.includes("portfolio") && granted.includes("transactions");
    if (!authorized) {
      return { status: "ok", mode: "limited", notice: "目前未使用個人帳戶資料" };
    }
    if (!state.profileResult) {
      return { status: "ok", mode: "general", notice: "投資樣貌還沒建立，先不下個人行為結論" };
    }
    return { status: "ok", mode: "personal" };
  }

  /** Screen 6 帶來的 context 只信任 ID，且必須真的屬於目前這份資料
   * TODO(後端)：正式版應由後端以使用者身分重新讀取並驗證，前端驗證只是最低限度。 */
  function validateIncomingContext(context, state) {
    if (!context || typeof context !== "object") return null;
    const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
    const clean = {};
    ["sourceModuleId", "sourceInsightId", "sourceMomentId", "sourceQuestionId", "marketContextId"].forEach((key) => {
      if (typeof context[key] === "string" && idPattern.test(context[key])) clean[key] = context[key];
    });
    if (state && state.demoSession && state.demoSession.dataVersion) clean.dataVersion = state.demoSession.dataVersion;
    if (state && state.effectiveProfile && state.effectiveProfile.updatedAt) clean.profileVersion = "effective-" + state.effectiveProfile.updatedAt;
    return Object.keys(clean).length ? clean : null;
  }

  /* ── 分析事件白名單（決策 4）──
   * 只准列舉值；禁自由文字、金額、持倉、問題原文、回覆原文。 */
  const EVENT_FIELDS = {
    q: /^[A-Za-z0-9_-]{1,48}$/,
    src: ["direct", "homeModule", "suggestedQuestion", "insight"],
    intent: ["allowedExplanation", "allowedPersonalAnalysis", "allowedEducation", "allowedHistoricalReview",
      "restrictedRecommendation", "restrictedExecution", "sensitiveCredential", "fraudOrAbuse", "unsupported"],
    tool: ["portfolio", "transactions", "market", "attribution", "planAlignment", "similarMoment",
      "knowledge", "profile", "homeInsight", "insightRoute"],
    style: ["guided", "concise", "analytical"],
    status: ["completed", "failed", "blocked", "cancelled", "partial"],
    guard: ["recommendation", "execution", "credential", "psychLabel", "hype", "unsupported"],
  };

  /** 過濾成只含白名單欄位與列舉值的事件參數 */
  function sanitizeEventMeta(meta) {
    const out = {};
    if (!meta || typeof meta !== "object") return out;
    Object.entries(EVENT_FIELDS).forEach(([key, rule]) => {
      const value = meta[key];
      if (typeof value !== "string") return;
      if (rule instanceof RegExp ? rule.test(value) : rule.includes(value)) out[key] = value;
    });
    return out;
  }

  window.MM_CHAT_CORE = Object.freeze({
    BLOCK_TYPES: Object.freeze(BLOCK_TYPES.slice()),
    EVENT_FIELDS: Object.freeze(EVENT_FIELDS),
    checkForbidden,
    scanForbidden: (value) => scanForbidden(value, 0),
    validateNumberConsistency,
    extractNumbers,
    validateBlocks,
    evaluateChatAccess,
    validateIncomingContext,
    sanitizeEventMeta,
  });
})();
