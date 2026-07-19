/* MaiMate 前端（無建置步驟的靜態 SPA，S3 直接託管）
 * API 失敗時自動切離線 mock（tech.md 的完成度保險）。 */
const API = window.API_BASE || "/api";
let messages = []; // Converse 格式對話歷史

// ---------- 離線備援資料 ----------
const MOCK = {
  health: [
    { n: "65%", l: "追高指數（買在均價上方）", c: "var(--red)" },
    { n: "NT$2,660萬", l: "年度賣出機會成本", c: "var(--navy)" },
    { n: "98.6%", l: "峰值持倉集中度（2025-12）", c: "var(--gold)" },
    { n: "14.2%", l: "下跌後出金比例——習慣健康", c: "var(--green)" },
  ],
  markets: ["btctwd", "ethtwd", "soltwd", "dogetwd"],
  reply: "（離線展示）你去年 2,350 筆買入中有 65% 買在近 7 筆均價之上，最活躍的月份是 5 月。要我拆開看哪一段？",
};

function offline() { document.getElementById("offline").style.display = "inline"; }

// ---------- 健檢面板 ----------
async function loadHealth() {
  const el = document.getElementById("health");
  try {
    const r = await (await fetch(`${API}/health`)).json();
    const cards = [
      { n: r.chase_index.buy_above_ma_pct + "%", l: "追高指數（買在均價上方）", c: "var(--red)" },
      { n: "NT$" + Math.round(r.opportunity_cost.total_missed_twd / 1e4) + "萬", l: "年度賣出機會成本", c: "var(--navy)" },
      { n: r.concentration.peak_concentration.top_pct + "%", l: `峰值持倉集中度（${r.concentration.peak_concentration.month}）`, c: "var(--gold)" },
      { n: r.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct + "%", l: "下跌後出金比例", c: "var(--green)" },
    ];
    render(cards);
  } catch { offline(); render(MOCK.health); }
  function render(cards) {
    el.innerHTML = cards.map(c => `<div class="stat"><div class="n" style="color:${c.c}">${c.n}</div><div class="l">${c.l}</div></div>`).join("");
  }
}

// ---------- 行情面板 ----------
async function loadMarket() {
  const el = document.getElementById("market");
  el.innerHTML = "";
  for (const m of MOCK.markets) {
    const name = m.replace("twd", "").toUpperCase() + "/TWD";
    try {
      const r = await (await fetch(`${API}/market?market=${m}&kind=ticker`)).json();
      const last = r.data?.last ?? "—";
      el.insertAdjacentHTML("beforeend", `<div class="tick"><b>${name}</b><span>${last}</span></div>`);
    } catch {
      offline();
      el.insertAdjacentHTML("beforeend", `<div class="tick"><b>${name}</b><span>—</span></div>`);
    }
  }
}

// ---------- 對話 ----------
function addMsg(cls, html) {
  const log = document.getElementById("chatlog");
  log.insertAdjacentHTML("beforeend", `<div class="msg ${cls}">${html}</div>`);
  log.scrollTop = log.scrollHeight;
}

function addConfirmCard(card, token) {
  const log = document.getElementById("chatlog");
  const id = "c" + Date.now();
  log.insertAdjacentHTML("beforeend", `
    <div class="confirm-card" id="${id}">
      <b>下單確認</b><br>${card.side === "buy" ? "買入" : "賣出"} ${card.market.toUpperCase()}／
      ${card.volume_twd} TWD／${card.ord_type === "market" ? "市價" : "限價 " + card.price}
      <br><button class="ok">確認</button><button class="no">取消</button>
    </div>`);
  const el = document.getElementById(id);
  el.querySelector(".ok").onclick = async () => {
    try {
      const r = await (await fetch(`${API}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_token: token }) })).json();
      addMsg("ai", r.ok ? "✅ 已成交。餘額與健檢已更新。" : `⚠️ ${r.message}`);
      loadHealth();
    } catch { addMsg("ai", "⚠️ 送單失敗，請再試一次。"); }
    el.remove();
  };
  el.querySelector(".no").onclick = () => { addMsg("ai", "已取消，沒有送出任何訂單。"); el.remove(); };
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
    addMsg("ai", r.reply);
    if (r.confirm) addConfirmCard(r.confirm.confirmation_card, r.confirm.confirm_token);
  } catch { offline(); addMsg("ai", MOCK.reply); }
};

loadHealth();
loadMarket();
setInterval(loadMarket, 10000);
