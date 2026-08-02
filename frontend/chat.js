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
  /* 原本只認「想買｜買進」這種帶修飾語的講法，於是最自然的「幫我買500NTD的USDT」
   * 整條不 match（買後面接的是數字，不是「進」），連方案卡自己的字「買入」都不在清單裡。
   * 線上看不出來——線上一律打後端，卡片照出；只有**後端連不上**時才會現形：
   * 這句被判成非交易意圖 → 掉出 Golden Path → 結構化服務回一段安全邊界文字，沒有卡。
   * 補兩條泛用式：買/賣直接接數字，以及買/賣後面幾個字內出現幣別。
   * 「買賣手續費怎麼算」不會誤中（沒接數字也沒接幣別），實測見 smoke_chat 第 31 項。 */
  const TRADE_INTENT = new RegExp([
    "全賣|賣掉|賣出|想賣|賣光|出清|停損",
    "想買|買進|買入|加碼|減碼|換成",
    "[買賣]\\s*[0-9０-９]",
    "[買賣][^。，,\\n]{0,8}(usdt|btc|eth|sol|doge|ada|link|bnb|max)",
  ].join("|"), "i");
  /* 「現在該買 BTC 嗎？」也含買＋幣別，但那是**徵詢意見**，必須走安全邊界（不報明牌），
   * 不是交易指令。上面的泛用式會誤收，所以再減掉徵詢句型——煙測第 17 項在守這條。 */
  const ADVICE_QUESTION = /(該不該|該買|該賣|要不要|值不值得|值得|好不好|好嗎|建議我|嗎[？?]?\s*$)/;
  const isTradeIntent = (text) => TRADE_INTENT.test(text) && !ADVICE_QUESTION.test(text);
  /* 離線劇本只有賣出情境（GOLDEN_MOCK 是 ethtwd sell）。買入意圖若套上去，畫面會出現
   * 一組方向相反的假卡——「畫面正常但資料是假的」正是本專案的紅線，寧可誠實說算不出來。 */
  const SELL_DIRECTION = /(賣|出清|停損)/;

  /* /chat 的逾時上限。寫法與 settings.js:66-67、home-service.js、welcome.js 一致
   * （AbortController + setTimeout + finally clearTimeout），只有秒數不同。
   *
   * 為什麼要有：場地網路每 5 次掉 1 次，而「卡住但沒斷線」時 fetch 既不 resolve
   * 也不 reject，沒有逾時就會永遠停在「正在查看你的持倉與市場資料」——畫面看起來
   * 還在跑，其實已經死了，正是本專案最忌諱的「看不出來的失效」。
   *
   * 為什麼是 30 秒而不是 12 秒：實測 demo 那一題「ETH 跌太多了，幫我全部賣掉！」
   * 第一輪 /chat，private us-east-1 curl 8 次落在 8.56～12.63 秒、另量 5 次 6.86～10.36 秒，
   * official us-west-2 量 3 次 6.31～8.01 秒，中位數約 9 秒、尾巴已經壓到 12.6 秒。
   * 設 12 秒等於在後端「明明會成功」的時候把它誤殺成離線 mock，畫面就會貼出
   * GOLDEN_MOCK 的舊數字冒充後端結果——那正是這道防線要防的東西，不能自己製造。
   * 逾時的價值是防「永遠不回」，不是防「慢」；慢的時候取消鈕就在畫面上，
   * 讓使用者自己決定要不要停。30 秒 ≈ 中位數的 3 倍、實測最慢值的 2.4 倍。
   *
   * MM_CHAT_TIMEOUT_MS 是給煙測用的縮短鈕（同 window.API_BASE 的注入慣例），
   * 好讓 smoke 不必真的空等 30 秒；smoke_chat.js 另有一條斷言守住這裡的預設值。 */
  const CHAT_TIMEOUT_MS = Number(window.MM_CHAT_TIMEOUT_MS) > 0
    ? Number(window.MM_CHAT_TIMEOUT_MS) : 30000;

  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  /* 模型回覆會帶 markdown 粗體（**方案 1：…**）。app.js:311 早就有 md() 做這個轉換，
   * chat.js 沒有——於是比賽版第一次問「幫我買 500 NTD 的 USDT」，三方案標題整排星號
   * 露在畫面上。**先 escape 再轉，順序不能反**（workflow.md 前端紀律③：插 DOM 先 escape）。
   * 只支援粗體與換行，與 app.js 保持一致——這裡不是要做 markdown 引擎。 */
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mdEl = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.innerHTML = escHtml(text == null ? "" : text)
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/\n/g, "<br>");
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
    cancel: null,      // 真 /chat 等待期間的取消把手（ui.stream 只管 mock 串流）
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
    summary: (payload) => mdEl("div", "direct", payload.directAnswer),
    text: (payload) => mdEl("div", "text", payload.text),
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
          // 保留來源脈絡與對話 ID，Screen 8 回來時回到同一段對話，不重新生成回答
          if (window.MM_NAVIGATION) {
            const context = { source: "chat_insight_link", relatedInsightId: link.id };
            if (ui.conversation && ui.conversation.id) context.conversationId = ui.conversation.id;
            window.MM_NAVIGATION.navigate({ id: link.id, route: link.route, context });
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
      // boundaryNotice 一定要收：安全邊界回覆整句話只存在那個 block 裡
      // （chat-service.js 的 toAssistantMessage 已不再重複產生 summary），
      // 漏掉它會讓「複製」在安全邊界那幾題複製出空字串。
      const text = message.blocks
        .filter((blk) => blk.type === "summary" || blk.type === "text" || blk.type === "boundaryNotice")
        .map((blk) => blk.payload.directAnswer || blk.payload.text || blk.payload.message).join("\n");
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

  /* Golden Path 這條把**後端 LLM 原文**直接貼上來，是唯一會出現 markdown 的路徑
   * （blockRenderers 那些是前端自己組的字串，不帶 **）。所以星號問題只在這裡爆——
   * 也因此七套煙測全綠卻沒抓到：煙測走的是本地 service，不是真模型的回覆。 */
  function addPlainAssistant(text) {
    const card = el("div", "card-ai");
    card.append(mdEl("div", "text", text));
    byId("chatlog").append(card);
    return card;
  }

  /* ── 示範帳戶標示（後端沒有 MAX 金鑰時）──
   * 這是三道標示裡**唯一不依賴模型**的一道：橫幅由資料欄位決定、程式渲染，
   * 模型漏講了畫面照樣看得出來這不是真帳戶。
   * 兩個來源都認：payload 頂層（chat.py 加的）與第一張卡（loop.py 只帶得出 scenarios
   * 這個陣列，所以標示也蓋在卡上）。任一個在就算數。 */
  function demoNoticeFrom(payload) {
    if (!payload) return null;
    const first = Array.isArray(payload.scenarios) ? payload.scenarios[0] : null;
    const source = payload.account_source || (first && first.account_source);
    if (source !== "demo_dataset") return null;
    return payload.account_notice || (first && first.account_notice) ||
      "🧪 示範帳戶 — 命題方提供的一年份帳戶資料，非真實 MAX 帳戶餘額";
  }

  /* 副標題是**常設**標示：它在 position:sticky 的 chat-header 裡，捲不走，
   * 之後每一輪（含只出確認卡、看不到橫幅的那一輪）都還在畫面上。
   * 聊天流裡的金框橫幅只在第一次貼——每輪都貼會疊出四五條一樣的金框。 */
  function markDemoAccount(notice) {
    const subtitle = byId("chat-subtitle");
    const first = !subtitle || subtitle.dataset.demo !== "1";
    if (subtitle) {
      subtitle.textContent = "🧪 示範帳戶模式（命題方資料）";
      subtitle.dataset.demo = "1";
    }
    if (first) byId("chatlog").append(el("div", "demo-banner", notice));
  }

  /* 卡片本身就是選項，使用者（與評審）第一直覺是直接點它。
   * 這份原本只組 DOM 不掛任何事件——三張卡點下去毫無反應，Golden Path
   * （三方案 → 選一個 → 確認卡）在這一頁整條斷掉。
   * app.js 早就修過同一個問題（見該檔 addScenarios 的註解），這裡把同樣的做法補上：
   * 點擊／Enter／空白鍵都會把卡片標題填回輸入框並送出，沿用既有那條路徑（含離線 fallback）。 */
  function addScenarios(list) {
    (list || []).forEach((scenario, index) => {
      const meta = SCEN_META[scenario.key] || ["💡", "選項 " + (index + 1)];
      const card = el("div", "scen" + (index === 0 ? " pick" : ""));
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.dataset.label = scenario.label;
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
      card.append(el("div", "hint", "點這張卡片選它 →"));
      const choose = () => {
        // 正在等回覆時不要重複送出。ui.stream 只涵蓋 mock 串流，真 /chat 等待中是
        // ui.cancel——少判這個，卡住期間點卡片會把標題塞進輸入框卻送不出去。
        if (ui.stream || ui.cancel) return;
        const input = byId("q");
        input.value = scenario.label;
        byId("chatform").requestSubmit();
      };
      card.onclick = choose;
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      };
      byId("chatlog").append(card);
    });
  }

  function feeForConfirm(card, scenarios) {
    if (!Array.isArray(scenarios)) return null;
    const found = scenarios.find((item) => item.amount_twd != null && item.amount_twd === card.volume_twd);
    return found && found.fee_twd != null ? found.fee_twd : null;
  }

  function addConfirmCard(card, token, fee, demoNotice) {
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
    /* 示範帳戶模式仍然把確認流程完整跑完（送出 → 後端驗憑證 → 寫稽核），
     * 但後端不會送出真實訂單。先在卡片上講明，不要等使用者按下去才知道。 */
    if (demoNotice) wrap.append(el("div", "demo-line", "🧪 示範帳戶模式：這張卡完整呈現流程，但不會送出到交易所。"));
    wrap.append(el("div", "warn", "⚠ 以當下價格估算，實際成交可能有滑價。麥麥不會替你按下這顆按鈕。"));
    const btns = el("div", "btns");
    const ok = el("button", "ok", "確認" + (card.side === "buy" ? "買入" : "賣出"));
    const no = el("button", "no", "取消");
    ok.type = "button"; no.type = "button";
    /* 這段流程走完就離開 Golden Path：不清掉的話，之後每一句都會繼續送 /chat，
       使用者問「什麼是手續費」也會被當成還在下單對話裡。 */
    const endGoldenPath = () => { ui.goldenMessages = []; };

    ok.onclick = async () => {
      if (token === "offline-demo") {
        byId("chatlog").append(el("div", "done", "✅（離線展示）訂單流程示意完成 — 真實環境將經 60 秒憑證驗證與 MAX Private API 成交"));
        renderTrail(GOLDEN_MOCK.trail);
        wrap.remove();
        endGoldenPath();
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
        } else if (response.demo_account) {
          /* 這不是故障，是「本來就不會送出」——用中性樣式，不要在評審面前跳紅字。
             也不偽造成交或單號；決策軌跡照樣展開，證明流程真的走完了。 */
          byId("chatlog").append(el("div", "demo-banner", "🧪 " + (response.message || "示範帳戶模式，未送出任何訂單。")));
          const subtitle = byId("chat-subtitle");
          if (subtitle) { subtitle.textContent = "🧪 示範帳戶模式（命題方資料）"; subtitle.dataset.demo = "1"; }
          showTrail();
        } else addPlainAssistant("⚠️ " + (response.message || "下單未成功"));
      } catch (_) { addPlainAssistant("⚠️ 送單失敗，請再試一次。"); }
      wrap.remove();
      endGoldenPath();
      scrollBottom();
    };
    no.onclick = () => {
      addPlainAssistant("已取消，沒有送出任何訂單。");
      wrap.remove();
      endGoldenPath();
    };
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

  /* 每一句都送真 /chat，與 index.html 的對話同一條路：同一個後端、同一個 LLM、
   * 同一組工具（查餘額／查行情／查交易史／試算三方案）。工具鏈 chip 也照後端回傳的
   * tool_trail 顯示，不再用前端猜的標籤。
   *
   * 取不到後端時才走離線劇本，而且要依意圖分流——交易意圖回三方案（GOLDEN_MOCK），
   * 一般問題交還給既有的結構化服務。全部套 GOLDEN_MOCK 會讓「什麼是手續費」跳出
   * 三張賣出方案卡，那比沒有回覆嚴重得多。
   *
   * 回傳 true＝已處理；false＝請呼叫端改走離線的結構化回覆。 */
  async function askBackend(text, opts) {
    const tradeIntent = (opts && opts.tradeIntent) || ui.goldenMessages.length > 0;
    const toolNode = el("div", "tool-activity");
    toolNode.append(el("span", "chip", "正在查看你的持倉與市場資料"));
    byId("chatlog").append(toolNode);
    byId("chatlog").setAttribute("aria-busy", "true");
    scrollBottom();

    ui.goldenMessages.push({ role: "user", content: [{ text }] });
    let payload = null;
    let failure = null;      // null｜"timeout"｜"cancelled"｜"error"
    let usedMock = false;    // 這次畫面上的內容是離線劇本，不是後端算的

    /* 逾時／取消保護。三件事必須一起做，少一件就會卡住：
     *   1. signal —— 讓 fetch 真的停得下來；
     *   2. 取消鈕看得見（chat-stop 預設 hidden，舊路徑只有 mock 串流會叫它出來）；
     *   3. 輸入框停用 —— 等待期間 ui.stream 是 null，submitQuestion 的
     *      `if (!text || ui.stream) return` 擋不住重送，兩個 in-flight 請求會互相
     *      覆寫 ui.goldenMessages。 */
    const abort = new AbortController();
    const timer = setTimeout(() => { failure = "timeout"; abort.abort(); }, CHAT_TIMEOUT_MS);
    ui.cancel = () => { failure = "cancelled"; abort.abort(); };
    byId("chat-stop").hidden = false;
    byId("q").disabled = true;

    try {
      const body = { messages: ui.goldenMessages, session_id: SESSION_ID };
      const navigationContext = ui.context && ui.context.requestContext;
      if (navigationContext) body.navigation_context = navigationContext;
      const response = await fetch(API + "/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: abort.signal,
      });
      if (!response.ok) throw new Error("CHAT_HTTP_" + response.status);
      payload = await response.json();
      if (Array.isArray(payload.messages)) ui.goldenMessages = payload.messages;
      setOffline(false);
    } catch (_) {
      payload = null;
      if (!failure) failure = "error";   // 逾時／取消已經先標好，其餘都是連線或非 2xx
      /* 使用者自己按停止 ≠ 後端壞掉。無條件 setOffline(true) 會在後端明明健康時
         點亮頂欄「離線展示」，等於把真資料標成假的——本專案紅線的反面，一樣要擋。 */
      if (failure !== "cancelled") setOffline(true);
    } finally {
      /* 收尾一律放 finally：舊版把 toolNode.remove() 寫在 try 外面，只要中間任何一行
         丟例外，「正在查看你的持倉與市場資料」就會永遠留在畫面上。 */
      clearTimeout(timer);
      ui.cancel = null;
      byId("chat-stop").hidden = true;
      byId("q").disabled = false;
      toolNode.remove();
      byId("chatlog").setAttribute("aria-busy", "false");
    }

    if (!payload) {
      /* 使用者自己按了停止：不要拿離線劇本頂替他取消掉的那句話。
         這則使用者訊息沒有得到任何回覆，從歷史移除——他等一下重問時會重新 push。 */
      if (failure === "cancelled") {
        ui.goldenMessages.pop();
        addPlainAssistant("已停止回答。這一題沒有送出結果，你可以再問一次。");
        track("maimate_generation_cancelled", { status: "cancelled" });
        scrollBottom();
        return true;
      }
      /* 這一句本來就不是交易意圖 → 把送出的那則從歷史移除，交還給結構化服務。
         留著會讓下一次請求帶著一則沒有回覆的訊息，也會讓流程誤判成還在下單對話裡。

         注意：交易意圖那一支刻意「不」移除。離線時 Golden Path 仍要繼續往下走，
         後端反問「賣多少」而使用者回「賣一半就好」時，那句話不含任何交易關鍵字，
         必須帶著前文一起送出去，否則後端會把它當成全新的問題（smoke 第 27 項在守）。 */
      if (!tradeIntent) { ui.goldenMessages.pop(); return false; }

      /* 離線劇本只有賣出情境。買入意圖套上去會出現方向相反的假卡（金額、幣別、
         「我理解你想賣」全都對不上使用者剛剛講的話），比沒有卡更糟。誠實說算不出來。 */
      if (!SELL_DIRECTION.test(text)) {
        addPlainAssistant("這次沒問到——暫時連不上後端，所以沒辦法用即時行情替你試算方案。"
          + "內建的離線示範內容只有賣出情境，套到你這次的買入問題上數字會是錯的，麥麥不拿它充數。"
          + "請再問一次。");
        return true;
      }

      /* 先說實話，再給離線內容。畫面上一定要看得出這段不是後端算的——
         直接把 GOLDEN_MOCK 當成後端的回答貼上去，就是「畫面正常但資料是假的」。 */
      addPlainAssistant(failure === "timeout"
        ? "這次沒問到——等了 " + Math.round(CHAT_TIMEOUT_MS / 1000)
          + " 秒還是沒有等到後端回應，可能是網路卡住了。請再試一次。"
          + "下面是內建的離線示範內容，不是你帳戶的即時資料。"
        : "這次沒問到——暫時連不上後端。請再試一次。"
          + "下面是內建的離線示範內容，不是你帳戶的即時資料。");
      payload = GOLDEN_MOCK;
      usedMock = true;
    }

    /* chip 用後端實際跑過的工具，不用前端猜的——分鏡稿鏡 2 就是在看這排。
       離線劇本不畫：那排打勾的「✓ 查持倉」「✓ 方案試算」是在宣稱後端真的跑過這些
       工具，但它根本沒跑成功，chip 本身又沒有任何離線記號。 */
    if (!usedMock) renderToolChips(payload.tool_trail);
    /* 橫幅放在回覆與卡片**之前**：使用者先看到「這是示範帳戶」，才看到數字。
       放在 addScenarios 裡面不夠——只查餘額沒有出卡的那一輪就會漏標。
       離線劇本（usedMock）不進這裡：那條路的標示是上面那句「不是你帳戶的即時資料」。 */
    const demoNotice = usedMock ? null : demoNoticeFrom(payload);
    if (demoNotice) markDemoAccount(demoNotice);
    addPlainAssistant(payload.reply || GOLDEN_MOCK.reply);
    addScenarios(payload.scenarios);
    if (payload.confirm) {
      addConfirmCard(payload.confirm.confirmation_card, payload.confirm.confirm_token,
        feeForConfirm(payload.confirm.confirmation_card, payload.scenarios), demoNotice);
    }
    track("maimate_response_completed", { intent: "allowedPersonalAnalysis", status: "completed" });
    scrollBottom();
    return true;
  }

  /* 後端回的 tool_trail → 工具鏈 chip（與 index.html 的 addTrail 同語意）。 */
  function renderToolChips(trail) {
    if (!Array.isArray(trail) || !trail.length) return;
    const wrap = el("div", "tool-activity");
    trail.forEach((step) => {
      wrap.append(el("span", "chip", "✓ " + (step.summary || step.tool || "查詢")));
    });
    byId("chatlog").append(wrap);
  }

  /* 離線標示：畫面上必須看得出這段回覆不是線上算的（同 index.html 的頂欄標示）。 */
  function setOffline(on) {
    const badge = byId("chat-offline");
    if (badge) badge.hidden = !on;
  }

  /* ── 送出問題 ── */
  function scrollBottom() { window.scrollTo(0, document.body.scrollHeight); }

  async function submitQuestion() {
    const input = byId("q");
    const text = input.value.trim();
    /* ui.cancel ≠ null 代表真 /chat 還在飛。追問按鈕直接呼叫這支，不經過已停用的
       輸入框，所以旗標要在這裡擋，否則兩個 in-flight 請求會各自 push 使用者訊息、
       又各自用自己的回應覆寫整段 ui.goldenMessages。 */
    if (!text || ui.stream || ui.cancel) return;
    input.value = "";
    updateCount();
    byId("chat-empty").hidden = true;
    if (!ui.conversation) await startConversation("direct", null, null);

    renderMessage({ role: "user", blocks: [{ id: "u", type: "text", payload: { text } }] });
    scrollBottom();
    track("maimate_message_sent", { src: ui.conversation.source, style: ui.conversation.communicationStyle });

    /* Golden Path：使用者自己的交易意圖（要求 AI 自行執行的仍走安全邊界）。
     *
     * 這個判斷必須看狀態，不能只看這一句。後端遇到講不清楚的意圖會先反問
     *（「你想保留多少比例的 ETH？」——這是刻意的設計，AI 不替你決定），
     * 而使用者回答「賣一半就好」時，那句話不含任何交易關鍵字。
     * 原本逐則比對正則，於是回答反問的那一句會掉回 mock，畫面接上一段完全不相干的
     * 資金分布分析——對話斷在半路，而且看起來像功能壞掉。實測可重現。
     *
     * 所以：一旦進了 Golden Path（goldenMessages 有東西）就待在裡面，直到這段流程
     * 結束（成交／取消／開新對話會清空）。AUTO_EXEC 的安全邊界仍然優先於一切。 */
    const inGoldenPath = ui.goldenMessages.length > 0;
    const tradeIntent = inGoldenPath || isTradeIntent(text);
    if (!AUTO_EXEC.test(text)) {
      hideComposerContext();
      /* 線上一律走真後端；只有取不到後端而且這句不是交易意圖時才回傳 false，
         由下面既有的結構化服務接手當離線劇本。 */
      if (await askBackend(text, { tradeIntent })) return;
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
  /* 兩條路都要能停：真 /chat 等待中用 ui.cancel（abort fetch），mock 串流用 ui.stream。
     只認 ui.stream 的話，等待真後端時按下去是空操作——按鈕看得見卻沒有作用，
     比按鈕藏起來更糟。 */
  byId("chat-stop").onclick = () => {
    if (ui.cancel) ui.cancel();
    else if (ui.stream) ui.stream.cancel();
  };
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
      /* 從 Screen 8 回來時帶著原本的 conversationId：接回同一段對話，不另開新的。 */
      const resumeId = envelope.context && envelope.context.conversationId;
      const resumed = resumeId ? await services.conversation.getConversation(resumeId) : null;
      if (resumed) await loadConversation(resumed.id);
      else {
        await startConversation(envelope.context && envelope.context.relatedInsightId ? "insight" : "suggestedQuestion",
          context, envelope.question);
      }
      renderContextBanner(envelope);
      // 規格 §6：預填但不自動送出，讓使用者可以先改
      if (envelope.question) { byId("q").value = envelope.question; updateCount(); }
      else if (!resumed) renderEmptyState();
    } else {
      renderEmptyState();
    }
  }

  window.MM_CHAT_UI = { submitQuestion, loadConversation, newConversation, getConversation: () => ui.conversation };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
