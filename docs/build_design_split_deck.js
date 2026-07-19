/* 設計圖＋工作分配（3 頁，給隊友選包用） */
const pptxgen = require("pptxgenjs");
const path = require("path");

const NAVY = "16224D", NAVY_D = "0D1530", ICE = "EAF0FB", GOLD = "E8A13A";
const GREEN = "1F9D66", RED = "D64550", BLUE = "2B6CB0", INK = "1F2937", MUT = "6B7280", WHITE = "FFFFFF";
const FONT = "Microsoft JhengHei";
const W = 13.33, M = 0.6;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";

function card(s, x, y, w, h, fill) {
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.09, fill: { color: fill || ICE }, line: { type: "none" } });
}

// ============ 1 設計圖 ============
{
  const s = pres.addSlide();
  s.background = { color: NAVY_D };
  s.addText("MaiMate 設計圖", { x: M, y: 0.35, w: 8, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, margin: 0 });
  s.addText("Golden Path 三畫面｜所有數字皆真實資料計算｜HTML 原始碼在 docs/mockups/（＝前端起點）", {
    x: M, y: 0.95, w: 10.5, h: 0.35, fontFace: FONT, fontSize: 11.5, color: "8FA0C9", margin: 0 });
  // 吉祥物
  s.addImage({ path: path.join(__dirname, "brand", "maimate_bot_small.png"), x: 12.15, y: 0.35, w: 0.72, h: 0.78 });
  const shots = [
    { f: "screen1.png", cap: "① 健檢首屏｜健康分＋行為洞察" },
    { f: "screen2.png", cap: "② 恐慌攔截｜工具鏈＋三方案" },
    { f: "screen3.png", cap: "③ 確認→成交→決策軌跡" },
  ];
  const iw = 2.62, ih = 5.67, gap = 0.85;
  const x0 = (W - (iw * 3 + gap * 2)) / 2;
  shots.forEach((sh, i) => {
    const x = x0 + i * (iw + gap);
    s.addImage({ path: path.join(__dirname, "mockups", sh.f), x, y: 1.42, w: iw, h: ih });
    s.addText(sh.cap, { x: x - 0.4, y: 7.12, w: iw + 0.8, h: 0.32, fontFace: FONT, fontSize: 11, bold: true, color: WHITE, align: "center", margin: 0 });
  });
}

// ============ 2 四包切法 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText("工作分配：四包自選，每包獨佔自己的地盤", { x: M, y: 0.45, w: W - 2 * M, h: 0.65, fontFace: FONT, fontSize: 26, bold: true, color: NAVY, margin: 0 });
  s.addText("切法原則：目錄所有權互不重疊（git 不會打架）＋工時拉平（各約 4 天）＋交接只走 docs/API.md 介面", {
    x: M, y: 1.1, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 12.5, color: MUT, margin: 0 });
  const header = ["工作包", "做什麼（issues）", "獨佔目錄", "估工時", "適合的人"].map(t =>
    ({ text: t, options: { bold: true, color: WHITE, fill: { color: NAVY } } }));
  const rows = [
    [{ text: "A｜Agent 與方案引擎", options: { bold: true, color: NAVY } },
     "confirm帶出(#1)、模型路由(#5)、Profile(#10)、三方案(#11)、Bedrock 首跑",
     "backend/agent/", { text: "4.5 天", options: { bold: true, color: GOLD } }, "想深玩 LLM／tool-use 的人"],
    [{ text: "B｜資料服務與 RAG", options: { bold: true, color: NAVY } },
     "Public API 實測(#2)、RAG 語料+KB(#9)、Audit Log(#12)",
     "backend/integrations/ + analysis/ + 語料", { text: "4 天", options: { bold: true, color: GOLD } }, "喜歡資料工程／AWS 服務的人"],
    [{ text: "C｜前端與品牌", options: { bold: true, color: NAVY } },
     "手機版改版(#13)、三方案卡/徽章/軌跡面板、離線備援、麥麥視覺",
     "frontend/ + docs/mockups/ + brand/", { text: "4 天", options: { bold: true, color: GOLD } }, "重視覺與使用者體驗的人"],
    [{ text: "D｜整合部署與交付", options: { bold: true, color: NAVY } },
     "部署演練(#14)、Private API E2E(#4)、Guardrails(#6)、錄影(#8)、簡報(#15)、E2E 測試主導",
     "infra/ + docs/ + DEPLOY.md", { text: "4 天", options: { bold: true, color: GOLD } }, "喜歡統籌／確保能上場的人"],
  ];
  s.addTable([header, ...rows], {
    x: M, y: 1.65, w: W - 2 * M, colW: [2.3, 4.6, 2.7, 0.9, 1.63],
    fontFace: FONT, fontSize: 11, color: INK, valign: "middle",
    border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.95, margin: 0.08,
  });
  card(s, M, 6.35, W - 2 * M, 0.85, "FFF4E0");
  s.addText([
    { text: "共同任務（不算包內工時）：", options: { bold: true, color: NAVY } },
    { text: "自己的 MAX Lv2 KYC＋API Key（#3）、Kiro 設定、每天把自己的分支合回 main。", options: { color: INK } },
  ], { x: M + 0.3, y: 6.47, w: W - 2 * M - 0.6, h: 0.62, fontFace: FONT, fontSize: 12.5, valign: "middle", margin: 0 });
}

// ============ 3 不打架的機制 ============
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText("交接不打架的五條規則", { x: M, y: 0.45, w: W - 2 * M, h: 0.65, fontFace: FONT, fontSize: 26, bold: true, color: NAVY, margin: 0 });
  const rules = [
    ["1", "地盤制", "每包只 commit 自己的目錄。要動別人的地盤 → 開 issue 給對方包，不直接改", NAVY],
    ["2", "介面契約先行", "四支 API 的請求/回應格式已寫死在 docs/API.md——C 包照契約用假資料先做，不用等後端", GOLD],
    ["3", "共用檔單一 owner", "tools.py／loop.py 歸 A；B 寫好函式由 A 註冊。infra 歸 D。誰的檔誰合", GREEN],
    ["4", "每日回合", "每天至少一次 pull --rebase ＋合回 main。衝突當天解，不隔夜", BLUE],
    ["5", "改介面要廣播", "要改 API.md 先在 #dev 說，受影響的包點頭才動——介面是全隊的，不是誰的", RED],
  ];
  rules.forEach(([n, t, d, c], i) => {
    const y = 1.5 + i * 1.02;
    s.addShape("ellipse", { x: M, y: y + 0.1, w: 0.55, h: 0.55, fill: { color: c } });
    s.addText(n, { x: M, y: y + 0.1, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    s.addText(t, { x: M + 0.8, y, w: 2.4, h: 0.85, fontFace: FONT, fontSize: 15.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
    s.addText(d, { x: M + 3.3, y, w: 8.9, h: 0.85, fontFace: FONT, fontSize: 12.5, color: INK, valign: "middle", margin: 0 });
  });
  card(s, M, 6.7, W - 2 * M, 0.6, ICE);
  s.addText("選包方式：Slack #general 回覆想要的包（先搶先贏），撞包就聊一下交換條件——今天內定案。", {
    x: M + 0.3, y: 6.78, w: W - 2 * M - 0.6, h: 0.45, fontFace: FONT, fontSize: 12.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
}

const out = path.join(__dirname, "設計與分工.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("written:", out));
