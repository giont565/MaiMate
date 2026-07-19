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
  s.addText("MaiMate 開發手冊", { x: M, y: 2.1, w: W - 2 * M, h: 1.0, fontFace: FONT, fontSize: 46, bold: true, color: WHITE, margin: 0 });
  s.addText("狀態・分工・架構・成本・驗收・Kiro 教學——隊內唯一簡報", { x: M, y: 3.3, w: 10, h: 0.5, fontFace: FONT, fontSize: 18, color: ICE, margin: 0 });
  s.addText("2026/07/19 晚間更新｜決賽 8/1–8/2｜文字完整版：repo 首頁 README.md", { x: M, y: 6.4, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, color: "8FA0C9", margin: 0 });
}

// ============ 2 總覽 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "總覽：07/19 部署上線，驗證過的從 8 項推進到 15 項");
  const stats = [
    { n: "15", l: "已完成並驗證", c: GREEN, d: "行為分析、Bedrock迴圈、部署上線、前端…" },
    { n: "7", l: "寫好但沒測過", c: GOLD, d: "confirm E2E、Private簽章、離線備援…" },
    { n: "12", l: "待做", c: RED, d: "RAG、三方案、Profile、手機版…" },
    { n: "5", l: "純測試項", c: BLUE, d: "E2E、雙層護欄、部署計時…" },
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
    { text: "Private API 簽章仍未驗證（#4 最小成交前不算數）、/order 沒真跑過、模型暫全走 Haiku（#5 路由未做）——上線 ≠ Golden Path 能走通。", options: { color: INK } },
  ], { x: M + 0.3, y: 4.85, w: W - 2 * M - 0.6, h: 0.7, fontFace: FONT, fontSize: 14, valign: "middle", margin: 0 });
  s.addText("本週原則：先讓 🧪 變 ✅（把寫好的測到能動），再開 🔨 新工。", {
    x: M, y: 6.0, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
}

// ============ 3 Agent 核心 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Agent 核心（10 項）｜主責 A", "07/19 迴圈已對真模型跑通（Haiku@us-east-1）——重心轉 confirm E2E・路由・三方案");
  statusTable(s, [
    ["Converse tool-use 迴圈", "done", "07/19 線上跑通：真模型多輪工具呼叫＋引用真實數據", "agent/loop.py"],
    ["工具定義×4＋dispatch", "done", "隨迴圈上線；已加 key_findings 摘要（答非所問保險）", "agent/tools.py"],
    ["prepare/execute 下單分離", "code", "架構完成，待端到端驗證", "tools+order"],
    ["程式層護欄（明牌/PII）", "code", "正則可測，未寫測試", "guardrails.py"],
    ["confirm 欄位帶出前端", "code", "後端 07/19 完成上線（任務5）；待一次下單對話 E2E", "#1"],
    ["Haiku/Sonnet 路由", "todo", "暫全走 Haiku；路由與 prompt caching 待做", "#5"],
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
  bigTitle(s, "資料・RAG・API 整合（11 項）｜主責 B（Private E2E:D、KYC:全員）");
  statusTable(s, [
    ["CSV 解析＋行為指標預計算", "done", "10,000 筆，真數字已驗證（追高65%等）", "analysis/"],
    ["health_report.json", "done", "五組指標齊全", "data/"],
    ["setup.sh 環境檢查", "done", "已實測", "scripts/"],
    ["RAG 語料蒐集", "todo", "防詐/教材公開資源＋工作坊資料（授權限制）", "#9"],
    ["Knowledge Base + S3 Vectors", "todo", "賽前建好，決賽只上架", "#9"],
    ["query_knowledge 工具", "todo", "回答附出處", "#9"],
    ["Lambda×4 handlers", "done", "07/19 SAM 部署上線；/chat /health /market 線上實測，/order 待 #4", "handlers/"],
    ["MAX Public API（快取+退避）", "code", "ticker 已線上實測（任務6）；kline/depth 待對文件核驗", "#2"],
    ["MAX Private API（HMAC）", "code", "簽章未驗證——對照 max-mcp-server 核對", "#4"],
    ["CoinMarketCap 延伸", "code", "無金鑰自動略過，未測", "thirdparty.py"],
    ["全員 Lv2 KYC＋API Key", "todo", "人工項，審核有等待期——最急", "#3"],
  ], 1.5, [3.1, 1.5, 5.7, 1.83], 0.465);
}

// ============ 5 前端＋部署＋交付 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "前端・部署・交付物（12 項）｜前端 C／部署交付 D");
  statusTable(s, [
    ["桌機三欄 SPA", "done", "07/19 上線實測＋UX 修正（行情就地更新/氣泡渲染）", "frontend/"],
    ["離線 mock 備援", "code", "行情斷網保值已由 npm run smoke 驗證；整站拔網路實測待做", "app.js"],
    ["手機版 RWD（Golden Path 動線）", "todo", "對話主畫面、確認卡放大、麥麥視覺", "#13"],
    ["三方案卡片／模式徽章／軌跡面板", "todo", "隨 #11 #10 #12", "—"],
    ["SAM 模板", "done", "07/19 首次 deploy 成功（us-east-1 API+S3）", "infra/"],
    ["自家 AWS 帳號＋Bedrock 開通", "done", "隊長帳號出線，Bedrock 已開通（07/19）", "—"],
    ["從零部署演練＋DEPLOY.md", "todo", "首次部署經驗已有；<1hr 計時演練＋文件待做（含 API_BASE 檢查項）", "#14"],
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
  bigTitle(s, "測試清單（6 項）｜主責 D（E2E 全員配合）", "寫好的程式都要過這關才算數");
  statusTable(s, [
    ["Bedrock 迴圈首次實跑", "done", "07/19 完成：Haiku 多工具對話、線上引用真實數據", "已達成"],
    ["Guardrails 雙層攔截", "test", "「推薦我買哪個幣」兩層各自單獨擋住", "#6 後"],
    ["憑證安全", "test", "token 過期/重放回 410；60 秒邊界", "#1 #4 後"],
    ["離線備援切換", "test", "拔網路 mock 自動接手＋UI 標示", "前端部署後"],
    ["E2E Golden Path", "test", "全賣→三方案→確認→最小額度成交→軌跡完整", "幾乎全部後"],
    ["從零部署計時", "test", "乾淨帳號 <1 小時上線（決賽日保險）", "#14"],
  ], 1.75, [3.1, 1.5, 5.7, 1.83], 0.6);
}

// ============ 7 工作包 × 未完成工項（A/B） ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "工作包 × 未完成工項（1/2）：A、B", "31 條未完成工項全數入包，無漏接。🔨待做｜🧪寫好待測｜🔬純測試");
  card(s, M, 1.65, 5.95, 5.2, ICE);
  s.addText("A｜Agent 與方案引擎　4.5 天", { x: M + 0.3, y: 1.85, w: 5.3, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  s.addText("地盤：backend/agent/", { x: M + 0.3, y: 2.25, w: 5.3, h: 0.3, fontFace: "Courier New", fontSize: 10.5, color: MUT, margin: 0 });
  s.addText([
    { text: "✅ Bedrock 迴圈首跑——07/19 完成", options: { bullet: true, bold: true, color: GREEN, breakLine: true } },
    { text: "🧪 tools dispatch／護欄 單元測試", options: { bullet: true, breakLine: true } },
    { text: "🧪 prepare/execute 單元驗證（E2E 歸 D）", options: { bullet: true, breakLine: true } },
    { text: "🧪 #1 confirm 後端✅待E2E｜🔨 #5 路由+caching", options: { bullet: true, breakLine: true } },
    { text: "🔨 #10 Profile 引擎（徽章 UI 歸 C）", options: { bullet: true, breakLine: true } },
    { text: "🔨 #11 三方案計算（卡片渲染歸 C）", options: { bullet: true, breakLine: true } },
    { text: "🔨 註冊 B 的函式／掛 D 的 Guardrails／埋 audit 點", options: { bullet: true } },
  ], { x: M + 0.3, y: 2.65, w: 5.4, h: 4.1, fontFace: FONT, fontSize: 11.5, color: INK, paraSpaceAfter: 8, margin: 0 });
  card(s, M + 6.25, 1.65, 5.95, 5.2, ICE);
  s.addText("B｜資料服務與 RAG　4 天", { x: M + 6.55, y: 1.85, w: 5.3, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  s.addText("地盤：backend/integrations/ + analysis/ + 語料", { x: M + 6.55, y: 2.25, w: 5.3, h: 0.3, fontFace: "Courier New", fontSize: 10.5, color: MUT, margin: 0 });
  s.addText([
    { text: "🔨 #9 RAG 語料蒐集（防詐+教材；不進 git）", options: { bullet: true, breakLine: true } },
    { text: "🔨 #9 Bedrock KB＋S3 Vectors 建置", options: { bullet: true, breakLine: true } },
    { text: "🔨 #9 query_knowledge 函式（交 A 註冊）", options: { bullet: true, breakLine: true } },
    { text: "🔨 #12 audit.py＋/audit endpoint（A 埋點、C 面板）", options: { bullet: true, breakLine: true } },
    { text: "🧪 #2 max_public：ticker✅ 07/19，kline/depth 待驗", options: { bullet: true, breakLine: true } },
    { text: "🧪 max_private 簽章對照 max-mcp-server 核對", options: { bullet: true, breakLine: true } },
    { text: "🧪 thirdparty CMC 冒煙", options: { bullet: true } },
  ], { x: M + 6.55, y: 2.65, w: 5.4, h: 4.1, fontFace: FONT, fontSize: 11.5, color: INK, paraSpaceAfter: 8, margin: 0 });
}

// ============ 7a 工作包 × 未完成工項（C/D） ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "工作包 × 未完成工項（2/2）：C、D＋全員", "選包：Slack #general 回覆先搶先贏，撞包自己聊");
  card(s, M, 1.65, 5.95, 4.55, ICE);
  s.addText("C｜前端與品牌　4 天", { x: M + 0.3, y: 1.85, w: 5.3, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  s.addText("地盤：frontend/ + docs/mockups/ + docs/brand/", { x: M + 0.3, y: 2.25, w: 5.3, h: 0.3, fontFace: "Courier New", fontSize: 10.5, color: MUT, margin: 0 });
  s.addText([
    { text: "🔨 #13 手機版 RWD（照 mockups 三畫面）", options: { bullet: true, breakLine: true } },
    { text: "🔨 三方案卡渲染（吃 README §3 schema）", options: { bullet: true, breakLine: true } },
    { text: "🔨 模式徽章＋切換｜決策軌跡面板", options: { bullet: true, breakLine: true } },
    { text: "🔨 麥麥視覺整合（成交切 BULLISH）", options: { bullet: true, breakLine: true } },
    { text: "🧪 SPA 瀏覽器全流程走查", options: { bullet: true, breakLine: true } },
    { text: "🧪 離線 mock 拔網路實測", options: { bullet: true } },
  ], { x: M + 0.3, y: 2.65, w: 5.4, h: 3.4, fontFace: FONT, fontSize: 11.5, color: INK, paraSpaceAfter: 7, margin: 0 });
  card(s, M + 6.25, 1.65, 5.95, 4.55, ICE);
  s.addText("D｜整合部署與交付　4 天（多為測試/設定短項）", { x: M + 6.55, y: 1.85, w: 5.4, h: 0.4, fontFace: FONT, fontSize: 14.5, bold: true, color: NAVY, margin: 0 });
  s.addText("地盤：infra/ + docs/", { x: M + 6.55, y: 2.25, w: 5.3, h: 0.3, fontFace: "Courier New", fontSize: 10.5, color: MUT, margin: 0 });
  s.addText([
    { text: "✅ AWS 帳號＋Bedrock 開通——07/19 完成（隊長帳號）", options: { bullet: true, bold: true, color: GREEN, breakLine: true } },
    { text: "✅ SAM 部署上線 07/19（/order 冒煙待真單）", options: { bullet: true, breakLine: true } },
    { text: "🔨 #6 Guardrails 建立｜#14 部署演練+DEPLOY.md", options: { bullet: true, breakLine: true } },
    { text: "🔬 #4 Private E2E 成交｜憑證 410｜雙層護欄測試", options: { bullet: true, breakLine: true } },
    { text: "🔬 E2E Golden Path 主導｜從零部署計時", options: { bullet: true, breakLine: true } },
    { text: "🔨 #8 預錄影片｜#15 簡報修正＋Kiro 證據", options: { bullet: true } },
  ], { x: M + 6.55, y: 2.65, w: 5.4, h: 3.4, fontFace: FONT, fontSize: 11.5, color: INK, paraSpaceAfter: 7, margin: 0 });
  card(s, M, 6.4, W - 2 * M, 0.85, "FFF4E0");
  s.addText([
    { text: "全員：", options: { bold: true, color: NAVY } },
    { text: "#3 KYC＋Key、Kiro 設定、截圖存證、每天合回 main。", options: { color: INK } },
    { text: "　跨包交接只有四條：", options: { bold: true, color: NAVY } },
    { text: "B→A 函式｜A→C schema｜D→A Guardrails ID｜A→D 可測版本 tag。", options: { color: INK } },
  ], { x: M + 0.3, y: 6.52, w: W - 2 * M - 0.6, h: 0.62, fontFace: FONT, fontSize: 11.5, valign: "middle", margin: 0 });
}

// ============ 7c 交棒地圖 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "交棒地圖：哪個工項完成，交付給誰", "進來的箭頭＝你在等什麼；出去的箭頭＝誰在等你。流程圖版在 README §1");
  const header = ["完成的工項", "交付物", "交給", "對方拿去做什麼"].map(t =>
    ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY } } }));
  const rows = [
    ["D：AWS 帳號＋Bedrock 開通", "帳號憑證", "A／B／D", "Bedrock 首跑｜KB 建置｜SAM 部署"],
    ["全員：Lv2 KYC＋Key（#3）", "各自 API Key", "D", "Private API E2E（#4）"],
    ["B：max_public 實測（#2）", "可靠的行情工具", "A", "get_market_data 放心用"],
    ["B：簽章對照核對", "簽章確認", "D", "E2E 真下單前置"],
    ["A：Bedrock 迴圈首跑", "跑通的迴圈", "A 自己", "解鎖 #1 #5 #10 #11 開發"],
    ["B：query_knowledge＋audit.py", "函式", "A", "註冊進 tools＋loop 埋點"],
    ["B：/audit endpoint", "audit schema", "C", "決策軌跡面板"],
    ["D：Guardrails 建立（#6）", "Guardrail ID", "A", "loop 掛載"],
    ["A：#11／#10／#1 完成", "scenarios/confirm schema（§3）", "C", "三方案卡・徽章・確認卡接真資料"],
    ["A：核心全完成", "可測版本 tag", "D", "E2E Golden Path 開跑"],
    ["C：手機版＋元件（#13）", "可操作前端", "D", "E2E＋離線備援驗證"],
    ["D：E2E 全線綠燈", "綠燈", "D 自己", "預錄影片（#8）＋DEPLOY.md（#14）"],
    ["D：影片＋部署 SOP", "決賽武器包", "全員", "8/1 上場"],
  ];
  s.addTable([header, ...rows.map(r => [
    { text: r[0], options: { bold: true, color: INK } },
    { text: r[1], options: { color: NAVY } },
    { text: r[2], options: { bold: true, color: GOLD } },
    { text: r[3], options: { color: INK } },
  ])], {
    x: M, y: 1.65, w: W - 2 * M, colW: [3.5, 2.9, 1.35, 4.38],
    fontFace: FONT, fontSize: 10, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.385, margin: 0.05,
  });
  s.addText("背四條就夠：B→A 函式｜A→C schema（已定義，C 先用假資料）｜D→A Guardrail ID｜A→D 可測版本 tag。", {
    x: M, y: 6.95, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 11.5, bold: true, color: NAVY, margin: 0 });
}

// ============ 7b 不打架五規則 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "交接不打架的五條規則");
  const rules = [
    ["1", "地盤制", "每包只 commit 自己的目錄。要動別人的地盤 → 開 issue 給對方包，不直接改", NAVY],
    ["2", "介面契約先行", "四支 API 格式寫死在 README §3——C 包照契約用假資料先做，不用等後端", GOLD],
    ["3", "共用檔單一 owner", "tools.py／loop.py 歸 A；B 寫好函式由 A 註冊。infra 歸 D。誰的檔誰合", GREEN],
    ["4", "每日回合", "每天至少一次 pull --rebase ＋合回 main。衝突當天解，不隔夜", BLUE],
    ["5", "改介面要廣播", "要改 README §3 先在 #dev 說，受影響的包點頭才動", RED],
  ];
  rules.forEach(([n, t, d, c], i) => {
    const y = 1.7 + i * 1.02;
    s.addShape("ellipse", { x: M, y: y + 0.1, w: 0.55, h: 0.55, fill: { color: c } });
    s.addText(n, { x: M, y: y + 0.1, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(t, { x: M + 0.8, y, w: 2.4, h: 0.85, fontFace: FONT, fontSize: 15.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(d, { x: M + 3.3, y, w: 8.9, h: 0.85, fontFace: FONT, fontSize: 12.5, color: INK, valign: "middle", margin: 0 });
  });
}

// ============ 8 功能 × 評分對應 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "功能 × 評分對應：你做的東西扛哪幾分", "每個工作項都有明確的得分理由——做的時候朝著驗收方向做");
  const header = [
    { text: "展示點（誰做的）", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "對應評分", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "分數怎麼拿", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const rows = [
    ["行為健檢真數字（A/B包）", "創意 25 + 商業 20", "評審給的資料挖出他們沒想到的洞察：追高65%、機會成本2,660萬——全場記憶點"],
    ["三方案生成＋恐慌攔截（A包）", "創意 25 + AI設計 15", "「不只回答，還給可執行的選項」——別隊的 AI 是聊天，我們的是行動"],
    ["Agent 工具鏈＋決策軌跡面板（A/B包）", "AI設計 15", "評分原文「上下文理解、主動分析數據、自動化執行交易決策」逐字對應，軌跡面板讓它看得見"],
    ["Profile 三模式提醒強度（A/C包）", "創意 25 + 商業 20", "同一句話三種回應——個人化不是口號是 Demo"],
    ["RAG 防詐/教材問答（B包）", "切合度 10", "官方資料源全用上：CSV+API+輿情+教材"],
    ["確認卡＋Audit Log（A/D包）", "商業 20 + 法遵敘事", "「合規是系統設計」——對 MaiCoin 評審的信任牌"],
    ["Private API 真實下單（D包）", "加分 +5", "Lv2 帳號＋最小額度真成交"],
    ["Kiro spec-driven 開發（全員）", "加分 +5", ".kiro/ 目錄＋截圖證據集"],
    ["離線備援＋預錄影片（C/D包）", "完成度 10", "現場網路掛掉照樣演完"],
    ["成本效益＋限制揭露（簡報）", "可行性 20", "模型分工、rate limit 因應、金鑰權限——主動揭露"],
  ];
  s.addTable([header, ...rows.map(r => [
    { text: r[0], options: { bold: true, color: INK } },
    { text: r[1], options: { bold: true, color: GOLD } },
    { text: r[2], options: { color: INK } },
  ])], {
    x: M, y: 1.6, w: W - 2 * M, colW: [3.5, 2.1, 6.53],
    fontFace: FONT, fontSize: 10.5, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.49, margin: 0.06,
  });
}

// ============ 9 Demo 畫面對應 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Demo 畫面對應：每個區塊是誰的作品、扛哪些分");
  // 左：手機畫面線框
  card(s, M, 1.7, 3.6, 5.1, "F4F7FD");
  s.addText("手機版畫面（#13 改版後）", { x: M + 0.25, y: 1.85, w: 3.1, h: 0.35, fontFace: FONT, fontSize: 11.5, bold: true, color: MUT, margin: 0 });
  const zones = [
    ["① 頂欄：麥麥＋模式徽章", NAVY, 0.5],
    ["② 健檢卡（橫向滑動）", GOLD, 0.75],
    ["③ 對話區（主畫面）", GREEN, 1.5],
    ["④ 三方案卡 / 確認卡", RED, 0.9],
    ["⑤ 決策軌跡（摺疊）", BLUE, 0.5],
  ];
  let zy = 2.25;
  zones.forEach(([t, c, h]) => {
    s.addShape("roundRect", { x: M + 0.25, y: zy, w: 3.1, h, rectRadius: 0.06, fill: { color: WHITE }, line: { color: c, width: 1.5 } });
    s.addText(t, { x: M + 0.4, y: zy, w: 2.85, h, fontFace: FONT, fontSize: 11, bold: true, color: c, valign: "middle", margin: 0 });
    zy += h + 0.12;
  });
  // 右：對應表
  const header = [
    { text: "畫面區塊", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "背後功能（工作包）", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "扛的分數", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const rows = [
    ["① 模式徽章", "profile-engine（A）＋前端（C）", "創意/商業"],
    ["② 健檢卡", "行為分析（✅）＋前端（C）", "創意/商業"],
    ["③ 對話回應", "Agent 迴圈＋模型路由（A）", "AI設計"],
    ["④ 三方案卡", "trade-scenarios（A）＋前端（C）", "創意/AI設計"],
    ["④ 確認卡→成交", "order 流＋Private API（D）", "加分+5/商業"],
    ["⑤ 軌跡面板", "audit-log（B）＋前端（C）", "AI設計/法遵"],
    ["（隱形）離線切換", "mock 備援（C 驗證）", "完成度"],
    ["（隱形）RAG 問答", "Knowledge Base（B）", "切合度"],
  ];
  s.addTable([header, ...rows.map(r => [
    { text: r[0], options: { bold: true, color: INK } },
    { text: r[1], options: { color: INK } },
    { text: r[2], options: { bold: true, color: GOLD } },
  ])], {
    x: M + 3.9, y: 1.7, w: 8.23, colW: [2.0, 4.13, 2.1],
    fontFace: FONT, fontSize: 11, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.56, margin: 0.06,
  });
  s.addText("原則：畫面上沒有任何一塊是裝飾——每個區塊都對應一個功能與至少一個評分項。", {
    x: M, y: 6.95, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 12.5, bold: true, color: NAVY, margin: 0 });
}

// ============ 9b Demo 實際畫面 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("Demo 實際畫面：Golden Path 三階段", { x: M, y: 0.4, w: W - 2 * M, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: WHITE, margin: 0 });
  s.addText("視覺 mockup＝C 包實作規格｜畫面中所有數字皆來自真實資料計算", { x: M, y: 1.0, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 12, color: "8FA0C9", margin: 0 });
  const shots = [
    { f: "screen1.png", cap: "① 健檢首屏：健康分＋行為洞察", sub: "開場 10 秒抓住評審" },
    { f: "screen2.png", cap: "② 恐慌攔截：工具鏈＋三方案", sub: "全場最重一擊（1/8 少賺 31 萬）" },
    { f: "screen3.png", cap: "③ 確認卡→成交→決策軌跡", sub: "AI 有手，方向盤在人手上" },
  ];
  const iw = 2.45, ih = 5.3, gap = 0.8;
  const x0 = (W - (iw * 3 + gap * 2)) / 2;
  shots.forEach((sh, i) => {
    const x = x0 + i * (iw + gap);
    s.addImage({ path: path.join(__dirname, "mockups", sh.f), x, y: 1.45, w: iw, h: ih });
    s.addText(sh.cap, { x: x - 0.35, y: 6.8, w: iw + 0.7, h: 0.35, fontFace: FONT, fontSize: 11.5, bold: true, color: WHITE, align: "center", margin: 0 });
    s.addText(sh.sub, { x: x - 0.35, y: 7.12, w: iw + 0.7, h: 0.3, fontFace: FONT, fontSize: 9.5, color: GOLD, align: "center", margin: 0 });
  });
}

// ============ 10 Golden Path 分鏡 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Golden Path 分鏡：90 秒，評審每一刻看到什麼");
  const header = [
    { text: "步驟", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "畫面上發生的事", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "評審看點", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "對應評分", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const rows = [
    ["0. 開場", "健檢首屏：追高 65%、機會成本 2,660 萬", "「這數字哪來的？」→ 評審自己給的資料", "創意 25"],
    ["1. 使用者輸入", "「ETH 跌太多，幫我全部賣掉」", "真實的恐慌場景，不是安排好的軟球", "商業 20"],
    ["2. AI 思考", "畫面顯示工具呼叫中：查持倉→查行情→查歷史→判斷模式", "AI 不是憑感覺，先查資料——看得見的推理", "AI設計 15"],
    ["3. 三方案", "三張卡：賣25%／全賣／暫停，各附損益・手續費・集中度", "數字由程式算，AI 只負責講人話", "創意+AI+可行性"],
    ["4. 恐慌提醒", "「1/8 你也是這樣，那次少賺 31 萬」", "用使用者自己的歷史說服他——全場最重一擊", "創意 25"],
    ["5. 確認→成交", "選「賣25%」→ 確認卡 → 按下確認 → 真實成交、健檢更新", "AI 有手但方向盤在人手上；真下單（Lv2）", "加分+5/商業"],
    ["6. 收尾", "點開決策軌跡面板：完整工具呼叫與訂單生命週期", "「合規不是聲明，是系統設計」", "AI設計/法遵"],
  ];
  s.addTable([header, ...rows.map(r => [
    { text: r[0], options: { bold: true, color: NAVY } },
    { text: r[1], options: { color: INK } },
    { text: r[2], options: { color: INK } },
    { text: r[3], options: { bold: true, color: GOLD } },
  ])], {
    x: M, y: 1.6, w: W - 2 * M, colW: [1.5, 4.5, 4.3, 1.83],
    fontFace: FONT, fontSize: 10.5, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.62, margin: 0.06,
  });
  s.addText("備援：任一步掛掉 → 離線 mock 接手繼續演；全掛 → 切預錄影片。演練時每步都要練過備援切換。", {
    x: M, y: 6.6, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 12, color: MUT, margin: 0 });
}

// ============ 11 系統架構成本明細 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "系統架構成本明細：這套東西到底花多少錢", "單價以 AWS 主控台現價估算；serverless＝用多少付多少，不用先繳月費");
  const header = [
    { text: "元件", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "計費方式", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "賽前開發期", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "決賽 Demo", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: "千人規模/月", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ];
  const rows = [
    ["Bedrock 模型（Haiku/Sonnet）", "依 token 計價＋prompt caching 一折", "≈NT$300（約500次測試對話）", "<NT$100", "依用量：重度用戶≈NT$60/人"],
    ["Lambda ×4＋API Gateway", "依請求數；免費額度 100 萬次/月", "≈NT$0（免費額度內）", "≈NT$0", "<NT$500"],
    ["DynamoDB（憑證/審計/session）", "on-demand 依讀寫", "≈NT$0", "≈NT$0", "<NT$300"],
    ["S3＋CloudFront（前端/資料）", "儲存＋流量", "<NT$30", "<NT$30", "<NT$500"],
    ["Knowledge Base＋S3 Vectors", "embedding 一次性＋向量儲存", "<NT$50（語料小）", "查詢零頭", "<NT$700"],
    ["MAX API", "呼叫免費；成交才收手續費", "NT$0", "最小額度手續費 <NT$10", "使用者自付"],
    ["Kiro（開發工具）", "黑客松贈點 2000/人", "NT$0（贈點內）", "NT$0", "—（開發工具）"],
  ];
  s.addTable([header, ...rows.map(r => r.map((c, j) => ({
    text: c, options: { color: j === 0 ? INK : j >= 2 ? NAVY : MUT, bold: j === 0, fontSize: 10.5 },
  })))], {
    x: M, y: 1.65, w: W - 2 * M, colW: [3.0, 2.9, 2.5, 1.9, 1.83],
    fontFace: FONT, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.58, margin: 0.06,
  });
  card(s, M, 6.2, W - 2 * M, 0.85, ICE);
  s.addText([
    { text: "全隊賽前總花費 < NT$500", options: { bold: true, color: GREEN, fontSize: 15 } },
    { text: "（幾乎只有 Bedrock 測試呼叫）；千人規模基礎設施 < NT$3,000/月＋模型依用量——本頁同時是可行性 20% 的簡報素材。", options: { color: INK, fontSize: 12.5 } },
  ], { x: M + 0.3, y: 6.32, w: W - 2 * M - 0.6, h: 0.62, fontFace: FONT, valign: "middle", margin: 0 });
}

// ============ 12 成本效益：三個省錢決策＋價值錨點 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("成本效益：我們主動避開的三個坑，和一句話的價值", { x: M, y: 0.55, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: WHITE, margin: 0 });
  const traps = [
    { t: "向量庫選 S3 Vectors", bad: "預設 OpenSearch Serverless 最低月費 ≈ NT$1 萬起", good: "S3 Vectors 幾十元搞定小語料——省 9 成以上" },
    { t: "全 serverless", bad: "EC2/容器要付閒置時間＋有人要顧機器", good: "Lambda 用多少付多少；30 小時裡零運維" },
    { t: "模型分層＋快取", bad: "全用大模型：每次對話 ≈ NT$2.2", good: "Haiku 日常＋Sonnet 深度＋prompt caching → 混合 <NT$0.6/次" },
  ];
  traps.forEach((tr, i) => {
    const x = M + i * 4.1;
    card(s, x, 1.6, 3.85, 2.9, NAVY);
    s.addText(tr.t, { x: x + 0.3, y: 1.85, w: 3.3, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: GOLD, margin: 0 });
    s.addText([
      { text: "✘ " + tr.bad, options: { color: "E8A5AC", breakLine: true } },
      { text: "", options: { breakLine: true } },
      { text: "✔ " + tr.good, options: { color: "9FE5B0" } },
    ], { x: x + 0.3, y: 2.45, w: 3.3, h: 1.9, fontFace: FONT, fontSize: 12, margin: 0 });
  });
  card(s, M, 4.85, W - 2 * M, 1.9, "22315E");
  s.addText("價值錨點（上台就講這句）", { x: M + 0.4, y: 5.05, w: 6, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: GOLD, margin: 0 });
  s.addText([
    { text: "每次對話 <NT$0.6；這個帳戶平均每筆賣出的機會成本 NT$11,480。", options: { color: WHITE, fontSize: 16, breakLine: true } },
    { text: "一年只要攔下「一筆」衝動交易，就抵掉這位用戶 16 年的 AI 成本。", options: { color: WHITE, fontSize: 20, bold: true } },
  ], { x: M + 0.4, y: 5.5, w: W - 2 * M - 0.8, h: 1.1, fontFace: FONT, margin: 0 });
}

// ============ 13 Kiro 部署（一次設定）============
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

// ============ 驗收總覽 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "驗收總覽：十組清單，打勾才算數", "逐條版在 README §4——完成一項就去那裡打勾");
  const header = ["驗收組", "負責包", "狀態", "關鍵驗收（一句話版）"].map(t =>
    ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY } } }));
  const rows = [
    ["4.1 行為分析引擎", "B（已完）", { text: "✅ 已全過", options: { bold: true, color: GREEN } }, "真實資料四項指標全數驗證（65%／2,660萬／31萬／14.2%）"],
    ["4.2 對話 Agent", "A（E2E:D）", { text: "進行中", options: { bold: true, color: GOLD } }, "個人問題引數字、行情附時間、明牌不給、confirm 帶出、≤8 輪"],
    ["4.3 三方案引擎", "A（卡片:C）", { text: "待做", options: { bold: true, color: RED } }, "三方案數字全由程式算、費率附來源、相容 prepare_order"],
    ["4.4 Profile Engine", "A（UI:C）", { text: "待做", options: { bold: true, color: RED } }, "確定性分三模式、同句話三種回應肉眼可辨"],
    ["4.5 授權下單流", "D（單元:A）", { text: "待驗", options: { bold: true, color: GOLD } }, "60s 憑證單次有效、過期重放 410、最小額度真成交一次"],
    ["4.6 RAG 知識庫", "B（註冊:A）", { text: "待做", options: { bold: true, color: RED } }, "KB+S3 Vectors、回答附出處、語料不進 git"],
    ["4.7 Audit Log", "B（埋點:A 面板:C）", { text: "待做", options: { bold: true, color: RED } }, "工具+訂單全留痕、軌跡可還原、append-only"],
    ["4.8 前端", "C", { text: "待做", options: { bold: true, color: RED } }, "照 mockups 三畫面實作、拔網路 mock 自動接手"],
    ["4.9 安全與法遵", "D（掛載:A）", { text: "設計已定", options: { bold: true, color: GOLD } }, "四紅線＝四個架構決策，兩層護欄各自能單獨擋"],
    ["4.10 部署與交付", "D", { text: "進行中", options: { bold: true, color: GOLD } }, "07/19 首次部署上線；從零 <1hr 演練、E2E、六項交付物待做"],
  ];
  s.addTable([header, ...rows.map(r => [
    { text: r[0], options: { bold: true, color: INK } },
    { text: r[1], options: { bold: true, color: NAVY } }, r[2],
    { text: r[3], options: { color: INK } },
  ])], {
    x: M, y: 1.7, w: W - 2 * M, colW: [2.1, 1.75, 1.15, 7.13],
    fontFace: FONT, fontSize: 10.5, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.485, margin: 0.06,
  });
}

// ============ 成果 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("目前成果", { x: M, y: 0.55, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, margin: 0 });
  card(s, M, 1.55, 5.9, 5.2, NAVY);
  s.addText("已驗證的真實洞察", { x: M + 0.35, y: 1.8, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: GOLD, margin: 0 });
  s.addText([
    { text: "追高 65%（2,350 筆買入）", options: { bullet: true, breakLine: true } },
    { text: "殺低僅 34.1% —— 非恐慌型", options: { bullet: true, breakLine: true } },
    { text: "年度機會成本 NT$26,598,877", options: { bullet: true, breakLine: true } },
    { text: "最痛單筆 1/8 DOGE 少賺 NT$312,924", options: { bullet: true, breakLine: true } },
    { text: "下跌後出金僅 14.2%", options: { bullet: true, breakLine: true } },
    { text: "最活躍 2025-05／08（各 416 筆）", options: { bullet: true } },
  ], { x: M + 0.35, y: 2.35, w: 5.2, h: 4.2, fontFace: FONT, fontSize: 13.5, color: ICE, paraSpaceAfter: 10, margin: 0 });
  card(s, M + 6.25, 1.55, 5.9, 5.2, "22315E");
  s.addText("已完成的資產", { x: M + 6.6, y: 1.8, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: GOLD, margin: 0 });
  s.addText([
    { text: "程式骨架：Agent 迴圈/護欄、Lambda×4、MAX 整合、前端 SPA、SAM", options: { bullet: true, breakLine: true } },
    { text: ".kiro/：steering×3＋specs×6＋MCP 設定（+5% 證據）", options: { bullet: true, breakLine: true } },
    { text: "設計：三張 Demo 畫面＋麥麥像素吉祥物三態", options: { bullet: true, breakLine: true } },
    { text: "簡報：提案簡報（評審版）＋本手冊", options: { bullet: true, breakLine: true } },
    { text: "環境：repo＋Issues×15＋Slack＋Drive＋setup.sh", options: { bullet: true } },
  ], { x: M + 6.6, y: 2.35, w: 5.25, h: 4.2, fontFace: FONT, fontSize: 13, color: ICE, paraSpaceAfter: 10, margin: 0 });
  s.addText("唯一文件：github.com/giont565/MaiMate（README）——驗收打勾、改介面、改範圍都在那裡。", {
    x: M, y: 6.95, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 12.5, color: "8FA0C9", margin: 0 });
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

const out = path.join(__dirname, "MaiMate_開發手冊.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("written:", out));
