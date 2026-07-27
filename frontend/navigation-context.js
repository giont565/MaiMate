/* MaiMate Screen 6→7／8 共用導航橋接。
 * - 只接受 MaiMate 站內白名單路由，正式 API 回傳的 route 不直接交給 location。
 * - 預填問題只暫存在 sessionStorage，不放 URL、不寫 analytics。
 * - Context 僅保留穩定 ID／來源欄位，不保存持倉、金額或完整資料物件。
 */
"use strict";

(function initMaiMateNavigation() {
  const STORAGE_KEY = "mm_pending_navigation";
  const ENVELOPE_VERSION = 1;
  /* 跨頁預填所需的最短暫存；Screen 7 讀取後立即 consume。 */
  const CONTEXT_TTL_MS = 10 * 60 * 1000;
  const MAX_QUESTION_LENGTH = 300;
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
  const SAFE_ASSET = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
  const CONTEXT_STRING_RULES = Object.freeze({
    source: SAFE_ID,
    questionId: SAFE_ID,
    moduleId: SAFE_ID,
    relatedModuleId: SAFE_ID,
    relatedInsightId: SAFE_ID,
    relatedMomentId: SAFE_ID,
    marketContextId: SAFE_ID,
    profileVersion: SAFE_ID,
    resultVersion: SAFE_ID,
    insightType: SAFE_ID,
    relatedAsset: SAFE_ASSET,
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function routeInfo(route) {
    if (typeof route !== "string") return null;
    const candidate = route.trim();
    if (!candidate || candidate.length > 512 ||
        candidate.startsWith("//") || candidate.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(candidate) ||
        /%(?:2f|5c|2e)/i.test(candidate)) return null;

    let parsed;
    try { parsed = new URL(candidate, window.location.origin); }
    catch (_) { return null; }
    if (parsed.protocol !== window.location.protocol ||
        parsed.origin !== window.location.origin ||
        parsed.username || parsed.password ||
        parsed.hash) return null;

    const pathname = parsed.pathname.length > 1
      ? parsed.pathname.replace(/\/+$/, "")
      : parsed.pathname;
    const currentDirectory = window.location.pathname.replace(/[^/]*$/, "");
    const localPath = pathname.startsWith(currentDirectory)
      ? pathname.slice(currentDirectory.length)
      : null;
    const params = [...parsed.searchParams.entries()];
    const noSearch = params.length === 0;

    if (localPath === "home.html") {
      const validHomeQuery = noSearch ||
        (params.length === 1 && params[0][0] === "src" && ["onboarding", "welcome"].includes(params[0][1])) ||
        (params.length === 1 && params[0][0] === "demo" && params[0][1] === "STEADY_PLANNER");
      if (!validHomeQuery) return null;
      return {
        canonical: "/maimate/home",
        local: "home.html" + parsed.search,
        kind: "home",
      };
    }
    if (localPath === "index.html") {
      const validChatQuery = noSearch ||
        (params.length === 1 && params[0][0] === "src" && params[0][1] === "home");
      if (!validChatQuery) return null;
      return {
        canonical: "/maimate/chat",
        local: "index.html" + parsed.search,
        kind: "chat",
      };
    }
    if (localPath === "insights.html" && noSearch) {
      return { canonical: "/maimate/insights", local: "insights.html", kind: "insight" };
    }
    if (localPath === "settings.html" && noSearch) {
      return { canonical: "/maimate/settings", local: "settings.html", kind: "settings" };
    }
    if (!noSearch) return null;
    if (pathname === "/maimate/home") {
      return { canonical: pathname, local: "home.html", kind: "home" };
    }
    if (pathname === "/maimate/chat") {
      return { canonical: pathname, local: "index.html", kind: "chat" };
    }
    if (pathname === "/maimate/settings") {
      return { canonical: pathname, local: "settings.html", kind: "settings" };
    }
    if (pathname === "/maimate/profile-result") {
      return {
        canonical: pathname,
        local: "onboarding.html#/profile-result",
        kind: "profile",
      };
    }
    if (pathname === "/maimate/consent") {
      return {
        canonical: pathname,
        local: "onboarding.html#/consent",
        kind: "consent",
      };
    }
    if (/^\/maimate\/insights(?:\/[A-Za-z0-9_-]+)*$/.test(pathname)) {
      return { canonical: pathname, local: "insights.html", kind: "insight" };
    }
    return null;
  }

  function cleanId(value, rule) {
    if (value == null) return undefined;
    const text = String(value).trim();
    return (rule || SAFE_ID).test(text) ? text : undefined;
  }

  function cleanQuestion(value) {
    if (value == null) return undefined;
    const text = String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_QUESTION_LENGTH);
    return text || undefined;
  }

  function sanitizeContext(value) {
    const source = value && typeof value === "object" ? value : {};
    const clean = {};
    Object.entries(CONTEXT_STRING_RULES).forEach(([key, rule]) => {
      const next = cleanId(source[key], rule);
      if (next) clean[key] = next;
    });
    if (Array.isArray(source.relatedInsightIds)) {
      const ids = source.relatedInsightIds
        .map((item) => cleanId(item))
        .filter(Boolean)
        .slice(0, 10);
      if (ids.length) clean.relatedInsightIds = [...new Set(ids)];
    }
    return clean;
  }

  function removeStoredContext() {
    try { sessionStorage.removeItem(STORAGE_KEY); }
    catch (_) {}
  }

  function readStoredContext() {
    let envelope;
    try { envelope = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); }
    catch (_) {
      removeStoredContext();
      return null;
    }
    if (!envelope || envelope.version !== ENVELOPE_VERSION ||
        !["chat", "insight"].includes(envelope.kind) ||
        !Number.isFinite(envelope.expiresAt) ||
        envelope.expiresAt <= Date.now()) {
      removeStoredContext();
      return null;
    }
    const info = routeInfo(envelope.route);
    if (!info || info.kind !== envelope.kind) {
      removeStoredContext();
      return null;
    }
    const clean = {
      version: ENVELOPE_VERSION,
      kind: info.kind,
      route: info.canonical,
      expiresAt: envelope.expiresAt,
      context: sanitizeContext(envelope.context),
    };
    const actionId = cleanId(envelope.actionId);
    const questionId = cleanId(envelope.questionId);
    const question = info.kind === "chat" ? cleanQuestion(envelope.question) : undefined;
    if (actionId) clean.actionId = actionId;
    if (questionId) clean.questionId = questionId;
    if (question) clean.question = question;
    return clean;
  }

  function saveContext(input) {
    const source = input && typeof input === "object" ? input : {};
    const info = routeInfo(source.route);
    if (!info || !["chat", "insight"].includes(info.kind)) return null;
    const context = sanitizeContext(source.context);
    const envelope = {
      version: ENVELOPE_VERSION,
      kind: info.kind,
      route: info.canonical,
      expiresAt: Date.now() + CONTEXT_TTL_MS,
      context,
    };
    const actionId = cleanId(source.actionId || source.id);
    const questionId = cleanId(source.questionId || context.questionId || source.id);
    const question = info.kind === "chat" ? cleanQuestion(source.question) : undefined;
    if (actionId) envelope.actionId = actionId;
    if (questionId) envelope.questionId = questionId;
    if (question) envelope.question = question;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(envelope)); }
    catch (_) { return null; }
    return clone(envelope);
  }

  function peekContext() {
    return clone(readStoredContext());
  }

  function consumeContext(expectedKind) {
    const envelope = readStoredContext();
    removeStoredContext();
    if (!envelope || (expectedKind && envelope.kind !== expectedKind)) return null;
    return clone(envelope);
  }

  function resolveRoute(route) {
    const info = routeInfo(route);
    return info ? info.local : null;
  }

  function navigate(action) {
    const input = action && typeof action === "object" ? action : {};
    const info = routeInfo(input.route);
    if (!info) return false;
    if (info.kind === "chat" || info.kind === "insight") saveContext(input);
    else removeStoredContext();
    window.location.assign(info.local);
    return true;
  }

  function openChat(input) {
    return navigate(Object.assign({}, input || {}, {
      route: "/maimate/chat",
      type: "openChat",
    }));
  }

  function openInsight(route, input) {
    return navigate(Object.assign({}, input || {}, {
      route,
      type: "openInsight",
    }));
  }

  window.MM_NAVIGATION = Object.freeze({
    resolveRoute,
    saveContext,
    peekContext,
    consumeContext,
    clearContext: removeStoredContext,
    navigate,
    navigateAction: navigate,
    openChat,
    openInsight,
  });
})();
