/* MaiMate Onboarding 共用核心（Screen 2–5）
 * 唯一 localStorage 入口：所有 onboarding、分析工作與投資樣貌都存於 mm_onboarding。
 * JSDoc typedef 對應正式 API contract；維持零建置靜態 SPA。
 */
"use strict";

/** @typedef {'portfolio'|'transactions'|'fundingHistory'|'interactionPersonalization'} DataScope */
/** @typedef {{consentVersion:string, requiredScopes:DataScope[], optionalScopes:DataScope[], grantedScopes:DataScope[], source:'demo'|'internal', grantedAt:string, revokedAt?:string}} ConsentRecord */
/** @typedef {{questionnaireVersion:string, experienceLevel:'beginner'|'exploring'|'habitual'|'advanced', investmentGoals:string[], holdingHorizon:'short'|'mediumShort'|'mediumLong'|'long'|'flexible', volatilityResponse:'investigate'|'followPlan'|'reduceExposure'|'anxiousChecking'|'unsure', helpPriorities:string[], communicationStyle:'guided'|'concise'|'analytical', status:'inProgress'|'completed'|'skipped', completedAt?:string}} OnboardingProfile */
/** @typedef {{id:string, dataVersion:string, createdAt:string, expiresAt:string}} DemoSession */
/** @typedef {'queued'|'running'|'succeeded'|'failed'} AnalysisJobStatus */
/** @typedef {'pending'|'running'|'completed'|'failed'} AnalysisStageStatus */
/** @typedef {'dataPreparation'|'portfolioAnalysis'|'behaviorAnalysis'|'questionnaireMerge'|'profileGeneration'} AnalysisStageKey */
/** @typedef {{key:AnalysisStageKey,status:AnalysisStageStatus,startedAt?:string,completedAt?:string,message?:string}} AnalysisStage */
/** @typedef {{id:string,status:AnalysisJobStatus,progress:number,currentStage?:AnalysisStageKey,stages:AnalysisStage[],dataVersion:string,profileVersion?:string,createdAt:string,updatedAt:string,completedAt?:string,errorCode?:string}} AnalysisJob */
/** @typedef {'full'|'sufficient'|'limited'} AnalysisCoverage */
/** @typedef {{coverage:AnalysisCoverage,portfolioAvailable:boolean,transactionCount:number,transactionCoverageDays:number,fundingHistoryAvailable:boolean,questionnaireCompleted:boolean,questionnaireAnswerCount:number,assetCount:number,missingFields:string[]}} AnalysisDataCoverage */
/** @typedef {'portfolio'|'transactions'|'fundingHistory'|'questionnaire'|'marketContext'} EvidenceSource */
/** @typedef {{id:string,label:string,value?:string,source:EvidenceSource}} EvidencePoint */
/** @typedef {'tradingRhythm'|'holdingPattern'|'allocationPattern'|'volatilityBehavior'} ProfileDimensionKey */
/** @typedef {'accurate'|'partiallyAccurate'|'inaccurate'|'unsure'} ProfileFeedbackValue */
/** @typedef {{value:ProfileFeedbackValue,selectedCorrection?:string,note?:string,createdAt:string}} ProfileDimensionFeedback */
/** @typedef {{key:ProfileDimensionKey,title:string,descriptor:string,summary:string,explanation:string,evidence:EvidencePoint[],dataSufficient:boolean}} ProfileDimension */
/** @typedef {{id:string,label:string,sourceDimension?:ProfileDimensionKey}} ProfileTag */
/** @typedef {{id:string,text:string,evidenceIds:string[],sourceLabels:string[]}} ProfileObservation */
/** @typedef {{id:string,title:string,description:string,priority:number,source:'questionnaire'|'profile'|'userCorrection'}} SupportPlanItem */
/** @typedef {'accurate'|'mostlyAccurate'|'needsRevision'|'unsure'} OverallProfileFeedbackValue */
/** @typedef {{value:OverallProfileFeedbackValue,createdAt:string}} OverallProfileFeedback */
/** @typedef {{id:string,resultId:string,dimensionKey:ProfileDimensionKey,feedbackValue:ProfileFeedbackValue,selectedCorrection?:string,note?:string,createdAt:string}} UserProfileCorrection */
/** @typedef {{key:ProfileDimensionKey,originalDescriptor:string,effectiveDescriptor:string,effectiveExplanation:string,correctionApplied:boolean}} EffectiveProfileDimension */
/** @typedef {{id:string,userId:string,analysisJobId:string,dataVersion?:string,resultVersion:string,status:'draft'|'confirmed'|'revised',profileHeadline:string,summary:string,tags:ProfileTag[],coverage:AnalysisDataCoverage,dimensions:ProfileDimension[],stablePatterns:ProfileObservation[],attentionPoints:ProfileObservation[],supportPlan:SupportPlanItem[],overallFeedback?:OverallProfileFeedback,generatedBy:'rules'|'rulesAndAi'|'fallbackTemplate',createdAt:string,updatedAt:string,confirmedAt?:string}} InvestmentProfileResult */
/** @typedef {{originalResultId:string,effectiveHeadline:string,dimensions:EffectiveProfileDimension[],supportPlan:SupportPlanItem[],userCorrections:UserProfileCorrection[],updatedAt:string}} EffectiveInvestmentProfile */
/** @typedef {{currentScreen:number,consent?:ConsentRecord,profile?:OnboardingProfile,portfolioSource?:'mock'|'internalApi',draft?:{qIndex:number,answers:Object,optional:Object},demoSession?:DemoSession,demoPersonaId?:'STEADY_PLANNER',analysisJob?:AnalysisJob,profileResult?:InvestmentProfileResult,profileFeedback?:Object,overallFeedback?:OverallProfileFeedback,effectiveProfile?:EffectiveInvestmentProfile,profileConfirmationReminder?:boolean,home?:Object}} OnboardingState */

const MM_DEMO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/* 示範資料版本：現在的來源是隊友共用的真實帳戶（data/health_report.json → mocks/account.js），
 * 不再是舊的「8 筆交易」示範帳戶，版本字串也一併改掉避免誤導。 */
const MM_DEMO_DATA_VERSION = "health-report-2025-v1";
const MM_EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

/* Analytics 只允許事件名與 questionId；不接受任意 metadata。 */
function track(name, meta) {
  try {
    const stored = JSON.parse(localStorage.getItem("mm_events") || "[]");
    const log = (Array.isArray(stored) ? stored : []).flatMap((item) => {
      if (!item || item.e == null || String(item.e).length === 0) return [];
      const clean = { e: String(item.e) };
      const priorQuestionId = item.q == null ? "" : String(item.q);
      if (MM_EVENT_ID_PATTERN.test(priorQuestionId)) clean.q = priorQuestionId;
      return [clean];
    });
    const event = { e: String(name) };
    const questionId = meta && meta.questionId ? String(meta.questionId) : "";
    if (MM_EVENT_ID_PATTERN.test(questionId)) event.q = questionId;
    log.push(event);
    localStorage.setItem("mm_events", JSON.stringify(log.slice(-100)));
  } catch (_) {}
  console.log("[track]", name, meta && meta.questionId ? { questionId: meta.questionId } : "");
}

const OnboardingStore = {
  KEY: "mm_onboarding",
  /** @returns {OnboardingState} */
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch (_) { return {}; }
  },
  /** @param {Partial<OnboardingState>} patch @returns {OnboardingState} */
  write(patch) {
    const state = Object.assign(this.read(), patch);
    localStorage.setItem(this.KEY, JSON.stringify(state));
    return state;
  },
  /* ── 使用者自己的作答快照 ──
   * 「先看示範帳戶」會用示範人格覆蓋整份 onboarding 狀態。覆蓋前先留一份快照，
   * 讓使用者能在「我的」把自己的設定換回來，不會因為好奇點一下就永久失去作答。 */
  SNAPSHOT_KEY: "mm_onboarding_user_snapshot",
  /** 只在使用者確實有自己的（非示範）資料、且尚未有快照時建立 */
  snapshotUserState() {
    if (localStorage.getItem(this.SNAPSHOT_KEY)) return false;
    const state = this.read();
    const isOwnData = Boolean(state.profile) &&
      !state.demoPersonaId &&
      !(state.consent && state.consent.source === "demo");
    if (!isOwnData) return false;
    localStorage.setItem(this.SNAPSHOT_KEY, JSON.stringify(state));
    return true;
  },
  hasUserSnapshot() { return Boolean(localStorage.getItem(this.SNAPSHOT_KEY)); },
  /** @returns {boolean} 還原成功與否 */
  restoreUserState() {
    const raw = localStorage.getItem(this.SNAPSHOT_KEY);
    if (!raw) return false;
    try { JSON.parse(raw); } catch (_) { localStorage.removeItem(this.SNAPSHOT_KEY); return false; }
    localStorage.setItem(this.KEY, raw);
    localStorage.removeItem(this.SNAPSHOT_KEY);
    return true;
  },
  /** @returns {DemoSession} */
  ensureDemoSession() {
    const state = this.read();
    if (state.demoSession &&
        state.demoSession.id &&
        state.demoSession.dataVersion &&
        Number.isFinite(Date.parse(state.demoSession.createdAt)) &&
        !this.isDemoSessionExpired(state.demoSession)) return state.demoSession;
    const now = Date.now();
    const id = "obs_demo_" + (crypto.randomUUID ? crypto.randomUUID() : String(now)).replaceAll("-", "").slice(0, 12);
    const demoSession = {
      id,
      dataVersion: MM_DEMO_DATA_VERSION,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MM_DEMO_SESSION_TTL_MS).toISOString(),
    };
    this.write({ demoSession });
    return demoSession;
  },
  /** @param {DemoSession=} session */
  isDemoSessionExpired(session) {
    if (!session || !session.expiresAt) return true;
    const expiresAt = Date.parse(session.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  },
  resetExpiredDemoSession() {
    this.write({
      currentScreen: 2,
      consent: undefined,
      profile: undefined,
      portfolioSource: undefined,
      draft: undefined,
      demoSession: undefined,
      demoPersonaId: undefined,
      analysisJob: undefined,
      profileResult: undefined,
      profileFeedback: undefined,
      overallFeedback: undefined,
      effectiveProfile: undefined,
      profileConfirmationReminder: undefined,
      home: undefined,
    });
  },
};
