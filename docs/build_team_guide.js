/* 組員開發環境上手指南（內部文件） */
const pptxgen = require("pptxgenjs");
const path = require("path");

const NAVY = "16224D", NAVY_D = "0D1530", ICE = "EAF0FB", GOLD = "E8A13A";
const GREEN = "1F9D66", RED = "D64550", INK = "1F2937", MUT = "6B7280", WHITE = "FFFFFF";
const FONT = "Microsoft JhengHei";
const W = 13.33, M = 0.6;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";

function bigTitle(s, t) {
  s.addText(t, { x: M, y: 0.5, w: W - 2 * M, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: NAVY, margin: 0 });
}
function card(s, x, y, w, h, fill) {
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.09, fill: { color: fill || ICE }, line: { type: "none" } });
}
function stepNum(s, x, y, n, color) {
  s.addShape("ellipse", { x, y, w: 0.5, h: 0.5, fill: { color: color || NAVY } });
  s.addText(String(n), { x, y, w: 0.5, h: 0.5, fontFace: FONT, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
}
function mono(txt) { return { text: txt, options: { fontFace: "Courier New", fontSize: 12, color: NAVY } }; }

// ============ 1 封面 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addShape("ellipse", { x: 10.2, y: -1.8, w: 5.5, h: 5.5, fill: { color: NAVY } });
  s.addText("隊伍「第五名」內部文件", { x: M, y: 1.6, w: 8, h: 0.4, fontFace: FONT, fontSize: 14, color: GOLD, margin: 0 });
  s.addText("MaiMate 開發環境上手指南", { x: M, y: 2.1, w: W - 2 * M, h: 1.0, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, margin: 0 });
  s.addText("照這份做完（約 40 分鐘），你就能開始開發。設定只做一次。", { x: M, y: 3.35, w: 10, h: 0.5, fontFace: FONT, fontSize: 18, color: ICE, margin: 0 });
  s.addText("重要時程：7/22（三）決賽名單公布｜8/1–8/2 決賽（全員全程）", { x: M, y: 6.4, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, color: "8FA0C9", margin: 0 });
}

// ============ 2 工具總覽 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "我們用四個工具，各管一件事");
  const tools = [
    { t: "GitHub", sub: "程式碼＋任務板", d: "隊伍 repo：MaiMate（私有）。程式碼同步、Issues 任務認領都在這。", c: INK },
    { t: "Kiro", sub: "開發環境（AI IDE）", d: "每人裝在自己電腦。AI 幫你照規格寫程式——這也是比賽加分項（+5%）。", c: GOLD },
    { t: "Slack", sub: "溝通", d: "Workspace「Hackathon」已建好。公告看 #general、程式討論在 #dev。", c: GREEN },
    { t: "Google Drive", sub: "文件與資料集", d: "「黑客松」共享資料夾：命題文件、官方 CSV、簡報都在這。", c: NAVY },
  ];
  tools.forEach((t, i) => {
    const x = M + (i % 2) * 6.2, y = 1.7 + Math.floor(i / 2) * 2.35;
    card(s, x, y, 5.95, 2.1, ICE);
    s.addText(t.t, { x: x + 0.35, y: y + 0.25, w: 3, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: t.c, margin: 0 });
    s.addText(t.sub, { x: x + 0.35, y: y + 0.75, w: 5.2, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: GOLD, margin: 0 });
    s.addText(t.d, { x: x + 0.35, y: y + 1.12, w: 5.3, h: 0.9, fontFace: FONT, fontSize: 12.5, color: INK, margin: 0 });
  });
  s.addText("原則：程式進 GitHub、檔案進 Drive、話講在 Slack、開發全程用 Kiro。", {
    x: M, y: 6.5, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13.5, bold: true, color: NAVY, margin: 0 });
}

// ============ 3 Step 1 GitHub ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Step 1｜GitHub：加入 repo、抓下程式碼");
  const steps = [
    ["收邀請", "信箱找 GitHub 邀請信（隊長已寄），按 Accept invitation"],
    ["裝 Git", "沒裝過的：git-scm.com 下載安裝，一路下一步即可"],
    ["Clone", "git clone https://github.com/giont565/MaiMate.git"],
    ["初始化", "bash scripts/setup.sh —— 環境缺什麼、下一步做什麼，它會直接告訴你"],
  ];
  steps.forEach((st, i) => {
    const y = 1.75 + i * 0.95;
    stepNum(s, M, y, i + 1);
    s.addText(st[0], { x: M + 0.75, y: y - 0.03, w: 1.6, h: 0.55, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(st[1], { x: M + 2.5, y: y - 0.03, w: 9.6, h: 0.55, fontFace: i === 2 ? "Courier New" : FONT, fontSize: i === 2 ? 13 : 13.5, color: INK, valign: "middle", margin: 0 });
  });
  card(s, M, 5.7, W - 2 * M, 1.15, ICE);
  s.addText([
    { text: "三條 git 規則（黑客松版，不搞複雜流程）：", options: { bold: true, color: NAVY, breakLine: true } },
    { text: "① main 保持隨時能 demo，各自開短分支做完就合　② push 前先 git pull --rebase　③ commit 小顆、訊息寫清楚做了什麼", options: { color: INK } },
  ], { x: M + 0.3, y: 5.85, w: W - 2 * M - 0.6, h: 0.9, fontFace: FONT, fontSize: 12.5, margin: 0 });
}

// ============ 4 Step 2 Kiro ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Step 2｜Kiro：安裝＋兌換黑客松額度");
  const steps = [
    ["下載", "kiro.dev 下載安裝（Mac / Windows，介面就是 VS Code）"],
    ["登入", "用自己的 Google 帳號登入（各用各的，帳號與額度不能共用——主辦規定）"],
    ["兌換", "輸入兌換碼 GenAIHack26 → 帳號選單裡看到 Bonus Credits 2000 即成功"],
    ["確認", "右上頭像 → 看到「GenAIHack26｜2000 total」就完成，順手截圖存證"],
  ];
  steps.forEach((st, i) => {
    const y = 1.75 + i * 0.95;
    stepNum(s, M, y, i + 1, GOLD);
    s.addText(st[0], { x: M + 0.75, y: y - 0.03, w: 1.6, h: 0.55, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(st[1], { x: M + 2.5, y: y - 0.03, w: 9.6, h: 0.55, fontFace: FONT, fontSize: 13.5, color: INK, valign: "middle", margin: 0 });
  });
  card(s, M, 5.7, W - 2 * M, 1.15, "FDF0EF");
  s.addText([
    { text: "Credit 只發一次、用完不補。", options: { bold: true, color: RED } },
    { text: "全隊預算：練習期每人 ≤300、開發期共用約 1000、決賽現場保底 700。跟課看示範就好的步驟不要自己重跑；Autopilot 只在跑定義好的 task 時開。", options: { color: INK } },
  ], { x: M + 0.3, y: 5.85, w: W - 2 * M - 0.6, h: 0.9, fontFace: FONT, fontSize: 12.5, margin: 0 });
}

// ============ 5 Step 3 開專案 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Step 3｜用 Kiro 打開專案，它就懂我們的規矩");
  s.addText("Kiro → Open Folder → 選剛 clone 的 MaiMate 資料夾。打開後它會自動讀 .kiro/ 裡的東西：", {
    x: M, y: 1.6, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 14.5, color: INK, margin: 0 });
  const items = [
    { t: ".kiro/steering/", d: "我們的紅線與約定（不報明牌、金鑰不進版控、CSV 欄位定義、架構規範）。Kiro 生成的每一行程式都會遵守——你不用自己記。", c: NAVY },
    { t: ".kiro/specs/", d: "功能規格。chat-agent 已有完整三件套：requirements（驗收條件）→ design（設計）→ tasks（任務清單，前 4 條已完成）。", c: GOLD },
    { t: ".kiro/settings/mcp.json", d: "MAX 交易所 MCP 接入設定。把路徑改成你本機 clone 的 max-mcp-server 位置，金鑰走環境變數。", c: GREEN },
  ];
  items.forEach((it, i) => {
    const y = 2.25 + i * 1.35;
    card(s, M, y, W - 2 * M, 1.2, ICE);
    s.addText(it.t, { x: M + 0.35, y: y + 0.12, w: 3.4, h: 0.5, fontFace: "Courier New", fontSize: 14, bold: true, color: it.c, margin: 0 });
    s.addText(it.d, { x: M + 3.9, y: y + 0.1, w: 8.3, h: 1.0, fontFace: FONT, fontSize: 12.5, color: INK, valign: "middle", margin: 0 });
  });
  s.addText("開發起手式：左側 Specs 面板 → chat-agent → tasks → 從沒打勾的任務點「Start task」。", {
    x: M, y: 6.45, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 13.5, bold: true, color: NAVY, margin: 0 });
}

// ============ 6 Step 4 MAX ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "Step 4｜MAX 帳號與 API 金鑰（每人自己辦）");
  const steps = [
    ["註冊", "用官方連結註冊 MAX：max.maicoin.com/signup?r=dreambigbtc"],
    ["KYC", "完成 Lv2 實名認證（要等審核，今天就辦）——這是比賽加分項 +5%"],
    ["產 Key", "MAX 網頁 → API 管理 → 建立 API Key，權限只勾「讀取＋交易」，絕不勾「提領」"],
    ["設定", "金鑰存自己電腦環境變數：MAX_API_KEY、MAX_API_SECRET"],
  ];
  steps.forEach((st, i) => {
    const y = 1.75 + i * 0.95;
    stepNum(s, M, y, i + 1, GREEN);
    s.addText(st[0], { x: M + 0.75, y: y - 0.03, w: 1.6, h: 0.55, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(st[1], { x: M + 2.5, y: y - 0.03, w: 9.6, h: 0.55, fontFace: FONT, fontSize: 13.5, color: INK, valign: "middle", margin: 0 });
  });
  card(s, M, 5.7, W - 2 * M, 1.15, "FDF0EF");
  s.addText([
    { text: "金鑰紅線：", options: { bold: true, color: RED } },
    { text: "不貼 Slack、不貼任何聊天、不進 git。程式一律從環境變數讀。誰的金鑰誰保管，Demo 用隊長的帳號跑最小額度測試單。", options: { color: INK } },
  ], { x: M + 0.3, y: 5.9, w: W - 2 * M - 0.6, h: 0.8, fontFace: FONT, fontSize: 12.5, valign: "middle", margin: 0 });
}

// ============ 7 日常工作流 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "日常開發：一個循環，四個動作");
  const flow = [
    { t: "領任務", d: "GitHub Issues（或 tasks.md）認領一條，Slack #dev 說一聲避免撞車", c: NAVY },
    { t: "開分支", d: "git checkout -b feat/任務名 —— 從最新的 main 開", c: NAVY },
    { t: "Kiro 做", d: "Specs 面板點該任務 Start task，或直接把需求講給 Kiro；改完自己看過 diff 再收", c: GOLD },
    { t: "合回去", d: "git pull --rebase → push → 開 PR 或直接合（賽前用 PR，決賽現場講求速度可直合）", c: GREEN },
  ];
  flow.forEach((f, i) => {
    const y = 1.8 + i * 1.12;
    stepNum(s, M, y + 0.15, i + 1, f.c);
    card(s, M + 0.75, y, 11.9, 0.95, i === 2 ? "FFF4E0" : ICE);
    s.addText(f.t, { x: M + 1.1, y: y + 0.08, w: 1.9, h: 0.8, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(f.d, { x: M + 3.1, y: y + 0.08, w: 9.3, h: 0.8, fontFace: FONT, fontSize: 12.5, color: INK, valign: "middle", margin: 0 });
  });
  s.addText("新功能要開工前：先請 Kiro 生成 spec（requirements → design → tasks），人審過 requirements 再動手——規格便宜，返工很貴。", {
    x: M, y: 6.45, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, margin: 0 });
}

// ============ 8 紅線與求助 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("兩條紅線，以及卡住了找誰", { x: M, y: 0.55, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, margin: 0 });
  card(s, M, 1.6, 5.95, 2.5, NAVY);
  s.addText("🚫 官方 CSV 不進 GitHub", { x: M + 0.35, y: 1.85, w: 5.3, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: RED, margin: 0 });
  s.addText("主辦規定資料僅供競賽使用、勿轉傳。原始檔只放 Drive 共享資料夾；repo 的 .gitignore 已擋，不要繞過它。", {
    x: M + 0.35, y: 2.4, w: 5.3, h: 1.5, fontFace: FONT, fontSize: 13, color: ICE, margin: 0 });
  card(s, M + 6.2, 1.6, 5.95, 2.5, NAVY);
  s.addText("🚫 金鑰與兌換碼不共用、不外流", { x: M + 6.55, y: 1.85, w: 5.3, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: RED, margin: 0 });
  s.addText("Kiro 兌換碼、workshop access code、MAX API Key 都僅限本人使用——違者主辦可取消參賽資格。金鑰只放環境變數。", {
    x: M + 6.55, y: 2.4, w: 5.3, h: 1.5, fontFace: FONT, fontSize: 13, color: ICE, margin: 0 });
  card(s, M, 4.5, W - 2 * M, 2.1, "22315E");
  s.addText([
    { text: "卡住了怎麼辦（照順序）：", options: { bold: true, color: GOLD, breakLine: true } },
    { text: "① 先問 Kiro（描述錯誤訊息，它多半能解）　② Slack #dev 貼問題＋截圖　③ 環境／帳號類問題找隊長　④ 主辦相關問題寄 hackathon@digitimes.com", options: { color: WHITE, breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "重要連結都釘選在 Slack #general：repo、Drive 資料夾、MAX API 文件、命題文件。", options: { color: "A9B7D9" } },
  ], { x: M + 0.35, y: 4.75, w: W - 2 * M - 0.7, h: 1.7, fontFace: FONT, fontSize: 13.5, margin: 0 });
}

// ============ 9 重要連結 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  bigTitle(s, "重要連結（點了就到）");
  const groups = [
    { h: "程式碼與任務", links: [
      ["隊伍 Repo（MaiMate）", "https://github.com/giont565/MaiMate"],
      ["環境檢查腳本（clone 後執行）", "https://github.com/giont565/MaiMate/blob/main/scripts/setup.sh"],
      ["任務清單 tasks.md", "https://github.com/giont565/MaiMate/blob/main/.kiro/specs/chat-agent/tasks.md"],
    ]},
    { h: "Drive 文件與資料集", links: [
      ["比賽專案資料夾（命題文件/簡報/數據）", "https://drive.google.com/drive/folders/1TWnet3QahUA2pUWYeGzAMuC-4Ijix6_S"],
      ["官方數據集（CSV，下載後放 repo 的 data/）", "https://drive.google.com/drive/folders/1aeXn6lZOTgtwK_iCyFh2_fcYMcAQgLwC"],
      ["MaiCoin 工作坊簡報 PDF", "https://drive.google.com/file/d/1iIpCu5BAjRL7s30_oGHUdU76517OAYpz/view"],
    ]},
    { h: "MAX 交易所", links: [
      ["註冊（官方提供連結）", "https://max.maicoin.com/signup?r=dreambigbtc"],
      ["API 文件 v3", "https://max-api.maicoin.com/doc/v3.html"],
      ["WebSocket 文件", "https://maicoin.github.io/max-websocket-docs"],
      ["MAX MCP Server（接進 Kiro 用）", "https://github.com/bistin/max-mcp-server"],
    ]},
    { h: "工具與求助", links: [
      ["Kiro 下載", "https://kiro.dev"],
      ["MAX Skill（下單模組參考）", "https://github.com/bistin/max-api-skill"],
      ["主辦活動小組信箱", "mailto:hackathon@digitimes.com"],
    ]},
  ];
  groups.forEach((g, gi) => {
    const x = M + (gi % 2) * 6.2, y = 1.6 + Math.floor(gi / 2) * 2.65;
    card(s, x, y, 5.95, 2.45, ICE);
    s.addText(g.h, { x: x + 0.3, y: y + 0.15, w: 5.3, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    const runs = [];
    g.links.forEach(([label, url], li) => {
      runs.push({ text: "• " + label, options: { hyperlink: { url }, color: "1155CC", fontSize: 12, breakLine: li < g.links.length - 1 } });
    });
    s.addText(runs, { x: x + 0.3, y: y + 0.6, w: 5.4, h: 1.75, fontFace: FONT, paraSpaceAfter: 6, margin: 0 });
  });
  s.addText("這頁所有連結也釘選在 Slack #general——找不到東西先去那裡。", {
    x: M, y: 6.95, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 12, color: MUT, margin: 0 });
}

const out = path.join(__dirname, "開發環境上手指南.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("written:", out));
