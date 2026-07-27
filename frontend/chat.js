/* Screen 7｜問麥麥：UI 控制器
 * 兩條路線共存（決策 1）：
 *   A. 分析對話 —— 走 MM_CHAT_SERVICES（工具→結構化區塊→依據→追問）
 *   B. Golden Path —— 使用者自己表達交易意圖時，走既有後端 /chat 取得三方案與確認卡，
 *      由「使用者親自按下確認」才送出 /order。AI 全程不執行交易。
 * 渲染一律用 createElement + textContent（與 Screen 6 同標準，杜絕注入）。
 */
"use strict";

(function initChat() {
  const CORE = window.MM_CHAT_CORE;
  const MOCK = window.MM_CHAT_MOCK;
  const services = window.MM_CHAT_SERVICES;
  const API = window.API_BASE || "/api";
  const SESSION_ID = sessionStorage.maimate_sid ||
    (sessionStorage.maimate_sid = (crypto.randomUUID ? crypto.randomUUID() : "sid_" + Date.now()));

  /* 使用者自己的交易意圖 → Golden Path；要求 AI 自行執行 → 安全邊界 */
  const AUTO_EXEC = /(自動下單|替我下單|不用問我|直接幫我(買|賣|下單)|幫我操作帳戶)/;
  const TRADE_INTENT = /(全賣|賣掉|賣出|想賣|想買|買進|加碼|減碼|停損|出清)/;

  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const fmt = (n, maxDec) => {
    const num = Number(n);
    return Number.isFinite(num) ? num.toLocaleString("en-US", { maximumFractionDigits: maxDec == null ? 4 : maxDec }) : "—";
  };

  const ui = {
    conversation: null,
    messages: [],
    stream: null,
    pendingFeedback: null,
    lastEvidence: [],
    context: null,
    goldenMessages: [], // Golden Path 的 Converse 歷史（後端契約要求原樣存回）
  };

  /* ── 分析事件（決策 4：列舉值白名單，禁自由文字／金額／持倉）── */
  function track(name, meta) {
    try {
      const log = JSON.parse(localStorage.getItem("mm_events") || "[]");
      log.push(Object.assign({ e: name }, CORE.sanitizeEventMeta(meta)));
      localStorage.setItem("mm_events", JSON.stringify(log.slice(-100)));
    } catch (_) {}
  }

  /* ── Sheets ── */
  function openSheet(id) { byId(id).classList.add("sheet-open"); }
  function closeSheet(id) { byId(id).classList.remove("sheet-open"); }

  /* ── 區塊渲染 ── */
  const blockRenderers = {
    summary: (payload) => el("div", "direct", payload.directAnswer),
    text: (payload) => el("div", "text", payload.text),
    metric: (payload) => kvBlock(payload.title, payload.items),
    comparison: (payload) => kvBlock(payload.title, payload.items),
    timeline: (payload) => kvBlock(payload.title, payload.items),
    dataScopeNotice: (payload) => {
      const wrap = el("div", "blk");
      wrap.append(el("div", "bt", "資料範圍與限制"));
      const list = el("ul", "notice-list");
      payload.items.forEach((item) => list.append(el("li", "", item)));
      wrap.append(list);
      return wrap;
    },
    glossaryLink: (payload) => {
      const wrap = el("div", "blk");
      const card = el("div", "glossary");
      card.append(el("b", "", payload.title));
      card.append(el("span", "", "來源：" + payload.sourceId + "・更新於 " + payload.updatedAt));
      wrap.append(card);
      return wrap;
    },
    boundaryNotice: (payload) => {
      const wrap = el("div", "blk");
      const card = el("div", "boundary");
      card.append(el("div", "bm", payload.message));
      wrap.append(card);
      return wrap;
    },
    /* 本次參考：直接把用到的資料列出來（規格畫面的「本次參考」卡），
     * 細節（數值與更新時間）留在「查看依據」的 Sheet 裡。 */
    evidence: (payload) => {
      const wrap = el("div", "blk");
      const card = el("div", "ref-card");
      card.append(el("div", "bt", "本次參考"));
      const list = el("ul", "notice-list");
      const sources = (payload.sources || []).length
        ? payload.sources.map((tool) => MOCK.toolDoneLabels[tool] || tool)
        : payload.items.map((item) => sourceTypeLabel(item.sourceType));
      Array.from(new Set(sources)).forEach((label) => list.append(el("li", "", label)));
      card.append(list);
      const button = el("button", "ref-link", "查看依據 ›");
      button.type = "button";
      button.onclick = () => openEvidence(payload.items);
      card.append(button);
      wrap.append(card);
      return wrap;
    },
    insightLink: (payload) => {
      const wrap = el("div", "insight-links");
      wrap.append(el("div", "bt", "深入了解"));
      payload.links.forEach((link) => {
        const button = el("button", "", link.title + " ›");
        button.type = "button";
        button.onclick = () => {
          track("maimate_insight_link_opened", { src: ui.conversation && ui.conversation.source });
          // 保留來源脈絡，Screen 8 回來時不重新生成回答
          if (window.MM_NAVIGATION) {
            window.MM_NAVIGATION.navigate({
              id: link.id,
              route: link.route,
              context: { source: "chat_insight_link", relatedInsightId: link.id },
            });
          }
        };
        wrap.append(button);
      });
      return wrap;
    },
    followUpQuestions: (payload) => {
      const wrap = el("div", "followups");
      wrap.append(el("div", "fu-label", "你也可以接著問："));
      payload.questions.forEach((question) => {
        const button = el("button", "", question.text);
        button.type = "button";
        button.onclick = () => {
          track("maimate_follow_up_clicked", { q: question.id });
          byId("q").value = question.text;
          submitQuestion();
        };
        wrap.append(button);
      });
      return wrap;
    },
    toolStatus: (payload) => {
      const wrap = el("div", "tool-activity");
      payload.tools.forEach((tool) => wrap.append(el("span", "chip", MOCK.toolLabels[tool] || "正在整理資料")));
      return wrap;
    },
  };

  function kvBlock(title, items) {
    const wrap = el("div", "blk");
    if (title) wrap.append(el("div", "bt", title));
    (items || []).forEach((item) => {
      const row = el("div", "kv");
      row.append(el("span", "", item.label));
      row.append(el("b", "", item.value));
      wrap.append(row);
    });
    return wrap;
  }

  function renderMessage(message) {
    if (message.role === "user") {
      const bubble = el("div", "bubble-user", (message.blocks[0] && message.blocks[0].payload.text) || "");
      byId("chatlog").append(bubble);
      return bubble;
    }
    const card = el("div", "card-ai");
    card.dataset.messageId = message.id;
    const who = el("div", "who-row");
    const avatar = document.createElement("img");
    avatar.src = "maimate_hero.png";
    avatar.alt = "";
    who.append(avatar, el("b", "", "麥麥"));
    card.append(who);
    if (!CORE.validateBlocks(message.blocks)) {
      card.append(el("div", "direct", "這則回答沒有通過內容檢查，麥麥先不顯示它。"));
      byId("chatlog").append(card);
      return card;
    }
    message.blocks.forEach((blk) => {
      const render = blockRenderers[blk.type];
      if (render) card.append(render(blk.payload));
    });
    // 沒有「本次參考」卡時（例如安全邊界回覆），才用收合列表交代用過的資料
    const hasRefCard = message.blocks.some((blk) => blk.type === "evidence");
    if (!hasRefCard && message.toolExecutionIds && message.toolExecutionIds.length) {
      const details = el("details", "tool-done");
      details.append(el("summary", "", "已參考 " + message.toolExecutionIds.length + " 類資料"));
      const list = el("ul");
      message.toolExecutionIds.forEach((tool) => list.append(el("li", "", MOCK.toolDoneLabels[tool] || tool)));
      details.append(list);
      card.append(details);
    }
    card.append(messageActions(message));
    byId("chatlog").append(card);
    return card;
  }

  function messageActions(message) {
    const wrap = el("div", "msg-acts");
    const helpful = el("button", "", "👍 有幫助");
    helpful.type = "button";
    helpful.setAttribute("aria-pressed", "false");
    helpful.onclick = () => {
      helpful.setAttribute("aria-pressed", "true");
      services.conversation.submitMessageFeedback(message.id, { value: "helpful", createdAt: new Date().toISOString() });
      track("maimate_message_feedback_submitted", { status: "completed" });
    };
    const notHelpful = el("button", "", "👎 沒有幫助");
    notHelpful.type = "button";
    notHelpful.onclick = () => { ui.pendingFeedback = message.id; openFeedback(); };
    const copy = el("button", "", "複製");
    copy.type = "button";
    copy.onclick = () => {
      const text = message.blocks
        .filter((blk) => blk.type === "summary" || blk.type === "text")
        .map((blk) => blk.payload.directAnswer || blk.payload.text).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    };
    wrap.append(helpful, notHelpful, copy);
    return wrap;
  }

  /* ── 依據 Sheet ── */
  function openEvidence(items) {
    ui.lastEvidence = items || ui.lastEvidence;
    const body = byId("evidence-body");
    body.textContent = "";
    if (!ui.lastEvidence.length) {
      body.append(el("p", "", "這則回答沒有用到個人資料。"));
    } else {
      ui.lastEvidence.forEach((item) => {
        const row = el("div", "ev-item");
        row.append(el("b", "", item.label + "：" + item.value));
        row.append(el("span", "", "資料類型：" + sourceTypeLabel(item.sourceType) +
          (item.updatedAt ? "・更新於 " + String(item.updatedAt).slice(0, 16).replace("T", " ") : "")));
        body.append(row);
      });
      body.append(el("p", "", "麥麥不會顯示完整交易明細或帳號資訊。"));
    }
    track("maimate_evidence_opened");
    openSheet("evidence-root");
  }

  function sourceTypeLabel(type) {
    return {
      portfolio: "持倉摘要", transactions: "交易紀錄", market: "市場資料",
      profile: "投資樣貌", questionnaire: "你的問卷回答",
      knowledgeBase: "金融知識庫", historicalMoment: "歷史相似情況",
    }[type] || "資料";
  }

  /* ── 回饋 Sheet ── */
  const FEEDBACK_REASONS = [
    { id: "notRelevant", text: "和問題無關" },
    { id: "hardToUnderstand", text: "不容易理解" },
    { id: "incorrectData", text: "資料不正確" },
    { id: "tooLong", text: "太長" },
    { id: "tooShort", text: "太短" },
    { id: "feltLikeAdvice", text: "感覺像投資建議" },
    { id: "other", text: "其他" },
  ];
  let feedbackPicked = null;

  function openFeedback() {
    const box = byId("feedback-options");
    box.textContent = "";
    feedbackPicked = null;
    FEEDBACK_REASONS.forEach((reason) => {
      const button = el("button", "", reason.text);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.onclick = () => {
        feedbackPicked = reason.id;
        box.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      };
      box.append(button);
    });
    openSheet("feedback-root");
  }

  byId("feedback-submit").onclick = () => {
    if (ui.pendingFeedback) {
      services.conversation.submitMessageFeedback(ui.pendingFeedback,
        { value: "notHelpful", reasons: feedbackPicked ? [feedbackPicked] : [], createdAt: new Date().toISOString() });
      track("maimate_message_feedback_submitted", { status: "completed" });
    }
    closeSheet("feedback-root");
  };

  /* ── 對話紀錄 Sheet（清單長存、內容 30 分鐘）── */
  async function openHistory() {
    const list = await services.conversation.listConversations();
    const body = byId("history-body");
    body.textContent = "";
    if (!list.length) {
      body.append(el("p", "", "還沒有對話紀錄。"));
    } else {
      list.forEach((item) => {
        const row = el("div", "conv-item");
        const open = el("button", "ci");
        open.type = "button";
        open.append(el("b", "", item.title));
        open.append(el("span", "", new Date(item.updatedAt).toLocaleString("zh-TW", { hour12: false }).slice(5, 16) +
          "・" + (item.usesPersonalData ? "有使用個人資料" : "一般知識")));
        open.onclick = () => { closeSheet("history-root"); loadConversation(item.id); };
        const del = el("button", "del", "刪除");
        del.type = "button";
        del.onclick = () => {
          if (!window.confirm("刪除後這段對話就找不回來了，確定刪除？")) return;
          services.conversation.deleteConversation(item.id);
          track("maimate_conversation_deleted");
          openHistory();
        };
        row.append(open, del);
        body.append(row);
      });
    }
    openSheet("history-root");
  }

  /* ── Golden Path（使用者自己的交易意圖）── */
  const GOLDEN_MOCK = {
    reply: "（離線展示）我理解你想賣，先陪你看 30 秒再決定。這不是說你不能賣，是給你三個都算好數字的選項：",
    tool_trail: [{ seq: 1, tool: "get_account_balance", summary: "查持倉" }, { seq: 2, tool: "calculate_trade_scenarios", summary: "方案試算" }],
    scenarios: [
      { key: "partial", label: "先賣 25%，留 75% 觀察", amount_twd: 35920, fee_twd: 57, post_concentration_pct: 44 },
      { key: "full", label: "照原計畫全部賣出", amount_twd: 143680, fee_twd: 230, post_concentration_pct: 0 },
      { key: "pause", label: "先不動，設 -10% 價格提醒", behavior_note: "不產生任何訂單；到價時提醒你回來看看。" },
    ],
    confirm: { confirm_token: "offline-demo", confirmation_card: { market: "ethtwd", side: "sell", volume_twd: 35920, ord_type: "market", price: null } },
    trail: [
      { seq: 1, ts: null, type: "tool_call", payload: { tool: "get_account_balance", input_summary: "查持倉", status: "success" } },
      { seq: 2, ts: null, type: "draft_created", payload: { market: "ethtwd", side: "sell", volume_twd: 35920 } },
      { seq: 3, ts: null, type: "user_confirmed", payload: { market: "ethtwd" } },
      { seq: 4, ts: null, type: "executed", payload: { exchange_order_id: "demo" } },
    ],
  };
  const SCEN_META = { partial: ["🛡️", "麥麥陪跑建議看看"], full: ["📤", "你的原意圖"], pause: ["⏸️", "冷靜期"] };

  function addPlainAssistant(text) {
    const card = el("div", "card-ai");
    card.append(el("div", "text", text));
    byId("chatlog").append(card);
    return card;
  }

  function addScenarios(list) {
    (list || []).forEach((scenario, index) => {
      const meta = SCEN_META[scenario.key] || ["💡", "選項 " + (index + 1)];
      const card = el("div", "scen" + (index === 0 ? " pick" : ""));
      const title = el("div", "t", meta[0] + " " + scenario.label);
      title.append(el("span", "tag", meta[1]));
      card.append(title);
      const row = el("div", "row");
      const cell = (label, value) => { const box = el("div", "", label); box.append(el("b", "", value)); return box; };
      row.append(scenario.amount_twd != null ? cell("預估金額", "NT$" + fmt(scenario.amount_twd)) : cell("動作", "不產生訂單"));
      if (scenario.fee_twd != null) row.append(cell("手續費", "NT$" + fmt(scenario.fee_twd)));
      if (scenario.post_concentration_pct != null) row.append(cell("執行後佔比", fmt(scenario.post_concentration_pct) + "%"));
      card.append(row);
      if (scenario.behavior_note) card.append(el("div", "note", scenario.behavior_note));
      byId("chatlog").append(card);
    });
  }

  function feeForConfirm(card, scenarios) {
    if (!Array.isArray(scenarios)) return null;
    const found = scenarios.find((item) => item.amount_twd != null && item.amount_twd === card.volume_twd);
    return found && found.fee_twd != null ? found.fee_twd : null;
  }

  function addConfirmCard(card, token, fee) {
    const wrap = el("div", "confirm");
    wrap.append(el("div", "h", "📋 下單確認 — 最後一步由你決定"));
    const table = el("table");
    const row = (label, value) => {
      const tr = document.createElement("tr");
      const td1 = el("td", "", label);
      const td2 = el("td", "", value);
      tr.append(td1, td2);
      return tr;
    };
    const coin = String(card.market || "").replace(/twd$/i, "").toUpperCase();
    const qty = card.ord_type === "market" ? "市價，數量依成交價定"
      : (card.price ? fmt(card.volume_twd / card.price, 6) + " " + coin : "—");
    table.append(row("動作", (card.side === "buy" ? "買入 " : "賣出 ") + String(card.market || "").toUpperCase() +
      "（" + (card.ord_type === "market" ? "市價" : "限價 NT$" + fmt(card.price)) + "）"));
    table.append(row("數量", qty));
    table.append(row("預估金額", "NT$" + fmt(card.volume_twd)));
    if (fee != null) table.append(row("預估手續費", "NT$" + fmt(fee)));
    table.append(row("確認時效", "60 秒內有效"));
    wrap.append(table);
    wrap.append(el("div", "warn", "⚠ 以當下價格估算，實際成交可能有滑價。麥麥不會替你按下這顆按鈕。"));
    const btns = el("div", "btns");
    const ok = el("button", "ok", "確認" + (card.side === "buy" ? "買入" : "賣出"));
    const no = el("button", "no", "取消");
    ok.type = "button"; no.type = "button";
    ok.onclick = async () => {
      if (token === "offline-demo") {
        byId("chatlog").append(el("div", "done", "✅（離線展示）訂單流程示意完成 — 真實環境將經 60 秒憑證驗證與 MAX Private API 成交"));
        renderTrail(GOLDEN_MOCK.trail);
        wrap.remove();
        return;
      }
      try {
        const response = await (await fetch(API + "/order", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm_token: token, session_id: SESSION_ID }),
        })).json();
        if (response.ok) {
          const oid = (response.exchange_response && response.exchange_response.id) || (response.order && response.order.id) || "";
          byId("chatlog").append(el("div", "done", "✅ 已成交" + (oid ? "（單號 #" + oid + "）" : "") + " — 持倉與健檢已更新"));
          showTrail();
        } else addPlainAssistant("⚠️ " + (response.message || "下單未成功"));
      } catch (_) { addPlainAssistant("⚠️ 送單失敗，請再試一次。"); }
      wrap.remove();
      scrollBottom();
    };
    no.onclick = () => { addPlainAssistant("已取消，沒有送出任何訂單。"); wrap.remove(); };
    btns.append(ok, no);
    wrap.append(btns);
    byId("chatlog").append(wrap);
    scrollBottom();
  }

  function renderTrail(trail) {
    if (!trail || !trail.length) return;
    const wrap = el("div", "trail");
    const head = el("div", "h", "🔍 決策軌跡（本次對話）");
    head.append(el("span", "", "已寫入稽核紀錄"));
    wrap.append(head);
    trail.forEach((entry) => {
      const step = el("div", "step" + (entry.type !== "tool_call" ? " hl" : ""));
      step.append(el("i", "", entry.ts ? new Date(entry.ts * 1000).toTimeString().slice(0, 5) : "--:--"));
      step.append(el("em", "", entry.type === "tool_call" ? entry.payload.tool : entry.type));
      const note = entry.type === "tool_call" ? (entry.payload.input_summary || "")
        : [entry.payload.market, entry.payload.side,
           entry.payload.volume_twd != null ? "NT$" + fmt(entry.payload.volume_twd) : "",
           entry.payload.exchange_order_id ? "#" + entry.payload.exchange_order_id : ""].filter(Boolean).join(" ");
      step.append(document.createTextNode(" " + note));
      wrap.append(step);
    });
    byId("chatlog").append(wrap);
    scrollBottom();
  }

  async function showTrail() {
    try {
      const response = await (await fetch(API + "/audit?session_id=" + encodeURIComponent(SESSION_ID))).json();
      renderTrail(response.trail);
    } catch (_) { /* 軌跡載入失敗不影響主流程 */ }
  }

  async function runGoldenPath(text) {
    const toolNode = el("div", "tool-activity");
    toolNode.append(el("span", "chip", "正在查看你的持倉與市場資料"));
    byId("chatlog").append(toolNode);
    scrollBottom();
    ui.goldenMessages.push({ role: "user", content: [{ text }] });
    let payload;
    try {
      const body = { messages: ui.goldenMessages, session_id: SESSION_ID };
      const navigationContext = ui.context && ui.context.requestContext;
      if (navigationContext) body.navigation_context = navigationContext;
      payload = await (await fetch(API + "/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })).json();
      if (Array.isArray(payload.messages)) ui.goldenMessages = payload.messages;
    } catch (_) {
      payload = GOLDEN_MOCK; // 離線保險：Golden Path 全鏈路照走
    }
    toolNode.remove();
    addPlainAssistant(payload.reply || GOLDEN_MOCK.reply);
    addScenarios(payload.scenarios);
    if (payload.confirm) {
      addConfirmCard(payload.confirm.confirmation_card, payload.confirm.confirm_token,
        feeForConfirm(payload.confirm.confirmation_card, payload.scenarios));
    }
    track("maimate_response_completed", { intent: "allowedPersonalAnalysis", status: "completed" });
    scrollBottom();
  }

  /* ── 送出問題 ── */
  function scrollBottom() { window.scrollTo(0, document.body.scrollHeight); }

  async function submitQuestion() {
    const input = byId("q");
    const text = input.value.trim();
    if (!text || ui.stream) return;
    input.value = "";
    updateCount();
    byId("chat-empty").hidden = true;
    if (!ui.conversation) await startConversation("direct", null, null);

    renderMessage({ role: "user", blocks: [{ id: "u", type: "text", payload: { text } }] });
    scrollBottom();
    track("maimate_message_sent", { src: ui.conversation.source, style: ui.conversation.communicationStyle });

    // Golden Path：使用者自己的交易意圖（要求 AI 自行執行的仍走安全邊界）
    if (!AUTO_EXEC.test(text) && TRADE_INTENT.test(text)) {
      hideComposerContext();
      return runGoldenPath(text);
    }

    const toolNode = el("div", "tool-activity");
    byId("chatlog").append(toolNode);
    byId("chat-stop").hidden = false;
    byId("chatlog").setAttribute("aria-busy", "true");

    let card = null;
    ui.stream = services.conversation.sendMessage(ui.conversation.id, { text }, {
      onToolStarted: (tool) => {
        track("maimate_tool_started", { tool });
        toolNode.append(el("span", "chip", MOCK.toolLabels[tool] || "正在整理資料"));
        scrollBottom();
      },
      onToolCompleted: (tool) => track("maimate_tool_completed", { tool, status: "completed" }),
      onResponseStarted: () => { toolNode.remove(); },
      onDelta: (chunk) => {
        if (!card) {
          card = el("div", "card-ai");
          card.append(el("div", "direct", ""));
          byId("chatlog").append(card);
        }
        card.firstChild.textContent += chunk;
        scrollBottom();
      },
      onCompleted: (message, meta) => {
        ui.stream = null;
        byId("chat-stop").hidden = true;
        byId("chatlog").setAttribute("aria-busy", "false");
        if (card) card.remove();
        renderMessage(message);
        const evidenceBlock = message.blocks.find((blk) => blk.type === "evidence");
        ui.lastEvidence = evidenceBlock ? evidenceBlock.payload.items : [];
        track(message.status === "blocked" ? "maimate_response_blocked" : "maimate_response_completed",
          { intent: meta.intent, status: message.status === "blocked" ? "blocked" : "completed", style: meta.style,
            guard: message.safetyBoundary ? message.safetyBoundary.category : undefined });
        scrollBottom();
      },
      onCancelled: () => {
        ui.stream = null;
        byId("chat-stop").hidden = true;
        byId("chatlog").setAttribute("aria-busy", "false");
        toolNode.remove();
        if (card) card.append(el("div", "text", "已停止回答。已顯示的內容仍會保留。"));
        track("maimate_generation_cancelled", { status: "cancelled" });
      },
    });
  }

  byId("chatform").onsubmit = (event) => { event.preventDefault(); submitQuestion(); };
  byId("chat-stop").onclick = () => { if (ui.stream) ui.stream.cancel(); };
  byId("q").addEventListener("input", updateCount);
  byId("q").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitQuestion(); }
  });

  function updateCount() {
    const value = byId("q").value;
    byId("chat-count").textContent = value.length > 800 ? value.length + " / 1000" : "";
    byId("chat-send").disabled = !value.trim();
  }

  /* ── Context Banner ── */
  const SOURCE_LABELS = {
    today_relevant_hero: "今天，什麼和你有關？",
    home_contextual_question: "從首頁繼續問",
    account_attribution: "帳戶變化原因",
    plan_alignment: "原本的我 vs 最近的我",
    similar_moment: "相似時刻回放",
    personalized_insight: "麥麥幫你注意到",
    persistent_chat_entry: "首頁提問",
    home_chat_quick_entry: "首頁快速提問",
    home_bottom_navigation: "首頁導覽",
    chat_insight_link: "深入分析",
  };

  function renderContextBanner(envelope) {
    if (!envelope || !envelope.context) return;
    const source = envelope.context.source;
    byId("ctx-src").textContent = "接續自「" + (SOURCE_LABELS[source] || "MaiMate 投資導航") + "」";
    byId("ctx-sum").textContent = envelope.question || "麥麥會帶著剛才的來源背景一起回答。";
    const tags = byId("ctx-tags");
    tags.textContent = "";
    [envelope.context.relatedAsset, SOURCE_LABELS[source], envelope.context.relatedModuleId ? "首頁模組" : null]
      .filter(Boolean).slice(0, 3).forEach((tag) => tags.append(el("span", "", tag)));
    byId("ctx-banner").hidden = false;
    track("maimate_context_banner_viewed", { src: "homeModule" });

    byId("composer-ctx-text").textContent = "正在詢問：" + (SOURCE_LABELS[source] || "來自首頁的問題");
    byId("composer-ctx").hidden = false;
  }

  function hideComposerContext() {
    byId("composer-ctx").hidden = true;
  }

  byId("ctx-hide").onclick = () => {
    byId("ctx-banner").hidden = true;
    hideComposerContext();
    ui.context = null;
    track("maimate_context_removed");
  };
  byId("composer-ctx-remove").onclick = () => byId("ctx-hide").click();
  byId("ctx-open").onclick = () => {
    if (window.MM_NAVIGATION) window.MM_NAVIGATION.navigate({ id: "chat_context_open", route: "/maimate/home" });
  };

  /* ── 對話生命週期 ── */
  async function startConversation(source, context, title) {
    ui.conversation = await services.conversation.createConversation({ source, context, title });
    ui.messages = [];
    track("maimate_conversation_created", { src: source, style: ui.conversation.communicationStyle });
    return ui.conversation;
  }

  async function loadConversation(id) {
    const conversation = await services.conversation.getConversation(id);
    if (!conversation) return;
    ui.conversation = conversation;
    const result = await services.conversation.listMessages(id);
    byId("chatlog").textContent = "";
    byId("chat-empty").hidden = true;
    if (result.expired || !result.messages.length) {
      showStateNote("這段展示對話已過期", "為了保護你的資料，對話內容只在同一次使用中保留。你可以建立新對話。", [
        { text: "建立新對話", onClick: () => { hideStateNote(); newConversation(); } },
        { text: "返回首頁", onClick: () => window.MM_NAVIGATION.navigate({ id: "chat_back_home", route: "/maimate/home" }) },
      ]);
      return;
    }
    hideStateNote();
    result.messages.forEach(renderMessage);
    scrollBottom();
  }

  async function newConversation() {
    byId("chatlog").textContent = "";
    ui.conversation = null;
    ui.goldenMessages = [];
    hideStateNote();
    renderEmptyState();
  }

  function renderEmptyState() {
    byId("empty-title").textContent = MOCK.emptyState.title;
    byId("empty-subtitle").textContent = MOCK.emptyState.subtitle;
    const box = byId("empty-questions");
    box.textContent = "";
    MOCK.emptyState.quickQuestions.forEach((question) => {
      const button = el("button", "", question.text);
      button.type = "button";
      button.onclick = () => { byId("q").value = question.text; updateCount(); submitQuestion(); };
      box.append(button);
    });
    byId("chat-empty").hidden = false;
  }

  function showStateNote(title, copy, actions) {
    byId("state-note-title").textContent = title;
    byId("state-note-copy").textContent = copy;
    const box = byId("state-note-acts");
    box.textContent = "";
    (actions || []).forEach((action) => {
      const button = el("button", "", action.text);
      button.type = "button";
      button.onclick = action.onClick;
      box.append(button);
    });
    byId("chat-state-note").hidden = false;
  }
  function hideStateNote() { byId("chat-state-note").hidden = true; }

  /* ── Header 行為 ── */
  byId("chat-back").onclick = () => window.MM_NAVIGATION.navigate({ id: "chat_back", route: "/maimate/home" });
  byId("chat-history").onclick = openHistory;
  byId("history-new").onclick = () => { closeSheet("history-root"); newConversation(); };
  byId("chat-more").onclick = () => {
    const menu = byId("more-menu");
    menu.hidden = !menu.hidden;
    byId("chat-more").setAttribute("aria-expanded", String(!menu.hidden));
  };
  document.querySelectorAll("[data-more]").forEach((button) => {
    button.onclick = () => {
      byId("more-menu").hidden = true;
      byId("chat-more").setAttribute("aria-expanded", "false");
      const action = button.dataset.more;
      if (action === "new") newConversation();
      else if (action === "evidence") openEvidence(ui.lastEvidence);
      else if (action === "clear") { byId("chatlog").textContent = ""; renderEmptyState(); }
      else if (action === "report") { ui.pendingFeedback = null; openFeedback(); }
      else if (action === "privacy") window.MM_NAVIGATION.navigate({ id: "chat_privacy", route: "/maimate/settings" });
    };
  });
  document.querySelectorAll("[data-close-sheet]").forEach((node) =>
    node.addEventListener("click", () => closeSheet(node.dataset.closeSheet)));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    ["evidence-root", "feedback-root", "history-root"].forEach(closeSheet);
    byId("more-menu").hidden = true;
  });
  document.querySelectorAll("[data-chat-nav]").forEach((button) => {
    button.onclick = () => window.MM_NAVIGATION.navigate({ id: "chat_bottom_nav", route: button.dataset.chatNav });
  });

  /* ── 初始化 ── */
  async function init() {
    const state = OnboardingStore.read();
    const access = CORE.evaluateChatAccess(state);
    if (access.status === "redirect") { location.replace(access.route); return; }

    document.body.classList.add("nav-visible");
    byId("chat-subtitle").textContent = access.mode === "limited"
      ? "一般市場與金融知識模式"
      : (state.portfolioSource === "mock" ? "展示資料模式" : "依你的資料與目前市場整理");
    if (access.mode === "limited") {
      showStateNote("目前未使用個人帳戶資料", "你仍然可以問市場與金融名詞。想讓麥麥帶入你的帳戶資料，可以到「我的」調整授權。", [
        { text: "查看資料授權設定", onClick: () => window.MM_NAVIGATION.navigate({ id: "chat_consent", route: "/maimate/settings" }) },
      ]);
    }

    const envelope = window.MM_NAVIGATION ? window.MM_NAVIGATION.consumeContext("chat") : null;
    track("maimate_chat_viewed", { src: envelope ? "homeModule" : "direct" });
    updateCount();

    if (envelope) {
      const context = CORE.validateIncomingContext({
        sourceModuleId: envelope.context && envelope.context.relatedModuleId,
        sourceInsightId: envelope.context && envelope.context.relatedInsightId,
        sourceQuestionId: envelope.questionId,
      }, state);
      ui.context = { requestContext: context };
      await startConversation(envelope.context && envelope.context.relatedInsightId ? "insight" : "suggestedQuestion",
        context, envelope.question);
      renderContextBanner(envelope);
      // 規格 §6：預填但不自動送出，讓使用者可以先改
      if (envelope.question) { byId("q").value = envelope.question; updateCount(); }
      else renderEmptyState();
    } else {
      renderEmptyState();
    }
  }

  window.MM_CHAT_UI = { submitQuestion, loadConversation, newConversation, getConversation: () => ui.conversation };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
