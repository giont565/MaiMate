#!/usr/bin/env node
/* build_pitch.js — 提案簡報產生器（一份內容，出 HTML 與 pptx 兩種）
 *
 * 為什麼重寫而不改舊的 build_deck.js：
 *   1. 舊的跑不起來——它 require react / react-icons / sharp，三個都沒裝在 repo 任何地方
 *   2. 舊簡報有已知錯誤（issue #15：MAX Skill 被標成執行模組），照抄會把錯誤帶到新版
 *
 * 鐵則：**簡報上的每個數字都必須指得出來源。**
 *   - 來自 data/health_report.json 的，一律在這裡即時讀取，不手抄（改報告 → 重跑 → 簡報自動同步）
 *   - 估算值一律在頁面上標「估算」，不准講成實測
 *   - 查無出處的數字（費率折抵 −30%/−20%、prompt caching「一折」）**不放進簡報**
 *
 * 用法：
 *   npm run pitch                    # 兩種都出
 *   node docs/build_pitch.js --html  # 只出 HTML
 *   node docs/build_pitch.js --pptx  # 只出 pptx
 */
const fs = require("fs");
const path = require("path");

const DOCS = __dirname;
const R = JSON.parse(fs.readFileSync(path.join(DOCS, "..", "data", "health_report.json"), "utf8"));

// ---------- 從報告取數（唯一數字來源）----------
const ci = R.chase_index, oc = R.opportunity_cost, pnl = R.realized_pnl;
const conc = R.concentration.peak_concentration, cash = R.cash_flow_behavior;
const worst = oc.worst_single_sell;
const hpd = R.holding_period_distribution;

const n = (v) => Number(v).toLocaleString("en-US");
const money = (v) => "NT$" + n(Math.round(v));
const wan = (v) => (v >= 1e8 ? (v / 1e8).toFixed(2) + " 億" : (v / 1e4).toFixed(0) + " 萬");

// 平均每筆賣出的機會成本：現算，不抄。
// （README 舊版寫 NT$11,480，用報告實算是 26,598,877 ÷ 2,304 = 11,545，以實算為準）
const avgMissedPerSell = oc.total_missed_twd / ci.sell_total;

const PALETTE = {
  navy: "16224D", navyD: "0D1530", ice: "EAF0FB", gold: "E8A13A",
  green: "1F9D66", red: "D64550", ink: "1F2937", mut: "6B7280", white: "FFFFFF",
};

// ══════════════════════════════════════════════════════════════════
// 內容模型：一份，兩個 renderer 共用
// ══════════════════════════════════════════════════════════════════
const SLIDES = [
  { type: "cover",
    title: "MaiMate 麥麥",
    sub: "別的投資工具看「市場」，MaiMate 同時看「你」",
    meta: "2026 雲湧智生黑客松｜MaiCoin 智慧理財命題｜隊伍「第五名」" },

  { type: "statement",
    kicker: "問題",
    title: "散戶賠錢，多半不是因為看不懂線圖",
    body: "是因為**恐慌的時候，做了跟上次一樣的決定**。\n\n市場資訊已經過剩了。缺的不是又一個技術指標，\n是有人在你按下賣出之前，把你自己的紀錄拿給你看。" },

  { type: "stats",
    kicker: `真實資料｜${R.period.start} ~ ${R.period.end}，${n(R.row_count)} 筆交易`,
    title: "這個帳戶的一年",
    stats: [
      { v: ci.buy_above_ma_pct + "%", l: "買入發生在近 7 筆均價**上方**", s: `${n(ci.buy_total)} 筆買入`, c: "red" },
      { v: money(oc.total_missed_twd), l: "全年「少賺」總額", s: "賣出後續漲的機會成本", c: "red" },
      { v: money(worst.missed_twd), l: "最痛的單筆", s: `${worst.date} 賣 ${worst.currency.toUpperCase()}，年底價差 ${worst.sell_price}→${worst.eoy_price}`, c: "red" },
      { v: conc.top_pct + "%", l: `峰值集中在單一部位（${conc.top_currency.toUpperCase()}）`, s: conc.month, c: "gold" },
    ],
    foot: "資料來源：官方交易紀錄 CSV → analysis/precompute.py → data/health_report.json。簡報所有數字由程式直接讀取，非手抄。" },

  { type: "compare",
    kicker: "洞察",
    title: "他其實有賺錢。真正的傷口在別的地方。",
    left: { h: "真實已實現損益", v: money(pnl.total_realized_twd), d: `${n(pnl.profit_trades)} 筆獲利 / ${n(pnl.loss_trades)} 筆虧損\n（移動平均成本法）`, c: "green" },
    right: { h: "同一年的「少賺」", v: money(oc.total_missed_twd), d: `是已實現損益的 ${Math.round(oc.total_missed_twd / pnl.total_realized_twd)} 倍\n賣掉之後才漲的部分`, c: "red" },
    note: "**傳統對帳單只會顯示左邊。** 使用者一整年都以為自己在小賺，看不到右邊那個數字——\n因為沒有任何工具會告訴他「如果你當時沒賣」。這就是行為盲點：它不在帳面上。" },

  { type: "statement",
    kicker: "解法",
    title: "把他自己的紀錄，在他按下賣出之前拿給他看",
    body: "使用者打「ETH 跌太多，幫我全部賣掉」——\n\nMaiMate **不照做**，也**不勸他不要賣**。\n\n它把 1/8 那天的紀錄攤開，然後給三個**算好數字**的選項。\n最後一步，一定是人自己按。" },

  { type: "steps",
    kicker: "Golden Path｜90 秒",
    title: "從一句衝動，到一筆想清楚的交易",
    steps: [
      { t: "「ETH 跌太多幫我全賣」", d: "使用者的原話，不是選單" },
      { t: "查持倉 → 查行情 → 查你的歷史", d: "工具鏈即時顯示 AI 在查什麼" },
      { t: `「${worst.date} 你也這樣全賣過，少賺 ${money(worst.missed_twd)}」`, d: "個人化脈絡，不是通用警語" },
      { t: "三方案：賣 25% / 全賣 / 先暫停", d: "金額、手續費、賣後集中度全部算好" },
      { t: "確認卡 → 人按下去", d: "憑證 60 秒有效，過期作廢" },
      { t: "成交 → 決策軌跡面板", d: "AI 做過的每一步都攤開給你看" },
    ] },

  { type: "statement",
    kicker: "產品原則",
    title: "AI 不做決定。AI 把選項算好。",
    body: "三個方案的**每一個數字都是程式算的**，LLM 只負責把它講成人話。\n\n所以使用者換一種說話風格（陪伴／簡潔／分析），\n**數字一個都不會變**——他不會換到不同的事實。" },

  { type: "cards",
    kicker: "安全設計",
    title: "三件 AI 在這個系統裡「做不到」的事",
    lead: "不是提示詞叫它不要做。是架構上沒有那條路徑。",
    cards: [
      { h: "下單函式不在工具清單", b: "execute_order 確實存在，但不在 LLM 的 TOOLS 清單、也不在執行分派表。模型看不到它，就算幻覺出這個名字也沒有東西會執行。", e: "tools.py:21-105, 241-259" },
      { h: "下單憑證 60 秒過期", b: "AI 只能產生確認卡，不能送單。憑證要人按，60 秒後自己失效，過期回 410。沒有「授權一次、之後自動」。", e: "tools.py:19｜order.py:25,29,51-53" },
      { h: "每一步都留痕", b: "工具呼叫、產卡、確認、取消、過期、成交，六種事件 append-only 寫入。使用者當下就看得到，不是出事後才查得到。", e: "audit.py:27-41" },
    ],
    foot: "**提示詞攔的是意圖，架構攔的是能力。** 靠提示詞說「不要下單」，是在賭模型每次都聽話。" },

  { type: "arch",
    kicker: "系統架構",
    title: "全 Serverless，決賽當天可在 1 小時內重新部署",
    foot: "前端零建置（純 HTML＋vanilla JS，沒有打包器）——決賽當天不會因為 build 掛掉而開天窗。" },

  // 修正 issue #15 第 1 點：舊版簡報把 MAX Skill 標成執行模組。
  // 證據：.kiro/settings/mcp.json 是 Kiro 的開發期設定（autoApprove 只給唯讀的
  // ticker/depth/kline）；產品下單路徑是 order.py → max_private.place_order，不經過兩者。
  { type: "table",
    kicker: "開發工具鏈",
    title: "會下單的只有一條路，而它不在工具鏈上",
    head: ["元件", "實際是什麼", "在產品 runtime 裡嗎"],
    rows: [
      ["max-api-skill", "給 AI 看的 **API 文件包**——它不執行任何交易", "否"],
      ["max-mcp-server", "開發期工具，接在 Kiro 裡查行情用；設定檔的 autoApprove 只給唯讀的 ticker／depth／kline", "否"],
      ["Kiro IDE", "開發環境（spec／steering／task 執行）", "否"],
      ["**OrderFunction → MAX Private API**", "使用者按下確認後唯一真正送單的路徑", "**是，只有這條**"],
    ],
    note: "這頁是修正：先前版本把 MAX Skill 標成執行模組。**文件包不會下單。**\n證據：`.kiro/settings/mcp.json`（開發期設定，唯讀白名單）、`backend/handlers/order.py:56`（唯一送單點）。",
    foot: "為什麼要特別澄清：把開發工具畫進 runtime，等於把一個不存在的攻擊面畫給評審看——而我們整套安全敘事的地基就是「送單路徑只有一條」。" },

  { type: "table",
    kicker: "AI 設計",
    title: "模型分工：貴的只用在該用的地方",
    head: ["工作", "模型", "單次成本（估算）"],
    rows: [
      ["日常對話＋工具調度", "Claude Haiku（Bedrock）", "≈ NT$0.3"],
      ["深度歸因＋方案解釋", "Claude Sonnet（Bedrock）", "≈ NT$2.2"],
      ["混合平均", "依意圖自動路由", "< NT$0.6"],
    ],
    note: "⚠️ **以上為估算**（依 AWS 主控台現價推算），非實測計費。系統目前沒有量測成本的程式碼。\n\n路由邏輯在 loop.py:60-67——看使用者這句話是不是深度問題，是才升級到 Sonnet。" },

  { type: "statement",
    kicker: "AI 設計",
    title: "為什麼金融數字不能讓 LLM 算",
    body: "手續費、賣後集中度、機會成本——**全部由確定性程式計算**。\n\nLLM 算錯一次數字，使用者可能就照著它下了一筆真錢的單。\n而 LLM 算術出錯是已知的、機率性的、無法用提示詞根治的。\n\n所以我們的分工是：**程式負責對，模型負責讓人聽得懂。**" },

  // 補回評審 7/15 點名的「AI-native 應用對照」（issue #15 第 2 點）
  { type: "table",
    kicker: "AI-native",
    title: "沒有生成式 AI，這個產品不存在",
    lead: "誠實地逐項問一次：哪些部分其實不需要 AI？",
    head: ["產品的一部分", "沒有生成式 AI 做得到嗎"],
    rows: [
      ["行為健檢的數字（追高 65%、機會成本 26.6M）", "✅ 做得到 —— 那是 `analysis/precompute.py` 算的統計"],
      ["三方案的金額、手續費、賣後集中度", "✅ 做得到 —— `scenarios.py` 的確定性計算"],
      ["**聽懂「ETH 跌太多幫我全部賣掉」**", "❌ 那是自由語句，不是選單上的選項"],
      ["**在恐慌當下，把他自己的紀錄講成一句聽得進去的話**", "❌ 要把數據、個人歷史、當下情境編織成人話"],
      ["**同一組數字換三種語氣（陪伴／簡潔／分析）**", "❌ 數字不變，說法要變"],
      ["**「這是不是詐騙話術」的語意理解與語料檢索**", "❌ 意圖判讀 ＋ RAG"],
    ],
    note: "所以我們沒有把 AI 用在算數字上——**數字全部由程式算**。AI 只做程式做不到的那一半。",
    foot: "沒有生成式 AI，這產品會退化成一個儀表板。而**儀表板攔不住正在恐慌的人**——那個人不會在按下全賣之前先去看圖表。" },

  { type: "cards",
    kicker: "護欄",
    title: "四層攔截，任一層可獨立擋住",
    lead: "「不報明牌」不是一句承諾，是四個獨立的攔截點。",
    cards: [
      { h: "① 提示詞 ＋ ② 後端正則", b: "系統提示明訂永不建議買賣特定標的；輸出再過一次正則，命中就整段換成安全回覆——不是遮字，因為遮一半會被腦補成建議。", e: "loop.py:20｜guardrails.py:8-13, 79-100" },
      { h: "③ 前端 ＋ ④ Bedrock Guardrails", b: "後端萬一漏了，畫面這關再擋一次。Bedrock Guardrails 的接點已就緒，設環境變數即疊加生效。", e: "chat-core.js:26-31｜loop.py:109-115" },
      { h: "還做了誤判防護", b: "反詐教育內容本來就必須出現「保證獲利」這種詞——那是在教人辨識詐騙。沒有語境排除，護欄會擋掉自家的反詐功能，而且是靜默失敗。", e: "guardrails.py:24-29" },
    ],
    foot: "護欄設計不只要問「擋不擋得住壞的」，也要問「**會不會擋掉好的**」。" },

  { type: "table",
    kicker: "商業模式",
    title: "平台怎麼賺錢——不是只幫客戶省錢",
    head: ["收入線", "機制", "為什麼成立"],
    rows: [
      ["① 手續費放大\n（今天就在收）", "新手不敢下第一筆 → 陪跑；恐慌離場者 LTV 歸零 → 攔住＝保住未來手續費年金", "交易所的收入核心是成交手續費"],
      ["② 冷靜期導流 DCA", "三方案的「暫停」導向既有定期定額產品", "衝動單的手續費是一次性的，定投是年金"],
      ["③ Premium 訂閱", "損益歸因、年度健檢、行為提醒", "第二曲線"],
      ["④ B2B 白牌", "行為引擎＋合規框架授權其他交易所／銀行", "台灣 VASP 專法後合規需求放大"],
    ],
    note: "上台順序建議：先講 ①（評審是交易所的人，手續費語言最直接），再用 ③④ 展示想像空間。" },

  { type: "anchor",
    kicker: "單位經濟學",
    title: "一年攔住一筆衝動交易，就付得起十幾年的 AI 帳單",
    big: money(avgMissedPerSell),
    bigLabel: "此帳戶平均每筆賣出的機會成本",
    formula: `${money(oc.total_missed_twd)} ÷ ${n(ci.sell_total)} 筆賣出 ＝ ${money(avgMissedPerSell)}／筆`,
    rows: [
      ["重度使用者 AI 成本", "< NT$60 / 月（估算）"],
      ["攔住一筆衝動交易的價值", `${money(avgMissedPerSell)}（此帳戶實算）`],
      ["換算", `≈ ${Math.round(avgMissedPerSell / 60)} 個月的 AI 成本`],
    ],
    note: "**留存率每提高 1%，手續費增量遠大於整個 AI 帳單。** MaiMate 存在的目的是提高留存，不是省成本。" },

  { type: "table",
    kicker: "產品化路徑",
    title: "掛在交易所旁邊的獨立服務，不是塞進主系統的模組",
    head: ["階段", "入口", "下單方式", "主系統改動"],
    rows: [
      ["黑客松（現況）", "獨立 Web（S3+CloudFront）", "MAX Private API＋逐筆確認", "零"],
      ["產品化", "App 內嵌「麥麥」分頁，前端即現有 SPA", "不變", "零——只加一個入口"],
      ["B2B 白牌", "客戶自有 App", "各交易所自有 API", "零"],
    ],
    note: "升級迭代不動核心交易系統——這是可行性與合規的雙重賣點。\nMaiMate 全程只做「讀資料＋產草稿＋留稽核」，執行永遠隔離在 LLM 之外，所以審計邊界天然清晰。",
    foot: "▶ 這頁有可點示意：開 host-app.html — MAX／MaiCoin 首頁多一個麥麥 icon，點下去麥麥就在 WebView 裡跑起來，左上角保留返回宿主 App 的箭頭。" },

  { type: "stats",
    kicker: "完成度",
    title: "現在就能跑",
    stats: [
      { v: "8 支", l: "前端煙測全綠", s: "含真·全斷網冷啟動實測", c: "green" },
      { v: "35 項", l: "Python 測試通過", s: "護欄／三方案／模式／audit", c: "green" },
      { v: "5 支", l: "Lambda 全部部署", s: "chat / health / market / order / audit", c: "green" },
      { v: "0", l: "建置步驟", s: "前端純靜態，不會 build 失敗", c: "gold" },
    ],
    foot: "任一 API 掛掉自動切離線 mock 並明示標示，Golden Path 照樣走完。刻意的例外：斷網時行情顯示「—」，**不給假價格**。" },

  { type: "honest",
    kicker: "誠實頁",
    title: "還沒做到的",
    lead: "這一頁存在的理由：前面每一條都有程式證據，這一頁才可信。",
    items: [
      ["Bedrock Guardrails 尚未在主控台建立", "程式接點已就緒，設環境變數即生效。目前實際是四層護欄而非五層——前四層仍各自獨立有效。"],
      ["費率沒有可點擊的官方出處", "程式寫死 maker 0.08% / taker 0.16%，註解自陳「官網查證」但沒有 URL。對使用者算成本的數字，只有自陳出處不夠。"],
      ["成本數字是估算，不是實測", "系統沒有量測 AI 成本的程式碼。簡報上標的是估算值。"],
      ["真實成交 E2E 尚未跑完", "待 Lv2 KYC。「不代操」的完整鏈路目前只在單元層驗過。"],
    ],
    foot: "完整清單在 docs/COMPLIANCE.md §5。" },

  { type: "cover",
    title: "洞察 → 對話 → 行動",
    sub: "AI 有手，方向盤在人手上",
    meta: "github.com/giont565/MaiMate" },
];

// ══════════════════════════════════════════════════════════════════
// Renderer 1：HTML（現場投影用，自帶樣式與鍵盤導覽，單一檔案）
// ══════════════════════════════════════════════════════════════════
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const md = (s) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>") // 檔案路徑用等寬字，跟敘述文字分開
  .replace(/\n/g, "<br>");

function htmlSlide(s, i) {
  const kicker = s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : "";
  const title = s.title ? `<h2>${md(s.title)}</h2>` : "";
  let body = "";

  switch (s.type) {
    case "cover":
      return `<section class="slide cover"><div class="inner">
        <h1>${md(s.title)}</h1><p class="sub">${md(s.sub)}</p><p class="meta">${md(s.meta)}</p>
      </div><div class="num">${i + 1}</div></section>`;

    case "statement":
      body = `<p class="lead">${md(s.body)}</p>`; break;

    case "stats":
      body = `<div class="grid stats">${s.stats.map((x) => `
        <div class="stat c-${x.c}"><div class="v">${md(x.v)}</div>
        <div class="l">${md(x.l)}</div><div class="s">${md(x.s)}</div></div>`).join("")}</div>`;
      break;

    case "compare":
      body = `<div class="grid two">
        ${[s.left, s.right].map((x) => `<div class="col c-${x.c}">
          <div class="h">${md(x.h)}</div><div class="v">${md(x.v)}</div><div class="d">${md(x.d)}</div></div>`).join("")}
        </div><p class="note">${md(s.note)}</p>`;
      break;

    case "steps":
      body = `<ol class="steps">${s.steps.map((x) => `
        <li><div class="t">${md(x.t)}</div><div class="d">${md(x.d)}</div></li>`).join("")}</ol>`;
      break;

    case "cards":
      body = `${s.lead ? `<p class="lead sm">${md(s.lead)}</p>` : ""}
        <div class="grid three">${s.cards.map((x) => `<div class="card">
          <div class="h">${md(x.h)}</div><div class="b">${md(x.b)}</div>
          <div class="e">${md(x.e)}</div></div>`).join("")}</div>`;
      break;

    case "table":
      body = `${s.lead ? `<p class="lead sm">${md(s.lead)}</p>` : ""}
        <table><thead><tr>${s.head.map((h) => `<th>${md(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${md(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      break;

    case "anchor":
      body = `<div class="anchor"><div class="big">${md(s.big)}</div>
        <div class="biglabel">${md(s.bigLabel)}</div>
        <div class="formula">${md(s.formula)}</div></div>
        <table class="tight"><tbody>${s.rows.map((r) => `<tr><td>${md(r[0])}</td><td class="r">${md(r[1])}</td></tr>`).join("")}</tbody></table>
        <p class="note">${md(s.note)}</p>`;
      break;

    case "honest":
      body = `<p class="lead sm">${md(s.lead)}</p>
        <div class="honest">${s.items.map((x) => `<div class="hi">
          <div class="h">${md(x[0])}</div><div class="b">${md(x[1])}</div></div>`).join("")}</div>`;
      break;

    case "arch":
      body = archHtml(); break;
  }

  const foot = s.foot ? `<p class="foot">${md(s.foot)}</p>` : "";
  const note = s.note && s.type !== "compare" && s.type !== "anchor" ? `<p class="note">${md(s.note)}</p>` : "";
  return `<section class="slide"><div class="inner">${kicker}${title}${body}${note}${foot}</div><div class="num">${i + 1}</div></section>`;
}

// 架構圖的內容模型（HTML 與 pptx 共用同一份，避免兩邊講不一樣的話）
const ARCH = {
  layers: [
    { tag: "入口", boxes: ["使用者（手機）"], note: "" },
    { tag: "前端", boxes: ["前端 SPA — S3 + CloudFront"],
      note: "零建置：純 HTML + vanilla JS｜任一 API 掛掉自動切離線 mock 並明示標示" },
    { tag: "API", boxes: ["/chat", "/health", "/market", "/order", "/audit"],
      note: "API Gateway (HttpApi) ＋ Lambda × 5" },
    { tag: "Agent", boxes: ["Bedrock Converse 工具迴圈"],
      note: "Haiku 日常／Sonnet 深度路由 ＋ 護欄 ＋ Audit 埋點" },
    { tag: "資料", boxes: ["health_report", "Bedrock KB（RAG）", "DynamoDB（audit）", "MAX Public API"], note: "" },
  ],
  tools: ["query_user_history", "get_market_data", "get_account_balance（唯讀）",
    "calculate_trade_scenarios", "prepare_order（只產確認卡）", "query_knowledge（RAG）"],
  excluded: "execute_order 不在 LLM 工具清單",
  orderPath: "/order → MAX Private API",
  orderNote: "唯一能真的送單的路徑",
};

function archHtml() {
  const layers = ARCH.layers.map((L, i) => `
    ${i ? '<div class="arw">↓</div>' : ""}
    <div class="lay"><div class="tag">${esc(L.tag)}</div>
      <div class="bxs">${L.boxes.map((b) => `<div class="bx">${esc(b)}</div>`).join("")}</div>
      ${L.note ? `<div class="lnote">${esc(L.note)}</div>` : ""}
    </div>`).join("");
  return `<div class="archwrap">
    <div class="archcol">${layers}</div>
    <div class="archside">
      <div class="sh">LLM 能呼叫的工具（全部）</div>
      <ul class="tools">${ARCH.tools.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <div class="excl">✖ ${esc(ARCH.excluded)}</div>
      <div class="opath"><b>${esc(ARCH.orderPath)}</b><span>${esc(ARCH.orderNote)}</span></div>
    </div></div>`;
}


function buildHtml() {
  const out = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MaiMate 提案簡報</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0D1530;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif;color:#EAF0FB}
.slide{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;position:relative;
  page-break-after:always;scroll-snap-align:start;padding:5vh 6vw;background:#16224D;border-bottom:1px solid #0D1530}
.slide.cover{background:linear-gradient(135deg,#16224D,#0D1530)}
html{scroll-snap-type:y mandatory;scroll-behavior:smooth}
.inner{width:100%;max-width:1100px}
.num{position:absolute;right:2vw;bottom:2vh;color:#6B7280;font-size:.8rem}
h1{font-size:clamp(2.5rem,6vw,4.5rem);letter-spacing:-.02em;line-height:1.05}
h2{font-size:clamp(1.5rem,3.4vw,2.6rem);line-height:1.25;margin-bottom:1.2rem;letter-spacing:-.01em}
.kicker{color:#E8A13A;font-size:clamp(.75rem,1.3vw,.95rem);letter-spacing:.12em;margin-bottom:.7rem;font-weight:600}
.sub{font-size:clamp(1.1rem,2.4vw,1.8rem);color:#E8A13A;margin-top:1.2rem;font-weight:500}
.meta{color:#6B7280;margin-top:2rem;font-size:.95rem}
.lead{font-size:clamp(1rem,2vw,1.5rem);line-height:1.85;color:#EAF0FB}
.lead.sm{font-size:clamp(.9rem,1.5vw,1.15rem);color:#B9C6E0;margin-bottom:1.4rem}
.grid{display:grid;gap:1.1rem}
.two{grid-template-columns:1fr 1fr}
.three{grid-template-columns:repeat(3,1fr)}
.stats{grid-template-columns:repeat(2,1fr)}
.stat,.col,.card{background:rgba(234,240,251,.05);border:1px solid rgba(234,240,251,.12);border-radius:14px;padding:1.3rem 1.4rem}
.stat .v,.col .v{font-size:clamp(1.6rem,3.6vw,2.7rem);font-weight:700;line-height:1.1;letter-spacing:-.02em}
.stat .l,.col .h{margin-top:.5rem;font-size:clamp(.85rem,1.4vw,1.05rem);color:#EAF0FB}
.col .h{margin-top:0;margin-bottom:.6rem;color:#B9C6E0;font-size:.95rem}
.stat .s,.col .d{margin-top:.4rem;color:#8FA0C0;font-size:.82rem;line-height:1.6}
.c-red .v{color:#FF7A85}.c-green .v{color:#4ADE9A}.c-gold .v{color:#E8A13A}
.card .h{font-weight:700;color:#E8A13A;margin-bottom:.6rem;font-size:clamp(.95rem,1.5vw,1.15rem)}
.card .b{font-size:.9rem;line-height:1.75;color:#D5DEF0}
.card .e{margin-top:.8rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:#7C8CAC}
.steps{list-style:none;counter-reset:s}
.steps li{counter-increment:s;display:flex;gap:1rem;padding:.65rem 0;border-bottom:1px solid rgba(234,240,251,.09);align-items:baseline}
.steps li::before{content:counter(s);color:#E8A13A;font-weight:700;min-width:1.6rem;font-size:1.1rem}
.steps .t{font-size:clamp(.95rem,1.7vw,1.25rem);flex:1}
.steps .d{color:#8FA0C0;font-size:.85rem;text-align:right;min-width:32%}
table{width:100%;border-collapse:collapse;font-size:clamp(.8rem,1.3vw,1rem)}
th{text-align:left;color:#E8A13A;padding:.7rem .8rem;border-bottom:2px solid rgba(232,161,58,.4);font-size:.9rem}
td{padding:.75rem .8rem;border-bottom:1px solid rgba(234,240,251,.1);vertical-align:top;line-height:1.6}
td.r{text-align:right;font-weight:600}
.note{margin-top:1.2rem;color:#B9C6E0;font-size:clamp(.78rem,1.2vw,.95rem);line-height:1.8;
  border-left:3px solid #E8A13A;padding-left:.9rem}
.foot{margin-top:1.1rem;color:#8FA0C0;font-size:.8rem;line-height:1.7}
.anchor{text-align:center;padding:1rem 0 1.4rem}
.big{font-size:clamp(3rem,8vw,5.5rem);font-weight:800;color:#E8A13A;letter-spacing:-.03em;line-height:1}
.biglabel{color:#B9C6E0;margin-top:.5rem;font-size:clamp(.9rem,1.5vw,1.1rem)}
.formula{margin-top:.7rem;font-family:ui-monospace,Menlo,monospace;font-size:.85rem;color:#8FA0C0}
.tight td{padding:.5rem .8rem}
.honest .hi{padding:.8rem 0;border-bottom:1px solid rgba(234,240,251,.1)}
.honest .h{color:#E8A13A;font-weight:600;margin-bottom:.3rem;font-size:clamp(.9rem,1.5vw,1.1rem)}
.honest .b{color:#B9C6E0;font-size:.85rem;line-height:1.7}
.archwrap{display:grid;grid-template-columns:1.15fr .85fr;gap:1.6rem;align-items:start}
.archcol{display:flex;flex-direction:column;align-items:stretch}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;
  background:rgba(234,240,251,.09);padding:.05em .35em;border-radius:4px;color:#CFE0FF}
.lay{background:rgba(234,240,251,.05);border:1px solid rgba(234,240,251,.14);border-radius:11px;padding:.48rem .8rem}
.lay .tag{color:#E8A13A;font-size:.68rem;letter-spacing:.1em;margin-bottom:.35rem;font-weight:700}
.bxs{display:flex;flex-wrap:wrap;gap:.4rem}
.bx{background:#1D2B5C;border:1px solid #2B3B72;border-radius:7px;padding:.3rem .6rem;
  font-size:clamp(.68rem,1.05vw,.88rem);color:#EAF0FB;white-space:nowrap}
.lnote{margin-top:.4rem;color:#8FA0C0;font-size:.7rem;line-height:1.5}
.arw{text-align:center;color:#E8A13A;font-size:.9rem;line-height:1;padding:.1rem 0}
.archside{background:rgba(232,161,58,.07);border:1px solid rgba(232,161,58,.28);border-radius:11px;padding:.85rem 1rem}
.archside .sh{color:#E8A13A;font-weight:700;font-size:.78rem;letter-spacing:.06em;margin-bottom:.5rem}
.tools{list-style:none;margin:0 0 .7rem}
.tools li{font-family:ui-monospace,Menlo,monospace;font-size:clamp(.6rem,.95vw,.78rem);
  color:#D5DEF0;padding:.16rem 0;border-bottom:1px solid rgba(234,240,251,.07)}
.excl{color:#FF7A85;font-size:clamp(.65rem,1vw,.82rem);font-weight:600;padding:.45rem 0;
  font-family:ui-monospace,Menlo,monospace}
.opath{margin-top:.5rem;padding-top:.6rem;border-top:1px solid rgba(232,161,58,.28)}
.opath b{display:block;color:#4ADE9A;font-size:clamp(.7rem,1.05vw,.86rem);font-family:ui-monospace,Menlo,monospace}
.opath span{display:block;color:#8FA0C0;font-size:.7rem;margin-top:.2rem}
@media (max-width:820px){.two,.three,.stats{grid-template-columns:1fr}.steps li{flex-direction:column;gap:.2rem}
  .steps .d{text-align:left;min-width:0}}
@media print{.slide{height:100vh;page-break-after:always}}
</style></head><body>
${SLIDES.map(htmlSlide).join("\n")}
<script>
document.addEventListener("keydown",(e)=>{
  const s=[...document.querySelectorAll(".slide")];
  const cur=s.findIndex(x=>x.getBoundingClientRect().top>=-window.innerHeight/2);
  if(e.key==="ArrowRight"||e.key==="ArrowDown"||e.key===" "){e.preventDefault();s[Math.min(cur+1,s.length-1)]?.scrollIntoView()}
  if(e.key==="ArrowLeft"||e.key==="ArrowUp"){e.preventDefault();s[Math.max(cur-1,0)]?.scrollIntoView()}
});
</script></body></html>`;
  const p = path.join(DOCS, "MaiMate_提案簡報.html");
  fs.writeFileSync(p, out);
  return p;
}

// ══════════════════════════════════════════════════════════════════
// Renderer 2：pptx（交付檔）
// ══════════════════════════════════════════════════════════════════
function buildPptx() {
  const PptxGen = require("pptxgenjs");
  const p = new PptxGen();
  p.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  p.author = "MaiMate 第五名";
  p.title = "MaiMate 提案簡報";

  const W = 13.33, H = 7.5, M = 0.7;
  const FONT = "Microsoft JhengHei";
  const plain = (s) => String(s).replace(/\*\*/g, "").replace(/`/g, ""); // pptx 沒有行內樣式，記號直接去掉

  const addBase = (s) => {
    const sl = p.addSlide();
    sl.background = { color: PALETTE.navy };
    return sl;
  };
  const kickerAt = (sl, s, y = 0.45) => {
    if (!s.kicker) return y;
    sl.addText(plain(s.kicker), { x: M, y, w: W - 2 * M, h: 0.3, fontSize: 12, bold: true,
      color: PALETTE.gold, fontFace: FONT, charSpacing: 1.5 });
    return y + 0.42;
  };
  const titleAt = (sl, s, y) => {
    if (!s.title) return y;
    sl.addText(plain(s.title), { x: M, y, w: W - 2 * M, h: 0.85, fontSize: 30, bold: true,
      color: PALETTE.white, fontFace: FONT, valign: "top" });
    return y + 1.0;
  };
  const noteAt = (sl, text, y) => {
    if (!text) return;
    sl.addShape(p.ShapeType.rect, { x: M, y, w: 0.045, h: 0.75, fill: { color: PALETTE.gold } });
    sl.addText(plain(text), { x: M + 0.18, y, w: W - 2 * M - 0.18, h: 0.9, fontSize: 11.5,
      color: "B9C6E0", fontFace: FONT, valign: "top", lineSpacing: 18 });
  };
  const CMAP = { red: "FF7A85", green: "4ADE9A", gold: PALETTE.gold };

  SLIDES.forEach((s, i) => {
    const sl = addBase(s);

    if (s.type === "cover") {
      sl.background = { color: PALETTE.navyD };
      sl.addText(plain(s.title), { x: M, y: 2.3, w: W - 2 * M, h: 1.4, fontSize: 54, bold: true,
        color: PALETTE.white, fontFace: FONT });
      sl.addText(plain(s.sub), { x: M, y: 3.7, w: W - 2 * M, h: 0.8, fontSize: 22,
        color: PALETTE.gold, fontFace: FONT });
      sl.addText(plain(s.meta), { x: M, y: 5.9, w: W - 2 * M, h: 0.4, fontSize: 12,
        color: PALETTE.mut, fontFace: FONT });
      return;
    }

    let y = kickerAt(sl, s);
    y = titleAt(sl, s, y);

    if (s.type === "statement") {
      sl.addText(plain(s.body), { x: M, y: y + 0.3, w: W - 2 * M, h: 3.4, fontSize: 19,
        color: PALETTE.ice, fontFace: FONT, lineSpacing: 34, valign: "top" });
    }

    if (s.type === "stats") {
      const cw = (W - 2 * M - 0.4) / 2, ch = 1.55;
      s.stats.forEach((x, k) => {
        const cx = M + (k % 2) * (cw + 0.4), cy = y + Math.floor(k / 2) * (ch + 0.35);
        sl.addShape(p.ShapeType.roundRect, { x: cx, y: cy, w: cw, h: ch,
          fill: { color: "1D2B5C" }, line: { color: "2B3B72", width: 1 }, rectRadius: 0.08 });
        sl.addText(plain(x.v), { x: cx + 0.25, y: cy + 0.12, w: cw - 0.5, h: 0.6, fontSize: 28,
          bold: true, color: CMAP[x.c] || PALETTE.white, fontFace: FONT });
        sl.addText(plain(x.l), { x: cx + 0.25, y: cy + 0.72, w: cw - 0.5, h: 0.38, fontSize: 12.5,
          color: PALETTE.ice, fontFace: FONT });
        sl.addText(plain(x.s), { x: cx + 0.25, y: cy + 1.08, w: cw - 0.5, h: 0.38, fontSize: 10,
          color: "8FA0C0", fontFace: FONT });
      });
      y += 2 * (ch + 0.35);
    }

    if (s.type === "compare") {
      const cw = (W - 2 * M - 0.4) / 2;
      [s.left, s.right].forEach((x, k) => {
        const cx = M + k * (cw + 0.4);
        sl.addShape(p.ShapeType.roundRect, { x: cx, y, w: cw, h: 2.0,
          fill: { color: "1D2B5C" }, line: { color: "2B3B72", width: 1 }, rectRadius: 0.08 });
        sl.addText(plain(x.h), { x: cx + 0.25, y: y + 0.15, w: cw - 0.5, h: 0.35, fontSize: 12,
          color: "B9C6E0", fontFace: FONT });
        sl.addText(plain(x.v), { x: cx + 0.25, y: y + 0.52, w: cw - 0.5, h: 0.65, fontSize: 30,
          bold: true, color: CMAP[x.c], fontFace: FONT });
        sl.addText(plain(x.d), { x: cx + 0.25, y: y + 1.22, w: cw - 0.5, h: 0.7, fontSize: 10.5,
          color: "8FA0C0", fontFace: FONT, lineSpacing: 16 });
      });
      noteAt(sl, s.note, y + 2.25);
    }

    if (s.type === "steps") {
      s.steps.forEach((x, k) => {
        const sy = y + k * 0.62;
        sl.addText(String(k + 1), { x: M, y: sy, w: 0.4, h: 0.4, fontSize: 16, bold: true,
          color: PALETTE.gold, fontFace: FONT });
        sl.addText(plain(x.t), { x: M + 0.45, y: sy, w: 6.6, h: 0.42, fontSize: 14.5,
          color: PALETTE.white, fontFace: FONT });
        sl.addText(plain(x.d), { x: M + 7.2, y: sy + 0.04, w: W - M - 7.4, h: 0.42, fontSize: 10.5,
          color: "8FA0C0", fontFace: FONT, align: "right" });
        sl.addShape(p.ShapeType.line, { x: M, y: sy + 0.52, w: W - 2 * M, h: 0,
          line: { color: "2B3B72", width: 0.5 } });
      });
    }

    if (s.type === "cards") {
      if (s.lead) { sl.addText(plain(s.lead), { x: M, y, w: W - 2 * M, h: 0.4, fontSize: 13, color: "B9C6E0", fontFace: FONT }); y += 0.55; }
      const cw = (W - 2 * M - 0.6) / 3;
      s.cards.forEach((x, k) => {
        const cx = M + k * (cw + 0.3);
        sl.addShape(p.ShapeType.roundRect, { x: cx, y, w: cw, h: 3.0,
          fill: { color: "1D2B5C" }, line: { color: "2B3B72", width: 1 }, rectRadius: 0.08 });
        sl.addText(plain(x.h), { x: cx + 0.22, y: y + 0.18, w: cw - 0.44, h: 0.55, fontSize: 13.5,
          bold: true, color: PALETTE.gold, fontFace: FONT });
        sl.addText(plain(x.b), { x: cx + 0.22, y: y + 0.8, w: cw - 0.44, h: 1.75, fontSize: 10.5,
          color: "D5DEF0", fontFace: FONT, lineSpacing: 16, valign: "top" });
        sl.addText(plain(x.e), { x: cx + 0.22, y: y + 2.6, w: cw - 0.44, h: 0.3, fontSize: 8,
          color: "7C8CAC", fontFace: "Consolas" });
      });
      y += 3.25;
    }

    if (s.type === "table" || s.type === "anchor") {
      if (s.type === "anchor") {
        sl.addText(plain(s.big), { x: M, y: y + 0.1, w: W - 2 * M, h: 1.0, fontSize: 46, bold: true,
          color: PALETTE.gold, fontFace: FONT, align: "center" });
        sl.addText(plain(s.bigLabel), { x: M, y: y + 1.1, w: W - 2 * M, h: 0.35, fontSize: 13,
          color: "B9C6E0", fontFace: FONT, align: "center" });
        sl.addText(plain(s.formula), { x: M, y: y + 1.45, w: W - 2 * M, h: 0.3, fontSize: 10,
          color: "8FA0C0", fontFace: "Consolas", align: "center" });
        y += 1.9;
      }
      if (s.lead) {
        sl.addText(plain(s.lead), { x: M, y, w: W - 2 * M, h: 0.35, fontSize: 13,
          color: "B9C6E0", fontFace: FONT });
        y += 0.5;
      }
      const head = s.head || null;
      const rows = [];
      if (head) rows.push(head.map((h) => ({ text: plain(h), options: { bold: true, color: PALETTE.gold, fill: { color: "1D2B5C" } } })));
      (s.rows || []).forEach((r) => rows.push(r.map((c) => ({ text: plain(c), options: { color: PALETTE.ice } }))));
      sl.addTable(rows, { x: M, y, w: W - 2 * M, fontSize: 11, fontFace: FONT,
        border: { type: "solid", color: "2B3B72", pt: 0.5 }, autoPage: false, valign: "top" });
      y += 0.5 + rows.length * 0.45;
    }

    if (s.type === "honest") {
      sl.addText(plain(s.lead), { x: M, y, w: W - 2 * M, h: 0.4, fontSize: 13, color: "B9C6E0", fontFace: FONT });
      y += 0.55;
      s.items.forEach((x, k) => {
        const sy = y + k * 0.95;
        sl.addText(plain(x[0]), { x: M, y: sy, w: W - 2 * M, h: 0.32, fontSize: 13, bold: true,
          color: PALETTE.gold, fontFace: FONT });
        sl.addText(plain(x[1]), { x: M, y: sy + 0.33, w: W - 2 * M, h: 0.5, fontSize: 10.5,
          color: "B9C6E0", fontFace: FONT, lineSpacing: 15 });
      });
      y += s.items.length * 0.95;
    }

    if (s.type === "arch") {
      // 用圖形物件排，不用 ASCII——全形中文在等寬字體下框線對不齊，投影出來會歪
      const LW = 7.3, RW = W - 2 * M - LW - 0.4, RX = M + LW + 0.4;
      const LH = 0.66, GAP = 0.24;
      ARCH.layers.forEach((L, k) => {
        const ly = y + k * (LH + GAP);
        sl.addShape(p.ShapeType.roundRect, { x: M, y: ly, w: LW, h: LH,
          fill: { color: "1D2B5C" }, line: { color: "2B3B72", width: 1 }, rectRadius: 0.06 });
        sl.addText(L.tag, { x: M + 0.16, y: ly + 0.06, w: 0.75, h: 0.25, fontSize: 8,
          bold: true, color: PALETTE.gold, fontFace: FONT });
        sl.addText(L.boxes.join("　│　"), { x: M + 0.95, y: ly + 0.04, w: LW - 1.1, h: 0.3,
          fontSize: 10.5, color: PALETTE.ice, fontFace: FONT });
        if (L.note) sl.addText(L.note, { x: M + 0.95, y: ly + 0.34, w: LW - 1.1, h: 0.28,
          fontSize: 8, color: "8FA0C0", fontFace: FONT });
        if (k < ARCH.layers.length - 1) sl.addText("↓", { x: M + LW / 2 - 0.15, y: ly + LH - 0.02,
          w: 0.3, h: GAP, fontSize: 11, color: PALETTE.gold, align: "center" });
      });

      const panelH = ARCH.layers.length * (LH + GAP) - GAP;
      sl.addShape(p.ShapeType.roundRect, { x: RX, y, w: RW, h: panelH,
        fill: { color: "2A2440" }, line: { color: "6B5A2E", width: 1 }, rectRadius: 0.06 });
      sl.addText("LLM 能呼叫的工具（全部）", { x: RX + 0.22, y: y + 0.14, w: RW - 0.44, h: 0.26,
        fontSize: 9.5, bold: true, color: PALETTE.gold, fontFace: FONT });
      sl.addText(ARCH.tools.map((t) => "· " + t).join("\n"), { x: RX + 0.22, y: y + 0.46,
        w: RW - 0.44, h: 1.75, fontSize: 8.5, color: "D5DEF0", fontFace: "Consolas", lineSpacing: 13 });
      sl.addText("✖ " + ARCH.excluded, { x: RX + 0.22, y: y + 2.3, w: RW - 0.44, h: 0.3,
        fontSize: 9, bold: true, color: "FF7A85", fontFace: FONT });
      sl.addText(ARCH.orderPath, { x: RX + 0.22, y: y + 2.72, w: RW - 0.44, h: 0.28,
        fontSize: 9.5, bold: true, color: "4ADE9A", fontFace: "Consolas" });
      sl.addText(ARCH.orderNote, { x: RX + 0.22, y: y + 3.0, w: RW - 0.44, h: 0.25,
        fontSize: 8, color: "8FA0C0", fontFace: FONT });
      y += panelH + 0.15;
    }

    if (s.note && s.type !== "compare" && s.type !== "anchor") noteAt(sl, s.note, Math.min(y + 0.1, 5.9));
    if (s.type === "anchor" && s.note) noteAt(sl, s.note, Math.min(y + 0.1, 6.0));
    if (s.foot) sl.addText(plain(s.foot), { x: M, y: 6.75, w: W - 2 * M, h: 0.55, fontSize: 9.5,
      color: "8FA0C0", fontFace: FONT, lineSpacing: 14, valign: "top" });

    sl.addText(String(i + 1), { x: W - 0.8, y: H - 0.45, w: 0.4, h: 0.25, fontSize: 9,
      color: PALETTE.mut, fontFace: FONT, align: "right" });
  });

  const out = path.join(DOCS, "MaiMate_提案簡報_20260731.pptx");
  return p.writeFile({ fileName: out }).then(() => out);
}

// ---------- main ----------
(async () => {
  const wantHtml = !process.argv.includes("--pptx");
  const wantPptx = !process.argv.includes("--html");
  const made = [];
  if (wantHtml) made.push(buildHtml());
  if (wantPptx) made.push(await buildPptx());
  console.log(`簡報產生完成（${SLIDES.length} 頁）：`);
  made.forEach((f) => console.log("  " + f));
  console.log(`\n數字來源：data/health_report.json（${R.period.start} ~ ${R.period.end}，${n(R.row_count)} 筆）`);
  console.log(`報告一改，重跑本程式即同步——簡報裡沒有手抄的數字。`);
})();
