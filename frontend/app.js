/* MaiMate 前端（無建置步驟的靜態 SPA，S3 直接託管）
 * 視覺依 docs/mockups 三畫面；API 失敗自動切離線 mock（tech.md 的完成度保險）。
 * 金額顯示鐵則：一律千分位逗號（fmt）。 */
const API = window.API_BASE || "/api";
let messages = []; // Converse 格式對話歷史

// 千分位格式化：fmt(2091464.5) → "2,091,464.5"；小數照原值保留（最多 maxDec 位）
function fmt(n, maxDec = 4) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US", { maximumFractionDigits: maxDec }) : String(n);
}

// ---------- 離線備援資料 ----------
const MOCK = {
  health: {
    chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
    opportunity_cost: { total_missed_twd: 26598877 },
    concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12" } },
    cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
  },
  markets: ["btctwd", "ethtwd", "soltwd", "dogetwd"],
  reply: "（離線展示）你去年 2,350 筆買入中有 **65%** 買在近 7 筆均價之上，最活躍的月份是 5 月。要我拆開看哪一段？",
};

function offline() { document.getElementById("offline").style.display = "inline"; }

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
    try {
      const r = await (await fetch(`${API}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_token: token }) })).json();
      if (r.ok) {
        const oid = r.exchange_response?.id || r.order?.id || "";
        log().insertAdjacentHTML("beforeend", `<div class="done">✅ 已成交${oid ? `（單號 #${esc(oid)}）` : ""} — 健檢與持倉已更新</div>`);
        loadHealth();
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
    const r = await (await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) })).json();
    messages = r.messages;
    addTrail(r.tool_trail);
    addMsg("ai", r.reply);
    addScenarios(r.scenarios);
    if (r.confirm) addConfirmCard(r.confirm.confirmation_card, r.confirm.confirm_token);
  } catch { offline(); addMsg("ai", MOCK.reply); }
};

loadHealth();
initMarket();
loadMarket();
setInterval(loadMarket, 10000);
