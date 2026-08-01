/* Screen 6 Bottom Navigation 的設定 Placeholder。
 * 只導向既有安全頁面，不讀取或複製 Profile／Mock Data。
 */
"use strict";

(function initSettings() {
  const navigation = window.MM_NAVIGATION;

  function navigate(route) {
    if (navigation && navigation.navigate({ id: "settings_navigation", route })) return;
    const message = document.getElementById("settings-message");
    message.querySelector("b").textContent = "這個頁面暫時無法開啟";
    message.querySelector("p").textContent = "請回到 MaiMate 首頁後再試一次。";
  }

  document.getElementById("btn-back").onclick = () => navigate("/maimate/home");
  // from=settings：讓 onboarding 各頁的返回鍵回到設定頁，而不是掉回行銷入口頁
  document.getElementById("btn-profile").onclick = () => {
    window.location.assign("onboarding.html?from=settings#/profile-result");
  };
  document.getElementById("btn-consent").onclick = () => {
    window.location.assign("onboarding.html?from=settings#/consent");
  };

  /* 使用者若曾點「先看示範帳戶」，自己的作答會被示範人格覆蓋；這裡提供換回入口 */
  const restore = document.getElementById("btn-restore");
  if (typeof OnboardingStore !== "undefined" && OnboardingStore.hasUserSnapshot()) {
    restore.hidden = false;
    restore.onclick = () => {
      if (!OnboardingStore.restoreUserState()) return;
      restore.hidden = true;
      const message = document.getElementById("settings-message");
      message.querySelector("b").textContent = "已換回你自己的設定";
      message.querySelector("p").textContent = "麥麥會依你原本的作答重新整理首頁內容。";
      navigate("/maimate/home");
    };
  }
  document.getElementById("btn-notifications").onclick = () => {
    const message = document.getElementById("settings-message");
    message.querySelector("b").textContent = "通知設定即將提供";
    message.querySelector("p").textContent = "目前不會自行開啟任何買賣或價格預測通知。";
    message.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });

  /* ── 資料來源 ────────────────────────────────────────────────────────
   * 這頁其餘項目都是本機偏好，唯一有後端可接的是「數字從哪來、算到哪一天」。
   * 刻意不載入 home-service.js 那條鏈（4 支檔、僅為了一行字不划算），直接查 /health。
   *
   * 逾時 2.5 秒與 home-service 一致：場地網路每 5 次連線掉 1 次（CLAUDE.md 待辦），
   * 沒有逾時這行字會一直卡在「正在確認…」。取不到就明說是示範資料，不留白也不假裝。
   */
  (async function renderDataSource() {
    const title = document.getElementById("data-source-title");
    const detail = document.getElementById("data-source-detail");
    if (!title || !detail) return;

    const demo = () => {
      title.textContent = "目前使用示範資料";
      detail.textContent = "尚未連上分析服務，畫面上的數字來自內建的示範報告，不是你的帳戶。";
    };
    if (!window.API_BASE) return demo();

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2500);
    let report = null;
    try {
      /* no-store 的理由見 home-service.js 同一個呼叫點：/health 是
         `public, max-age=3600` 但 ACAO 只在帶 Origin 時才回、又沒有 Vary: Origin，
         共用快取一被不帶 Origin 的請求灌進去，跨來源 fetch 就整整一小時拿不到。 */
      const response = await fetch(window.API_BASE + "/health", { signal: abort.signal, cache: "no-store" });
      if (response.ok) report = await response.json();
    } catch (_) { /* 落回示範資料 */ }
    finally { clearTimeout(timer); }

    const period = report && report.period;
    if (!report || !period || typeof period.start !== "string") return demo();

    title.textContent = "你的交易紀錄分析報告";
    const rows = Number(report.row_count);
    const parts = [period.start + " 至 " + period.end];
    if (Number.isFinite(rows)) parts.push("共 " + rows.toLocaleString("en-US") + " 筆紀錄");
    /* 只裁切後端給的字串，不自行換算時區（鐵則：時間以後端為準）。 */
    if (typeof report.generated_at === "string" && report.generated_at.length >= 10) {
      parts.push("報告產生於 " + report.generated_at.slice(0, 10));
    }
    detail.textContent = parts.join("　·　");
  })();
})();
