/* MaiMate 工作狀態簡報（團隊會議用）— 資料源：docs/STATUS.md 2026-07-19 盤點 */
const pptxgen = require("pptxgenjs");
const path = require("path");

const NAVY = "16224D", NAVY_D = "0D1530", ICE = "EAF0FB", GOLD = "E8A13A";
const GREEN = "1F9D66", RED = "D64550", BLUE = "2B6CB0", INK = "1F2937", MUT = "6B7280", WHITE = "FFFFFF";
const FONT = "Microsoft JhengHei";
const W = 13.33, M = 0.6;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";

const ST = {
  done: { label: "✅ 已驗證", color: GREEN },
  code: { label: "🧪 寫好待測", color: GOLD },
  todo: { label: "🔨 待做", color: RED },
  test: { label: "🔬 測試項", color: BLUE },
};

function bigTitle(s, t, sub) {
  s.addText(t, { x: M, y: 0.45, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 27, bold: true, color: NAVY, margin: 0 });
  if (sub) s.addText(sub, { x: M, y: 1.12, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 12.5, color: MUT, margin: 0 });
}
function card(s, x, y, w, h, fill) {
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.09, fill: { color: fill || ICE }, line: { type: "none" } });
}
function statusTable(s, rows, y, colW, rowH) {
  const header = [
    { text: "項目", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "狀態", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "說明", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "參照", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const body = rows.map(([item, st, note, ref]) => [
    { text: item, options: { bold: true, color: INK } },
    { text: ST[st].label, options: { bold: true, color: ST[st].color } },
    { text: note, options: { color: INK } },
    { text: ref, options: { color: MUT, fontSize: 10 } },
  ]);
  s.addTable([header, ...body], {
    x: M, y, w: W - 2 * M, colW: colW || [3.3, 1.55, 5.5, 1.78],
    fontFace: FONT, fontSize: 11, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: rowH || 0.52, margin: 0.06,
  });
}

// ============ 1 封面 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addShape("ellipse", { x: 10.2, y: -1.8, w: 5.5, h: 5.5, fill: { color: NAVY } });
  s.addText("隊伍「第五名」團隊會議", { x: M, y: 1.6, w: 8, h: 0.4, fontFace: FONT, fontSize: 14, color: GOLD, margin: 0 });
  s.addText("MaiMate 工作項目狀態", { x: M, y: 2.1, w: W - 2 * M, h: 1.0, fontFace: FONT, fontSize: 46, bold: true, color: WHITE, margin: 0 });
  s.addText("39 項全盤點・四級誠實標示・分工討論用", { x: M, y: 3.3, w: 10, h: 0.5, fontFace: FONT, fontSize: 18, color: ICE, margin: 0 });
  s.addText("盤點日 2026/07/19｜決賽 8/1–8/2｜完整版：docs/STATUS.md", { x: M, y: 6.4, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, color: "8FA0C9", margin: 0 });
}

// ============ 2 總覽 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "總覽：repo 看起來很滿，驗證過的只有 8 項");
  const stats = [
    { n: "8", l: "已完成並驗證", c: GREEN, d: "行為分析、文件、環境腳本" },
    { n: "11", l: "寫好但沒測過", c: GOLD, d: "Agent迴圈、API串接、SAM…" },
    { n: "14", l: "待做", c: RED, d: "RAG、三方案、Profile、手機版…" },
    { n: "6", l: "純測試項", c: BLUE, d: "E2E、雙層護欄、部署計時…" },
  ];
  stats.forEach((st, i) => {
    const x = M + i * 3.1;
    card(s, x, 1.75, 2.85, 2.5, ICE);
    s.addText(st.n, { x: x + 0.3, y: 2.0, w: 2.3, h: 1.0, fontFace: FONT, fontSize: 54, bold: true, color: st.c, margin: 0 });
    s.addText(st.l, { x: x + 0.3, y: 3.05, w: 2.3, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    s.addText(st.d, { x: x + 0.3, y: 3.5, w: 2.35, h: 0.6, fontFace: FONT, fontSize: 10.5, color: MUT, margin: 0 });
  });
  card(s, M, 4.7, W - 2 * M, 1.0, "FDF0EF");
  s.addText([
    { text: "最大隱藏風險：", options: { bold: true, color: RED } },
    { text: "Agent 迴圈從沒對真實 Bedrock 跑過、Private API 簽章沒驗證過、SAM 從沒 deploy 過——「寫好」不等於「能動」。", options: { color: INK } },
  ], { x: M + 0.3, y: 4.85, w: W - 2 * M - 0.6, h: 0.7, fontFace: FONT, fontSize: 14, valign: "middle", margin: 0 });
  s.addText("本週原則：先讓 🧪 變 ✅（把寫好的測到能動），再開 🔨 新工。", {
    x: M, y: 6.0, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
}

// ============ 3 Agent 核心 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Agent 核心（10 項）", "Bedrock 首跑是全案最優先——唯一沒碰過真傢伙的核心路徑");
  statusTable(s, [
    ["Converse tool-use 迴圈", "code", "程式完成，從沒對真實 Bedrock 跑過", "agent/loop.py"],
    ["工具定義×4＋dispatch", "code", "同上", "agent/tools.py"],
    ["prepare/execute 下單分離", "code", "架構完成，待端到端驗證", "tools+order"],
    ["程式層護欄（明牌/PII）", "code", "正則可測，未寫測試", "guardrails.py"],
    ["confirm 欄位帶出前端", "todo", "迴圈把確認卡帶給 handler 回應", "#1"],
    ["Haiku/Sonnet 路由", "todo", "含 prompt caching", "#5"],
    ["Bedrock Guardrails", "todo", "與程式層雙保險", "#6"],
    ["Profile Engine 簡版", "todo", "行為推斷三模式→提醒強度", "#10 spec✓"],
    ["三方案生成", "todo", "Golden Path 核心，確定性計算", "#11 spec✓"],
    ["Audit Log", "todo", "工具+訂單留痕＋軌跡面板", "#12 spec✓"],
  ], 1.6, [3.1, 1.5, 5.7, 1.83], 0.49);
}

// ============ 4 資料/RAG＋API ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "資料・RAG・API 整合（11 項）");
  statusTable(s, [
    ["CSV 解析＋行為指標預計算", "done", "10,000 筆，真數字已驗證（追高65%等）", "analysis/"],
    ["health_report.json", "done", "五組指標齊全", "data/"],
    ["setup.sh 環境檢查", "done", "已實測", "scripts/"],
    ["RAG 語料蒐集", "todo", "防詐/教材公開資源＋工作坊資料（授權限制）", "#9"],
    ["Knowledge Base + S3 Vectors", "todo", "賽前建好，決賽只上架", "#9"],
    ["query_knowledge 工具", "todo", "回答附出處", "#9"],
    ["Lambda×4 handlers", "code", "未部署未打過", "handlers/"],
    ["MAX Public API（快取+退避）", "code", "路徑需對官方文件核對後實測", "#2"],
    ["MAX Private API（HMAC）", "code", "簽章未驗證——對照 max-mcp-server 核對", "#4"],
    ["CoinMarketCap 延伸", "code", "無金鑰自動略過，未測", "thirdparty.py"],
    ["全員 Lv2 KYC＋API Key", "todo", "人工項，審核有等待期——最急", "#3"],
  ], 1.5, [3.1, 1.5, 5.7, 1.83], 0.465);
}

// ============ 5 前端＋部署＋交付 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "前端・部署・交付物（12 項）");
  statusTable(s, [
    ["桌機三欄 SPA", "code", "寫好，未在瀏覽器完整走過", "frontend/"],
    ["離線 mock 備援", "code", "機制寫好，fallback 未驗證", "app.js"],
    ["手機版 RWD（Golden Path 動線）", "todo", "對話主畫面、確認卡放大、麥麥視覺", "#13"],
    ["三方案卡片／模式徽章／軌跡面板", "todo", "隨 #11 #10 #12", "—"],
    ["SAM 模板", "code", "從未實際 deploy", "infra/"],
    ["自家 AWS 帳號＋Bedrock 開通", "todo", "多條線的前置——今天定誰出帳號", "—"],
    ["從零部署演練＋DEPLOY.md", "todo", "目標<1hr，7/31 前至少一次", "#14"],
    ["提案簡報 16 頁", "done", "含評審兩題頁；視覺本機過一次", "docs/"],
    ["上手指南／架構文件／法規檢討", "done", "三份皆完成", "docs/"],
    ["整合簡報修正", "todo", "Skill 標示＋補兩頁", "#15"],
    ["Demo 預錄影片", "todo", "Phase 2 出 v1", "#8"],
    ["Kiro 加分證據集", "todo", "補 Specs/task/MCP 截圖", "—"],
  ], 1.6, [3.4, 1.5, 5.4, 1.83], 0.44);
}

// ============ 6 測試清單 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "測試清單（6 項）— 需要一位「測試主導」認領", "寫好的程式都要過這關才算數");
  statusTable(s, [
    ["Bedrock 迴圈首次實跑", "test", "對真模型完成一次多工具對話——全案最優先", "需AWS帳號"],
    ["Guardrails 雙層攔截", "test", "「推薦我買哪個幣」兩層各自單獨擋住", "#6 後"],
    ["憑證安全", "test", "token 過期/重放回 410；60 秒邊界", "#1 #4 後"],
    ["離線備援切換", "test", "拔網路 mock 自動接手＋UI 標示", "前端部署後"],
    ["E2E Golden Path", "test", "全賣→三方案→確認→最小額度成交→軌跡完整", "幾乎全部後"],
    ["從零部署計時", "test", "乾淨帳號 <1 小時上線（決賽日保險）", "#14"],
  ], 1.75, [3.1, 1.5, 5.7, 1.83], 0.6);
}

// ============ 7 四工作包 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "分工討論：建議切成四個工作包（未指派）");
  const packs = [
    { t: "A｜Agent 核心", c: NAVY, body: "#1 confirm帶出\n#5 模型路由\n#10 Profile\n#11 三方案\nBedrock 首跑", skill: "Python・Bedrock" },
    { t: "B｜資料與 RAG", c: GOLD, body: "#9 語料+KB建置\n#12 Audit Log\n#2 Public API 實測", skill: "Python・AWS 資料" },
    { t: "C｜前端與體驗", c: GREEN, body: "#13 手機版改版\n三方案卡/徽章/軌跡面板\n離線備援驗證\n麥麥視覺", skill: "HTML/JS・設計" },
    { t: "D｜整合與交付", c: RED, body: "#14 部署演練\n#4 Private API E2E\n#6 Guardrails\n#8 錄影・#15 簡報\nE2E 測試主導", skill: "AWS・統籌" },
  ];
  packs.forEach((p, i) => {
    const x = M + i * 3.1;
    card(s, x, 1.7, 2.85, 3.9, ICE);
    s.addShape("roundRect", { x, y: 1.7, w: 2.85, h: 0.6, rectRadius: 0.09, fill: { color: p.c }, line: { type: "none" } });
    s.addText(p.t, { x: x + 0.2, y: 1.7, w: 2.5, h: 0.6, fontFace: FONT, fontSize: 14.5, bold: true, color: WHITE, valign: "middle", margin: 0 });
    s.addText(p.body, { x: x + 0.25, y: 2.5, w: 2.4, h: 2.3, fontFace: FONT, fontSize: 11.5, color: INK, margin: 0 });
    s.addText(p.skill, { x: x + 0.25, y: 5.05, w: 2.4, h: 0.4, fontFace: FONT, fontSize: 10.5, bold: true, color: MUT, margin: 0 });
  });
  card(s, M, 5.9, W - 2 * M, 0.95, "FFF4E0");
  s.addText([
    { text: "相依關係：", options: { bold: true, color: NAVY } },
    { text: "#3 全員KYC 擋 #4｜AWS 帳號擋 Bedrock首跑・#9・#14｜#11 擋三方案卡片。今天要定：AWS 帳號誰出、四包誰認領。", options: { color: INK } },
  ], { x: M + 0.3, y: 6.02, w: W - 2 * M - 0.6, h: 0.7, fontFace: FONT, fontSize: 12.5, valign: "middle", margin: 0 });
}

// ============ 8 Kiro 部署（一次設定）============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Kiro 部署｜每人一次設定（約 15 分鐘）", "認領工作包後，先把這頁做完才開工");
  const steps = [
    ["1", "下載安裝", "kiro.dev 下載（Mac/Windows）。介面就是 VS Code，不用重學", NAVY],
    ["2", "登入", "用自己的 Google 帳號。帳號與額度不能共用（主辦規定，違者取消資格）", NAVY],
    ["3", "兌換額度", "輸入兌換碼 GenAIHack26 → 頭像選單看到 Bonus Credits 2000 即成功，截圖存證", GOLD],
    ["4", "開啟專案", "git clone github.com/giont565/MaiMate → Kiro「Open Folder」選 MaiMate 資料夾", GREEN],
    ["5", "確認載入", "左側出現 Specs 面板（5 個 spec）＝.kiro/ 讀取成功；跑 bash scripts/setup.sh 檢查環境", GREEN],
  ];
  steps.forEach(([n, t, d, c], i) => {
    const y = 1.7 + i * 0.95;
    s.addShape("ellipse", { x: M, y: y + 0.08, w: 0.55, h: 0.55, fill: { color: c } });
    s.addText(n, { x: M, y: y + 0.08, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(t, { x: M + 0.8, y, w: 1.9, h: 0.75, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(d, { x: M + 2.8, y, w: 9.4, h: 0.75, fontFace: FONT, fontSize: 13, color: INK, valign: "middle", margin: 0 });
  });
  s.addText("疑難：登入卡住→換瀏覽器完成 OAuth；Specs 面板沒出現→確認開的是 MaiMate 根目錄不是上層資料夾。", {
    x: M, y: 6.55, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 11.5, color: MUT, margin: 0 });
}

// ============ 9 Kiro 開發：Steering 與 Specs ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Kiro 開發｜.kiro 目錄就是團隊大腦", "打開專案它就懂我們的規矩——不用自己記紅線");
  const rows = [
    [".kiro/steering/", "自動載入的團隊約定", "product.md 紅線（不報明牌/下單必確認）、data-schema.md 欄位與 API 格式、tech.md 架構規範。Kiro 生成的每行程式都遵守"],
    [".kiro/specs/<功能>/", "五個功能規格（三件套）", "requirements.md 驗收條件（EARS）→ design.md 設計 → tasks.md 任務清單。已備：chat-agent、behavior-engine、order-flow、profile-engine、trade-scenarios、audit-log"],
    [".kiro/settings/mcp.json", "MAX MCP 接入", "把 REPLACE_WITH_LOCAL_PATH 改成本機 clone 的 max-mcp-server 路徑；金鑰走環境變數。之後對 Kiro 說「查 BTC 現價」它直接打 MAX API"],
  ];
  rows.forEach(([t, sub, d], i) => {
    const y = 1.7 + i * 1.55;
    card(s, M, y, W - 2 * M, 1.4, ICE);
    s.addText(t, { x: M + 0.35, y: y + 0.15, w: 3.4, h: 0.5, fontFace: "Courier New", fontSize: 14, bold: true, color: NAVY, margin: 0 });
    s.addText(sub, { x: M + 0.35, y: y + 0.68, w: 3.4, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: GOLD, margin: 0 });
    s.addText(d, { x: M + 3.95, y: y + 0.12, w: 8.2, h: 1.2, fontFace: FONT, fontSize: 12, color: INK, valign: "middle", margin: 0 });
  });
  s.addText("Steering 寫得越清楚，Kiro 來回修正越少——這就是我們省 credit 的主要手段。", {
    x: M, y: 6.55, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, margin: 0 });
}

// ============ 10 Kiro 開發：日常循環 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Kiro 開發｜日常循環：領任務 → 開分支 → Kiro 做 → 合回去");
  const flow = [
    ["領任務", "GitHub Issues 認領（開會分配的工作包），Slack #dev 說一聲避免撞車", NAVY],
    ["開分支", "git checkout -b feat/任務名（從最新 main 開）", NAVY],
    ["Kiro 執行", "Specs 面板 → 對應 spec → tasks → 點「Start task」。Kiro 讀 requirements+design 上下文動手改碼；做完自己看 diff 再收", GOLD],
    ["驗證", "跑該 spec tasks.md 的驗收條件（單元測試/劇本），過了才算完成、打勾", GREEN],
    ["合回去", "git pull --rebase → push → PR（賽前）或直合（決賽現場求快）", GREEN],
  ];
  flow.forEach(([t, d, c], i) => {
    const y = 1.65 + i * 0.94;
    s.addShape("ellipse", { x: M, y: y + 0.08, w: 0.55, h: 0.55, fill: { color: c } });
    s.addText(String(i + 1), { x: M, y: y + 0.08, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(t, { x: M + 0.8, y, w: 1.7, h: 0.75, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(d, { x: M + 2.6, y, w: 9.6, h: 0.75, fontFace: FONT, fontSize: 12.5, color: INK, valign: "middle", margin: 0 });
  });
  card(s, M, 6.35, W - 2 * M, 0.75, "FFF4E0");
  s.addText([
    { text: "要開 spec 沒涵蓋的新功能時：", options: { bold: true, color: NAVY } },
    { text: "先對 Kiro 說「幫我為 XX 建立 spec」，人審過 requirements 再讓它動手——規格便宜，返工很貴。", options: { color: INK } },
  ], { x: M + 0.3, y: 6.45, w: W - 2 * M - 0.6, h: 0.55, fontFace: FONT, fontSize: 12.5, valign: "middle", margin: 0 });
}

// ============ 11 Kiro credit 紀律與雷區 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Kiro｜Credit 紀律與雷區", "2000 點只發一次、用完不補——全隊共同資產");
  card(s, M, 1.7, 5.9, 4.4, ICE);
  s.addText("預算分配（每人）", { x: M + 0.35, y: 1.95, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: NAVY, margin: 0 });
  const budget = [
    ["練習期（～7/22）", "≤ 300", GOLD],
    ["開發期（7/23–31）", "~ 1000", NAVY],
    ["決賽保底（8/1–2）", "≥ 700", RED],
  ];
  budget.forEach(([t, n, c], i) => {
    const y = 2.55 + i * 1.05;
    card(s, M + 0.35, y, 5.2, 0.9, WHITE);
    s.addText(t, { x: M + 0.6, y: y + 0.08, w: 3.1, h: 0.75, fontFace: FONT, fontSize: 13.5, color: INK, valign: "middle", margin: 0 });
    s.addText(n, { x: M + 3.7, y: y + 0.08, w: 1.7, h: 0.75, fontFace: FONT, fontSize: 20, bold: true, color: c, valign: "middle", margin: 0 });
  });
  card(s, M + 6.25, 1.7, 5.9, 4.4, "FDF0EF");
  s.addText("四個雷區", { x: M + 6.6, y: 1.95, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: RED, margin: 0 });
  s.addText([
    { text: "Autopilot 只在跑定義好的 task 時開——探索、跟課、隨便問問一律關，它會自主連跑燒點數", options: { bullet: true, breakLine: true } },
    { text: "小改動自己動手改，讓 Kiro 做「一個 task 一次到位」的活", options: { bullet: true, breakLine: true } },
    { text: "同一個問題別在 Kiro 裡反覆重試——換個問法前先想清楚要什麼", options: { bullet: true, breakLine: true } },
    { text: "頭像選單隨時看剩餘點數；低於個人決賽保底就停手回報", options: { bullet: true } },
  ], { x: M + 6.6, y: 2.55, w: 5.3, h: 3.3, fontFace: FONT, fontSize: 12.5, color: INK, paraSpaceAfter: 10, margin: 0 });
  s.addText("加分項證據：過程隨手截 Specs 面板／task 執行／MCP 查行情畫面，丟 Drive「Kiro證據」資料夾。", {
    x: M, y: 6.4, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 12, color: MUT, margin: 0 });
}

// ============ 12 時間軸 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("時間軸：賽前做完，決賽只上架", { x: M, y: 0.55, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, margin: 0 });
  const phases = [
    { t: "～7/22", n: "定案與就位", d: "KYC・環境設定・AWS帳號・架構拍板・#1 #2 開工", c: GOLD },
    { t: "7/23–27", n: "核心構建週", d: "Golden Path 全鏈路＋RAG＋手機版；7/27 晚自家 AWS 跑通全程", c: GOLD },
    { t: "7/28–30", n: "整合排練週", d: "E2E・離線備援・預錄影片 v1・簡報定稿・pitch 兩輪", c: GREEN },
    { t: "7/31", n: "凍結日", d: "code freeze・DEPLOY.md 定稿・部署演練・早睡", c: BLUE },
    { t: "8/1–8/2", n: "決賽 30hr", d: "官方環境重部署(1hr)・現場調整・最終錄影・上台", c: RED },
  ];
  phases.forEach((p, i) => {
    const y = 1.6 + i * 1.02;
    s.addShape("roundRect", { x: M, y, w: 1.7, h: 0.85, rectRadius: 0.08, fill: { color: p.c }, line: { type: "none" } });
    s.addText(p.t, { x: M, y, w: 1.7, h: 0.85, fontFace: FONT, fontSize: 14, bold: true, color: p.c === GOLD ? NAVY_D : WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(p.n, { x: M + 1.95, y, w: 2.2, h: 0.85, fontFace: FONT, fontSize: 15, bold: true, color: WHITE, valign: "middle", margin: 0 });
    s.addText(p.d, { x: M + 4.25, y, w: 7.9, h: 0.85, fontFace: FONT, fontSize: 12.5, color: "C9D4EE", valign: "middle", margin: 0 });
  });
  s.addText("Kiro credit 紀律：練習 ≤300／開發 ~1000／決賽保底 700（只發一次不補）", {
    x: M, y: 6.85, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 12, color: "8FA0C9", margin: 0 });
}

const out = path.join(__dirname, "工作項目狀態.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("written:", out));
