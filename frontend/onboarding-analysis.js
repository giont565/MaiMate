/* Screen 4/5 UI Controller。畫面只透過 MM_INVESTMENT_SERVICES 讀寫分析與投資樣貌。 */
"use strict";

const AnalysisUI = (() => {
  const services = window.MM_INVESTMENT_SERVICES;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const expandedDimensions = new Set(["tradingRhythm"]);
  const pendingFeedback = {};
  const feedbackStatus = {};
  const feedbackInFlight = {};
  let dimensionWriteQueue = Promise.resolve();
  let pendingOverall = null;
  let overallStatus = "";
  let overallInFlight = null;
  let pollTimer = 0;
  let autoRouteTimer = 0;
  let viewRequestEpoch = 0;
  let activeJob = null;
  let activeResult = null;
  let activeContext = null;
  let correctionDraft = null;
  let trackedResultId = "";
  let reviewingCompleted = false;
  let activeSheetName = "";
  let sheetReturnFocus = null;
  let actionResizeObserver = null;
  let transientResultId = "";
  let correctionSaving = false;
  let terminalActionInFlight = false;
  let failedPreviousResultAvailable = false;

  function el(id) { return document.getElementById(id); }
  function show(id, value) { el(id).classList.toggle("on", Boolean(value)); }
  function routeTo(hash) { if (location.hash !== hash) location.hash = hash; }

  function stopTimers() {
    clearTimeout(pollTimer);
    clearTimeout(autoRouteTimer);
    pollTimer = 0;
    autoRouteTimer = 0;
    viewRequestEpoch += 1;
  }

  function routeRequestIsCurrent(epoch, hash) {
    return viewRequestEpoch === epoch && location.hash === hash;
  }

  function resultMatchesState(state, result) {
    return Boolean(
      result &&
      state.analysisJob &&
      state.demoSession &&
      state.analysisJob.dataVersion === state.demoSession.dataVersion &&
      (
        (state.analysisJob.status === "succeeded" && result.analysisJobId === state.analysisJob.id) ||
        (state.analysisJob.status === "failed" && result.dataVersion === state.analysisJob.dataVersion)
      )
    );
  }

  function renderStageList(job) {
    const root = el("analysis-stages");
    services.stageDefinitions.forEach((definition) => {
      let row = root.querySelector('[data-stage="' + definition.key + '"]');
      if (!row) {
        row = document.createElement("div");
        row.className = "analysis-stage pending";
        row.dataset.stage = definition.key;
        const mark = document.createElement("div");
        mark.className = "stage-mark";
        mark.setAttribute("aria-hidden", "true");
        const copy = document.createElement("div");
        copy.className = "stage-copy";
        const title = document.createElement("b");
        title.textContent = definition.title;
        const description = document.createElement("p");
        description.textContent = definition.description;
        copy.append(title, description);
        row.append(mark, copy);
        root.appendChild(row);
      }
      const stage = job.stages.find((item) => item.key === definition.key) || { status: "pending" };
      row.className = "analysis-stage " + stage.status;
      row.querySelector(".stage-mark").textContent = stage.status === "completed" ? "✓" : stage.status === "failed" ? "!" : "";
    });
    const progress = Math.max(0, Math.min(100, job.progress || 0));
    el("analysis-progress-fill").style.width = progress + "%";
    el("analysis-progress-value").textContent = progress + "%";
  }

  function renderScopeNote() {
    const state = OnboardingStore.read();
    const messages = ["分析只會使用你已授權的資料。"];
    const scopes = state.consent ? state.consent.grantedScopes : [];
    if (!scopes.includes("fundingHistory")) messages.push("這次沒有使用入出金紀錄，資金投入節奏的觀察會比較有限。");
    if (!state.profile || state.profile.status === "skipped") messages.push("這次主要根據帳戶紀錄整理，之後補充目標與偏好，麥麥可以更了解你。");
    el("analysis-scope-note").textContent = messages.join(" ");
  }

  function showRunning() {
    el("analysis-running").hidden = false;
    show("analysis-complete", false);
    show("analysis-error", false);
    show("session-expired", false);
  }

  /* 只要本機已有「與目前資料版本相符」的結果就算可救援——分析本身成功、
   * 只是這次讀取失敗時同樣適用；否則會把讀取失敗誤報成分析失敗，
   * 並讓使用者走上會清掉自己修正的「使用展示結果」。 */
  function hasPreviousResultForFailedJob() {
    const state = OnboardingStore.read();
    return Boolean(
      state.analysisJob &&
      (state.analysisJob.status === "failed" || state.analysisJob.status === "succeeded") &&
      resultMatchesState(state, state.profileResult)
    );
  }

  function showFailed(hasPreviousResult) {
    failedPreviousResultAvailable = hasPreviousResult == null ? hasPreviousResultForFailedJob() : Boolean(hasPreviousResult);
    el("analysis-running").hidden = true;
    show("analysis-complete", false);
    show("analysis-error", true);
    show("session-expired", false);
    el("analysis-error-title").textContent = failedPreviousResultAvailable ? "最新分析暫時沒有完成" : "這次沒有整理完成";
    el("analysis-error-copy").textContent = failedPreviousResultAvailable
      ? "你仍可以查看上一次整理的投資樣貌。"
      : "你的原始資料沒有被變更，可以重新分析，或先使用展示結果繼續體驗。";
    el("btn-analysis-fallback").textContent = failedPreviousResultAvailable ? "查看上次結果" : "使用展示結果";
    el("btn-analysis-back").hidden = failedPreviousResultAvailable;
    track("maimate_analysis_failed");
  }

  function showCompleted(allowAutoRoute) {
    el("analysis-running").hidden = false;
    show("analysis-complete", true);
    show("analysis-error", false);
    show("session-expired", false);
    if (activeJob && !activeJob._completionTracked) {
      activeJob._completionTracked = true;
      track("maimate_analysis_completed");
    }
    if (allowAutoRoute && !reducedMotion.matches) {
      const epoch = viewRequestEpoch;
      autoRouteTimer = setTimeout(() => {
        if (routeRequestIsCurrent(epoch, "#/analyzing")) routeTo("#/profile-result");
      }, 700);
    }
  }

  async function pollJob() {
    const epoch = viewRequestEpoch;
    if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
    try {
      activeJob = await services.analysis.getAnalysisJob(activeJob.id);
      if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
      renderStageList(activeJob);
      if (activeJob.status === "failed") return showFailed();
      if (activeJob.status === "succeeded") return showCompleted(true);
      pollTimer = setTimeout(pollJob, 180);
    } catch (_) {
      if (routeRequestIsCurrent(epoch, "#/analyzing")) showFailed();
    }
  }

  async function renderAnalyzing() {
    stopTimers();
    const epoch = viewRequestEpoch;
    activeResult = null;
    activeContext = null;
    let state = OnboardingStore.read();
    if (state.portfolioSource === "mock" && !state.demoSession) {
      OnboardingStore.ensureDemoSession();
      state = OnboardingStore.read();
    }
    if (state.portfolioSource === "mock" && OnboardingStore.isDemoSessionExpired(state.demoSession)) {
      el("analysis-running").hidden = true;
      show("analysis-complete", false);
      show("analysis-error", false);
      show("session-expired", true);
      return;
    }
    try {
      const existingResult = await services.profile.getProfileResult();
      if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
      if (resultMatchesState(state, existingResult)) {
        if (state.analysisJob.status === "failed") {
          reviewingCompleted = false;
          activeJob = state.analysisJob;
          renderScopeNote();
          renderStageList(activeJob);
          showFailed(true);
          return;
        }
        if (!reviewingCompleted) return routeTo("#/profile-result");
        reviewingCompleted = false;
        activeJob = state.analysisJob;
        showRunning();
        renderScopeNote();
        renderStageList(activeJob);
        showCompleted(false);
        return;
      }
    } catch (_) {
      if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
      // 讀取失敗但本機已有同版本結果 → 走「查看上次結果」，不謊報分析失敗
      if (hasPreviousResultForFailedJob()) {
        activeJob = state.analysisJob;
        renderScopeNote();
        renderStageList(activeJob);
        showFailed(true);
      } else {
        showFailed();
      }
      return;
    }
    const storedJobIsCurrent = Boolean(
      state.analysisJob &&
      state.demoSession &&
      state.analysisJob.dataVersion === state.demoSession.dataVersion
    );
    if (storedJobIsCurrent) {
      reviewingCompleted = false;
      activeJob = state.analysisJob;
      renderScopeNote();
      renderStageList(activeJob);
      if (activeJob.status === "failed") {
        showFailed();
        return;
      }
      showRunning();
      if (activeJob.status === "succeeded") {
        showCompleted(false);
        return;
      }
      try {
        activeJob = await services.analysis.getAnalysisJob(activeJob.id);
        if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
        renderStageList(activeJob);
        if (activeJob.status === "failed") return showFailed();
        if (activeJob.status === "succeeded") return showCompleted(true);
        pollTimer = setTimeout(pollJob, 180);
      } catch (_) {
        if (routeRequestIsCurrent(epoch, "#/analyzing")) showFailed();
      }
      return;
    }
    reviewingCompleted = false;
    showRunning();
    renderScopeNote();
    const session = state.demoSession || OnboardingStore.ensureDemoSession();
    try {
      activeJob = await services.analysis.startAnalysis({
        onboardingSessionId: session.id,
        consentVersion: state.consent.consentVersion,
        questionnaireVersion: state.profile ? state.profile.questionnaireVersion : "demo-1.0",
        dataVersion: session.dataVersion,
      });
      if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
      renderStageList(activeJob);
      if (!state.analysisJob || state.analysisJob.id !== activeJob.id) track("maimate_analysis_started");
      if (activeJob.status === "succeeded") {
        await services.analysis.getAnalysisJob(activeJob.id);
        if (!routeRequestIsCurrent(epoch, "#/analyzing")) return;
        return showCompleted(true);
      }
      pollTimer = setTimeout(pollJob, 80);
    } catch (_) {
      if (routeRequestIsCurrent(epoch, "#/analyzing")) showFailed();
    }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  }

  function coveragePeriod(coverage) {
    if (!coverage.transactionCoverageDays) return "資料期間不足";
    const months = Math.max(1, Math.round(coverage.transactionCoverageDays / 30.4375));
    return "約 " + months + " 個月";
  }

  function coverageLabel(level) {
    return {
      full: "足以產生主要樣貌",
      sufficient: "可整理部分主要樣貌",
      limited: "目前只能產生初步樣貌",
    }[level] || "資料仍在整理";
  }

  function setHeroTitle(lines) {
    const root = el("result-hero-title");
    root.innerHTML = "";
    lines.forEach((text) => {
      const line = document.createElement("span");
      line.className = "hero-title-line";
      line.textContent = text;
      root.appendChild(line);
    });
  }

  function sourceLabel(source) {
    return {
      portfolio: "持倉資料",
      transactions: "交易紀錄",
      fundingHistory: "入出金紀錄",
      questionnaire: "補充問卷",
      marketContext: "市場資料",
    }[source] || "資料來源";
  }

  function feedbackLabel(value) {
    return { accurate: "很像", partiallyAccurate: "部分像", inaccurate: "不太像", unsure: "還不確定" }[value] || "";
  }

  function overallLabel(value) {
    return { accurate: "很接近", mostlyAccurate: "大致接近", needsRevision: "還需要調整", unsure: "目前不確定" }[value] || "";
  }

  function correctionOptionsFor(key) {
    return {
      tradingRhythm: [
        ["recurring_contribution", "大多是定期定額"],
        ["recent_event", "近期有特殊事件"],
        ["platform_transfer", "只是換平台或轉換資產"],
        ["frequency_lower", "交易頻率比描述更低"],
        ["frequency_higher", "交易頻率比描述更高"],
        ["other", "其他"],
      ],
      holdingPattern: [
        ["planned_longer", "原本計畫持有更久"],
        ["different_purposes", "不同資產用途不同"],
        ["conversion_only", "部分交易只是轉換"],
        ["timing_mismatch", "描述的時間不符合"],
        ["other", "其他"],
      ],
      allocationPattern: [
        ["specific_purpose", "部分資產有特定用途"],
        ["external_assets", "有其他平台資產尚未納入"],
        ["rebalancing", "近期正在調整配置"],
        ["temporary_state", "這只是短期狀態"],
        ["other", "其他"],
      ],
      volatilityBehavior: [
        ["checking_only", "通常只是查看，沒有操作"],
        ["recent_need", "近期有特殊需求"],
        ["questionnaire_closer", "問卷答案更符合我"],
        ["records_closer", "交易紀錄更符合我"],
        ["other", "其他"],
      ],
    }[key] || [];
  }

  function storedDimensionFeedback(key) {
    return activeContext && activeContext.dimensionFeedback
      ? activeContext.dimensionFeedback.find((item) => item.dimensionKey === key)
      : null;
  }

  function selectedFeedback(key) {
    return pendingFeedback[key]
      ? pendingFeedback[key].value
      : storedDimensionFeedback(key) ? storedDimensionFeedback(key).feedbackValue : "";
  }

  function effectiveDimension(key) {
    return activeContext && activeContext.effectiveProfile && Array.isArray(activeContext.effectiveProfile.dimensions)
      ? activeContext.effectiveProfile.dimensions.find((item) => item.key === key)
      : null;
  }

  function createEvidence(evidence) {
    const row = document.createElement("div");
    row.className = "evidence";
    const label = document.createElement("span");
    label.textContent = evidence.label;
    const value = document.createElement("b");
    value.textContent = evidence.value || "資料不足";
    const source = document.createElement("small");
    source.textContent = "資料來源：" + sourceLabel(evidence.source);
    row.append(label, value, source);
    return row;
  }

  function updateContextFromFeedback(response, submittedFeedback) {
    if (response.profileResult && response.profileResult.id) {
      activeResult = response.profileResult;
      activeContext.profileResult = response.profileResult;
    }
    if (response.effectiveProfile && response.effectiveProfile.originalResultId) {
      activeContext.effectiveProfile = response.effectiveProfile;
      activeContext.corrections = Array.isArray(response.effectiveProfile.userCorrections)
        ? response.effectiveProfile.userCorrections.slice()
        : activeContext.corrections;
    }
    const persistedFeedback = response.correction || submittedFeedback;
    if (persistedFeedback) {
      activeContext.dimensionFeedback = activeContext.dimensionFeedback.filter((item) => item.dimensionKey !== persistedFeedback.dimensionKey);
      activeContext.dimensionFeedback.push(persistedFeedback);
    }
  }

  function renderHeadline() {
    el("profile-headline").textContent = activeContext && activeContext.effectiveProfile && activeContext.effectiveProfile.effectiveHeadline
      ? activeContext.effectiveProfile.effectiveHeadline
      : activeResult.profileHeadline;
  }

  function sendDimensionFeedback(key, feedback) {
    if (feedbackInFlight[key]) return feedbackInFlight[key];
    const resultId = activeResult.id;
    pendingFeedback[key] = feedback;
    feedbackStatus[key] = "saving";
    let request;
    const perform = async () => {
      try {
        const response = await services.profile.submitDimensionFeedback(resultId, key, feedback);
        if (!activeResult || activeResult.id !== resultId) return true;
        updateContextFromFeedback(response, {
          id: "feedback_" + key,
          resultId,
          dimensionKey: key,
          feedbackValue: feedback.value,
          selectedCorrection: feedback.selectedCorrection,
          note: feedback.note,
          createdAt: feedback.createdAt,
        });
        delete pendingFeedback[key];
        feedbackStatus[key] = "saved";
        track("maimate_profile_dimension_feedback_selected");
        renderHeadline();
        renderDimensions();
        renderSupportPlan();
        renderActions();
        return true;
      } catch (_) {
        if (activeResult && activeResult.id === resultId) {
          feedbackStatus[key] = "error";
          renderDimensions();
        }
        return false;
      } finally {
        if (feedbackInFlight[key] === request) {
          delete feedbackInFlight[key];
          if (activeResult && activeResult.id === resultId) renderDimensions();
        }
      }
    };
    request = dimensionWriteQueue.then(perform, perform);
    dimensionWriteQueue = request.then(() => undefined, () => undefined);
    feedbackInFlight[key] = request;
    renderDimensions();
    return request;
  }

  function openCorrection(dimensionKey, feedbackValue) {
    const existing = storedDimensionFeedback(dimensionKey) || {};
    correctionDraft = {
      dimensionKey,
      value: feedbackValue,
      selectedCorrection: existing.selectedCorrection || "",
      note: existing.note || "",
    };
    const options = el("correction-options");
    options.innerHTML = "";
    correctionOptionsFor(dimensionKey).forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.correction = value;
      button.setAttribute("aria-pressed", String(correctionDraft.selectedCorrection === value));
      button.onclick = () => {
        correctionDraft.selectedCorrection = value;
        options.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      };
      options.appendChild(button);
    });
    el("correction-note").value = correctionDraft.note;
    el("correction-count").textContent = String(200 - correctionDraft.note.length);
    el("correction-error").textContent = "";
    openNamedSheet("correction");
    track("maimate_profile_correction_opened");
  }

  function renderFeedbackStatus(key, root) {
    const status = feedbackStatus[key];
    root.className = "feedback-status" + (status === "error" ? " error" : "");
    root.innerHTML = "";
    if (status === "saving") root.textContent = "正在儲存…";
    else if (status === "saved") root.textContent = "已記下";
    else if (status === "error") {
      root.append(document.createTextNode("這次沒有成功儲存，你的選擇還在。"));
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sheet-secondary";
      retry.textContent = "重新送出";
      retry.onclick = () => sendDimensionFeedback(key, pendingFeedback[key]);
      root.appendChild(retry);
    } else if (storedDimensionFeedback(key)) root.textContent = "已記下";
  }

  function renderDimensions() {
    if (!activeResult) return;
    const root = el("profile-dimensions");
    root.innerHTML = "";
    activeResult.dimensions.forEach((dimension, index) => {
      const card = document.createElement("article");
      const panelId = "dimension-panel-" + dimension.key;
      const toggleId = "dimension-toggle-" + dimension.key;
      const isOpen = expandedDimensions.has(dimension.key);
      const effective = effectiveDimension(dimension.key);
      card.className = "dimension";
      card.dataset.dimension = dimension.key;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = toggleId;
      toggle.className = "dimension-toggle";
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-controls", panelId);
      const icon = document.createElement("span");
      icon.className = "dim-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = String(index + 1).padStart(2, "0");
      const label = document.createElement("div");
      const title = document.createElement("div");
      title.className = "dim-title";
      title.textContent = dimension.title;
      const descriptor = document.createElement("div");
      descriptor.className = "dim-desc";
      descriptor.textContent = effective && effective.correctionApplied
        ? effective.effectiveDescriptor
        : dimension.dataSufficient ? dimension.descriptor : "還需要更多資料";
      const summary = document.createElement("div");
      summary.className = "dim-summary";
      summary.textContent = effective && effective.correctionApplied
        ? "已依你的補充調整。原始數據仍保留在展開內容中。"
        : dimension.summary;
      label.append(title, descriptor, summary);
      const chev = document.createElement("span");
      chev.className = "chev";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "⌄";
      toggle.append(icon, label, chev);

      const body = document.createElement("div");
      body.id = panelId;
      body.className = "dimension-body" + (isOpen ? " on" : "");
      body.setAttribute("role", "region");
      body.setAttribute("aria-labelledby", toggleId);
      body.setAttribute("aria-hidden", String(!isOpen));
      if ("inert" in body) body.inert = !isOpen;
      const bodyInner = document.createElement("div");
      bodyInner.className = "dimension-body-inner";
      const evidenceTitle = document.createElement("div");
      evidenceTitle.className = "data-source-title";
      evidenceTitle.textContent = "數據依據";
      const evidenceRoot = document.createElement("div");
      evidenceRoot.className = "evidence-list";
      if (dimension.evidence.length) dimension.evidence.forEach((item) => evidenceRoot.appendChild(createEvidence(item)));
      else {
        const empty = document.createElement("p");
        empty.className = "dim-explain";
        empty.textContent = "目前還無法穩定判斷這個面向，麥麥不會勉強替你下結論。";
        evidenceRoot.appendChild(empty);
      }
      const explanation = document.createElement("p");
      explanation.className = "dim-explain";
      explanation.textContent = effective && effective.correctionApplied
        ? effective.effectiveExplanation
        : dimension.explanation;

      const feedbackBlock = document.createElement("fieldset");
      feedbackBlock.className = "feedback-block";
      const legend = document.createElement("legend");
      legend.textContent = "這像我嗎？";
      const options = document.createElement("div");
      options.className = "feedback-options";
      const currentValue = selectedFeedback(dimension.key);
      ["accurate", "partiallyAccurate", "inaccurate", "unsure"].forEach((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = feedbackLabel(value);
        button.dataset.feedback = value;
        button.setAttribute("aria-pressed", String(currentValue === value));
        button.disabled = Object.keys(feedbackInFlight).length > 0 || terminalActionInFlight;
        button.onclick = () => {
          if (value === "partiallyAccurate" || value === "inaccurate") openCorrection(dimension.key, value);
          else sendDimensionFeedback(dimension.key, { value, createdAt: new Date().toISOString() });
        };
        options.appendChild(button);
      });
      const status = document.createElement("div");
      status.setAttribute("aria-live", "polite");
      renderFeedbackStatus(dimension.key, status);
      feedbackBlock.append(legend, options, status);
      bodyInner.append(evidenceTitle, evidenceRoot, explanation, feedbackBlock);
      body.appendChild(bodyInner);

      toggle.onclick = () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        body.classList.toggle("on", open);
        body.setAttribute("aria-hidden", String(!open));
        if ("inert" in body) body.inert = !open;
        if (open) {
          expandedDimensions.add(dimension.key);
          track("maimate_profile_dimension_expanded");
        } else expandedDimensions.delete(dimension.key);
      };
      card.append(toggle, body);
      root.appendChild(card);
    });
  }

  function renderBasis() {
    const root = el("basis-content");
    root.innerHTML = "";
    const coverage = activeResult.coverage;
    const dataTypes = [];
    if (coverage.portfolioAvailable) dataTypes.push("目前持倉");
    if (coverage.transactionCount) dataTypes.push(coverage.transactionCount.toLocaleString("en-US") + " 筆交易紀錄");
    if (coverage.fundingHistoryAvailable) dataTypes.push("入出金紀錄");
    if (coverage.questionnaireCompleted) dataTypes.push(coverage.questionnaireAnswerCount + " 題補充問卷");
    const rows = [
      ["資料期間", coveragePeriod(coverage)],
      ["使用資料", dataTypes.length ? dataTypes.join("、") : "目前沒有足夠資料"],
      // 報告只給最大持有標的與占比時 assetCount 是 null → 明說未提供，不補數字
      ["持有資產", !coverage.portfolioAvailable ? "未使用持倉資料"
        : coverage.assetCount == null ? "報告未提供各幣種比例" : coverage.assetCount + " 項"],
      ["問卷狀態", coverage.questionnaireCompleted ? "已完成 " + coverage.questionnaireAnswerCount + " / " + coverage.questionnaireAnswerCount : "稍後補充"],
      ["入出金資料", coverage.fundingHistoryAvailable ? "已使用" : "未使用"],
      ["分析時間", formatDate(activeResult.createdAt)],
      ["分析版本", activeResult.resultVersion],
      ["資料完整程度", coverageLabel(coverage.coverage)],
    ];
    rows.forEach(([label, value]) => {
      const p = document.createElement("p");
      const b = document.createElement("b");
      b.textContent = label + "：";
      p.append(b, document.createTextNode(value));
      root.appendChild(p);
    });
  }

  function renderTags() {
    const root = el("profile-tags");
    root.innerHTML = "";
    activeResult.tags.forEach((tag) => {
      const span = document.createElement("span");
      span.className = "profile-tag";
      span.textContent = tag.label;
      root.appendChild(span);
    });
  }

  function renderChips() {
    const coverage = activeResult.coverage;
    const values = [
      coveragePeriod(coverage),
      coverage.transactionCount ? coverage.transactionCount.toLocaleString("en-US") + " 筆交易" : "交易紀錄未使用",
      !coverage.portfolioAvailable ? "持倉資料未使用"
        : coverage.assetCount == null ? "無各幣種持倉明細" : coverage.assetCount + " 項持有資產",
      coverage.questionnaireCompleted ? coverage.questionnaireAnswerCount + " 題補充回答" : "問卷稍後補充",
    ];
    if (!coverage.fundingHistoryAvailable) values.push("未使用入出金紀錄");
    if (coverage.coverage === "limited") values.push("初步樣貌・資料仍在累積");
    if (activeContext.usingPreviousResult) values.unshift("顯示上次成功整理結果");
    const root = el("profile-data-chips");
    root.innerHTML = "";
    values.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "data-chip";
      chip.textContent = text;
      root.appendChild(chip);
    });
  }

  function renderObservationList(id, observations, expandable) {
    const root = el(id);
    root.innerHTML = "";
    observations.forEach((observation) => {
      const item = expandable ? document.createElement("details") : document.createElement("div");
      item.className = expandable ? "attention-item" : "observation";
      if (expandable) {
        const summary = document.createElement("summary");
        summary.textContent = observation.text;
        const evidenceText = [];
        observation.evidenceIds.forEach((evidenceId) => {
          activeResult.dimensions.forEach((dimension) => {
            const evidence = dimension.evidence.find((point) => point.id === evidenceId);
            if (evidence) evidenceText.push(evidence.label + "：" + evidence.value);
          });
        });
        const why = document.createElement("p");
        why.textContent = evidenceText.length
          ? "為什麼會看到這個？" + evidenceText.join("；") + "。"
          : "為什麼會看到這個？目前資料仍有限，因此只保留提醒，不補造數字。";
        item.append(summary, why);
      } else {
        const text = document.createElement("div");
        text.textContent = observation.text;
        item.appendChild(text);
        if (observation.sourceLabels.length) {
          const labels = document.createElement("div");
          labels.className = "source-labels";
          observation.sourceLabels.forEach((sourceText) => {
            const label = document.createElement("span");
            label.className = "source-label";
            label.textContent = sourceText;
            labels.appendChild(label);
          });
          item.appendChild(labels);
        }
      }
      root.appendChild(item);
    });
  }

  function renderSupportPlan() {
    const root = el("support-plan");
    root.innerHTML = "";
    const plans = activeContext && activeContext.effectiveProfile && Array.isArray(activeContext.effectiveProfile.supportPlan)
      ? activeContext.effectiveProfile.supportPlan
      : activeResult.supportPlan;
    plans.slice().sort((a, b) => a.priority - b.priority).forEach((plan) => {
      const item = document.createElement("div");
      item.className = "support-item";
      const title = document.createElement("b");
      title.textContent = plan.title;
      const description = document.createElement("p");
      description.textContent = plan.description;
      item.append(title, description);
      root.appendChild(item);
    });
  }

  function renderOverallFeedback() {
    const current = pendingOverall
      ? pendingOverall.value
      : activeContext.overallFeedback ? activeContext.overallFeedback.value : "";
    el("overall-options").querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.overall === current));
      button.disabled = overallStatus === "saving" || terminalActionInFlight;
    });
    const status = el("overall-feedback-status");
    status.className = "feedback-status" + (overallStatus === "error" ? " error" : "");
    status.innerHTML = "";
    if (overallStatus === "saving") status.textContent = "正在儲存…";
    else if (overallStatus === "saved" || activeContext.overallFeedback) status.textContent = "已記下";
    else if (overallStatus === "error") {
      status.append(document.createTextNode("這次沒有成功儲存，你的選擇還在。"));
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sheet-secondary";
      retry.textContent = "重新送出";
      retry.onclick = () => saveOverallFeedback(pendingOverall.value);
      status.appendChild(retry);
    }
  }

  function renderActions() {
    if (!activeResult) return;
    const hasPendingCorrections = Object.values(pendingFeedback).some((item) => item.selectedCorrection || item.note);
    const hasCorrections = Boolean(activeContext.corrections.length || hasPendingCorrections);
    const confirmed = activeResult.status === "confirmed";
    const main = el("btn-profile-confirm");
    const secondary = el("btn-profile-adjust");
    const later = el("btn-profile-later");
    const row = secondary.parentElement;
    if (confirmed) {
      main.textContent = "進入我的 MaiMate";
      secondary.textContent = "更新樣貌";
      later.hidden = true;
      row.classList.add("single");
    } else if (hasCorrections) {
      main.textContent = "儲存樣貌，進入 MaiMate";
      secondary.textContent = "繼續調整";
      later.hidden = false;
      row.classList.remove("single");
    } else {
      main.textContent = "這很像我，進入 MaiMate";
      secondary.textContent = "調整我的樣貌";
      later.hidden = false;
      row.classList.remove("single");
    }
  }

  function updateActionClearance() {
    const actions = el("profile-result-actions");
    if (actions.hidden) return;
    el("view-profile-result").style.paddingBottom = (actions.offsetHeight + 24) + "px";
  }

  function renderProfile(context) {
    if (transientResultId !== context.profileResult.id) {
      Object.keys(pendingFeedback).forEach((key) => delete pendingFeedback[key]);
      Object.keys(feedbackStatus).forEach((key) => delete feedbackStatus[key]);
      Object.keys(feedbackInFlight).forEach((key) => delete feedbackInFlight[key]);
      dimensionWriteQueue = Promise.resolve();
      pendingOverall = null;
      overallStatus = "";
      overallInFlight = null;
      correctionDraft = null;
      expandedDimensions.clear();
      expandedDimensions.add("tradingRhythm");
      transientResultId = context.profileResult.id;
    }
    activeContext = context;
    activeResult = context.profileResult;
    setHeroTitle(activeResult.coverage.coverage === "limited"
      ? ["麥麥先整理出", "一個初步樣貌"]
      : ["這是麥麥", "目前看到的你"]);
    el("result-intro").textContent = activeResult.coverage.coverage === "limited"
      ? "目前可用資料還不多，以下內容只代表初步觀察，之後會隨著資料增加慢慢更新。"
      : "不是分數，也不是定型。這是根據目前資料整理出的起點，之後會隨著你的使用慢慢更新。";
    renderHeadline();
    el("profile-summary-copy").textContent = activeResult.summary;
    renderTags();
    renderChips();
    renderDimensions();
    renderObservationList("stable-patterns", activeResult.stablePatterns, false);
    renderObservationList("attention-points", activeResult.attentionPoints, true);
    renderSupportPlan();
    renderOverallFeedback();
    renderBasis();
    renderActions();
    el("profile-result-loading").hidden = true;
    el("profile-result-load-error").hidden = true;
    el("profile-result-missing").hidden = true;
    el("profile-result-content").hidden = false;
    el("profile-result-actions").hidden = false;
    requestAnimationFrame(updateActionClearance);
    if (trackedResultId !== activeResult.id) {
      trackedResultId = activeResult.id;
      track("maimate_profile_result_viewed");
    }
  }

  function showResultState(stateName) {
    el("profile-result-loading").hidden = stateName !== "loading";
    el("profile-result-load-error").hidden = stateName !== "load-error";
    el("profile-result-missing").hidden = stateName !== "missing";
    el("profile-result-content").hidden = true;
    el("profile-result-actions").hidden = true;
    el("view-profile-result").style.paddingBottom = "40px";
  }

  async function renderProfileResult() {
    stopTimers();
    const epoch = viewRequestEpoch;
    showResultState("loading");
    const state = OnboardingStore.read();
    try {
      let context = await services.profile.getProfileContext();
      if (!routeRequestIsCurrent(epoch, "#/profile-result")) return;
      if (!context.profileResult && state.analysisJob && state.analysisJob.status === "succeeded") {
        context = await services.profile.getProfileContext();
        if (!routeRequestIsCurrent(epoch, "#/profile-result")) return;
      }
      if (!context.profileResult) {
        const failed = state.analysisJob && state.analysisJob.status === "failed";
        el("profile-missing-title").textContent = failed ? "這次沒有分析完成" : "結果還沒準備好";
        el("profile-missing-copy").textContent = failed
          ? "目前沒有可顯示的舊結果。請返回分析頁重新分析，或使用展示結果繼續體驗。"
          : "分析工作已完成，但這次沒有取得結果。你可以重新建立展示結果，不會重新分析原始資料。";
        el("btn-profile-rebuild").textContent = failed ? "使用展示結果" : "重新建立結果";
        showResultState("missing");
        return;
      }
      if (!resultMatchesState(state, context.profileResult)) {
        routeTo("#/analyzing");
        return;
      }
      context.usingPreviousResult = Boolean(
        state.analysisJob.status === "failed" &&
        context.profileResult.analysisJobId !== state.analysisJob.id
      );
      renderProfile(context);
    } catch (_) {
      if (routeRequestIsCurrent(epoch, "#/profile-result")) {
        showResultState("load-error");
        track("maimate_profile_load_failed");
      }
    }
  }

  function focusableIn(sheet) {
    return Array.from(sheet.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
  }

  function openNamedSheet(name) {
    if (correctionSaving) return;
    if (activeSheetName) closeNamedSheet(activeSheetName, false);
    const root = el(name + "-root");
    const sheet = root.querySelector(".sheet");
    sheetReturnFocus = document.activeElement;
    activeSheetName = name;
    root.classList.add("sheet-open");
    sheet.setAttribute("aria-hidden", "false");
    if ("inert" in document.querySelector("main")) {
      document.querySelector("main").inert = true;
      document.querySelector(".topbar").inert = true;
    }
    const close = sheet.querySelector(".x");
    (close || sheet).focus();
  }

  function closeNamedSheet(name, restoreFocus) {
    if (name === "correction" && correctionSaving) return;
    const root = el(name + "-root");
    const sheet = root.querySelector(".sheet");
    root.classList.remove("sheet-open");
    sheet.setAttribute("aria-hidden", "true");
    if ("inert" in document.querySelector("main")) {
      document.querySelector("main").inert = false;
      document.querySelector(".topbar").inert = false;
    }
    if (activeSheetName === name) activeSheetName = "";
    if (name === "correction") correctionDraft = null;
    if (restoreFocus !== false && sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus();
    sheetReturnFocus = null;
  }

  function openBasis() {
    if (!activeResult) return;
    renderBasis();
    openNamedSheet("basis");
    track("maimate_profile_basis_opened");
  }

  function openContextHelp() {
    if (location.hash === "#/profile-result") {
      openBasis();
      return true;
    }
    return false;
  }

  function sanitizeNote(value) {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 200).trim();
  }

  function setCorrectionBusy(value) {
    correctionSaving = value;
    el("correction-root").querySelectorAll("button,textarea").forEach((control) => {
      control.disabled = value;
    });
  }

  async function saveCorrection() {
    if (!correctionDraft || correctionSaving) return;
    const draft = Object.assign({}, correctionDraft, { note: sanitizeNote(el("correction-note").value) });
    correctionDraft.note = draft.note;
    const dimensionKey = draft.dimensionKey;
    const feedback = {
      value: draft.value,
      selectedCorrection: draft.selectedCorrection || undefined,
      note: draft.note || undefined,
      createdAt: new Date().toISOString(),
    };
    el("correction-error").textContent = "";
    const button = el("btn-save-correction");
    setCorrectionBusy(true);
    button.textContent = "正在儲存…";
    pendingFeedback[dimensionKey] = feedback;
    try {
      const saved = await sendDimensionFeedback(dimensionKey, feedback);
      if (!saved) throw new Error("CORRECTION_SAVE_FAILED");
      track("maimate_profile_correction_submitted");
      setCorrectionBusy(false);
      closeNamedSheet("correction", true);
    } catch (_) {
      el("correction-error").textContent = "這次沒有成功儲存，你的內容還在。";
    } finally {
      setCorrectionBusy(false);
      button.textContent = "儲存調整";
    }
  }

  function firstUnansweredDimension() {
    return activeResult.dimensions.find((dimension) => !selectedFeedback(dimension.key)) || activeResult.dimensions[0];
  }

  function scrollToDimension(dimension) {
    if (!dimension) return;
    expandedDimensions.add(dimension.key);
    renderDimensions();
    const target = el("profile-dimensions").querySelector('[data-dimension="' + dimension.key + '"]');
    if (target) target.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
  }

  function saveOverallFeedback(value) {
    if (overallInFlight) return overallInFlight;
    const resultId = activeResult.id;
    pendingOverall = { value, createdAt: new Date().toISOString() };
    overallStatus = "saving";
    renderOverallFeedback();
    const submittedFeedback = pendingOverall;
    const request = (async () => {
      try {
        const response = await services.profile.submitOverallFeedback(resultId, submittedFeedback);
        if (!activeResult || activeResult.id !== resultId) return true;
        activeContext.overallFeedback = response.overallFeedback || submittedFeedback;
        pendingOverall = null;
        overallStatus = "saved";
        track("maimate_profile_overall_feedback_selected");
        renderOverallFeedback();
        if (value === "needsRevision") scrollToDimension(firstUnansweredDimension());
        return true;
      } catch (_) {
        if (activeResult && activeResult.id === resultId) {
          overallStatus = "error";
          renderOverallFeedback();
        }
        return false;
      } finally {
        if (overallInFlight === request) overallInFlight = null;
      }
    })();
    overallInFlight = request;
    return request;
  }

  async function syncPendingFeedback() {
    for (const key of Object.keys(pendingFeedback)) {
      const saved = await (feedbackInFlight[key] || sendDimensionFeedback(key, pendingFeedback[key]));
      if (!saved) throw new Error("PENDING_FEEDBACK_FAILED");
    }
    if (pendingOverall) {
      const saved = await (overallInFlight || saveOverallFeedback(pendingOverall.value));
      if (!saved) throw new Error("PENDING_OVERALL_FAILED");
    }
  }

  function setTerminalActionBusy(value) {
    terminalActionInFlight = value;
    el("btn-profile-confirm").disabled = value;
    el("btn-profile-later").disabled = value;
    el("btn-profile-adjust").disabled = value;
    if (activeResult) {
      renderDimensions();
      renderOverallFeedback();
    }
  }

  function navigateNext(response) {
    if (!response || !response.nextRoute) throw new Error("NEXT_ROUTE_MISSING");
    if (!window.MM_NAVIGATION || typeof window.MM_NAVIGATION.resolveRoute !== "function") {
      throw new Error("NEXT_ROUTE_GUARD_UNAVAILABLE");
    }
    const resolved = window.MM_NAVIGATION.resolveRoute(response.nextRoute);
    if (!resolved) throw new Error("NEXT_ROUTE_NOT_ALLOWED");
    location.href = resolved;
  }

  async function confirmProfile() {
    if (terminalActionInFlight) return;
    el("profile-action-error").textContent = "";
    setTerminalActionBusy(true);
    try {
      await syncPendingFeedback();
      let overallValue = activeContext.overallFeedback ? activeContext.overallFeedback.value : "";
      if (!overallValue) {
        const saved = await saveOverallFeedback("accurate");
        if (!saved) throw new Error("OVERALL_FEEDBACK_FAILED");
        overallValue = "accurate";
      }
      const response = await services.profile.confirmProfile(activeResult.id, {
        overallFeedback: overallValue,
        acceptEffectiveProfile: true,
      });
      track("maimate_profile_confirmed");
      navigateNext(response);
    } catch (_) {
      setTerminalActionBusy(false);
      el("profile-action-error").textContent = "還沒有完成儲存。你的調整不會消失，可以再試一次。";
    }
  }

  async function continueLater() {
    if (terminalActionInFlight) return;
    el("profile-action-error").textContent = "";
    setTerminalActionBusy(true);
    try {
      await syncPendingFeedback();
      const response = await services.profile.continueWithoutConfirmation(activeResult.id);
      track("maimate_profile_continue_without_confirmation");
      navigateNext(response);
    } catch (_) {
      setTerminalActionBusy(false);
      el("profile-action-error").textContent = "還沒有完成儲存。你的調整不會消失，可以再試一次。";
    }
  }

  async function rebuildProfileResult() {
    showResultState("loading");
    try {
      const state = OnboardingStore.read();
      const result = state.analysisJob && state.analysisJob.status === "failed"
        ? await services.analysis.useDemoFallback()
        : await services.analysis.rebuildProfileResult();
      const context = await services.profile.getProfileContext();
      context.profileResult = result;
      renderProfile(context);
    } catch (_) {
      showResultState("load-error");
    }
  }

  function returnToAnalysis() {
    reviewingCompleted = true;
    routeTo("#/analyzing");
  }

  el("btn-view-result").onclick = () => routeTo("#/profile-result");
  el("btn-analysis-retry").onclick = async () => {
    try {
      services.setFailureMode(false);
      track("maimate_analysis_retried");
      if (activeJob) await services.analysis.retryAnalysis(activeJob.id);
      renderAnalyzing();
    } catch (_) {
      showFailed();
    }
  };
  el("btn-analysis-fallback").onclick = async () => {
    if (failedPreviousResultAvailable) {
      services.setFailureMode(false);
      routeTo("#/profile-result");
      return;
    }
    try {
      await services.analysis.useDemoFallback();
      track("maimate_analysis_demo_fallback_selected");
      routeTo("#/profile-result");
    } catch (_) {
      showFailed(false);
    }
  };
  el("btn-analysis-back").onclick = () => routeTo("#/profile");
  el("btn-session-reset").onclick = () => {
    OnboardingStore.resetExpiredDemoSession();
    routeTo("#/consent");
  };
  el("header-profile-basis").onclick = openBasis;
  el("footer-profile-basis").onclick = openBasis;
  el("btn-profile-confirm").onclick = confirmProfile;
  el("btn-profile-later").onclick = continueLater;
  el("btn-profile-adjust").onclick = () => scrollToDimension(firstUnansweredDimension());
  el("btn-save-correction").onclick = saveCorrection;
  el("btn-profile-reload").onclick = renderProfileResult;
  el("btn-profile-error-back").onclick = returnToAnalysis;
  el("btn-profile-missing-back").onclick = returnToAnalysis;
  el("btn-profile-rebuild").onclick = rebuildProfileResult;
  el("footer-consent-settings").onclick = () => routeTo("#/consent");
  el("correction-note").oninput = () => {
    const value = el("correction-note").value.slice(0, 200);
    el("correction-note").value = value;
    el("correction-count").textContent = String(200 - value.length);
    if (correctionDraft) correctionDraft.note = value;
  };
  el("overall-options").querySelectorAll("button").forEach((button) => {
    button.onclick = () => saveOverallFeedback(button.dataset.overall);
  });
  document.querySelectorAll("[data-close-sheet]").forEach((button) => {
    button.addEventListener("click", () => closeNamedSheet(button.dataset.closeSheet, true));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSheetName) {
      event.preventDefault();
      closeNamedSheet(activeSheetName, true);
      return;
    }
    if (event.key !== "Tab" || !activeSheetName) return;
    const sheet = el(activeSheetName + "-root").querySelector(".sheet");
    const focusable = focusableIn(sheet);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  if ("ResizeObserver" in window) {
    actionResizeObserver = new ResizeObserver(updateActionClearance);
    actionResizeObserver.observe(el("profile-result-actions"));
  }

  return {
    renderAnalyzing,
    renderProfileResult,
    stopTimers,
    openContextHelp,
    openUsageSheet() { openNamedSheet("usage"); },
    closeUsageSheet() { closeNamedSheet("usage", true); },
    returnToAnalysis,
    prepareCompletedReview() { reviewingCompleted = true; },
    resultMatchesState,
    setNetworkMode(mode) { services.setFailureMode(mode === "fail"); },
  };
})();

window.MM_ANALYSIS_UI = AnalysisUI;
