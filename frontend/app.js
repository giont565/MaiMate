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
function cycleMode() {
  modeOverride = MODE_ORDER[(MODE_ORDER.indexOf(modeOverride || currentMode) + 1) % MODE_ORDER.length];
  setBadge(modeOverride, true);
}
const _badge = document.getElementById("mode-badge");
_badge.onclick = cycleMode;
// 鍵盤可及（a11y）：Enter／Space 等同點擊
_badge.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleMode(); } };

// 千分位格式化：fmt(2091464.5) → "2,091,464.5"；小數照原值保留（最多 maxDec 位）
function fmt(n, maxDec = 4) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US", { maximumFractionDigits: maxDec }) : "—";
}

// ---------- 離線備援資料（決賽保險：任一步掛掉→mock 接手走完 Golden Path） ----------
const MOCK = {
  health: {
    chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
    opportunity_cost: { total_missed_twd: 26598877 },
    realized_pnl: { total_realized_twd: 117482, loss_trades: 493, profit_trades: 981 },
    concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12", top_currency: "twd" } },
    cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
  },
  markets: ["btctwd", "ethtwd", "soltwd", "dogetwd"],
  // 離線對話劇本：依輸入意圖回對應的展示回應（數字皆來自真實 health_report）
  // 全賣意圖的開場白隨模式切換（DEMO_SCRIPT 三模式加拍的離線備援）——
  // 三方案數字不變（程式算的），只變說法，對應「LLM 只負責把方案講成人話」的職責分離
  chat(text) {
    const mode = modeOverride || currentMode || "growth";
    // 方案卡可點之後，卡片標題會被當成訊息送進來，所以選方案要先攔下來。
    // 少了這兩段的話：「先賣 25%…」「照原計畫全部賣出」會命中下面的 /賣/ 再跑一次三方案
    // （點了等於原地繞圈），「先不動，設 -10% 價格提醒」則什麼都沒命中、掉到最後的預設
    // 回覆（答非所問）。離線劇本是 Demo 的保命符，這條路徑不能斷。
    if (/先不動|價格提醒|冷靜/.test(text)) return {
      reply: "（離線展示）好，這個選項**不會產生任何訂單**。我幫你記下 −10% 的提醒價，到價時再通知你回來看看。在那之前，你的持倉維持不變。",
      tool_trail: [{ seq: 1, tool: "calculate_trade_scenarios", summary: "方案試算（ethtwd）" }],
    };
    const pick = /先賣\s*25%|留\s*75%/.test(text) ? { label: "先賣 25%、留 75% 觀察", amount: 35920 }
      : /全部賣出|照原計畫/.test(text) ? { label: "照原計畫全部賣出", amount: 143680 } : null;
    if (pick) return {
      reply: `（離線展示）好，${pick.label}。確認卡片已產生，**60 秒內有效**——要你自己按下確認才會送出訂單，麥麥不會替你按。`,
      tool_trail: [{ seq: 1, tool: "prepare_order", summary: "擬定訂單草稿（ethtwd）" }],
      confirm: { confirm_token: "offline-demo",
                 confirmation_card: { market: "ethtwd", side: "sell", volume_twd: pick.amount, ord_type: "market", price: null } },
    };
    if (/全賣|賣掉|賣出|全部賣/.test(text)) return {
      reply: {
        cautious: "（離線展示）別急，麥麥陪你。你想把 ETH 都賣掉——它現在佔你資產的 **54%**。想先跟你說一件事：**今年 1/8 大跌那天你也這樣全賣過**，到年底少賺了 **NT$312,924**（三十多萬）。賣或不賣都可以，我們先看三個都算好數字的選項，挑最安心的那個：",
        growth: "（離線展示）我理解你想賣，先陪你看 30 秒再決定。ETH 現在佔你持倉 **54%**——要提醒你：**今年 1/8 急跌時你也全賣過**，那一次到年末少賺了 **NT$312,924**。這不是說你不能賣，是給你三個都算好數字的選項：",
        pro: "（離線展示）ETH 持倉佔比 **54%**。歷史對照：**2025-01-08** 同型態恐慌全賣，機會成本 **NT$312,924**。三方案試算如下（金額／手續費／賣後集中度），選定後出確認卡：",
      }[mode],
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
    // RAG 防詐意圖（DEMO_SCRIPT RAG 加拍的離線備援）：教育性回覆＋出處，形狀對齊 query_knowledge
    if (/騙|話術|保證獲利|穩賺/.test(text)) return {
      reply: "（離線展示）幫你對照防詐語料的常見特徵：**「保證獲利」「穩賺不賠」「老師帶單」「急著拉你進群」**都是高風險紅旗——合法投資不會保證報酬。建議三不：不點陌生連結、不轉帳到個人帳戶、不下載來路不明 App；用官方管道自行查證。\n\n📚 出處：165 全民防騙網「假投資詐騙」宣導、金管會投資人保護專區",
      tool_trail: [{ seq: 1, tool: "query_knowledge", summary: "防詐語料檢索" }],
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

// ---------- 麥麥健康分 hero 卡（設計稿 screen1）----------
// 分數＝真實子項的透明加權（追高控制/勝率/出金紀律），公式印在卡上；
// 缺哪個子項就把它的權重攤到其餘，數字全部指得出 health_report 來源，無憑空編造。
function renderHero(r) {
  const el = document.getElementById("hero");
  if (!el) return;
  const rp = r.realized_pnl;
  const winRate = rp && rp.profit_trades + rp.loss_trades > 0
    ? (rp.profit_trades / (rp.profit_trades + rp.loss_trades)) * 100 : null;
  const factors = [
    { k: "追高控制", v: 100 - r.chase_index.buy_above_ma_pct, w: 0.4 },
    ...(winRate != null ? [{ k: "勝率", v: winRate, w: 0.3 }] : []),
    { k: "出金紀律", v: 100 - r.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct, w: 0.3 },
  ];
  const wsum = factors.reduce((a, f) => a + f.w, 0);
  const score = Math.round(factors.reduce((a, f) => a + f.v * f.w, 0) / wsum);
  const worst = factors.reduce((a, f) => (f.v < a.v ? f : a));
  const pnl = rp ? rp.total_realized_twd : null;
  const pnlLine = rp
    ? `2025 已實現損益 <span class="${pnl >= 0 ? "pos" : "neg"}">${pnl >= 0 ? "+" : "−"}NT$${fmt(Math.abs(pnl))}</span>`
      + (winRate != null ? ` · 勝率 <b>${winRate.toFixed(1)}%</b>（${fmt(rp.profit_trades)}勝/${fmt(rp.loss_trades)}負）` : "")
    : "";
  const formula = "＝" + factors.map((f) => `${f.k}${Math.round(f.w / wsum * 100)}%`).join("＋") + "，皆依你 2025 真實紀錄";
  el.innerHTML = `
    <div class="ring" style="background:conic-gradient(var(--gold) 0 ${score}%, #E8EDF7 ${score}% 100%)">
      <i><b>${score}</b><s>健康分</s></i>
    </div>
    <div class="htxt">
      <div class="n">投資健康分</div>
      <div class="l">${esc(worst.k)}扣最多分，最該練；其餘大致健康。</div>
      ${pnlLine ? `<div class="pnl">${pnlLine}</div>` : ""}
      <div class="formula">${esc(formula)}</div>
    </div>`;
}

// ---------- 健檢面板（2×2 卡＋麥麥 insight，照 mockup screen1） ----------
function renderHealth(r) {
  renderHero(r);
  // 後端若回傳非數字字串，一律先轉數字／esc，避免注入 DOM（見 smoke_frontend 的 XSS 邊界斷言）
  const chasePct = Number(r.chase_index.buy_above_ma_pct);
  const missedValue = Number(r.opportunity_cost.total_missed_twd);
  const topPct = Number(r.concentration.peak_concentration.top_pct);
  const withdrawalPct = Number(r.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct);
  const missedWan = Number.isFinite(missedValue) ? Math.round(missedValue / 1e4) : NaN;
  // 集中度卡：top_currency=twd 代表「資金多在現金」（保守，非風險）。明確標幣別，
  // 免得評審把 98.6% 誤讀成危險的加密資產過度集中（實際意思相反）。
  const pc = r.concentration.peak_concentration;
  const month = esc(String(pc.month || "").slice(0, 20));
  const isCash = String(pc.top_currency || "").toLowerCase() === "twd";
  const concLabel = isCash
    ? `峰值現金佔比（TWD）<br>（${month}，資金多在觀望）`
    : `峰值持倉集中度 ${esc(String(pc.top_currency || "").toUpperCase().slice(0, 10))}<br>（${month}）`;
  document.getElementById("health").innerHTML = [
    { n: fmt(chasePct) + "%", l: "追高指數<br>買在近7筆均價上方", c: "var(--red)" },
    { n: fmt(missedWan) + "萬", l: "年度賣出機會成本（少賺）<br>（NT$）", c: "var(--gold)" },
    { n: fmt(topPct) + "%", l: concLabel, c: "var(--navy)" },
    { n: fmt(withdrawalPct) + "%", l: "下跌後出金比例<br>習慣健康", c: "var(--green)" },
  ].map((c) => `<div class="card"><div class="n" style="color:${c.c}">${c.n}</div><div class="l">${c.l}</div></div>`).join("");
  document.getElementById("insights").innerHTML = `
    <div class="insight">你 ${fmt(r.chase_index.buy_total)} 筆買入中有 <b>${fmt(chasePct)}% 買在高點</b>——這是典型的 FOMO 模式，麥麥會在你追高前提醒你。</div>
    <div class="insight g">你的出金習慣很健康：${fmt(r.cash_flow_behavior.twd_withdrawal_count)} 筆提領只有 <b>${fmt(withdrawalPct)}%</b> 發生在下跌後——不是恐慌型。</div>`;
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
    // 每列是 <button>：鍵盤可達、有 aria-expanded；K 線面板同層綁在下面，
    // 展開不影響上方數值節點，行情輪詢照樣就地更新不重建。
    el.insertAdjacentHTML("beforeend",
      `<div class="mrow" data-m="${esc(m)}">
         <button type="button" class="tick" aria-expanded="false">
           <b>${esc(name)}</b>
           <span class="rt"><span class="v">—</span><span class="caret" aria-hidden="true">▼</span></span>
         </button>
         <div class="kl"></div>
       </div>`);
    tickEls[m] = el.lastElementChild.querySelector(".v");
  }
  el.addEventListener("click", onTickClick);
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

// ---------- K 線（#18 的 kline 契約，前端消費端） ----------
// 一次只展開一列：手機上同時開四張圖要一直捲，而且四路輪詢沒有意義。
const KL = window.MM_KLINE_CORE;
const klState = {}; // market -> 目前選的 period

function onTickClick(e) {
  const btn = e.target.closest(".tick");
  if (!btn) return;
  const row = btn.closest(".mrow");
  if (!row) return;
  const opening = !row.classList.contains("open");
  for (const other of document.querySelectorAll("#market .mrow.open")) {
    other.classList.remove("open");
    other.querySelector(".tick").setAttribute("aria-expanded", "false");
  }
  if (!opening) return;
  row.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  const m = row.dataset.m;
  loadKline(m, klState[m] || KL.DEFAULT_PERIOD);
}

function klBox(m) {
  const row = document.querySelector(`#market .mrow[data-m="${CSS.escape(m)}"]`);
  return row ? row.querySelector(".kl") : null;
}

function klChips(m, period) {
  return `<div class="pd" role="group" aria-label="K 線週期">` +
    KL.PERIODS.map((p) =>
      `<button type="button" data-p="${p.minutes}" aria-pressed="${p.minutes === period}">${esc(p.label)}</button>`
    ).join("") + `</div>`;
}

async function loadKline(m, period) {
  klState[m] = period;
  const box = klBox(m);
  if (!box) return;
  box.innerHTML = klChips(m, period) + `<div class="na ld">載入中…</div>`;
  bindKlChips(box, m);
  let parsed;
  try {
    const r = await (await fetch(`${API}/market?market=${m}&kind=kline&period=${period}`)).json();
    parsed = KL.parse(r);
  } catch {
    parsed = { ok: false, reason: "FETCH_FAILED" };
  }
  // 離線／壞資料一律明說，不畫假 K 線——與行情「維持舊值、不假造」是同一條原則
  if (!parsed.ok) {
    offline();
    box.innerHTML = klChips(m, period) + `<div class="na">目前取不到 K 線資料</div>`;
    bindKlChips(box, m);
    return;
  }
  box.innerHTML = klChips(m, period) + renderKline(parsed);
  bindKlChips(box, m);
}

function bindKlChips(box, m) {
  for (const b of box.querySelectorAll(".pd button")) {
    b.addEventListener("click", () => loadKline(m, Number(b.dataset.p)));
  }
}

function renderKline(parsed) {
  const s = KL.summarize(parsed.bars);
  const W = 320, H = 118;
  const g = KL.geometry(parsed.bars, W, H);
  if (!g.ok) return `<div class="na">資料不足，無法繪製</div>`;
  const dir = s.up === null ? "" : s.up ? " up" : " down";
  const body = g.candles.map((c) => {
    const col = c.up ? "var(--green)" : "var(--red)";
    return `<line x1="${c.cx.toFixed(2)}" y1="${c.wickTop.toFixed(2)}" x2="${c.cx.toFixed(2)}" y2="${c.wickBottom.toFixed(2)}" stroke="${col}" stroke-width="1"/>` +
      `<rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" fill="${col}"/>`;
  }).join("");
  return `<div class="sm">
      <span>${esc(KL.periodLabel(parsed.periodMinutes))}・${s.count} 根</span>
      <span class="ch${dir}">${esc(KL.fmtPct(s.changePct))}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${esc(KL.periodLabel(parsed.periodMinutes))} K 線，期間漲跌 ${esc(KL.fmtPct(s.changePct))}">${body}</svg>
    <div class="ax"><span>${esc(KL.fmtTime(s.from))}</span>
      <span>高 ${esc(KL.fmtPrice(s.high))}・低 ${esc(KL.fmtPrice(s.low))}</span>
      <span>${esc(KL.fmtTime(s.to))}</span></div>`;
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
      s.post_concentration_pct != null ? `<div>執行後佔比<b>${fmt(s.post_concentration_pct)}%</b></div>` : "",
    ].join("");
    const note = s.behavior_note ? `<div class="note">${esc(s.behavior_note)}</div>` : "";
    return `<div class="scen${i === 0 ? " pick" : ""}" role="button" tabindex="0" data-label="${esc(s.label)}"><div class="t">${icon} ${esc(s.label)}<span class="tag">${tag}</span></div><div class="row">${rows}</div>${note}<div class="hint">點這張卡片選它 →</div></div>`;
  }).join("");
  log().insertAdjacentHTML("beforeend", html);
  // 卡片本身就是選項，使用者（與評審）第一直覺是直接點它。原本 pick 只有樣式沒有行為，
  // 點下去毫無反應。這裡把點擊接回聊天送出，沿用同一條路徑（含離線劇本 fallback）。
  log().querySelectorAll(".scen[data-label]:not([data-wired])").forEach((card) => {
    card.dataset.wired = "1";
    const choose = () => {
      const input = document.getElementById("q");
      input.value = card.dataset.label;
      document.getElementById("chatform").requestSubmit();
    };
    card.onclick = choose;
    card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } };
  });
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

// 確認卡手續費：取自對應方案已算好的 fee_twd（真值，README §3 方案含手續費），以 volume_twd 對應；
// 對不到就回 null（不前端估算、不編數字）。
function feeForConfirm(card, scenarios) {
  if (!Array.isArray(scenarios)) return null;
  const s = scenarios.find((x) => x.amount_twd != null && x.amount_twd === card.volume_twd);
  return s && s.fee_twd != null ? s.fee_twd : null;
}

// 下單確認卡（設計稿 screen3：表格＋滑價警語＋大按鈕）
// fee＝對應方案的真實 fee_twd（feeForConfirm 帶入）；數量照契約——市價單無價，標「依成交價定」，
// 限價單才由 volume_twd/price 算（price 為契約內真值）。皆不憑空編數字。
function addConfirmCard(card, token, fee) {
  const id = "c" + Date.now();
  const coin = String(card.market).replace(/twd$/i, "").toUpperCase();
  const qtyCell = card.ord_type === "market"
    ? "市價，數量依成交價定"
    : (card.price ? `${fmt(card.volume_twd / card.price, 6)} ${esc(coin)}` : "—");
  log().insertAdjacentHTML("beforeend", `
    <div class="confirm" id="${id}">
      <div class="h">📋 下單確認 — 最後一步由你決定</div>
      <table>
        <tr><td>動作</td><td>${card.side === "buy" ? "買入" : "賣出"} ${esc(String(card.market || "").toUpperCase())}（${card.ord_type === "market" ? "市價" : "限價 NT$" + fmt(card.price)}）</td></tr>
        <tr><td>數量</td><td>${qtyCell}</td></tr>
        <tr><td>預估金額</td><td>NT$${fmt(card.volume_twd)}</td></tr>
        ${fee != null ? `<tr><td>預估手續費</td><td>NT$${fmt(fee)}</td></tr>` : ""}
        <tr><td>確認時效</td><td>60 秒內有效</td></tr>
      </table>
      <div class="warn">⚠ 以當下價格估算，實際成交可能有滑價。麥麥不會替你按下這顆按鈕。</div>
      <div class="btns"><button class="ok">確認${card.side === "buy" ? "買入" : "賣出"}</button><button class="no">取消</button></div>
    </div>`);
  const el = document.getElementById(id);
  el.querySelector(".ok").onclick = async () => {
    // 按下就鎖住。實測（07/31 真實成交 #20720919534）使用者 1.7 秒內連按三次，
    // 第一次成交、後兩次被後端 410 擋掉——重放保護有效，但畫面會在成交成功之後
    // 才跳出「確認憑證無效或已過期」的紅字，看起來像失敗。後端那道防線留著，
    // 前端這裡不要讓第二次點擊有機會送出。
    const ok = el.querySelector(".ok"), no = el.querySelector(".no");
    if (ok.disabled) return;
    ok.disabled = no.disabled = true;
    ok.textContent = "送出中…";
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
  el.querySelector(".no").onclick = () => {
    addMsg("ai", "已取消，沒有送出任何訂單。");
    el.remove();
    // 回報取消：留下軌跡證據並讓憑證即刻失效。網路失敗不影響「已取消」這個結果，
    // 憑證本來就會在 TTL 到期後自動作廢，所以這裡不打擾使用者。
    if (token !== "offline-demo") {
      fetch(`${API}/order`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_token: token, session_id: SESSION_ID, action: "cancel" }) }).catch(() => {});
    }
  };
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
    const navigationContext = window.MM_CHAT_CONTEXT && window.MM_CHAT_CONTEXT.takeRequestContext();
    if (navigationContext) body.navigation_context = navigationContext;
    const r = await (await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    messages = r.messages;
    if (r.mode) setBadge(r.mode, !!modeOverride);
    addTrail(r.tool_trail);
    addMsg("ai", r.reply);
    addScenarios(r.scenarios);
    if (r.confirm) addConfirmCard(r.confirm.confirmation_card, r.confirm.confirm_token, feeForConfirm(r.confirm.confirmation_card, r.scenarios));
  } catch { // 離線劇本接手：依意圖回展示回應，Golden Path 全鏈路照走
    offline();
    const m = MOCK.chat(text);
    addTrail(m.tool_trail);
    addMsg("ai", m.reply);
    addScenarios(m.scenarios);
    if (m.confirm) addConfirmCard(m.confirm.confirmation_card, m.confirm.confirm_token, feeForConfirm(m.confirm.confirmation_card, m.scenarios));
  }
};

loadHealth();
initMarket();
loadMarket();
setInterval(loadMarket, 10000);
