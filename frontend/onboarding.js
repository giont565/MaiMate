/* Screen 2＋3｜資料授權（#/consent）＋補充問卷（#/profile）
 * 架構：UI → Service（Mock*Service，正式版換 MaiCoin 內部 API／MAX Private API 實作）→ OnboardingStore
 * 原則：
 *   - OnboardingStore 是唯一碰 localStorage 的地方，頁面不直接讀寫
 *   - 問卷結果只調整語氣/深度/排序，不做投資人格或能力評分
 *   - 事件只記事件名＋questionId，不記答案內容、持倉、金額
 *   - Screen 2/3 不提前顯示分析結果（分析屬 Screen 4/5）
 * 共用 Store、事件與 JSDoc 型別位於 onboarding-core.js。
 */
"use strict";

const MOCK = window.MM_ONBOARDING_MOCK;
/** @type {DataScope[]} */ const REQUIRED_SCOPES = ["portfolio", "transactions"];
/** @type {DataScope[]} */ const OPTIONAL_SCOPES = ["fundingHistory", "interactionPersonalization"];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clearedAnalysisState = () => ({
  analysisJob: undefined,
  profileResult: undefined,
  profileFeedback: undefined,
  overallFeedback: undefined,
  effectiveProfile: undefined,
  profileConfirmationReminder: undefined,
});

/* Demo 展示用連線情境（右上徽章切換；fail 時 Mock 授權/儲存會失敗，供評審看錯誤流程） */
let netMode = "ok";

/* ── AccountAuthorizationService（Mock 實作）──
 * TODO(正式 API)：替換為 MaiCoinInternalAuthorizationService / MaxPrivateApiAuthorizationService
 *   GET  /api/onboarding/status、POST /api/onboarding/consent、POST /api/onboarding/demo-session
 *   （或依 Screen 1 慣例掛在 /api/v1/maimate/ 下，等後端定案）
 * 介面不變、UI 不知道 mock 或真 API。整合於 MaiCoin/MAX App 內，永不要求使用者輸入 API Key/Secret/密碼/私鑰。 */
const AccountAuthorizationService = {
  /** @param {DataScope[]} scopes @returns {Promise<ConsentRecord>} */
  async authorize(scopes) {
    await delay(800); // 規格：Mock 等待約 600–1000ms
    if (netMode === "fail") throw new Error("MOCK_AUTH_FAILED");
    return {
      consentVersion: MOCK.consentVersion,
      requiredScopes: REQUIRED_SCOPES.slice(),
      optionalScopes: scopes.filter((s) => OPTIONAL_SCOPES.includes(s)),
      grantedScopes: scopes.slice(),
      source: "internal",
      grantedAt: new Date().toISOString(),
    };
  },
  /** @returns {Promise<ConsentRecord>} 範例資料體驗：不連接任何真實資料 */
  async createDemoSession() {
    await delay(300);
    return {
      consentVersion: MOCK.consentVersion,
      requiredScopes: REQUIRED_SCOPES.slice(),
      optionalScopes: ["fundingHistory"],
      grantedScopes: REQUIRED_SCOPES.concat(["fundingHistory"]),
      source: "demo",
      grantedAt: new Date().toISOString(),
    };
  },
  async revokeAuthorization() {
    const s = OnboardingStore.read();
    if (s.consent) s.consent.revokedAt = new Date().toISOString();
    OnboardingStore.write({ consent: s.consent, portfolioSource: undefined });
  },
};

/* ── OnboardingProfileService（Mock 實作）──
 * TODO(正式 API)：POST /api/onboarding/profile、POST /api/onboarding/profile/skip */
const OnboardingProfileService = {
  /** @returns {Promise<OnboardingProfile|null>} */
  async getProfile() { return OnboardingStore.read().profile || null; },
  /** @param {OnboardingProfile} p @returns {Promise<OnboardingProfile>} */
  async saveProfile(p) {
    await delay(700);
    if (netMode === "fail") throw new Error("MOCK_SAVE_FAILED");
    const profile = Object.assign({}, p, { status: "completed", completedAt: new Date().toISOString() });
    OnboardingStore.write(Object.assign({ profile, currentScreen: 4 }, clearedAnalysisState()));
    return profile;
  },
  /** 略過＝中性預設，不阻擋後續 Demo，之後可在設定頁重填 */
  async skipQuestionnaire() {
    /** @type {OnboardingProfile} */
    const profile = {
      questionnaireVersion: MOCK.questionnaireVersion,
      experienceLevel: "exploring", investmentGoals: [], holdingHorizon: "flexible",
      volatilityResponse: "unsure", helpPriorities: [], communicationStyle: "guided",
      status: "skipped",
    };
    OnboardingStore.write(Object.assign({ profile, currentScreen: 4 }, clearedAnalysisState()));
    return profile;
  },
};

/* ── 問卷定義（6 題；answers 的 key＝id）── */
const QUESTIONS = [
  { id: "experienceLevel", type: "single", title: "你現在怎麼看自己的投資經驗？", desc: "沒有標準答案，只是幫麥麥決定要從哪裡開始說。",
    opts: [{ v: "beginner", l: "我才剛開始接觸" }, { v: "exploring", l: "我有一些買賣經驗" }, { v: "habitual", l: "我已經有固定的投資方式" }, { v: "advanced", l: "我熟悉市場與交易工具" }] },
  { id: "investmentGoals", type: "multi", max: 2, exclusive: "exploringGoal", title: "你希望投資幫你完成什麼？", desc: "最多選兩項，之後可以修改。",
    opts: [{ v: "longTermGrowth", l: "長期累積資產" }, { v: "lifeGoal", l: "為特定生活目標準備" }, { v: "steadyHabit", l: "建立更穩定的投資習慣" }, { v: "marketLiteracy", l: "學會看懂市場與數據" }, { v: "behaviorReview", l: "檢視自己的交易行為" }, { v: "exploringGoal", l: "目前還在探索" }] },
  { id: "holdingHorizon", type: "single", title: "你通常預計持有一筆投資多久？", desc: "",
    opts: [{ v: "short", l: "幾天到一個月" }, { v: "mediumShort", l: "一到六個月" }, { v: "mediumLong", l: "半年到兩年" }, { v: "long", l: "兩年以上" }, { v: "flexible", l: "沒有固定時間" }] },
  { id: "volatilityResponse", type: "single", title: "市場突然大幅波動時，你通常比較接近哪種狀態？", desc: "這不會被拿來評分，只是幫麥麥調整提醒方式。",
    opts: [{ v: "investigate", l: "我會先找原因，再決定怎麼做" }, { v: "followPlan", l: "我通常依照原本的計畫觀察" }, { v: "reduceExposure", l: "我會想先減少部分部位" }, { v: "anxiousChecking", l: "我容易焦慮，反覆查看價格" }, { v: "unsure", l: "我還不確定自己會怎麼反應" }] },
  { id: "helpPriorities", type: "multi", max: 3, title: "你最希望麥麥先幫你做什麼？", desc: "最多選三項。",
    opts: [{ v: "newsToHoldings", l: "把市場消息和我的持倉連在一起" }, { v: "habitInsight", l: "看懂自己的投資習慣" }, { v: "riskAlerts", l: "提醒集中、追高或頻繁交易等風險" }, { v: "termExplain", l: "解釋看不懂的名詞與數據" }, { v: "planReview", l: "回顧原本設定的投資計畫" }, { v: "dailyDigest", l: "用簡短方式整理每天的重要變化" }] },
  { id: "communicationStyle", type: "single", title: "麥麥怎麼跟你說，會比較舒服？", desc: "這是內容呈現偏好，不是投資人格分類。",
    // 選項名與 app.js 的 MODE_LABELS、home.html 的版面切換同名同序。原本的第一人稱
    // 說法（「陪我慢慢看懂」等）移到 d，語意沒有掉，但三個畫面終於叫同一個名字。
    opts: [{ v: "guided", l: "安心白話", d: "陪我慢慢看懂：少一點術語，多一點解釋與例子。" }, { v: "concise", l: "成長陪跑", d: "先告訴我重點：先給結論摘要，需要時再展開。" }, { v: "analytical", l: "專業效率", d: "給我更多數據與脈絡：保留更多數字、依據與深入分析。" }] },
];

/* 摘要標籤對照（呈現偏好，不是人格/能力標籤） */
const TAG_MAP = {
  experienceLevel: { beginner: "剛開始接觸", exploring: "有一些經驗", habitual: "有固定投資方式", advanced: "熟悉市場工具" },
  investmentGoals: { longTermGrowth: "長期累積", lifeGoal: "為生活目標準備", steadyHabit: "建立穩定習慣", marketLiteracy: "學看市場數據", behaviorReview: "檢視交易行為", exploringGoal: "還在探索方向" },
  volatilityResponse: { investigate: "波動時先解釋原因", followPlan: "波動時陪你照計畫看", reduceExposure: "波動時先確認風險", anxiousChecking: "波動時多一點安撫", unsure: "波動時從解釋開始" },
  communicationStyle: { guided: "慢慢看懂模式", concise: "重點摘要模式", analytical: "數據脈絡模式" },
  helpPriorities: { newsToHoldings: "優先連結消息與持倉", habitInsight: "優先看懂投資習慣", riskAlerts: "優先提醒集中風險", termExplain: "優先解釋名詞", planReview: "優先回顧計畫", dailyDigest: "優先每日重點整理" },
};

/* ═══ 問卷執行狀態（draft 經 Store 持久化，重新整理可續）═══ */
let qIndex = 0;
let answers = {};
let questionnaireStarted = false;

function saveDraft() {
  OnboardingStore.write({ draft: { qIndex, answers, optional: readOptionalToggles() } });
}

/* ═══ Screen 2：資料授權 ═══ */
const scopeInputs = () => Array.from(document.querySelectorAll('input[data-scope]'));
function readOptionalToggles() {
  const o = {};
  scopeInputs().forEach((i) => { if (!i.dataset.required) o[i.dataset.scope] = i.checked; });
  return o;
}
function grantedScopesFromUI() {
  return scopeInputs().filter((i) => i.checked).map((i) => /** @type {DataScope} */(i.dataset.scope));
}

function sameScopes(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((scope) => right.includes(scope));
}

function renderConsentCTA() {
  const btn = document.getElementById("btn-consent");
  const hint = document.getElementById("consent-hint");
  const requiredOK = scopeInputs().filter((i) => i.dataset.required).every((i) => i.checked);
  const st = OnboardingStore.read();
  btn.disabled = !requiredOK;
  btn.classList.remove("ok");
  if (!requiredOK) {
    btn.textContent = "同意授權，繼續認識我";
    hint.textContent = "需要開啟必要項目，麥麥才有辦法認識你的投資足跡。";
  } else if (st.consent && !st.consent.revokedAt && sameScopes(grantedScopesFromUI(), st.consent.grantedScopes)) {
    btn.textContent = "已完成授權，繼續";
    hint.textContent = "";
  } else if (st.consent && !st.consent.revokedAt) {
    btn.textContent = "儲存授權設定";
    hint.textContent = "儲存後會依新的資料範圍重新整理投資樣貌。";
  } else {
    btn.textContent = "同意授權，繼續認識我";
    hint.textContent = "";
  }
}

let consentViewedTracked = false;
function renderConsent() {
  const st = OnboardingStore.read();
  // 還原選擇：已授權 → 依 grantedScopes；未授權 → 依草稿（預設：入出金開、使用紀錄關）
  scopeInputs().forEach((i) => {
    if (i.dataset.required) { i.checked = true; return; }
    if (st.consent && !st.consent.revokedAt && Array.isArray(st.consent.grantedScopes)) i.checked = st.consent.grantedScopes.includes(i.dataset.scope);
    else if (st.draft && st.draft.optional && i.dataset.scope in st.draft.optional) i.checked = st.draft.optional[i.dataset.scope];
  });
  renderConsentCTA();
  if (!consentViewedTracked) { track("onboarding_consent_viewed"); consentViewedTracked = true; }
}

scopeInputs().forEach((i) => i.addEventListener("change", () => {
  if (i.dataset.required) track("onboarding_required_scope_confirmed"); // 必要項被切換（含重新勾回）
  else track("onboarding_optional_scope_changed");
  saveDraft();
  renderConsentCTA();
}));

async function grantConsent(record, portfolioSource) {
  OnboardingStore.write(Object.assign({ consent: record, portfolioSource, currentScreen: 3 }, clearedAnalysisState()));
  OnboardingStore.ensureDemoSession();
}

document.getElementById("btn-consent").onclick = async () => {
  const btn = document.getElementById("btn-consent");
  const hint = document.getElementById("consent-hint");
  const st = OnboardingStore.read();
  const selectedScopes = grantedScopesFromUI();
  if (st.consent && !st.consent.revokedAt && sameScopes(selectedScopes, st.consent.grantedScopes)) {
    location.hash = "#/profile";
    return;
  }
  document.getElementById("err-consent").classList.remove("on");
  btn.disabled = true;
  btn.textContent = "正在建立安全的只讀連結⋯";
  track("onboarding_required_scope_confirmed");
  try {
    const record = await AccountAuthorizationService.authorize(selectedScopes);
    if (st.consent && st.consent.source === "demo") record.source = "demo";
    await grantConsent(record, "mock"); // Demo 版一律 mock 資料；正式版 'internalApi'
    track("onboarding_consent_granted");
    btn.classList.add("ok");
    btn.textContent = "✓ 資料已連結";
    hint.textContent = "資料已連結，麥麥只會讀取，不會操作。";
    setTimeout(() => { location.hash = "#/profile"; }, 900);
  } catch (_) {
    // 錯誤後不清除使用者已選擇的授權項目（toggle 原狀保留）
    document.getElementById("err-consent").classList.add("on");
    document.getElementById("err-consent").scrollIntoView({ block: "nearest", behavior: "smooth" });
    renderConsentCTA();
  }
};

async function startDemoData() {
  track("onboarding_demo_data_selected");
  const record = await AccountAuthorizationService.createDemoSession();
  await grantConsent(record, "mock");
  location.hash = "#/profile";
}
document.getElementById("btn-demo-data").onclick = startDemoData;
document.getElementById("btn-err-demo").onclick = startDemoData;
document.getElementById("btn-retry").onclick = () => {
  document.getElementById("err-consent").classList.remove("on");
  document.getElementById("btn-consent").onclick();
};

/* ═══ Screen 3：補充問卷 ═══ */
function renderQuestion() {
  const q = QUESTIONS[qIndex];
  document.getElementById("q-area").style.display = "";
  document.getElementById("summary").classList.remove("on");
  document.getElementById("err-save").classList.remove("on");
  document.getElementById("qprog").textContent = (qIndex + 1) + " / " + QUESTIONS.length;
  document.getElementById("qbar-fill").style.width = Math.round(((qIndex + 1) / QUESTIONS.length) * 100) + "%";
  document.getElementById("qtitle").textContent = q.title;
  document.getElementById("qdesc").textContent = q.desc;
  document.getElementById("qhint").textContent = "";
  const box = document.getElementById("qopts");
  box.setAttribute("aria-label", q.title);
  box.innerHTML = "";
  q.opts.forEach((o) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.dataset.v = o.v;
    b.setAttribute("aria-pressed", String(isSelected(q, o.v)));
    b.innerHTML = o.d ? o.l + '<span class="cd">' + o.d + "</span>" : o.l;
    b.onclick = () => pick(q, o.v);
    box.appendChild(b);
  });
  document.getElementById("btn-prev").disabled = qIndex === 0;
  document.getElementById("btn-next").textContent = qIndex === QUESTIONS.length - 1 ? "看麥麥的整理" : "下一題";
  updateNext();
}

function isSelected(q, v) {
  const a = answers[q.id];
  return q.type === "multi" ? Array.isArray(a) && a.includes(v) : a === v;
}
function updateNext() {
  const q = QUESTIONS[qIndex];
  const a = answers[q.id];
  document.getElementById("btn-next").disabled = q.type === "multi" ? !(Array.isArray(a) && a.length > 0) : !a;
}

function pick(q, v) {
  const hint = document.getElementById("qhint");
  hint.textContent = "";
  if (q.type === "single") {
    answers[q.id] = v; // 單選：只能有一個答案
  } else {
    let a = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
    if (a.includes(v)) a = a.filter((x) => x !== v);
    else if (q.exclusive && v === q.exclusive) a = [v];               // 「還在探索」單獨成立
    else {
      if (q.exclusive) a = a.filter((x) => x !== q.exclusive);
      if (a.length >= q.max) { hint.textContent = "最多選" + (q.max === 2 ? "兩" : "三") + "項，可以先取消一項再選。"; return; }
      a.push(v);
    }
    answers[q.id] = a;
  }
  track("onboarding_question_answered", { questionId: q.id });
  saveDraft();
  document.querySelectorAll("#qopts .chip").forEach((b) => b.setAttribute("aria-pressed", String(isSelected(q, b.dataset.v))));
  updateNext();
}

document.getElementById("btn-prev").onclick = () => { if (qIndex > 0) { qIndex--; saveDraft(); renderQuestion(); } };
document.getElementById("btn-next").onclick = () => {
  if (qIndex < QUESTIONS.length - 1) { qIndex++; saveDraft(); renderQuestion(); }
  else renderSummary();
};

/* 摘要：依答案動態產 3–5 個「陪伴方式」標籤（不是人格評分） */
function buildTags(a) {
  const tags = [];
  if (a.experienceLevel) tags.push(TAG_MAP.experienceLevel[a.experienceLevel]);
  if (Array.isArray(a.investmentGoals) && a.investmentGoals[0]) tags.push(TAG_MAP.investmentGoals[a.investmentGoals[0]]);
  if (a.volatilityResponse) tags.push(TAG_MAP.volatilityResponse[a.volatilityResponse]);
  if (a.communicationStyle) tags.push(TAG_MAP.communicationStyle[a.communicationStyle]);
  if (Array.isArray(a.helpPriorities)) {
    const h = a.helpPriorities.includes("riskAlerts") ? "riskAlerts" : a.helpPriorities[0];
    if (h) tags.push(TAG_MAP.helpPriorities[h]);
  }
  return tags.filter(Boolean).slice(0, 5);
}

function renderSummary() {
  document.getElementById("q-area").style.display = "none";
  const s = document.getElementById("summary");
  s.classList.add("on");
  document.getElementById("err-save2").classList.remove("on");
  document.getElementById("sum-tags").innerHTML = buildTags(answers).map((t) => '<span class="tagchip">' + t + "</span>").join("");
  document.getElementById("finish-hint").textContent = "";
}

document.getElementById("btn-revise").onclick = () => { qIndex = QUESTIONS.length - 1; saveDraft(); renderQuestion(); };

async function finishQuestionnaire() {
  const btn = document.getElementById("btn-finish");
  document.getElementById("err-save2").classList.remove("on");
  btn.disabled = true;
  btn.textContent = "正在儲存⋯";
  /** @type {OnboardingProfile} */
  const profile = {
    questionnaireVersion: MOCK.questionnaireVersion,
    experienceLevel: answers.experienceLevel,
    investmentGoals: answers.investmentGoals || [],
    holdingHorizon: answers.holdingHorizon,
    volatilityResponse: answers.volatilityResponse,
    helpPriorities: answers.helpPriorities || [],
    communicationStyle: answers.communicationStyle,
    status: "completed",
  };
  try {
    await OnboardingProfileService.saveProfile(profile);
    OnboardingStore.write({ draft: undefined }); // 完成後清草稿，重新整理不會回到第一題
    track("onboarding_questionnaire_completed");
    location.hash = "#/analyzing";
  } catch (_) {
    // 儲存失敗：答案全部保留（answers/draft 未動），只提示重新送出
    btn.disabled = false;
    btn.textContent = "完成，開始分析";
    document.getElementById("err-save2").classList.add("on");
  }
}
document.getElementById("btn-finish").onclick = finishQuestionnaire;
document.getElementById("btn-resave2").onclick = finishQuestionnaire;
document.getElementById("btn-resave").onclick = finishQuestionnaire;

document.getElementById("btn-skip").onclick = async () => {
  track("onboarding_questionnaire_skipped");
  await OnboardingProfileService.skipQuestionnaire();
  OnboardingStore.write({ draft: undefined });
  location.hash = "#/analyzing"; // 略過不阻擋分析；之後可在設定頁重填
};

function renderProfile() {
  const st = OnboardingStore.read();
  if (st.draft) { qIndex = st.draft.qIndex || 0; answers = st.draft.answers || {}; }
  if (!questionnaireStarted) { track("onboarding_questionnaire_started"); questionnaireStarted = true; }
  // 已完成過問卷（重新整理/回訪）：直接顯示摘要，不回到第一題
  if (st.profile && st.profile.status === "completed" && !st.draft) {
    answers = {
      experienceLevel: st.profile.experienceLevel, investmentGoals: st.profile.investmentGoals,
      holdingHorizon: st.profile.holdingHorizon, volatilityResponse: st.profile.volatilityResponse,
      helpPriorities: st.profile.helpPriorities, communicationStyle: st.profile.communicationStyle,
    };
    renderSummary();
    return;
  }
  renderQuestion();
}

/* ═══ 路由與共用 ═══ */
function route() {
  const h = location.hash || "#/consent";
  let st = OnboardingStore.read();
  // PR #28 舊狀態尚無 demoSession：只遷移「缺少」的 Session；已過期者仍交由 Screen 4 明確處理。
  if (st.portfolioSource === "mock" && !st.demoSession && st.consent && !st.consent.revokedAt) {
    OnboardingStore.ensureDemoSession();
    st = OnboardingStore.read();
  }
  const known = ["#/consent", "#/profile", "#/analyzing", "#/profile-result"];
  if (!known.includes(h)) { location.replace("#/consent"); return; }
  const hasConsent = Boolean(
    st.consent &&
    st.consent.consentVersion &&
    !st.consent.revokedAt &&
    Array.isArray(st.consent.grantedScopes) &&
    REQUIRED_SCOPES.every((scope) => st.consent.grantedScopes.includes(scope))
  );
  const questionnaireReady = Boolean(
    st.profile &&
    st.profile.questionnaireVersion &&
    (st.profile.status === "completed" || st.profile.status === "skipped")
  );
  const hasValidSession = Boolean(
    st.demoSession &&
    st.demoSession.id &&
    st.demoSession.dataVersion &&
    Number.isFinite(Date.parse(st.demoSession.createdAt)) &&
    !OnboardingStore.isDemoSessionExpired(st.demoSession)
  );
  if (h === "#/profile-result" && !hasValidSession) { location.replace("welcome.html"); return; }
  if (h !== "#/consent" && !hasConsent) { location.replace("#/consent"); return; }
  if ((h === "#/analyzing" || h === "#/profile-result") && !questionnaireReady) { location.replace("#/profile"); return; }
  if (h === "#/profile-result") {
    if (!st.analysisJob) { location.replace("#/analyzing"); return; }
    if (st.analysisJob.status === "queued" || st.analysisJob.status === "running") { location.replace("#/analyzing"); return; }
    if (st.profileResult && st.analysisJob.status === "succeeded" &&
        (st.profileResult.analysisJobId !== st.analysisJob.id || st.analysisJob.dataVersion !== st.demoSession.dataVersion)) {
      location.replace("#/analyzing");
      return;
    }
  }

  const views = {
    "#/consent": "view-consent",
    "#/profile": "view-profile",
    "#/analyzing": "view-analyzing",
    "#/profile-result": "view-profile-result",
  };
  Object.values(views).forEach((id) => { document.getElementById(id).hidden = id !== views[h]; });
  const page = {
    "#/consent": ["設定 MaiMate", "2 / 8"],
    "#/profile": ["讓麥麥更懂你", "3 / 8"],
    "#/analyzing": ["認識你的投資樣貌", "4 / 8"],
    "#/profile-result": ["你的投資樣貌", "5 / 8"],
  }[h];
  document.getElementById("page-title").textContent = page[0];
  document.getElementById("step-badge").textContent = page[1];
  const onResult = h === "#/profile-result";
  document.getElementById("header-profile-basis").hidden = !onResult;
  document.getElementById("net-badge").hidden = onResult;
  document.getElementById("btn-help").hidden = onResult;
  if (h !== "#/analyzing") window.MM_ANALYSIS_UI.stopTimers();
  if (h === "#/profile") renderProfile();
  else if (h === "#/consent") renderConsent();
  else if (h === "#/analyzing") window.MM_ANALYSIS_UI.renderAnalyzing();
  else window.MM_ANALYSIS_UI.renderProfileResult();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", (event) => {
  let previousHash = "";
  try { previousHash = new URL(event.oldURL).hash; } catch (_) {}
  if (previousHash === "#/profile-result" && location.hash === "#/analyzing") {
    window.MM_ANALYSIS_UI.prepareCompletedReview();
  }
  route();
});

/* 從「我的」進來時（?from=settings），返回鍵一律回設定頁——
 * 使用者只是想看授權或樣貌，不該被退回行銷入口頁或分析中畫面。 */
const cameFromSettings = new URLSearchParams(location.search).get("from") === "settings";
document.getElementById("btn-back").onclick = () => {
  if (cameFromSettings) { location.href = "settings.html"; return; }
  if (location.hash === "#/profile") location.hash = "#/consent";
  else if (location.hash === "#/profile-result") window.MM_ANALYSIS_UI.returnToAnalysis();
  else if (location.hash === "#/analyzing") location.hash = "#/profile";
  else location.href = "welcome.html";
};

/* Bottom Sheet：資料使用說明 */
function openSheet() { window.MM_ANALYSIS_UI.openUsageSheet(); }
document.querySelectorAll("[data-usage]").forEach((el) => el.addEventListener("click", openSheet));
document.getElementById("btn-help").onclick = () => {
  if (!window.MM_ANALYSIS_UI.openContextHelp()) openSheet();
};

/* Demo 用連線情境切換（評審展示錯誤流程；與 Screen 1 state-badge 同手法） */
const _nb = document.getElementById("net-badge");
function cycleNet() {
  netMode = netMode === "ok" ? "fail" : "ok";
  _nb.textContent = netMode === "ok" ? "連線正常" : "連線會失敗（demo）";
  window.MM_ANALYSIS_UI.setNetworkMode(netMode);
}
_nb.onclick = cycleNet;
_nb.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleNet(); } };

route();
