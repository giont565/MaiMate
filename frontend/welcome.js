/* Screen 1｜MaiMate 入口與功能說明
 * 架構：UI → EntryAdapter（fetch 真 API，失敗回退 mock）→ 渲染
 * 原則：Screen 1 不呼叫 AI、不取持倉/交易明細/健康分數；事件不記 token 與金融明細。
 * 未來替換：後端就緒後 EntryAdapter 內的 fetch 直接生效，MOCK 僅作離線保險（與 app.js 同模式）。
 */
"use strict";

/* ── 分析事件（僅事件名，禁止時間、token、持倉與明細）── */
function track(name) {
  try {
    const stored = JSON.parse(localStorage.getItem("mm_events") || "[]");
    const log = (Array.isArray(stored) ? stored : []).flatMap((item) => {
      if (!item || item.e == null || String(item.e).length === 0) return [];
      const clean = { e: String(item.e) };
      if (item.q != null && String(item.q).length > 0) clean.q = String(item.q);
      return [clean];
    });
    log.push({ e: String(name) });
    localStorage.setItem("mm_events", JSON.stringify(log.slice(-100)));
  } catch (_) {}
  console.log("[track]", name);
}

/* ── Mock Data（離線保險；正式 API 回傳同 schema 即可無縫替換）── */
const MOCK_ENTRY = {
  user: { id: "demo-user-001", displayName: "壹踢", accountStatus: "ACTIVE" },
  maimate: {
    eligible: true,
    onboardingStatus: "NOT_STARTED",
    nextStep: "CONSENT",
    nextRoute: "/maimate/consent",
    hasInvestmentData: true,
  },
  experience: { entryMode: "STANDARD", demoAvailable: true, estimatedSetupSeconds: 60 },
  featureFlags: { enableDemoMode: true, enableAnimatedAvatar: true },
  system: { status: "AVAILABLE", message: null },
};

const DEMO_PERSONAS = {
  BEGINNER_GUIDED: "安心入門型示範帳戶",
  STEADY_PLANNER: "穩健規劃型示範帳戶",
  ACTIVE_RESEARCHER: "主動研究型示範帳戶",
};

/* ── EntryAdapter：資料來源包在這層之後，UI 不直接碰 mock ── */
const EntryAdapter = {
  async getEntryContext() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${window.API_BASE}/api/v1/maimate/entry-context`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("bad status");
      return { ctx: await res.json(), offline: false };
    } catch (_) {
      return { ctx: MOCK_ENTRY, offline: true };
    }
  },
  async createDemoSession(personaId) {
    // Demo 階段：本地建立 session（正式版 POST /api/v1/maimate/demo-sessions）
    return {
      demoSessionId: "demo_session_local",
      persona: { id: personaId, displayName: DEMO_PERSONAS[personaId] || personaId },
      nextRoute: "home.html?demo=" + encodeURIComponent(personaId),
    };
  },
};

/* ── 入口狀態機：CTA 三態＋錯誤，由 onboardingStatus 推導（正式版由後端 nextStep 決定）── */
const STATES = ["READY_NEW_USER", "READY_RESUME", "READY_COMPLETED", "ERROR"];
const CTA_TEXT = {
  READY_NEW_USER: "開始和麥麥認識彼此",
  READY_RESUME: "繼續和麥麥認識彼此",
  READY_COMPLETED: "進入我的 MaiMate",
  ERROR: "重新載入",
};
const BADGE_TEXT = { READY_NEW_USER: "第一次見面", READY_RESUME: "設定到一半", READY_COMPLETED: "歡迎回來", ERROR: "連線異常" };

let entryState = "READY_NEW_USER";
let entryCtx = MOCK_ENTRY;

function stateFromStatus(s) {
  if (s === "COMPLETED") return "READY_COMPLETED";
  if (s === "NOT_STARTED") return "READY_NEW_USER";
  return "READY_RESUME"; // CONSENT_PENDING / QUESTIONNAIRE_PENDING / ANALYZING / PROFILE_READY
}

function renderCTA() {
  const btn = document.getElementById("btn-cta");
  const hint = document.getElementById("cta-hint");
  btn.disabled = false;
  btn.textContent = CTA_TEXT[entryState];
  btn.classList.toggle("err", entryState === "ERROR");
  hint.textContent =
    entryState === "ERROR" ? "MaiMate 暫時無法確認你的設定狀態。"
    : entryState === "READY_NEW_USER" ? "約 1 分鐘，讓麥麥更了解你" : "";
  document.getElementById("state-badge").textContent = BADGE_TEXT[entryState];
}

/* ── 靜態內容：三價值卡＋三步流程（同一 reusable 樣式，資料驅動）── */
const VALUE_CARDS = [
  { t: "看見自己的投資節奏", d: "從每一次買入、持有與調整中，整理出屬於你的投資習慣，陪你看見自己是怎麼走到今天的。" },
  { t: "留下真正與你有關的市場資訊", d: "市場每天都有很多聲音，麥麥會陪你整理重點，告訴你哪些變化與你的持倉和目標更有關。" },
  { t: "在需要時，提醒你停下來看看", d: "當投資步調和原本的目標漸漸不同，麥麥會溫柔提醒你，一起重新確認現在的選擇是否仍適合自己。" },
];
const STEPS = [
  { t: "讓麥麥認識你的投資歷程", d: "由你決定是否分享持倉與交易紀錄，讓麥麥從真實的投資經驗開始認識你。" },
  { t: "一起整理你的投資樣貌", d: "透過幾個簡單問題，了解你在意的目標、習慣與期待，整理出目前最接近你的投資樣貌。" },
  { t: "開始專屬於你的陪伴", d: "每次回來，麥麥都會為你整理最新變化、投資健康狀態，以及值得留意的下一步。" },
];

/* C 版把價值卡/步驟卡收進對話證據卡與進度線；容器存在才渲染（A/B 版仍用） */
const _vc = document.getElementById("value-cards");
if (_vc) _vc.innerHTML = VALUE_CARDS.map(c =>
  `<div class="vcard"><span class="mark" aria-hidden="true"></span><div class="vbody"><div class="t">${c.t}</div><div class="d">${c.d}</div></div></div>`
).join("");
const _st = document.getElementById("steps");
if (_st) _st.innerHTML = STEPS.map((s, i) =>
  `<div class="pstep"><div class="dot">${i + 1}</div><div><div class="t">${s.t}</div><div class="d">${s.d}</div></div></div>`
).join("");

/* 對話證據卡（C 版）：兩顆回覆膠囊——「好」走主流程、「先不用」收到麥麥一句溫和回應 */
const _py = document.getElementById("pill-yes"), _pn = document.getElementById("pill-no");
if (_py) _py.onclick = () => { track("maimate_demo_bubble_yes"); location.href = "onboarding.html#/consent"; };
if (_pn) _pn.onclick = () => {
  track("maimate_demo_bubble_no");
  const r = document.getElementById("bubble-reply");
  if (r) { r.textContent = "好的，需要我的時候我都在。"; r.style.display = "block"; }
  _py.parentElement.style.display = "none";
};

/* ── Bottom Sheet 開關（Help／法律共用）── */
function openSheet(id) { document.getElementById(id).classList.add("sheet-open"); }
function closeSheet(id) { document.getElementById(id).classList.remove("sheet-open"); }
document.querySelectorAll("[data-close]").forEach(el => {
  el.addEventListener("click", () => closeSheet(el.getAttribute("data-close") + "-root"));
});
document.getElementById("btn-help").onclick = () => { track("maimate_help_opened"); openSheet("help-root"); };
document.querySelectorAll("[data-legal]").forEach(el => {
  el.addEventListener("click", () => {
    track("maimate_privacy_opened");
    document.getElementById("legal-title").textContent = el.getAttribute("data-legal");
    openSheet("legal-root");
  });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeSheet("help-root"); closeSheet("legal-root"); }
});

/* ── CTA／Demo 導向 ── */
/* 新用戶/續接 → 資料授權頁（onboarding.html Screen 2）；已完成 onboarding → 直接進首頁 */
document.getElementById("btn-cta").onclick = async () => {
  if (entryState === "ERROR") { track("maimate_entry_reload_clicked"); return init(); }
  track("maimate_primary_cta_clicked");
  location.href = entryState === "READY_COMPLETED" ? "home.html?src=welcome" : "onboarding.html#/consent";
};
document.getElementById("btn-demo").onclick = async () => {
  track("maimate_demo_cta_clicked");
  const s = await EntryAdapter.createDemoSession("STEADY_PLANNER");
  location.href = s.nextRoute;
};
document.getElementById("btn-back").onclick = () => history.back();

/* ── Demo 用狀態切換（評審展示三態；與 index.html 模式徽章同手法）── */
function cycleState() {
  entryState = STATES[(STATES.indexOf(entryState) + 1) % STATES.length];
  renderCTA();
}
const _sb = document.getElementById("state-badge");
_sb.onclick = cycleState;
_sb.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleState(); } };

/* ── 入口動畫 splash：assets/intro.mp4 存在才播（缺檔→error→直接進頁）── */
(function initSplash() {
  if (sessionStorage.getItem("mm_intro_seen")) return;
  const splash = document.getElementById("splash");
  const v = document.getElementById("intro-video");
  const done = () => { splash.classList.remove("on"); sessionStorage.setItem("mm_intro_seen", "1"); };
  v.addEventListener("error", done, { once: true });
  v.addEventListener("ended", done, { once: true });
  v.addEventListener("canplay", () => { splash.classList.add("on"); v.play().catch(done); }, { once: true });
  document.getElementById("skip-intro").onclick = done;
  v.src = "assets/intro.mp4";
})();

/* ── 初始化 ── */
async function init() {
  const btn = document.getElementById("btn-cta");
  btn.disabled = true; btn.textContent = "載入中…"; btn.classList.remove("err");
  const { ctx, offline } = await EntryAdapter.getEntryContext();
  entryCtx = ctx;
  if (!ctx || !ctx.maimate || !ctx.maimate.eligible) {
    entryState = "ERROR";
    track("maimate_entry_load_failed");
  } else {
    entryState = stateFromStatus(ctx.maimate.onboardingStatus);
  }
  if (offline) console.log("[entry] 後端未回應，使用離線 mock");
  renderCTA();
  track("maimate_entry_viewed");
}
init();
