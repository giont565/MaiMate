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
  document.getElementById("btn-profile").onclick = () => {
    window.location.assign("onboarding.html#/profile-result");
  };
  document.getElementById("btn-consent").onclick = () => {
    window.location.assign("onboarding.html#/consent");
  };
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
