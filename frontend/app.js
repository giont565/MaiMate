/* MaiMate 前端（無建置步驟的靜態 SPA，S3 直接託管）
 * 視覺依 docs/mockups 三畫面；API 失敗自動切離線 mock（tech.md 的完成度保險）。
 * 金額顯示鐵則：一律千分位逗號（fmt）。 */
const API = window.API_BASE || "/api";
let messages = []; // Converse 格式對話歷史

// session_id：稽核軌跡的關聯鍵（README §3；audit-log spec）
const SESSION_ID = sessionStorage.maimate_sid || (sessionStorage.maimate_sid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)));

// 使用者模式（#10）：null=後端自動推斷；點徽章循環切換（Demo 展示「同句話三種回應」）
const MODE_LABELS = { cautious: "安心白話", growth: "成長陪跑", pro: "專業效率" };
const MODE_ORDER = ["cautious", "growth", "pro"];
let modeOverride = null;
let currentMode = "growth";
function setBadge(mode, isOverride) {
  currentMode = mode;
  document.getElementById("mode-badge").textContent = MODE_LABELS[mode] + (isOverride ? "＊" : "");
}
document.getElementById("mode-badge").onclick = () => {
  modeOverride = MODE_ORDER[(MODE_ORDER.indexOf(modeOverride || currentMode) + 1) % MODE_ORDER.length];
  setBadge(modeOverride, true);
};

// 千分位格式化：fmt(2091464.5) → "2,091,464.5"；小數照原值保留（最多 maxDec 位）
function fmt(n, maxDec = 4) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US", { maximumFractionDigits: maxDec }) : String(n);
}

// ---------- 離線備援資料（決賽保險：任一步掛掉→mock 接手走完 Golden Path） ----------
const MOCK = {
  health: {
    chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
    opportunity_cost: { total_missed_twd: 26598877 },
    concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12" } },
    cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
  },
  markets: ["btctwd", "ethtwd", "soltwd", "dogetwd"],
  // 離線對話劇本：依輸入意圖回對應的展示回應（數字皆來自真實 health_report）
  chat(text) {
    if (/全賣|賣掉|賣出|全部賣/.test(text)) return {
      reply: "（離線展示）我理解你想賣，先陪你看 30 秒再決定。ETH 現在佔你持倉 **54%**——要提醒你：**今年 1/8 急跌時你也全賣過**，那一次到年末少賺了 **NT$312,924**。這不是說你不能賣，是給你三個都算好數字的選項：",
      tool_trail: [
        { seq: 1, tool: "get_account_balance", summary: "查持倉" },
        { seq: 2, tool: "get_market_data", summary: "查行情（ethtwd）" },
        { seq: 3, tool: "query_user_history", summary: "查交易史（opportunity_cost）" },
        { seq: 4, tool: "calculate_trade_scenarios", summary: "方案試算（ethtwd）" },
      ],
      scenarios: [
        { key: "partial", label: "先賣 25%，留 75% 觀察", amount_twd: 35920, fee_twd: 57, post_concentration_pct: 44, behavior_note: "1/8 類似情境你全賣後少賺 NT$312,924" },
        { key: "full", label: "照原計畫全部賣出", amount_twd: 143680, fee_twd: 230, post_concentration_pct: 0 },
        { key: "pause", label: "先不動，設 -10% 價格提醒", behavior_note: "不產生任何訂單；到價時提醒你回來看看。" },
      ],
      confirm: { confirm_token: "offline-demo", confirmation_card: { market: "ethtwd", side: "sell", volume_twd: 35920, ord_type: "market", price: null } },
    };
    if (/虧|賠|損/.test(text)) return {
      reply: "（離線展示）先分清楚兩件事：**真實虧損**是已實現損益（真金白銀的賺賠），**少賺**是機會成本。你 2025 年機會成本最痛的一筆：**1/8 以 14.2 賣出 DOGE 6,216 顆，年底價 64.54，少賺 NT$312,924**。",
      tool_trail: [{ seq: 1, tool: "query_user_history", summary: "查交易史（all）" }],
    };
    return {
      reply: "（離線展示）你去年 2,350 筆買入中有 **65%** 買在近 7 筆均價之上，最活躍的月份是 5 月。要我拆開看哪一段？",
      tool_trail: [{ seq: 1, tool: "query_user_history", summary: "查交易史（activity_profile）" }],
    };
  },
  trail: [
    { seq: 1, ts: null, type: "tool_call", payload: { tool: "get_account_balance", input_summary: "查持倉", status: "success" } },
    { seq: 2, ts: null, type: "tool_call", payload: { tool: "calculate_trade_scenarios", input_summary: "方案試算（ethtwd）", status: "success" } },
    { seq: 3, ts: null, type: "draft_created", payload: { market: "ethtwd", side: "sell", volume_twd: 35920 } },
    { seq: 4, ts: null, type: "user_confirmed", payload: { market: "ethtwd" } },
    { seq: 5, ts: null, type: "executed", payload: { exchange_order_id: "demo" } },
  ],
};

function offline() { document.getElementById("offline").style.display = "inline"; }

// 麥麥情緒：成交切 BULLISH（happy＋全綠 K 線），六秒後回常態
let _moodTimer = null;
function maiMood(state) {
  const img = document.querySelector(".topbar .logo img");
  if (!img) return;
  img.src = state === "bullish" ? "maimate_bot_small_bullish.png" : "maimate_bot_small.png";
  clearTimeout(_moodTimer);
  if (state === "bullish") _moodTimer = setTimeout(() => maiMood("idle"), 6000);
}

// ---------- 健檢面板（2×2 卡＋麥麥 insight，照 mockup screen1） ----------
function renderHealth(r) {
  const missedWan = Math.round(r.opportunity_cost.total_missed_twd / 1e4);
  document.getElementById("health").innerHTML = [
    { n: r.chase_index.buy_above_ma_pct + "%", l: "追高指數<br>買在近7筆均價上方", c: "var(--red)" },
    { n: fmt(missedWan) + "萬", l: "年度賣出機會成本（少賺）<br>（NT$）", c: "var(--gold)" },
    { n: r.concentration.peak_concentration.top_pct + "%", l: `峰值持倉集中度<br>（${r.concentration.peak_concentration.month}）`, c: "var(--navy)" },
    { n: r.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct + "%", l: "下跌後出金比例<br>習慣健康", c: "var(--green)" },
  ].map((c) => `<div class="card"><div class="n" style="color:${c.c}">${c.n}</div><div class="l">${c.l}</div></div>`).join("");
  document.getElementById("insights").innerHTML = `
    <div class="insight">你 ${fmt(r.chase_index.buy_total)} 筆買入中有 <b>${r.chase_index.buy_above_ma_pct}% 買在高點</b>——這是典型的 FOMO 模式，麥麥會在你追高前提醒你。</div>
    <div class="insight g">你的出金習慣很健康：${fmt(r.cash_flow_behavior.twd_withdrawal_count)} 筆提領只有 <b>${r.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct}%</b> 發生在下跌後——不是恐慌型。</div>`;
}

async function loadHealth() {
  try {
    const r = await (await fetch(`${API}/health`)).json();
    renderHealth(r);
  } catch { offline(); renderHealth(MOCK.health); }
}

// ---------- 行情面板 ----------
// 列一次建好、之後只就地改數字：刷新不清空、不閃爍；抓失敗保留上一次的值。
const tickEls = {}; // market -> 數值 <span>
function initMarket() {
  const el = document.getElementById("market");
  el.innerHTML = "";
  for (const m of MOCK.markets) {
    const name = m.replace("twd", "").toUpperCase() + "/TWD";
    el.insertAdjacentHTML("beforeend", `<div class="tick"><b>${name}</b><span class="v">—</span></div>`);
    tickEls[m] = el.lastElementChild.querySelector(".v");
  }
}

async function loadMarket() {
  const results = await Promise.allSettled(MOCK.markets.map(async (m) => {
    const r = await (await fetch(`${API}/market?market=${m}&kind=ticker`)).json();
    return { m, last: r.data?.last };
  }));
  let anyOk = false;
  for (const res of results) {
    if (res.status !== "fulfilled" || res.value.last == null) continue;
    anyOk = true;
    const el = tickEls[res.value.m];
    const prev = parseFloat(el.dataset.last);
    const cur = parseFloat(res.value.last);
    el.textContent = fmt(res.value.last);
    el.classList.remove("up", "down");
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && cur !== prev) el.classList.add(cur > prev ? "up" : "down");
    el.dataset.last = res.value.last;
  }
  if (!anyOk) offline();
}

// ---------- 對話 ----------
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// 模型回覆常帶 markdown；氣泡內只支援粗體與換行，其餘原樣顯示
function md(s) { return esc(s).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>"); }

const log = () => document.getElementById("chatlog");

function addMsg(cls, text) {
  log().insertAdjacentHTML("beforeend", `<div class="msg ${cls}">${md(text)}</div>`);
  scrollBottom();
}

function scrollBottom() { window.scrollTo(0, document.body.scrollHeight); }

// 工具鏈 chips（README §3 tool_trail，設計稿 screen2 上緣）
function addTrail(trail) {
  if (!trail?.length) return;
  const chips = trail.map((t) => `<span class="tool"><span class="ok">✓</span> ${esc(t.summary || t.tool)}</span>`).join("");
  log().insertAdjacentHTML("beforeend", `<div class="tools">${chips}</div>`);
}

// 三方案卡（README §3 scenarios，設計稿 screen2）
const SCEN_META = { partial: ["🛡️", "麥麥陪跑建議看看"], full: ["📤", "你的原意圖"], pause: ["⏸️", "冷靜期"] };
function addScenarios(list) {
  if (!list?.length) return;
  const html = list.map((s, i) => {
    const [icon, tag] = SCEN_META[s.key] || ["💡", "選項 " + (i + 1)];
    const rows = [
      s.amount_twd != null ? `<div>預估金額<b>NT$${fmt(s.amount_twd)}</b></div>` : "<div>動作<b>不產生訂單</b></div>",
      s.fee_twd != null ? `<div>手續費<b>NT$${fmt(s.fee_twd)}</b></div>` : "",
      s.post_concentration_pct != null ? `<div>執行後佔比<b>${s.post_concentration_pct}%</b></div>` : "",
    ].join("");
    const note = s.behavior_note ? `<div class="note">${esc(s.behavior_note)}</div>` : "";
    return `<div class="scen${i === 0 ? " pick" : ""}"><div class="t">${icon} ${esc(s.label)}<span class="tag">${tag}</span></div><div class="row">${rows}</div>${note}</div>`;
  }).join("");
  log().insertAdjacentHTML("beforeend", html);
  scrollBottom();
}

// 決策軌跡面板（設計稿 screen3；GET /audit 契約）——成交後自動展開
function renderTrail(trail) {
  if (!trail?.length) return;
  const steps = trail.map((e) => {
    const t = e.ts ? new Date(e.ts * 1000).toTimeString().slice(0, 5) : "--:--";
    const hl = e.type !== "tool_call" ? " hl" : "";
    const tag = e.type === "tool_call" ? e.payload.tool : e.type;
    const note = e.type === "tool_call" ? (e.payload.input_summary || "")
      : [e.payload.market, e.payload.side, e.payload.volume_twd != null ? "NT$" + fmt(e.payload.volume_twd) : "",
         e.payload.exchange_order_id ? "#" + e.payload.exchange_order_id : ""].filter(Boolean).join(" ");
    return `<div class="step${hl}"><i>${t}</i><em>${esc(tag)}</em> ${esc(note)}</div>`;
  }).join("");
  log().insertAdjacentHTML("beforeend", `
    <div class="trail"><div class="h">🔍 決策軌跡（本次對話）<span>已寫入稽核紀錄</span></div>${steps}</div>`);
  scrollBottom();
}

async function showTrail() {
  try {
    const r = await (await fetch(`${API}/audit?session_id=${SESSION_ID}`)).json();
    renderTrail(r.trail);
  } catch { /* 軌跡載入失敗不影響主流程 */ }
}

// 下單確認卡（設計稿 screen3：表格＋滑價警語＋大按鈕）
function addConfirmCard(card, token) {
  const id = "c" + Date.now();
  log().insertAdjacentHTML("beforeend", `
    <div class="confirm" id="${id}">
      <div class="h">📋 下單確認 — 最後一步由你決定</div>
      <table>
        <tr><td>動作</td><td>${card.side === "buy" ? "買入" : "賣出"} ${esc(card.market).toUpperCase()}（${card.ord_type === "market" ? "市價" : "限價 NT$" + fmt(card.price)}）</td></tr>
        <tr><td>預估金額</td><td>NT$${fmt(card.volume_twd)}</td></tr>
        <tr><td>確認時效</td><td>60 秒內有效</td></tr>
      </table>
      <div class="warn">⚠ 以當下價格估算，實際成交可能有滑價。麥麥不會替你按下這顆按鈕。</div>
      <div class="btns"><button class="ok">確認${card.side === "buy" ? "買入" : "賣出"}</button><button class="no">取消</button></div>
    </div>`);
  const el = document.getElementById(id);
  el.querySelector(".ok").onclick = async () => {
    if (token === "offline-demo") { // 離線劇本：不打 API，示意完成整條 Golden Path
      log().insertAdjacentHTML("beforeend", `<div class="done">✅（離線展示）訂單流程示意完成 — 真實環境將經 60 秒憑證驗證與 MAX Private API 成交</div>`);
      maiMood("bullish");
      renderTrail(MOCK.trail);
      el.remove();
      return;
    }
    try {
      const r = await (await fetch(`${API}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_token: token, session_id: SESSION_ID }) })).json();
      if (r.ok) {
        const oid = r.exchange_response?.id || r.order?.id || "";
        log().insertAdjacentHTML("beforeend", `<div class="done">✅ 已成交${oid ? `（單號 #${esc(oid)}）` : ""} — 健檢與持倉已更新</div>`);
        maiMood("bullish"); // 麥麥切 BULLISH 六秒
        loadHealth();
        showTrail(); // Golden Path 收尾：秀決策軌跡
      } else addMsg("ai", `⚠️ ${r.message || "下單未成功"}`);
    } catch { addMsg("ai", "⚠️ 送單失敗，請再試一次。"); }
    el.remove();
    scrollBottom();
  };
  el.querySelector(".no").onclick = () => { addMsg("ai", "已取消，沒有送出任何訂單。"); el.remove(); };
  scrollBottom();
}

document.getElementById("chatform").onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById("q");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMsg("user", text);
  messages.push({ role: "user", content: [{ text }] });
  try {
    const body = { messages, session_id: SESSION_ID };
    if (modeOverride) body.mode = modeOverride;
    const r = await (await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    messages = r.messages;
    if (r.mode) setBadge(r.mode, !!modeOverride);
    addTrail(r.tool_trail);
    addMsg("ai", r.reply);
    addScenarios(r.scenarios);
    if (r.confirm) addConfirmCard(r.confirm.confirmation_card, r.confirm.confirm_token);
  } catch { // 離線劇本接手：依意圖回展示回應，Golden Path 全鏈路照走
    offline();
    const m = MOCK.chat(text);
    addTrail(m.tool_trail);
    addMsg("ai", m.reply);
    addScenarios(m.scenarios);
    if (m.confirm) addConfirmCard(m.confirm.confirmation_card, m.confirm.confirm_token);
  }
};

loadHealth();
initMarket();
loadMarket();
setInterval(loadMarket, 10000);
