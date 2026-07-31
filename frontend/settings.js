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
})();
