/* Screen 6｜MaiMate 投資導航首頁
 * UI → MaiMateHomeService / Navigation Context；本檔不讀取 Mock，也不計算金融指標。
 */
"use strict";

(function () {
  const service = window.MM_HOME_SERVICES && window.MM_HOME_SERVICES.home;
  const navigation = window.MM_NAVIGATION || {};
  const moduleRenderers = Object.create(null);
  /* 行情輪詢的 handle。renderModules() 每次都 replaceChildren()，舊列會整批消失，
     所以每次重畫都要把上一輪的 interval 收掉，否則會疊出多條各自打 API 的計時器。 */
  let marketTimer = null;
  const uiState = {
    response: null,
    loading: false,
    refreshing: false,
    toastTimer: 0,
    sheetReturnFocus: null,
    unsubscribe: null,
  };

  const IMPACT_LABELS = { low: "低", medium: "中", high: "高" };
  const ALIGNMENT_LABELS = {
    aligned: "大致沿著原本方向",
    partiallyAligned: "有部分不同",
    different: "最近出現明顯差異",
    insufficientData: "資料不足",
  };
  const TREND_LABELS = {
    stable: "大致相近",
    increased: "有所增加",
    decreased: "有所減少",
    changed: "出現變化",
    unknown: "仍在觀察",
  };
  const FRESHNESS_LABELS = { fresh: "剛剛更新", stale: "顯示上次整理", partial: "部分資料已更新" };
  const QUICK_CHAT_QUESTIONS = {
    today: "今天的變化主要和我的哪些持倉有關？",
    portfolio: "我的主要持倉最近如何影響帳戶變化？",
    history: "這次和過去相似情況有什麼不同？",
    term: "什麼是持倉占比？",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function create(tag, className, textValue) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = String(textValue);
    return node;
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asRatio(value) {
    const ratio = Number(value);
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null;
  }

  function formatPercentFromRatio(value) {
    const ratio = asRatio(value);
    return ratio == null ? "—" : Math.round(ratio * 100) + "%";
  }

  function formatPercentValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    // 保留一位小數：報告寫 98.6%，畫面不得四捨五入成 99%（整數不補 .0）
    const percent = Math.round((number <= 1 ? number * 100 : number) * 10) / 10;
    return (Number.isInteger(percent) ? percent : percent.toFixed(1)) + "%";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function formatMonth(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long" }).format(date);
  }

  function analytics(name, questionId) {
    const registry = window.MM_HOME_SERVICES;
    if (registry && typeof registry.trackEvent === "function") {
      registry.trackEvent(name, questionId ? { questionId } : undefined);
    }
  }

  function getAction(module, predicate) {
    return safeArray(module && module.actions).find(predicate) || null;
  }

  function navigateAction(action) {
    if (!action) return;
    if (typeof navigation.navigate === "function") {
      navigation.navigate(action);
      return;
    }
    if (action.route && typeof navigation.resolveRoute === "function") {
      const resolved = navigation.resolveRoute(action.route);
      if (resolved) location.href = resolved;
    }
  }

  function navigateRoute(route) {
    navigateAction({ id: "home-route", type: "navigate", label: "", route });
  }

  function openChat(input) {
    const payload = Object.assign({ source: "home" }, input || {});
    if (typeof navigation.openChat === "function") {
      navigation.openChat(payload);
      return;
    }
    showToast("這次沒有開啟問麥麥，請再試一次。");
  }

  function openInsight(route, input) {
    if (typeof navigation.openInsight === "function") {
      navigation.openInsight(route, Object.assign({ source: "home" }, input || {}));
      return;
    }
    showToast("這次沒有開啟洞察，請再試一次。");
  }

  function makeActionButton(action, className, analyticsName) {
    const button = create("button", className || "module-action", action && action.label ? action.label : "查看內容");
    button.type = "button";
    button.addEventListener("click", () => {
      if (analyticsName) analytics(analyticsName, action && action.context && action.context.questionId);
      if (action && action.type === "retry") {
        refreshHome(button);
        return;
      }
      navigateAction(action);
    });
    return button;
  }

  function moduleCard(module, className) {
    const section = create("section", "module-card" + (className ? " " + className : ""));
    section.dataset.moduleId = module.id || "";
    section.dataset.moduleType = module.type || "";
    section.id = "home-module-" + String(module.id || module.type || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
    return section;
  }

  function appendHeading(parent, title, eyebrow) {
    if (eyebrow) parent.append(create("div", "module-eyebrow", eyebrow));
    parent.append(create("h2", "module-title", title));
  }

  function appendList(parent, items) {
    const list = create("ul", "compact-list");
    safeArray(items).forEach((item) => {
      const value = typeof item === "string" ? item : item && (item.label || item.text);
      if (value) list.append(create("li", "", value));
    });
    parent.append(list);
    return list;
  }

  function renderModuleError(module) {
    const section = moduleCard(module, "status-card");
    const mark = create("div", "status-mark", "…");
    const copy = create("div", "status-copy");
    copy.append(create("h2", "", "這一段暫時沒有整理完成"));
    copy.append(create("p", "", "其他和你有關的內容仍可繼續查看。"));
    const retry = getAction(module, (action) => action.type === "retry");
    if (retry) copy.append(makeActionButton(retry, "module-action"));
    section.append(mark, copy);
    return section;
  }

  function renderTodayRelevant(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module, "today-card");
    section.id = "today-relevant-card";
    section.append(create("div", "module-eyebrow", payload.title || "今天，什麼和你有關？"));
    const headline = create("h2", "", payload.headline || "今天的個人化摘要暫時沒有整理完成。");
    headline.id = "today-relevant-headline";
    section.append(headline);

    const explanation = create("p", "today-explanation", payload.explanation || "");
    explanation.id = "today-relevant-explanation";
    section.append(explanation);

    const meta = create("div", "today-meta");
    if (payload.generatedBy === "fallbackTemplate") meta.append(create("span", "", "依規則模板整理"));
    else meta.append(create("span", "", "依示範資料整理"));
    const freshness = FRESHNESS_LABELS[payload.dataFreshness] || "";
    if (freshness) meta.append(create("span", "", freshness));
    const updated = formatTime(payload.updatedAt);
    if (updated) meta.append(create("span", "", updated));
    section.append(meta);

    const impacts = create("div", "impact-list");
    impacts.id = "today-impact-levels";
    [
      ["market", "市場影響"],
      ["allocation", "配置影響"],
      ["behavior", "行為變化"],
    ].forEach(([key, label]) => {
      const item = create("div", "impact-item");
      item.dataset.impact = key;
      item.append(create("span", "", label));
      const level = payload.impactLevels && payload.impactLevels[key];
      item.append(create("b", "", IMPACT_LABELS[level] || "待整理"));
      impacts.append(item);
    });
    section.append(impacts);

    const actions = create("div", "today-actions");
    const primary = getAction(module, (action) => action.type === "openInsight" || action.type === "navigate");
    if (primary) actions.append(makeActionButton(primary, "primary", "maimate_today_relevant_opened"));
    const refresh = create("button", "refresh", "↻");
    refresh.type = "button";
    refresh.setAttribute("aria-label", "重新整理今日重點");
    refresh.dataset.homeRefresh = "today";
    refresh.addEventListener("click", () => refreshHome(refresh));
    actions.append(refresh);
    section.append(actions);

    const chatActions = safeArray(module.actions).filter((action) => action.type === "openChat").slice(0, 3);
    if (chatActions.length) {
      const questionRow = create("div", "question-row");
      questionRow.id = "today-relevant-questions";
      chatActions.forEach((action) => {
        const button = create("button", "", action.label || action.question);
        button.type = "button";
        button.addEventListener("click", () => {
          analytics("maimate_today_relevant_question_clicked", action.context && action.context.questionId);
          navigateAction(action);
        });
        questionRow.append(button);
      });
      section.append(questionRow);
    }
    return section;
  }

  function renderPlanAlignment(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module, "plan-card");
    section.id = "plan-alignment-card";
    appendHeading(section, payload.title || "原本的我 vs 最近的我");
    const status = create("div", "status-pill", ALIGNMENT_LABELS[payload.status] || "一起看看差異");
    status.id = "plan-alignment-status";
    section.append(status);

    const grid = create("div", "plan-grid");
    const original = create("div", "plan-column");
    original.append(create("h3", "", "原本的我"));
    const originalList = appendList(original, payload.originalPlanItems);
    originalList.id = "original-plan-list";
    const recent = create("div", "plan-column recent");
    recent.append(create("h3", "", "最近的我"));
    const recentList = create("ul", "compact-list");
    safeArray(payload.recentBehaviorItems).forEach((item) => {
      const label = typeof item === "string" ? item : item && item.label;
      if (!label) return;
      const trend = item && item.trend ? TREND_LABELS[item.trend] : "";
      const textValue = trend && !label.includes(trend) ? label + "｜" + trend : label;
      recentList.append(create("li", "", textValue));
    });
    recentList.id = "recent-behavior-list";
    recent.append(recentList);
    grid.append(original, recent);
    section.append(grid);

    const summary = create("p", "module-copy", payload.summary || "");
    summary.id = "plan-alignment-summary";
    section.append(summary);
    const action = getAction(module, (item) => item.type === "openInsight" || item.type === "navigate");
    if (action) section.append(makeActionButton(action, "module-action", "maimate_plan_alignment_opened"));
    return section;
  }

  function renderAccountAttribution(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module);
    section.id = "account-attribution-card";
    appendHeading(section, payload.title || "今天的帳戶變化從哪裡來？");
    const summary = create("p", "module-copy", payload.summary || "");
    summary.id = "account-attribution-summary";
    section.append(summary);

    const contributors = safeArray(payload.contributors).filter((item) => asRatio(item && item.contributionRatio) != null);
    if (!contributors.length) {
      const empty = create("div", "empty-block");
      empty.id = "account-attribution-empty";
      empty.append(create("b", "", "目前資料不足以拆解帳戶變化來源。"));
      empty.append(create("p", "", "麥麥不會補上沒有依據的比例。"));
      section.append(empty);
    } else {
      const label = create("div", "attribution-label");
      label.id = "attribution-basis-label";
      label.append(create("span", "", payload.attributionType === "calculated" ? "依帳戶資料計算" : "依目前資料估算"));
      section.append(label);
      const list = create("div", "attribution-bars");
      list.id = "attribution-bar-list";
      contributors.forEach((contributor) => {
        const ratio = asRatio(contributor.contributionRatio);
        const row = create("div", "attribution-row");
        row.dataset.contributor = contributor.category || contributor.id || "";
        row.append(create("span", "label", contributor.label || ""));
        row.append(create("span", "value", formatPercentFromRatio(ratio)));
        const trackNode = create("div", "bar-track");
        const fill = create("div", "bar-fill");
        fill.style.width = Math.round(ratio * 1000) / 10 + "%";
        fill.setAttribute("role", "img");
        fill.setAttribute("aria-label", (contributor.label || "影響") + " " + formatPercentFromRatio(ratio));
        trackNode.append(fill);
        row.append(trackNode);
        list.append(row);
      });
      section.append(list);
    }
    const action = getAction(module, (item) => item.type === "openInsight" || item.type === "navigate");
    if (action) section.append(makeActionButton(action, "module-action", "maimate_account_attribution_opened"));
    return section;
  }

  function momentItems(moment, behavior) {
    const items = [];
    if (moment && moment.marketChangeSummary) items.push(moment.marketChangeSummary);
    safeArray(behavior).forEach((item) => { if (item) items.push(item); });
    return items;
  }

  function renderSimilarMoment(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module);
    section.id = "similar-moment-card";
    appendHeading(section, payload.title || "這個情況，你以前遇過");
    const historical = payload.historicalContext;
    const current = payload.currentContext;
    if (!historical || !current || payload.hasSufficientData === false) {
      const empty = create("div", "empty-block");
      empty.id = "similar-moment-empty";
      empty.append(create("b", "", "目前沒有足夠相似紀錄"));
      empty.append(create("p", "", "麥麥不會為了湊出結果，硬把不同情況說成一樣。"));
      section.append(empty);
      return section;
    }

    const layout = create("div", "moment-layout");
    layout.id = "similar-moment-comparison";
    [
      ["historical", "那一次", historical, payload.userBehaviorThen],
      ["current", "這一次", current, payload.userBehaviorNow],
    ].forEach(([key, heading, moment, behavior]) => {
      const column = create("div", "moment-column");
      column.dataset.moment = key;
      column.append(create("time", "", key === "historical" ? (formatMonth(moment.startDate) || "過去") : "現在"));
      column.append(create("b", "", heading));
      const list = create("ul");
      momentItems(moment, behavior).forEach((item) => list.append(create("li", "", item)));
      column.append(list);
      layout.append(column);
    });
    section.append(layout);
    const summary = create("p", "module-copy", payload.summary || "");
    summary.id = "similar-moment-summary";
    section.append(summary);
    section.append(create("p", "module-note", payload.disclaimer || "相似情境只用來回顧，不代表市場會重複，也不是買賣建議。"));
    const action = getAction(module, (item) => item.type === "openInsight" || item.type === "navigate");
    if (action) section.append(makeActionButton(action, "module-action", "maimate_similar_moment_opened"));
    return section;
  }

  function evidenceText(evidence) {
    if (typeof evidence === "string") return evidence;
    if (!evidence) return "";
    if (evidence.label && evidence.value) return evidence.label + " " + evidence.value;
    return evidence.text || evidence.label || evidence.value || "";
  }

  function contextualQuestionButton(question, module, analyticsName) {
    const button = create("button", "contextual-question", question.text || question.label || question.question || "");
    button.type = "button";
    button.dataset.questionId = question.id || "";
    const action = getAction(module, (item) =>
      item.type === "openChat" &&
      ((item.context && item.context.questionId === question.id) || item.question === question.text)
    );
    if (!action) {
      button.disabled = true;
      button.setAttribute("aria-label", (button.textContent || "這個問題") + "，目前暫時無法開啟");
    }
    button.addEventListener("click", () => {
      analytics(analyticsName || "maimate_contextual_question_clicked", question.id);
      navigateAction(action);
    });
    return button;
  }

  function moduleControls(module, parent) {
    if (!module.dismissible) return;
    const controls = create("div", "module-controls");
    const dismiss = create("button", "", "先收起");
    dismiss.type = "button";
    dismiss.dataset.dismissModule = module.id || "";
    dismiss.addEventListener("click", () => dismissModule(module, dismiss));
    const snooze = create("button", "", "稍後提醒");
    snooze.type = "button";
    snooze.dataset.snoozeModule = module.id || "";
    snooze.addEventListener("click", () => snoozeModule(module, snooze));
    controls.append(dismiss, snooze);
    parent.append(controls);
  }

  function renderPersonalizedInsights(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module, "insight-section");
    section.id = "personalized-insight-section";
    appendHeading(section, payload.title || "麥麥幫你注意到");
    const insights = safeArray(payload.insights).slice(0, 2);
    if (!insights.length) {
      const empty = create("div", "empty-block");
      empty.append(create("b", "", "今天沒有特別需要提醒的新變化。"));
      empty.append(create("p", "", "有新的關聯時，麥麥會再幫你整理。"));
      section.append(empty);
      return section;
    }
    const list = create("div", "insight-list");
    insights.forEach((insight) => {
      const card = create("article", "insight-card");
      card.dataset.insightId = insight.id || "";
      card.dataset.insightType = insight.type || "";
      card.append(create("h3", "", insight.title || ""));
      card.append(create("p", "summary", insight.summary || insight.explanation || ""));
      const evidence = safeArray(insight.evidence).map(evidenceText).filter(Boolean).slice(0, 3);
      if (evidence.length) {
        const chips = create("div", "evidence-list");
        evidence.forEach((item) => chips.append(create("span", "evidence-chip", item)));
        card.append(chips);
      }
      const questions = safeArray(insight.contextualQuestions).slice(0, 2);
      if (questions.length) {
        const questionList = create("div", "insight-questions");
        questions.forEach((question) => {
          const button = contextualQuestionButton(question, module, "maimate_contextual_question_clicked");
          button.className = "";
          questionList.append(button);
        });
        card.append(questionList);
      }
      list.append(card);
    });
    section.append(list);
    moduleControls(module, section);
    return section;
  }

  function renderContextualQuestions(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module);
    section.id = "contextual-question-section";
    appendHeading(section, payload.title || "從這裡繼續問");
    if (payload.description) section.append(create("p", "module-copy", payload.description));
    const questions = safeArray(payload.questions || payload.items || payload).slice(0, 5);
    const list = create("div", "contextual-list");
    list.id = "contextual-question-list";
    questions.forEach((question) => list.append(contextualQuestionButton(question, module)));
    section.append(list);
    return section;
  }

  function renderLearningRecommendation(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module, "learning-card");
    section.id = "contextual-learning-card";
    appendHeading(section, "今天適合看懂的一件事");
    const contentTitle = payload.contentTitle || payload.headline || payload.lessonTitle || payload.title || "";
    if (contentTitle) section.append(create("h3", "module-copy", contentTitle));
    const meta = create("div", "learning-meta");
    if (payload.durationLabel || payload.duration) meta.append(create("span", "", payload.durationLabel || payload.duration));
    if (payload.levelLabel) meta.append(create("span", "", payload.levelLabel));
    if (meta.childNodes.length) section.append(meta);
    if (payload.description) section.append(create("p", "module-copy", payload.description));
    if (payload.reason || payload.recommendationReason) {
      const reason = create("p", "learning-reason");
      reason.textContent = "推薦給你：" + (payload.reason || payload.recommendationReason);
      section.append(reason);
    }
    const action = getAction(module, (item) => item.type === "openInsight" || item.type === "navigate");
    if (action) section.append(makeActionButton(action, "module-action", "maimate_learning_opened"));
    return section;
  }

  function snapshotValue(payload, keys, fallback) {
    for (const key of keys) {
      if (payload[key] != null && payload[key] !== "") return payload[key];
    }
    return fallback;
  }

  function renderAccountSnapshot(module) {
    const payload = module.payload || {};
    if (payload.error) return renderModuleError(module);
    const section = moduleCard(module);
    section.id = "account-snapshot-card";
    appendHeading(section, payload.title || "你的帳戶概況");
    const assetCount = snapshotValue(payload, ["assetCount", "holdingAssetCount"], null);
    // 上游沒有各幣種明細時 assetCount 會是 null → 顯示 assetCountLabel（「報告未提供」），不補假數字
    const assetCountText = assetCount == null
      ? snapshotValue(payload, ["assetCountLabel"], "—")
      : assetCount + " 項";
    // 最大持有優先用顯示名稱（例如「現金（TWD）」）；只給代號讀起來會誤導
    const mainAsset = snapshotValue(payload, ["topAssetLabel", "topAsset", "primaryAsset", "mainAsset", "largestHoldingAsset"], "—");
    const mainRatio = snapshotValue(payload, ["topAssetRatio", "primaryAssetRatio", "mainAssetRatio", "largestHoldingRatio"], null);
    const latestTradeDays = snapshotValue(payload, ["lastTransactionDaysAgo"], null);
    const latestTrade = snapshotValue(
      payload,
      ["latestTransactionLabel", "lastTradeLabel", "recentTransaction"],
      latestTradeDays == null ? "—" : Number(latestTradeDays) === 0 ? "今天" : latestTradeDays + " 天前"
    );
    const items = [
      ["持有資產", assetCountText],
      ["最大持有", mainAsset],
      ["最大持有占比", mainRatio == null ? "—" : formatPercentValue(mainRatio)],
      ["最近一期買賣", latestTrade],
    ];
    const grid = create("div", "snapshot-grid");
    grid.id = "account-snapshot-grid";
    items.forEach(([label, value]) => {
      const item = create("div", "snapshot-item");
      item.append(create("span", "", label));
      item.append(create("b", "", payload.amountsHidden && label.includes("金額") ? "••••" : value));
      grid.append(item);
    });
    section.append(grid);
    const footer = create("div", "snapshot-footer");
    const updatedAt = snapshotValue(payload, ["updatedAt", "portfolioUpdatedAt"], "");
    footer.append(create("span", "", updatedAt ? "資料更新 " + formatTime(updatedAt) : "示範資料"));
    const visibility = create("button", "", payload.amountsHidden ? "金額預設：隱藏" : "金額預設：顯示");
    visibility.id = "account-amount-visibility";
    visibility.type = "button";
    visibility.setAttribute("aria-pressed", String(Boolean(payload.amountsHidden)));
    visibility.addEventListener("click", () => updateAmountVisibility(!payload.amountsHidden, visibility));
    footer.append(visibility);
    section.append(footer);
    const action = getAction(module, (item) => item.type === "openInsight" || item.type === "navigate");
    if (action) section.append(makeActionButton(action, "module-action"));
    return section;
  }

  function renderStatusModule(module) {
    const payload = module.payload || {};
    const section = moduleCard(module, "status-card");
    const isData = module.type === "dataStatus";
    section.id = isData ? "home-data-status-card" : "home-profile-status-card";
    section.append(create("div", "status-mark", isData ? "D" : "P"));
    const copy = create("div", "status-copy");
    const fallbackTitle = isData ? "麥麥還在累積對你的了解" : "你的投資樣貌還沒確認";
    copy.append(create("h2", "", payload.title || fallbackTitle));
    copy.append(create("p", "", payload.description || payload.message || ""));
    const action = getAction(module, (item) => item.type === "navigate" || item.type === "openInsight");
    if (action) copy.append(makeActionButton(action, "module-action"));
    section.append(copy);
    return section;
  }

  function renderSystemNotice(module) {
    return renderStatusModule(module);
  }

  /* ── 健康分（消費 /health，計算在 health-core.js）────────────────────────── */
  function renderHealthScore(module) {
    const payload = module.payload || {};
    const core = window.MM_HEALTH_CORE;
    if (payload.error || !core) return renderModuleError(module);

    const result = core.score(payload.report);
    if (!result.ok) return renderModuleError(module);

    const section = moduleCard(module, "health-card");
    appendHeading(section, payload.title || "行為健檢");

    const head = create("div", "health-head");
    const ring = create("div", "health-ring");
    /* conic-gradient 的百分比來自 core 夾過的 0–100，不是直接吃後端數字。 */
    ring.style.background =
      "conic-gradient(var(--mm-gold, #E8A13A) 0 " + result.score + "%, #E8EDF7 " + result.score + "% 100%)";
    const inner = create("div", "health-ring-inner");
    inner.append(create("b", "", String(result.score)));
    inner.append(create("span", "", "健檢分"));
    ring.append(inner);
    head.append(ring);

    const text = create("div", "health-text");
    text.append(create("p", "health-worst", result.worst.k + "扣最多分，最該練；其餘大致健康。"));

    const pnl = core.realized(payload.report);
    if (pnl.ok) {
      const line = create("p", "health-pnl");
      line.append(create("span", "", "2025 已實現損益 "));
      line.append(create(
        "b",
        pnl.positive ? "pos" : "neg",
        (pnl.positive ? "+" : "−") + "NT$" + core.fmt(Math.abs(pnl.totalTwd))
      ));
      if (pnl.winRatePct != null) {
        line.append(create("span", "", " · 勝率 " + pnl.winRatePct.toFixed(1) + "%（"
          + core.fmt(pnl.profitTrades) + "勝/" + core.fmt(pnl.lossTrades) + "負）"));
      }
      text.append(line);
    }

    /* 公式印在卡上是這張卡的核心主張：分數是透明加權，不是黑箱評等。 */
    text.append(create("p", "health-formula", result.formula));
    if (result.partial) {
      text.append(create("p", "health-formula", "（有子項資料不足，權重已攤到其餘項目）"));
    }
    head.append(text);
    section.append(head);

    const grid = create("div", "health-grid");
    core.cards(payload.report).forEach((card) => {
      const cell = create("div", "health-cell tone-" + card.tone);
      cell.dataset.cellId = card.id;
      cell.append(create("b", "", card.value));
      cell.append(create("span", "", card.label));
      grid.append(cell);
    });
    section.append(grid);

    core.insights(payload.report).forEach((item) => {
      section.append(create("p", "health-insight tone-" + item.tone, item.text));
    });

    /* 資料是真是假必須寫在卡上。這條線的起點就是「畫面全都正常但資料是假的」。 */
    section.append(create(
      "p",
      "health-source",
      payload.source === "live" ? "資料來源：你的帳戶分析報告（/health）" : "示範資料（未連線後端）"
    ));

    const action = getAction(module, (item) => item.type === "openChat");
    if (action) section.append(makeActionButton(action, "module-action"));
    return section;
  }

  /* ── 即時行情＋K 線（消費 /market，解析與幾何在 kline-core.js）───────────── */
  function renderMarketWatch(module) {
    const payload = module.payload || {};
    const marketCore = window.MM_MARKET_CORE;
    const klineCore = window.MM_KLINE_CORE;
    if (payload.error || !marketCore || !klineCore) return renderModuleError(module);

    const section = moduleCard(module, "market-card");
    appendHeading(section, payload.title || "即時行情");
    section.append(create("p", "market-note", payload.note || "點一列展開 K 線"));

    const list = create("div", "market-list");
    payload.markets.forEach((entry) => {
      const row = create("div", "market-row");
      row.dataset.market = entry.market;

      const tick = create("button", "market-tick");
      tick.type = "button";
      tick.setAttribute("aria-expanded", "false");
      tick.append(create("b", "", entry.label));
      const price = create("span", "market-price", "—");
      tick.append(price);
      tick.append(create("span", "market-caret", "▾"));
      row.append(tick);

      const panel = create("div", "market-panel");
      panel.hidden = true;
      row.append(panel);

      tick.addEventListener("click", () => toggleMarketRow(row, entry, payload));
      list.append(row);
    });
    section.append(list);

    if (!payload.live) {
      section.append(create("p", "market-offline", "目前未連線，行情與 K 線都不顯示——麥麥不會給你猜的價格。"));
      return section;
    }
    /* 卡片還沒進 DOM 就開始輪詢會抓不到節點，交給 renderModules 之後的 tick。 */
    queueMarketPolling(list, payload);
    return section;
  }

  /* 輪詢：就地更新既有節點，不清空重建；失敗保留舊值（開發紀律③）。 */
  function queueMarketPolling(list, payload) {
    if (marketTimer) clearInterval(marketTimer);
    const run = () => {
      if (!list.isConnected) { clearInterval(marketTimer); marketTimer = null; return; }
      payload.markets.forEach((entry) => refreshTicker(list, entry));
    };
    Promise.resolve().then(run);
    marketTimer = setInterval(run, 15000);
  }

  async function refreshTicker(list, entry) {
    const row = list.querySelector('.market-row[data-market="' + CSS.escape(entry.market) + '"]');
    if (!row) return;
    const cell = row.querySelector(".market-price");
    try {
      const res = await fetch((window.API_BASE || "") + "/market?market="
        + encodeURIComponent(entry.market) + "&kind=ticker");
      const parsed = window.MM_MARKET_CORE.parseTicker(await res.json());
      /* 取不到就原地不動——保留上一個真實價格，不要退回「—」把好資料擦掉。 */
      if (!parsed.ok) return;
      const dir = window.MM_MARKET_CORE.direction(cell.dataset.last, parsed.price);
      cell.dataset.last = String(parsed.price);
      cell.textContent = window.MM_KLINE_CORE.fmtPrice(parsed.price);
      cell.classList.remove("up", "down");
      if (dir !== "flat") cell.classList.add(dir);
    } catch (_) { /* 保留舊值 */ }
  }

  function toggleMarketRow(row, entry, payload) {
    const tick = row.querySelector(".market-tick");
    const panel = row.querySelector(".market-panel");
    const open = tick.getAttribute("aria-expanded") === "true";

    /* 一次只開一列：K 線很高，兩張以上會把其他模組推出視窗外。 */
    row.parentElement.querySelectorAll(".market-row").forEach((other) => {
      other.querySelector(".market-tick").setAttribute("aria-expanded", "false");
      other.querySelector(".market-panel").hidden = true;
    });
    if (open) return;

    tick.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    if (!payload.live) {
      panel.replaceChildren(create("p", "market-empty", "目前取不到 K 線資料"));
      return;
    }
    if (!panel.dataset.ready) {
      panel.dataset.ready = "1";
      panel.append(buildPeriodChips(panel, entry, payload.defaultPeriod));
      panel.append(create("div", "market-chart"));
    }
    loadKline(panel, entry, Number(panel.dataset.period || payload.defaultPeriod));
  }

  function buildPeriodChips(panel, entry, defaultPeriod) {
    const bar = create("div", "market-periods");
    window.MM_KLINE_CORE.PERIODS.forEach((period) => {
      const chip = create("button", "market-period", period.label);
      chip.type = "button";
      chip.dataset.period = String(period.minutes);
      if (period.minutes === defaultPeriod) chip.classList.add("active");
      chip.addEventListener("click", () => {
        bar.querySelectorAll(".market-period").forEach((b) => b.classList.remove("active"));
        chip.classList.add("active");
        loadKline(panel, entry, period.minutes);
      });
      bar.append(chip);
    });
    panel.dataset.period = String(defaultPeriod);
    return bar;
  }

  async function loadKline(panel, entry, period) {
    panel.dataset.period = String(period);
    const chart = panel.querySelector(".market-chart");
    chart.replaceChildren(create("p", "market-empty loading", "載入中…"));
    try {
      const res = await fetch((window.API_BASE || "") + "/market?market="
        + encodeURIComponent(entry.market) + "&kind=kline&period=" + encodeURIComponent(period));
      const parsed = window.MM_KLINE_CORE.parse(await res.json());
      /* 任一根壞掉 core 就整批不畫——畫錯位置的 K 棒比不畫更危險。 */
      if (!parsed.ok) throw new Error(parsed.reason);
      chart.replaceChildren(drawKline(parsed));
    } catch (_) {
      chart.replaceChildren(create("p", "market-empty", "目前取不到 K 線資料"));
    }
  }

  function drawKline(parsed) {
    const core = window.MM_KLINE_CORE;
    const width = 320;
    const height = 132;
    const geo = core.geometry(parsed.bars, width, height);
    const summary = core.summarize(parsed.bars);
    /* geometry 也會回 ok:false（viewport 壞掉）。丟回去讓 loadKline 走誠實的空狀態。 */
    if (!geo.ok || !summary) throw new Error(geo.reason || "NO_SUMMARY");

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      (parsed.market || "").toUpperCase() + " K 線，" + parsed.bars.length + " 根，期間 "
      + core.fmtPct(summary.changePct) + "，高 " + core.fmtPrice(summary.high)
      + "、低 " + core.fmtPrice(summary.low));

    geo.candles.forEach((candle) => {
      const colour = candle.up ? "var(--mm-green, #1F9D66)" : "var(--mm-red, #D64550)";
      const wick = document.createElementNS(NS, "line");
      wick.setAttribute("x1", candle.cx); wick.setAttribute("x2", candle.cx);
      wick.setAttribute("y1", candle.wickTop); wick.setAttribute("y2", candle.wickBottom);
      wick.setAttribute("stroke", colour);
      svg.append(wick);
      const body = document.createElementNS(NS, "rect");
      body.setAttribute("x", candle.x); body.setAttribute("y", candle.y);
      body.setAttribute("width", candle.w); body.setAttribute("height", candle.h);
      body.setAttribute("fill", colour);
      svg.append(body);
    });

    const wrap = create("div", "market-chart-wrap");
    wrap.append(svg);
    const axis = create("div", "market-axis");
    axis.append(create("span", "", core.fmtTime(summary.from)));
    axis.append(create("span", "", "高 " + core.fmtPrice(summary.high)
      + "　低 " + core.fmtPrice(summary.low) + "　" + core.fmtPct(summary.changePct)));
    axis.append(create("span", "", core.fmtTime(summary.to)));
    wrap.append(axis);
    return wrap;
  }

  moduleRenderers.healthScore = renderHealthScore;
  moduleRenderers.marketWatch = renderMarketWatch;
  moduleRenderers.todayRelevant = renderTodayRelevant;
  moduleRenderers.planAlignment = renderPlanAlignment;
  moduleRenderers.accountAttribution = renderAccountAttribution;
  moduleRenderers.similarMoment = renderSimilarMoment;
  moduleRenderers.personalizedInsight = renderPersonalizedInsights;
  moduleRenderers.contextualQuestions = renderContextualQuestions;
  moduleRenderers.learningRecommendation = renderLearningRecommendation;
  moduleRenderers.accountSnapshot = renderAccountSnapshot;
  moduleRenderers.profileStatus = renderStatusModule;
  moduleRenderers.dataStatus = renderStatusModule;
  moduleRenderers.systemNotice = renderSystemNotice;

  function renderGreeting(response) {
    const greeting = response.greeting || {};
    setText("home-greeting-title", greeting.title || "今天先看一件和你有關的事。");
    setText("home-greeting-subtitle", greeting.subtitle || "市場一直在變，麥麥會陪你一起看懂。");
    setText("home-brand-subtitle", greeting.brandSubtitle || "市場一直在變，麥麥會陪你一起看懂。");
  }

  function renderDraftReminder(response) {
    const profileStatus = response.user && response.user.profileStatus;
    const reminder = byId("profile-draft-reminder");
    const hasStatusModule = safeArray(response.modules).some((module) => module.visible !== false && module.type === "profileStatus");
    reminder.hidden = profileStatus !== "draft" || hasStatusModule;
  }

  function renderModules(response) {
    const root = byId("home-modules");
    root.replaceChildren();
    safeArray(response.modules)
      .filter((module) => module && module.visible !== false)
      .slice()
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
      .forEach((module) => {
        const renderer = moduleRenderers[module.type];
        if (!renderer) return;
        try {
          root.append(renderer(module));
        } catch (error) {
          console.error("[MaiMate Home] module render failed", module.type, error);
          root.append(renderModuleError(module));
        }
      });
  }

  function renderNotifications(response) {
    const list = byId("notification-list");
    list.replaceChildren();
    const entries = [];
    const modules = safeArray(response.modules).filter((module) => module && module.visible !== false);
    if (modules.some((module) => module.type === "todayRelevant")) {
      entries.push(["今", "今天和你有關的重點已整理", "從市場、持倉與近期行為一起看，不只是一則行情摘要。"]);
    }
    if (modules.some((module) => module.type === "similarMoment")) {
      entries.push(["回", "找到可以回看的相似時刻", "只用來比較當時與現在，不代表市場會重複。"]);
    }
    if (response.user && response.user.profileStatus === "draft") {
      entries.push(["樣", "投資樣貌尚未確認", "目前已先套用初步設定，不影響你查看首頁。"]);
    }
    if (!entries.length) entries.push(["麥", "目前沒有新的通知", "有新的個人化整理時，麥麥會放在這裡。"]);
    entries.forEach(([markText, title, copyText]) => {
      const item = create("article", "notification-item");
      item.append(create("div", "notification-mark", markText));
      const copy = create("div");
      copy.append(create("b", "", title), create("p", "", copyText));
      item.append(copy);
      list.append(item);
    });
    byId("notification-dot").hidden = entries.length === 1 && entries[0][1] === "目前沒有新的通知";
  }

  function renderNavigation(response) {
    const navigationResponse = response.navigation || {};
    const tabs = safeArray(navigationResponse.tabs);
    document.querySelectorAll("[data-home-tab]").forEach((button) => {
      const tab = tabs.find((item) => item && item.id === button.dataset.homeTab);
      if (!tab || typeof tab.route !== "string") {
        button.disabled = true;
        button.removeAttribute("data-home-nav");
        return;
      }
      button.disabled = false;
      button.dataset.homeNav = tab.route;
      const label = button.querySelector("span");
      if (label && tab.label) label.textContent = tab.label;
      if (tab.active || navigationResponse.activeTab === tab.id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function renderHome(rawResponse, options) {
    const response = rawResponse && rawResponse.home ? rawResponse.home : rawResponse;
    if (!response || !response.user || !Array.isArray(response.modules)) throw new Error("HOME_RESPONSE_INVALID");
    uiState.response = response;
    applyStyle();
    renderGreeting(response);
    renderDraftReminder(response);
    renderModules(response);
    renderNotifications(response);
    renderNavigation(response);
    byId("home-loading").hidden = true;
    byId("home-error").hidden = true;
    byId("home-content").hidden = false;
    byId("home-content").setAttribute("aria-busy", "false");
    /* 版面橫幅在頂欄下、內容區之外，要跟著內容一起開關——骨架畫面上放一個
       切了也沒東西可切的控制列只會讓人困惑。 */
    byId("home-style-badge").hidden = false;
    if (!options || !options.background) {
      analytics("maimate_home_viewed");
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function showLoading() {
    uiState.loading = true;
    byId("home-loading").hidden = false;
    byId("home-error").hidden = true;
    byId("home-content").hidden = true;
    byId("home-style-badge").hidden = true;
  }

  function showError(error) {
    uiState.loading = false;
    byId("home-loading").hidden = true;
    byId("home-content").hidden = true;
    byId("home-style-badge").hidden = true;
    const errorState = byId("home-error");
    errorState.hidden = false;
    if (error && error.userMessage) setText("home-error-copy", error.userMessage);
    analytics("maimate_home_load_failed");
    errorState.focus({ preventScroll: true });
  }

  function guardRouteFrom(value) {
    if (!value || Array.isArray(value.modules)) return "";
    if (typeof value === "string") return value;
    return value.redirectRoute || value.guardRoute || value.nextRoute ||
      (value.status === "redirect" ? value.route : "") || "";
  }

  function followGuard(value) {
    const route = guardRouteFrom(value);
    if (!route) return false;
    const trustedGuardRoutes = {
      "welcome.html": "welcome.html",
      "onboarding.html#/consent": "onboarding.html#/consent",
      "onboarding.html#/profile": "onboarding.html#/profile",
      "onboarding.html#/analyzing": "onboarding.html#/analyzing",
      "onboarding.html#/profile-result": "onboarding.html#/profile-result",
      "/maimate/consent": "onboarding.html#/consent",
      "/maimate/profile-result": "onboarding.html#/profile-result",
    };
    if (trustedGuardRoutes[route]) {
      location.replace(trustedGuardRoutes[route]);
      return true;
    }
    navigateRoute(route);
    return true;
  }

  async function loadHome() {
    if (uiState.loading) return;
    if (!service || typeof service.getHome !== "function") {
      showError(new Error("HOME_SERVICE_UNAVAILABLE"));
      return;
    }
    showLoading();
    try {
      const serviceRegistry = window.MM_HOME_SERVICES || {};
      if (typeof serviceRegistry.evaluateAccess === "function") {
        const access = await serviceRegistry.evaluateAccess();
        if (followGuard(access)) return;
      }
      const cached = typeof serviceRegistry.getCachedHome === "function"
        ? serviceRegistry.getCachedHome()
        : null;
      if (cached) {
        renderHome(cached);
        uiState.loading = false;
        Promise.resolve()
          .then(() => service.refreshHome())
          .then((fresh) => {
            if (!followGuard(fresh)) renderHome(fresh, { background: true });
          })
          .catch(() => {});
        return;
      }
      const result = await service.getHome();
      if (followGuard(result)) return;
      renderHome(result);
      uiState.loading = false;
    } catch (error) {
      uiState.loading = false;
      if (followGuard(error)) return;
      showError(error);
    }
  }

  async function refreshHome(trigger) {
    if (uiState.refreshing || !service || typeof service.refreshHome !== "function") return;
    uiState.refreshing = true;
    if (trigger) {
      trigger.disabled = true;
      trigger.setAttribute("aria-busy", "true");
    }
    try {
      const result = await service.refreshHome();
      if (followGuard(result)) return;
      renderHome(result, { background: true });
      analytics("maimate_home_refreshed");
      showToast("已更新和你有關的重點");
    } catch (_) {
      showToast("這次沒有更新完成，先保留目前內容。");
    } finally {
      uiState.refreshing = false;
      if (trigger && document.contains(trigger)) {
        trigger.disabled = false;
        trigger.removeAttribute("aria-busy");
      }
    }
  }

  async function dismissModule(module, trigger) {
    if (!service || typeof service.dismissModule !== "function") return;
    trigger.disabled = true;
    try {
      await service.dismissModule(module.id);
      const node = document.querySelector('[data-module-id="' + CSS.escape(module.id) + '"]');
      if (node) node.remove();
      analytics("maimate_home_module_dismissed");
      showToast("已收起這則洞察");
    } catch (_) {
      trigger.disabled = false;
      showToast("這次沒有儲存成功，內容仍保留。");
    }
  }

  async function snoozeModule(module, trigger) {
    if (!service || typeof service.snoozeModule !== "function") return;
    trigger.disabled = true;
    try {
      await service.snoozeModule(module.id, "PT24H");
      const node = document.querySelector('[data-module-id="' + CSS.escape(module.id) + '"]');
      if (node) node.remove();
      analytics("maimate_home_module_snoozed");
      showToast("明天再提醒你");
    } catch (_) {
      trigger.disabled = false;
      showToast("這次沒有儲存成功，內容仍保留。");
    }
  }

  async function updateAmountVisibility(hidden, trigger) {
    if (!service || typeof service.updateAmountVisibility !== "function") return;
    trigger.disabled = true;
    try {
      await service.updateAmountVisibility(Boolean(hidden));
      const result = await service.getHome();
      if (!followGuard(result)) renderHome(result, { background: true });
      showToast(hidden ? "已儲存：預設隱藏金額" : "已儲存：預設顯示金額");
    } catch (_) {
      trigger.disabled = false;
      showToast("這次沒有更新顯示設定。");
    }
  }

  function showToast(message) {
    const toast = byId("home-toast");
    clearTimeout(uiState.toastTimer);
    toast.textContent = message;
    toast.classList.add("on");
    uiState.toastTimer = window.setTimeout(() => toast.classList.remove("on"), 2200);
  }

  function openNotificationSheet() {
    const root = byId("notification-sheet");
    uiState.sheetReturnFocus = document.activeElement;
    byId("home-notifications").setAttribute("aria-expanded", "true");
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    byId("home-root").inert = true;
    document.body.style.overflow = "hidden";
    root.querySelector(".sheet-close").focus();
  }

  function closeNotificationSheet() {
    const root = byId("notification-sheet");
    byId("home-notifications").setAttribute("aria-expanded", "false");
    root.classList.remove("open");
    root.setAttribute("aria-hidden", "true");
    byId("home-root").inert = false;
    document.body.style.overflow = "";
    if (uiState.sheetReturnFocus && typeof uiState.sheetReturnFocus.focus === "function") uiState.sheetReturnFocus.focus();
  }

  function trapSheetFocus(event) {
    const root = byId("notification-sheet");
    if (!root.classList.contains("open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeNotificationSheet();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(root.querySelectorAll("button,[href],[tabindex]:not([tabindex='-1'])")).filter((node) => !node.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submitChat(event) {
    event.preventDefault();
    const input = byId("home-chat-input");
    const question = input.value.trim();
    analytics("maimate_chat_entry_clicked");
    openChat({
      question,
      context: { source: "home_chat_entry" },
    });
  }

  /* ── 三種版面（＝問卷 Q6 的溝通風格）──
   * 預設跟著使用者的問卷答案；在首頁改選會記住，只影響呈現密度，不改任何資料。 */
  const STYLE_HINTS = {
    questionnaire: "依你在問卷選的說明方式呈現，可以隨時改。",
    userChoice: "已記住你選的版面，之後回來都會用這個。",
    default: "可以選一種你看起來最舒服的呈現方式。",
  };

  /* 標籤與順序跟 app.js 的 MODE_LABELS／MODE_ORDER 一致——同一個「麥麥怎麼跟你說話」
     在 index、home、問卷 Q6 三處必須同名同序（smoke:home:integration 第 12 段逐字比對）。 */
  const STYLE_LABELS = { guided: "安心白話", concise: "成長陪跑", analytical: "專業效率" };
  const STYLE_ORDER = ["guided", "concise", "analytical"];
  const STYLE_ONCE_KEY = "mm_home_style_hinted";

  function applyStyle() {
    const services = window.MM_HOME_SERVICES;
    if (!services || typeof services.currentStyle !== "function") return;
    const { style, source } = services.currentStyle();
    document.body.dataset.homeStyle = style;
    const badge = byId("home-style-badge");
    if (!badge) return;
    badge.dataset.style = style;
    badge.textContent = STYLE_LABELS[style] || STYLE_LABELS.guided;
    /* 徽章只顯示目前模式，看不出點下去會發生什麼。aria-label 補上「點一下換成 X」，
       讀屏使用者才知道這是循環切換而不是一個狀態標示。 */
    const next = STYLE_ORDER[(STYLE_ORDER.indexOf(style) + 1) % STYLE_ORDER.length];
    badge.setAttribute("aria-label",
      "版面：" + STYLE_LABELS[style] + "。點一下換成 " + STYLE_LABELS[next] + "。");
    badge.title = STYLE_HINTS[source] || STYLE_HINTS.default;

    /* 「為什麼現在是這個版面」原本是橫幅裡一行常駐小字。徽章塞不下那行字，
       改成每個 session 提示一次就好——問卷幫你選了版面卻不說一聲會很莫名其妙，
       但講第二次以後就只是雜訊。自己選過的人不需要被告知。 */
    if (source === "userChoice") return;
    try {
      if (sessionStorage.getItem(STYLE_ONCE_KEY)) return;
      sessionStorage.setItem(STYLE_ONCE_KEY, "1");
    } catch (_) { return; }
    showToast(STYLE_HINTS[source] || STYLE_HINTS.default);
  }

  function bindStyleSwitch() {
    const badge = byId("home-style-badge");
    if (!badge) return;
    badge.addEventListener("click", async () => {
      analytics("maimate_home_style_changed");
      const current = badge.dataset.style || STYLE_ORDER[0];
      const next = STYLE_ORDER[(STYLE_ORDER.indexOf(current) + 1) % STYLE_ORDER.length];
      const svc = window.MM_HOME_SERVICES && window.MM_HOME_SERVICES.home;
      if (svc && typeof svc.updatePresentationStyle === "function") {
        try { await svc.updatePresentationStyle(next); } catch (_) {}
      }
      applyStyle();
      /* 徽章很小、字也小，切換後畫面密度的變化又在捲軸下方看不到，
         不給回饋使用者會不確定自己按到了沒。 */
      showToast("版面：" + STYLE_LABELS[next]);
    });
  }

  function bindStaticEvents() {
    bindStyleSwitch();
    byId("home-notifications").addEventListener("click", openNotificationSheet);
    document.querySelectorAll("[data-close-notifications]").forEach((node) => node.addEventListener("click", closeNotificationSheet));
    document.addEventListener("keydown", trapSheetFocus);
    byId("home-settings").addEventListener("click", () => {
      const tabs = safeArray(uiState.response && uiState.response.navigation && uiState.response.navigation.tabs);
      const settings = tabs.find((tab) => tab && tab.id === "settings");
      navigateRoute(settings && settings.route ? settings.route : "/maimate/settings");
    });
    byId("home-retry").addEventListener("click", loadHome);
    byId("home-error-chat").addEventListener("click", () => openChat({ context: { source: "home_error_state" } }));
    byId("profile-draft-link").addEventListener("click", () => navigateRoute("/maimate/profile-result"));
    byId("persistent-chat-entry").addEventListener("submit", submitChat);
    byId("home-chat-input").addEventListener("focus", () => { byId("home-chat-quick").hidden = false; });
    document.querySelectorAll("[data-chat-quick]").forEach((button) => {
      button.addEventListener("click", () => {
        analytics("maimate_chat_entry_clicked");
        openChat({
          question: QUICK_CHAT_QUESTIONS[button.dataset.chatQuick] || "",
          context: { source: "home_chat_quick_entry" },
        });
      });
    });
    document.querySelectorAll("[data-home-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        const route = button.dataset.homeNav;
        if (route === "/maimate/chat") {
          analytics("maimate_chat_entry_clicked");
          openChat({ context: { source: "home_bottom_navigation" } });
        } else {
          navigateRoute(route);
        }
      });
    });
    ["maimate:home-updated", "maimate-home-updated"].forEach((name) => {
      window.addEventListener(name, (event) => {
        if (event.detail) {
          try { renderHome(event.detail, { background: true }); }
          catch (_) {}
        }
      });
    });
    if (service && typeof service.subscribe === "function") {
      uiState.unsubscribe = service.subscribe((response) => {
        try { renderHome(response, { background: true }); }
        catch (_) {}
      });
    }
  }

  function init() {
    bindStaticEvents();
    loadHome();
  }

  window.MM_HOME_UI = {
    loadHome,
    refreshHome,
    renderHome,
    moduleRenderers,
    getResponse() { return uiState.response; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
