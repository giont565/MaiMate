/* Screen 7 導航 Context：
 * 顯示首頁來源、預填問題，但絕不自動送出。
 * 第一次由使用者按下送出時，才把白名單 ID Context 附在請求。
 */
"use strict";

(function initChatContext() {
  const envelope = window.MM_NAVIGATION
    ? window.MM_NAVIGATION.consumeContext("chat")
    : null;
  let requestContextUsed = false;

  function sourceTitle(context) {
    const labels = {
      today_relevant_hero: "今天，什麼和你有關？",
      home_contextual_question: "從首頁繼續問",
      account_attribution: "帳戶變化原因",
      plan_alignment: "原本的我 vs 最近的我",
      similar_moment: "相似時刻回放",
      personalized_insight: "麥麥幫你注意到",
      persistent_chat_entry: "首頁提問",
    };
    return labels[context && context.source] || "MaiMate 投資導航";
  }

  function render() {
    if (!envelope) return;
    const card = document.getElementById("navigation-source");
    const title = document.getElementById("navigation-source-title");
    const meta = document.getElementById("navigation-source-meta");
    const input = document.getElementById("q");
    if (card && title && meta) {
      title.textContent = "接續自「" + sourceTitle(envelope.context) + "」";
      const asset = envelope.context && envelope.context.relatedAsset;
      meta.textContent = asset
        ? "麥麥會帶著 " + asset + " 的相關背景一起回答，你仍可先修改問題。"
        : "麥麥會帶著剛才的來源背景一起回答，你仍可先修改問題。";
      card.hidden = false;
    }
    if (input && envelope.question) input.value = envelope.question;
  }

  function takeRequestContext() {
    if (!envelope || requestContextUsed) return null;
    requestContextUsed = true;
    const result = Object.assign({}, envelope.context || {});
    if (envelope.questionId) result.questionId = envelope.questionId;
    if (envelope.actionId) result.actionId = envelope.actionId;
    return Object.keys(result).length ? result : null;
  }

  window.MM_CHAT_CONTEXT = Object.freeze({
    takeRequestContext,
    hasPrefill: Boolean(envelope && envelope.question),
  });
  render();
})();
