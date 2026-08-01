/* Screen 8｜深入了解：UI 控制器
 * 版面順序（規格畫面）：
 *   Header → 來源卡 → Hero（結論＋主要 Metric）→ 為什麼這和你有關 →（圖表）→
 *   用簡單一點的方式說 → 麥麥根據什麼 → 這份分析有哪些限制 → 一起看懂相關概念 →
 *   你可以接著問 → 回到對話 CTA
 * 天條：
 *   - 第一屏先看到結論與個人關聯，圖表在後面
 *   - 渲染一律 createElement + textContent（與 Screen 6/7 同標準，禁 innerHTML 拼字串）
 *   - 資料不足時不畫任何圖表元素
 *   - 分析事件只記列舉值（沿用 chat-core 的白名單）
 */
"use strict";

(function initInsights() {
  const CORE = window.MM_INSIGHTS_CORE;
  const services = window.MM_INSIGHT_SERVICES;
  const navigation = window.MM_NAVIGATION;
  const VIEW_KEY = "mm_insight_view";

  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

  const ui = {
    stack: [],
    conversationId: null,
    origin: "home",
    detail: null,
  };

  /* ── 分析事件（沿用 Screen 7 的白名單：只准列舉值）── */
  function track(name, meta) {
    try {
      const log = JSON.parse(localStorage.getItem("mm_events") || "[]");
      log.push(Object.assign({ e: name }, CORE.sanitizeEventMeta(meta)));
      localStorage.setItem("mm_events", JSON.stringify(log.slice(-100)));
    } catch (_) {}
  }

  function currentStyle() {
    try {
      const resolved = window.MM_HOME_SERVICES.currentStyle();
      return (resolved && resolved.style) || "guided";
    } catch (_) { return "guided"; }
  }

  function saveView() {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({
        stack: ui.stack.slice(-10),
        conversationId: ui.conversationId,
        origin: ui.origin,
      }));
    } catch (_) {}
  }

  function restoreView() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null");
      if (!parsed) return null;
      const stack = Array.isArray(parsed.stack)
        ? parsed.stack.filter((id) => CORE.ALL_INSIGHTS.includes(id))
        : [];
      return {
        stack,
        conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
        origin: ["home", "chat", "insights"].includes(parsed.origin) ? parsed.origin : "home",
      };
    } catch (_) { return null; }
  }

  /* 堆疊單條：一條 100% 橫條切成數段，用在某一段極度獨大的分布。
   * 極小的段（0.1%）在條上只有 1px 級寬度、手指點不到，所以真正可點的是下面的圖例列——
   * 條本身只當視覺，數值一律從圖例與 readout 讀得到，不靠精準點擊。 */
  function renderStackedBar(payload) {
    const card = el("section", "chart-card");
    card.dataset.chart = "stackedBar";
    card.append(el("h2", "", payload.title));
    card.append(el("p", "sum", payload.summary));

    const summaryText = payload.items.map((item) => item.label + " " + item.valueText).join("、");
    const bar = el("div", "stack-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", payload.title + " " + summaryText);
    const readout = el("div", "chart-readout", "點任一項看數值：" + summaryText);
    const legend = el("div", "stack-legend");

    payload.items.forEach((item, index) => {
      const pct = Math.max(0, Math.min(100, Number(item.pct)));
      const seg = el("div", "stack-seg");
      seg.dataset.segIndex = String(index);
      seg.style.width = pct + "%";
      /* 0% 的區間必須完全看不見：CSS 的 min-width 是為了讓 0.1% 這種
       * 極小但存在的段還看得到，套到 0% 上就變成「畫出一塊不存在的東西」。 */
      if (pct === 0) { seg.style.minWidth = "0"; seg.style.borderRight = "0"; }
      seg.setAttribute("aria-hidden", "true");
      bar.append(seg);

      const row = el("button", "stack-item");
      row.type = "button";
      row.dataset.segIndex = String(index);
      row.setAttribute("aria-pressed", "false");
      row.setAttribute("aria-label", item.label + " " + item.valueText);
      row.append(el("i", "swatch"));
      row.append(el("span", "", item.label));
      row.append(el("b", "", item.valueText));
      row.onclick = () => {
        legend.querySelectorAll(".stack-item").forEach((node) =>
          node.setAttribute("aria-pressed", String(node === row)));
        bar.querySelectorAll(".stack-seg").forEach((node) =>
          node.classList.toggle("on", node.dataset.segIndex === row.dataset.segIndex));
        readout.textContent = item.label + "：" + item.valueText;
        track2("maimate_insight_chart_inspected");
      };
      legend.append(row);
    });
    card.append(bar);
    card.append(legend);
    card.append(readout);
    return card;
  }

  /* ── 圖表：純 CSS 橫條／柱狀。每張圖都有 role="img" 與文字摘要，可點看數值 ── */
  function renderAllocationBar(payload) {
    const card = el("section", "chart-card");
    card.dataset.chart = "allocationBar";
    card.append(el("h2", "", payload.title));
    card.append(el("p", "sum", payload.summary));

    const summaryText = payload.items.map((item) => item.label + " " + item.valueText).join("、");
    const list = el("div", "alloc-list");
    list.setAttribute("role", "img");
    list.setAttribute("aria-label", payload.title + " " + summaryText);
    const readout = el("div", "chart-readout", "點任一條看數值：" + summaryText);

    payload.items.forEach((item, index) => {
      const bar = el("button", "alloc-bar");
      bar.type = "button";
      bar.dataset.allocIndex = String(index);
      bar.setAttribute("aria-pressed", "false");
      bar.setAttribute("aria-label", item.label + " " + item.valueText);
      const row = el("div", "row");
      row.append(el("span", "", item.label));
      row.append(el("b", "", item.valueText));
      bar.append(row);
      const track = el("div", "track");
      const fill = el("div", "fill");
      fill.style.width = Math.max(0, Math.min(100, Number(item.pct))) + "%";
      track.append(fill);
      bar.append(track);
      bar.onclick = () => {
        list.querySelectorAll(".alloc-bar").forEach((node) =>
          node.setAttribute("aria-pressed", String(node === bar)));
        readout.textContent = item.label + "：" + item.valueText;
        track2("maimate_insight_chart_inspected");
      };
      list.append(bar);
    });
    card.append(list);
    card.append(readout);
    return card;
  }

  function renderRhythmTimeline(payload) {
    const card = el("section", "chart-card");
    card.dataset.chart = "rhythmTimeline";
    card.append(el("h2", "", payload.title));
    card.append(el("p", "sum", payload.summary));

    const values = payload.items.map((item) => Number(item.value));
    const max = Math.max.apply(null, values.concat([Number(payload.averageValue)]));
    const summaryText = payload.items.map((item) => item.label + " " + item.valueText).join("、");
    const chart = el("div", "rhythm-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", payload.title + " 每月買賣筆數：" + summaryText +
      "；期間平均 " + payload.averageText + "。");
    const readout = el("div", "chart-readout", "點任一根柱看數值。期間平均 " + payload.averageText + "。");

    const average = el("div", "rhythm-avg");
    average.style.bottom = (max > 0 ? (Number(payload.averageValue) / max) * 100 : 0) + "%";
    average.append(el("span", "", "平均 " + payload.averageText));
    chart.append(average);

    payload.items.forEach((item) => {
      const bar = el("button", "rhythm-bar");
      bar.type = "button";
      bar.setAttribute("aria-pressed", "false");
      bar.setAttribute("aria-label", item.label + " " + item.valueText);
      if (item.isLatest) bar.dataset.latest = "true";
      if (item.isBusiest) bar.dataset.busiest = "true";
      const fill = el("i");
      fill.style.height = (max > 0 ? Math.max(4, (Number(item.value) / max) * 100) : 0) + "%";
      bar.append(fill);
      bar.onclick = () => {
        chart.querySelectorAll(".rhythm-bar").forEach((node) =>
          node.setAttribute("aria-pressed", String(node === bar)));
        readout.textContent = item.label + "：" + item.valueText +
          "（期間平均 " + payload.averageText + "）";
        track2("maimate_insight_chart_inspected");
      };
      chart.append(bar);
    });
    card.append(chart);

    const axis = el("div", "rhythm-axis");
    axis.append(el("span", "", payload.items[0].label));
    axis.append(el("span", "", payload.items[payload.items.length - 1].label));
    card.append(axis);

    const legend = el("div", "rhythm-legend");
    const busiest = payload.items.find((item) => item.isBusiest);
    const latest = payload.items.find((item) => item.isLatest);
    if (busiest) legend.append(legendItem("var(--bar)", "最忙的一個月 " + busiest.label));
    if (latest) legend.append(legendItem("var(--blue)", "最近一個月 " + latest.label));
    if (legend.childNodes.length) card.append(legend);
    card.append(readout);
    return card;
  }

  function legendItem(color, text) {
    const wrap = el("span");
    const dot = el("i");
    dot.style.background = color;
    wrap.append(dot, document.createTextNode(text));
    return wrap;
  }

  function renderKvCard(title, items) {
    const card = el("section", "kv-card");
    card.append(el("h2", "", title));
    items.forEach((item) => {
      const row = el("div", "kv");
      row.append(el("span", "", item.label));
      const value = el("b", "", item.value);
      if (item.note) value.append(el("span", "note", item.note));
      row.append(value);
      card.append(row);
    });
    return card;
  }

  function renderTextCard(payload) {
    const card = el("article", "card");
    if (payload.title) card.append(el("h2", "", payload.title));
    payload.paragraphs.forEach((text) => card.append(el("p", "", text)));
    return card;
  }

  function renderKnowledgeExplanation(payload) {
    const card = el("article", "card");
    card.append(el("h2", "", payload.title));
    payload.paragraphs.forEach((text) => card.append(el("p", "", text)));
    return card;
  }

  function renderInsufficient(payload) {
    const card = el("section", "gap-card");
    card.dataset.state = "insufficientData";
    card.append(el("span", "tag", "資料不足"));
    card.append(el("h2", "", payload.title));
    card.append(el("p", "", payload.reason));
    card.append(el("div", "lbl", "還缺哪些資料"));
    const list = el("ul", "bullet");
    payload.missing.forEach((text) => list.append(el("li", "", text)));
    card.append(list);
    if (payload.requestNote) card.append(el("p", "", payload.requestNote));
    if (payload.alternatives && payload.alternatives.length) {
      card.append(el("div", "lbl", "你現在可以這樣做"));
      const actions = el("div", "gap-alts");
      payload.alternatives.forEach((item) => {
        const button = el("button", "", item.label);
        button.type = "button";
        button.dataset.altId = item.id;
        button.onclick = () => handleAlternative(item);
        actions.append(button);
      });
      card.append(actions);
    }
    return card;
  }

  function handleAlternative(item) {
    if (item.type === "insight" || CORE.ALL_INSIGHTS.includes(item.id)) return openInsight(item.id);
    if (item.type === "settings") return go("/maimate/settings");
    return openChat(null);
  }

  const SECTION_RENDERERS = {
    text: renderTextCard,
    knowledgeExplanation: renderKnowledgeExplanation,
    metricList: (payload) => renderKvCard(payload.title, payload.items),
    comparison: (payload) => renderKvCard(payload.title, payload.items),
    evidenceList: (payload) => renderKvCard(payload.title, payload.items),
    allocationBar: renderAllocationBar,
    stackedBar: renderStackedBar,
    rhythmTimeline: renderRhythmTimeline,
    insufficientData: renderInsufficient,
  };

  /* ── 主渲染 ── */
  function renderDetail(detail) {
    ui.detail = detail;
    byId("index-root").hidden = true;
    byId("detail-root").hidden = false;

    byId("ins-title").textContent = detail.title;
    byId("ins-subtitle").textContent = detail.kind === "knowledge" ? "名詞解釋" : "來自你的帳戶健檢報告";
    document.title = detail.title + "｜MaiMate";

    if (detail.source) {
      byId("source-value").textContent = detail.source.value;
      const meta = [];
      if (detail.source.sourceLabel) meta.push("資料類型：" + detail.source.sourceLabel);
      if (detail.source.updatedAt) meta.push("更新於 " + String(detail.source.updatedAt).slice(0, 10));
      byId("source-meta").textContent = meta.join("・");
      byId("source-card").hidden = false;
    } else {
      byId("source-card").hidden = true;
    }

    const notice = byId("notice-bar");
    if (detail.notice) {
      notice.textContent = detail.stopped
        ? detail.notice + "（已停止更新）"
        : detail.notice;
      notice.hidden = false;
    } else {
      notice.textContent = "";
      notice.hidden = true;
    }

    byId("hero-eyebrow").textContent = detail.kind === "knowledge" ? "名詞解釋" : "深入了解";
    byId("hero-title").textContent = detail.title;
    byId("hero-conclusion").textContent = detail.hero.conclusion;
    const metric = detail.hero.primaryMetric;
    if (metric) {
      byId("metric-value").textContent = metric.value;
      byId("metric-label").textContent = metric.label;
      byId("metric-note").textContent = metric.note || "";
      byId("hero-metric").hidden = false;
    } else {
      byId("hero-metric").hidden = true;
    }

    byId("why-title").textContent = detail.whyItMatters.title;
    const why = byId("why-body");
    clear(why);
    detail.whyItMatters.paragraphs.forEach((text) => why.append(el("p", "", text)));

    const root = byId("sections-root");
    clear(root);
    /* 限制在頁面下方有專屬區塊，這裡不重複渲染 limitationList。 */
    detail.sections
      .filter((item) => item.type !== "limitationList")
      .forEach((item) => {
        const render = SECTION_RENDERERS[item.type];
        if (render) root.append(render(item.payload));
      });

    byId("simple-title").textContent = detail.simpleExplanation.title;
    const simple = byId("simple-body");
    clear(simple);
    detail.simpleExplanation.paragraphs.forEach((text) => simple.append(el("p", "", text)));

    const evidenceBody = byId("evidence-body");
    clear(evidenceBody);
    if (!detail.evidence.length) {
      evidenceBody.append(el("p", "ev-foot", "這一頁沒有用到你的個人資料。"));
    } else {
      detail.evidence.forEach((item) => {
        const row = el("div", "ev-item");
        row.append(el("b", "", item.label + "：" + item.value));
        const meta = [];
        if (item.sourceLabel) meta.push("資料類型：" + item.sourceLabel);
        if (item.updatedAt) meta.push("更新於 " + String(item.updatedAt).slice(0, 10));
        row.append(el("span", "", meta.join("・")));
        evidenceBody.append(row);
      });
    }

    const limits = byId("limit-body");
    clear(limits);
    detail.limitations.forEach((item) => limits.append(el("li", "", item.text)));
    byId("limit-card").hidden = !detail.limitations.length;

    const terms = byId("terms-body");
    clear(terms);
    detail.relatedTerms.forEach((term) => {
      const button = el("button", "term-item");
      button.type = "button";
      button.dataset.termId = term.insightId;
      button.append(el("b", "", term.title));
      button.append(el("span", "", term.summary));
      button.onclick = () => {
        track("maimate_insight_term_opened", { src: "insight" });
        openInsight(term.insightId);
      };
      terms.append(button);
    });
    byId("terms-card").hidden = !detail.relatedTerms.length;

    const asks = byId("ask-body");
    clear(asks);
    detail.suggestedQuestions.forEach((question) => {
      const button = el("button", "");
      button.type = "button";
      button.textContent = question.text;
      button.dataset.questionId = question.id;
      button.onclick = () => {
        track("maimate_insight_question_clicked", { q: question.id, src: "insight" });
        openChat(question);
      };
      asks.append(button);
    });
    byId("ask-card").hidden = !detail.suggestedQuestions.length;

    if (detail.dataStatus === "insufficient") {
      track("maimate_insight_insufficient_shown", { status: "partial", src: "insight" });
    }
    if (detail.guard) track("maimate_insight_blocked", { guard: "unsupported", status: "blocked" });
    track("maimate_insight_viewed", { src: "insight", style: currentStyle() });
    window.scrollTo(0, 0);
  }

  function renderIndex() {
    ui.detail = null;
    byId("detail-root").hidden = true;
    byId("index-root").hidden = false;
    byId("ins-title").textContent = "深入了解";
    byId("ins-subtitle").textContent = "延續你在首頁與對話看到的資料";
    byId("source-card").hidden = true;
    byId("notice-bar").hidden = true;
    document.title = "深入了解｜MaiMate";

    const list = services.insight.listInsights();
    const personal = byId("index-personal");
    const knowledge = byId("index-knowledge");
    clear(personal);
    clear(knowledge);
    list.forEach((item) => {
      const button = el("button", "term-item");
      button.type = "button";
      button.dataset.termId = item.id;
      button.append(el("b", "", item.title));
      button.append(el("span", "", item.summary));
      button.onclick = () => openInsight(item.id);
      (item.kind === "knowledge" ? knowledge : personal).append(button);
    });
    track("maimate_insight_viewed", { src: "insight", style: currentStyle() });
    window.scrollTo(0, 0);
  }

  /* ── 導航 ── */
  function go(route, extra) {
    if (!navigation) return false;
    return navigation.navigate(Object.assign({ id: "insight_navigation", route }, extra || {}));
  }

  function openChat(question) {
    const context = { source: "insight_detail" };
    if (ui.detail) context.relatedInsightId = ui.detail.id;
    if (ui.conversationId) context.conversationId = ui.conversationId;
    track("maimate_insight_chat_opened", { src: "insight" });
    if (!navigation) return false;
    return navigation.openChat({
      id: question ? question.id : "insight_back_to_chat",
      questionId: question ? question.id : undefined,
      question: question ? question.text : undefined,
      context,
    });
  }

  /** 開下一個 Insight：不換頁，保留返回堆疊 */
  async function openInsight(insightId) {
    if (!CORE.ALL_INSIGHTS.includes(insightId)) return;
    if (ui.stack[ui.stack.length - 1] !== insightId) ui.stack.push(insightId);
    saveView();
    await show(insightId);
  }

  async function show(insightId) {
    let detail = null;
    try { detail = await services.insight.getInsight(insightId); }
    catch (_) { detail = null; }
    if (!detail) {
      ui.stack.pop();
      saveView();
      renderIndex();
      return;
    }
    renderDetail(detail);
  }

  function goBack() {
    if (ui.stack.length > 1) {
      ui.stack.pop();
      saveView();
      show(ui.stack[ui.stack.length - 1]);
      return;
    }
    if (ui.stack.length === 1) {
      ui.stack = [];
      saveView();
      renderIndex();
      return;
    }
    if (ui.origin === "chat") { openChat(null); return; }
    go("/maimate/home");
  }

  const track2 = (name) => track(name, { src: "insight" });

  /* ── Header／導覽事件 ── */
  byId("ins-back").onclick = goBack;
  byId("ins-more").onclick = () => {
    const menu = byId("more-menu");
    menu.hidden = !menu.hidden;
    byId("ins-more").setAttribute("aria-expanded", String(!menu.hidden));
  };
  document.querySelectorAll("[data-more]").forEach((button) => {
    button.onclick = () => {
      byId("more-menu").hidden = true;
      byId("ins-more").setAttribute("aria-expanded", "false");
      const action = button.dataset.more;
      if (action === "all") { ui.stack = []; saveView(); renderIndex(); }
      else if (action === "chat") openChat(null);
      else if (action === "home") go("/maimate/home");
      else if (action === "privacy") go("/maimate/settings");
    };
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") byId("more-menu").hidden = true;
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.onclick = () => {
      const route = button.dataset.nav;
      if (route === "/maimate/insights") { ui.stack = []; saveView(); renderIndex(); return; }
      if (route === "/maimate/chat") { openChat(null); return; }
      go(route);
    };
  });
  byId("cta-chat").onclick = () => openChat(null);
  byId("cta-all").onclick = () => { ui.stack = []; saveView(); renderIndex(); };

  /* ── 初始化 ── */
  async function init() {
    /* 這一頁的每個洞察都由 MM_HOME_SERVICES.adapters 現算（見 insights-service.js），
       而 adapters 要拿到真報告得先有人去取 /health。home.html 走 refreshHome() 會自己
       觸發，這頁只讀 adapters、不經過 refreshHome——沒有人叫它就永遠是示範資料，
       而且畫面完全正常、主控台零錯誤，看不出來。
       ensureHealth 記憶化＋2.5 秒逾時，取不到就照舊落回示範資料，不會卡住畫面。 */
    /* 名字不能叫 services——模組層第 16 行已經有一個 services＝MM_INSIGHT_SERVICES，
       在這裡重新宣告會把它遮蔽掉。 */
    const homeServices = window.MM_HOME_SERVICES;
    if (homeServices && typeof homeServices.ensureHealth === "function") {
      try { await homeServices.ensureHealth(); } catch (_) { /* 取不到就用示範資料 */ }
    }
    const envelope = navigation ? navigation.consumeContext("insight") : null;
    const restored = restoreView();
    if (restored) {
      ui.stack = restored.stack;
      ui.conversationId = restored.conversationId;
      ui.origin = restored.origin;
    }
    let insightId = null;
    if (envelope) {
      const parsed = CORE.parseInsightRoute(envelope.route);
      insightId = parsed ? parsed.insightId : null;
      const context = envelope.context || {};
      if (context.conversationId) ui.conversationId = context.conversationId;
      if (!insightId && context.relatedInsightId &&
          CORE.ALL_INSIGHTS.includes(context.relatedInsightId)) {
        insightId = context.relatedInsightId;
      }
      ui.origin = context.conversationId || String(context.source || "").indexOf("chat") === 0
        ? "chat"
        : "home";
      if (insightId) ui.stack = [insightId];
      else ui.stack = [];
      saveView();
    }
    if (!insightId && ui.stack.length) insightId = ui.stack[ui.stack.length - 1];
    if (insightId) await show(insightId);
    else renderIndex();
  }

  window.MM_INSIGHTS_UI = {
    open: openInsight,
    back: goBack,
    showIndex: () => { ui.stack = []; saveView(); renderIndex(); },
    getDetail: () => ui.detail,
    getStack: () => ui.stack.slice(),
    getConversationId: () => ui.conversationId,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
