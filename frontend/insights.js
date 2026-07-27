/* Screen 8 洞察入口／Placeholder。
 * 路由與 Context 由 MM_NAVIGATION 提供；不從 URL 接收完整問題或金融資料。
 */
"use strict";

(function initInsights() {
  const navigation = window.MM_NAVIGATION;
  const envelope = navigation ? navigation.consumeContext("insight") : null;
  const route = envelope ? envelope.route : "/maimate/insights";
  const context = envelope ? envelope.context || {} : {};
  const detailKey = route.startsWith("/maimate/insights/")
    ? route.slice("/maimate/insights/".length).split("/")[0]
    : "";
  const DETAILS = Object.freeze({
    "today-impact": {
      title: "今天的市場怎麼影響你的帳戶",
      copy: "完整內容會從首頁的市場情境、主要持倉與近期行為繼續展開，並清楚區分已知資料與目前還不能確定的部分。",
      question: "今天的市場變化，為什麼會影響我的帳戶？",
    },
    "plan-alignment": {
      title: "原本的我 vs 最近的我",
      copy: "完整內容會把問卷中的原本計畫，和帳戶紀錄顯示的近期行為分開呈現；這是對照，不是紀律或能力評分。",
      question: "我最近的紀錄和原本設定的方向，有哪些相同或不同？",
    },
    "account-change": {
      title: "今天的帳戶變化從哪裡來",
      copy: "完整內容會呈現可用的原因拆解；若目前只能估算，會明確標示，不把估算說成精準會計歸因。",
      question: "今天的帳戶變化主要是哪些因素造成的？",
    },
    "similar-moment": {
      title: "這個情況，以前遇過嗎",
      copy: "完整內容只會比較可解釋的相似與不同之處。相似情境不代表市場會重複，也不是買賣建議。",
      question: "這次和過去相似情況，有哪些相同或不同？",
    },
    "concentration-basics": {
      title: "為什麼持倉集中會放大帳戶變化",
      copy: "完整內容會用首頁已確認的比例資料說明資產占比與帳戶變化的關係，不提供最佳比例或要求調整。",
      question: "持倉占比較高時，為什麼會放大帳戶變化？",
    },
  });

  function navigate(action) {
    if (!navigation || !navigation.navigate(action)) {
      const source = document.getElementById("insight-source");
      document.getElementById("insight-source-copy").textContent = "這個站內頁面暫時無法開啟。";
      source.classList.add("on");
    }
  }

  function contextCopy() {
    const asset = context.relatedAsset;
    if (asset) return "已帶入 " + asset + " 的首頁來源背景；不會顯示敏感金額或完整持倉。";
    if (context.source) return "已帶入首頁模組的來源背景；不會把內部識別碼顯示在頁面上。";
    return "";
  }

  function render() {
    const detail = DETAILS[detailKey];
    if (envelope) {
      const copy = contextCopy();
      if (copy) {
        document.getElementById("insight-source-copy").textContent = copy;
        document.getElementById("insight-source").classList.add("on");
      }
    }
    if (!detail) return;
    document.getElementById("insight-index").hidden = true;
    document.getElementById("insight-detail").classList.add("on");
    document.getElementById("page-heading").textContent = "把這件事看得更清楚";
    document.getElementById("page-intro").textContent = "沿用剛才的資料依據，逐步展開重點與限制。";
    document.getElementById("detail-title").textContent = detail.title;
    document.getElementById("detail-copy").textContent = detail.copy;
    document.getElementById("btn-detail-ask").onclick = () => navigation.openChat({
      id: envelope && envelope.actionId ? envelope.actionId + "_ask" : "insight_followup",
      questionId: envelope && envelope.questionId ? envelope.questionId : "question_insight_followup",
      question: detail.question,
      context: Object.assign({}, context, {
        source: "insight_detail",
      }),
    });
  }

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate({
      id: "insights_navigation",
      route: button.dataset.route,
    }));
  });
  document.querySelectorAll("[data-insight-route]").forEach((button) => {
    button.addEventListener("click", () => navigation.openInsight(button.dataset.insightRoute, {
      id: "insight_list_open",
      context: { source: "insights_list" },
    }));
  });
  document.getElementById("btn-back").onclick = () => {
    if (detailKey) window.location.assign("insights.html");
    else navigate({ id: "insights_back_home", route: "/maimate/home" });
  };
  document.getElementById("btn-all-insights").onclick = () => window.location.assign("insights.html");
  document.getElementById("btn-chat-entry").onclick = () => navigation.openChat({
    id: "insights_chat_entry",
    context: { source: "insights_entry" },
  });
  render();
})();
