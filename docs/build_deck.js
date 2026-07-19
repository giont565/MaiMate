/* MaiMate 提案簡報產生器 v2
 * 資料來源：../data/health_report.json（真實 CSV 預計算結果）
 * v2：標題改為敘事式結論、移除英文 kicker 與頁尾評分標語，評分對應改放講者備忘稿
 */
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const {
  FaChartLine, FaShieldAlt, FaDatabase, FaComments,
  FaBolt, FaCheckCircle, FaGithub,
  FaExclamationTriangle, FaHandPointer, FaVideo, FaKey, FaTools,
} = require("react-icons/fa");

const report = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "health_report.json")));

// ---------- palette ----------
const NAVY = "16224D";
const NAVY_D = "0D1530";
const ICE = "EAF0FB";
const GOLD = "E8A13A";
const GREEN = "1F9D66";
const RED = "D64550";
const INK = "1F2937";
const MUT = "6B7280";
const WHITE = "FFFFFF";
const FONT = "Microsoft JhengHei";

const W = 13.33, H = 7.5, M = 0.6;

// ---------- icon rendering ----------
const iconCache = {};
async function iconPng(Icon, hex) {
  const key = Icon.name + hex;
  if (iconCache[key]) return iconCache[key];
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Icon, { color: "#" + hex, size: 256 })
  );
  const buf = await sharp(Buffer.from(svg)).resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  iconCache[key] = "image/png;base64," + buf.toString("base64");
  return iconCache[key];
}

function circleIcon(slide, data, x, y, d, bg) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: bg } });
  const pad = d * 0.26;
  slide.addImage({ data, x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

function bigTitle(slide, title) {
  slide.addText(title, { x: M, y: 0.5, w: W - 2 * M, h: 0.85, fontFace: FONT, fontSize: 29, bold: true, color: NAVY, margin: 0 });
}

function card(slide, x, y, w, h, fill) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.09, fill: { color: fill || ICE }, line: { type: "none" } });
}

function arrowRight(slide, x, y) {
  slide.addShape("line", { x, y, w: 0.35, h: 0, line: { color: "8FA0C9", width: 1.75, endArrowType: "arrow" } });
}

(async () => {
  const ic = {
    chart: await iconPng(FaChartLine, WHITE),
    shield: await iconPng(FaShieldAlt, WHITE),
    db: await iconPng(FaDatabase, WHITE),
    comments: await iconPng(FaComments, WHITE),
    bolt: await iconPng(FaBolt, WHITE),
    check: await iconPng(FaCheckCircle, WHITE),
    github: await iconPng(FaGithub, WHITE),
    warn: await iconPng(FaExclamationTriangle, WHITE),
    hand: await iconPng(FaHandPointer, WHITE),
    video: await iconPng(FaVideo, WHITE),
    key: await iconPng(FaKey, WHITE),
    tools: await iconPng(FaTools, WHITE),
  };

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";

  // ============ S1 封面 ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY_D };
    s.addShape("ellipse", { x: 10.2, y: -1.8, w: 5.5, h: 5.5, fill: { color: NAVY } });
    s.addShape("ellipse", { x: -1.6, y: 5.2, w: 4.2, h: 4.2, fill: { color: NAVY } });
    s.addText("2026 雲湧智生黑客松｜智慧理財（MaiCoin 命題）", {
      x: M, y: 1.5, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 14, color: GOLD, margin: 0 });
    s.addText("MaiMate", { x: M, y: 2.1, w: W - 2 * M, h: 1.3, fontFace: FONT, fontSize: 66, bold: true, color: WHITE, margin: 0 });
    s.addText("懂你操作史的 AI 投資特助", { x: M, y: 3.5, w: W - 2 * M, h: 0.6, fontFace: FONT, fontSize: 26, color: ICE, margin: 0 });
    s.addText("市場數據工具很多。看得懂「你自己」的，一個都沒有。", {
      x: M, y: 4.4, w: 9.5, h: 0.5, fontFace: FONT, fontSize: 15, color: "A9B7D9", margin: 0 });
    s.addText("隊伍：第五名", { x: M, y: 6.5, w: 6, h: 0.4, fontFace: FONT, fontSize: 14, color: "8FA0C9", margin: 0 });
    s.addNotes("開場 30 秒：先丟問題——在座有人知道自己去年追高了幾次嗎？沒有工具會告訴你。這就是我們做的事。");
  }

  // ============ S2 痛點 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "投資人看得到 K 線，看不到自己");
    s.addText("這是一個真實帳戶：一年 4,674 筆買賣、5,326 筆出入金。App 告訴他餘額多少——僅此而已。", {
      x: M, y: 1.6, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 16, color: INK, margin: 0 });

    card(s, M, 2.35, 5.9, 3.3, ICE);
    circleIcon(s, ic.warn, M + 0.35, 2.7, 0.72, RED);
    s.addText("沒人告訴他自己的習慣", { x: M + 1.3, y: 2.78, w: 4.4, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: NAVY, margin: 0 });
    s.addText("Dashboard 只是單向的圖表。他看得到每根 K 線，卻看不到自己一次又一次在高點進場——也算不出每個衝動決定的代價。", {
      x: M + 0.35, y: 3.6, w: 5.2, h: 1.85, fontFace: FONT, fontSize: 14, color: INK, margin: 0 });

    card(s, M + 6.25, 2.35, 5.9, 3.3, ICE);
    circleIcon(s, ic.bolt, M + 6.6, 2.7, 0.72, NAVY);
    s.addText("看到訊號，來不及行動", { x: M + 7.55, y: 2.78, w: 4.4, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: NAVY, margin: 0 });
    s.addText("看到訊號 → 切 App → 找交易對 → 填單。四個步驟走完，行情已經走掉。從判斷到執行，中間斷成好幾截。", {
      x: M + 6.6, y: 3.6, w: 5.2, h: 1.85, fontFace: FONT, fontSize: 14, color: INK, margin: 0 });

    s.addText([
      { text: "這一年，這兩件事讓這個帳戶付出了 ", options: { color: INK } },
      { text: "NT$26,598,877", options: { color: RED, bold: true } },
      { text: " 的機會成本。數字後面再拆給大家看。", options: { color: INK } },
    ], { x: M, y: 6.1, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 17, margin: 0 });
    s.addNotes("痛點對應命題原文「單向的數據圖表呈現」與「接收訊號到執行下單流程破碎」。2,660 萬先當鉤子，S6 再展開。＜商業性 20%＞");
  }

  // ============ S3 解法 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "我們把三件事接成一條線");
    const items = [
      { icon: ic.chart, bg: NAVY, t: "先讓帳戶開口", d: "AI 讀完他一年 10,000 筆紀錄，把追高習慣、機會成本、持倉風險攤在他眼前。" },
      { icon: ic.comments, bg: GOLD, t: "再用人話對談", d: "問「BTC 能不能加倉」，AI 同時看即時行情和你的持倉，給脈絡、不報明牌。" },
      { icon: ic.hand, bg: GREEN, t: "最後一句話下單", d: "「用 5,000 買 BTC」→ 確認卡片 → 你按下確認才成交。AI 有手，但方向盤在你手上。" },
    ];
    items.forEach((it, i) => {
      const x = M + i * 4.1;
      card(s, x, 1.9, 3.8, 3.45, ICE);
      circleIcon(s, it.icon, x + 0.35, 2.25, 0.8, it.bg);
      s.addText(it.t, { x: x + 0.35, y: 3.2, w: 3.2, h: 0.45, fontFace: FONT, fontSize: 18, bold: true, color: NAVY, margin: 0 });
      s.addText(it.d, { x: x + 0.35, y: 3.7, w: 3.15, h: 1.5, fontFace: FONT, fontSize: 12.5, color: INK, margin: 0 });
    });
    card(s, M, 5.7, W - 2 * M, 1.1, NAVY);
    s.addText([
      { text: "洞察 ", options: { bold: true, color: GOLD } },
      { text: "→ ", options: { color: WHITE } },
      { text: "對話 ", options: { bold: true, color: GOLD } },
      { text: "→ ", options: { color: WHITE } },
      { text: "行動", options: { bold: true, color: GOLD } },
      { text: "　命題的三個方向，我們不是選一個做，是接成一個閉環。", options: { color: WHITE } },
    ], { x: M + 0.4, y: 5.9, w: W - 2 * M - 0.8, h: 0.7, fontFace: FONT, fontSize: 16, align: "center", margin: 0 });
    s.addNotes("三個方向＝命題建議的「智慧AI數據分析／多維度互動介面／對話式下單生態」。串成閉環是創意度的主張之一。＜創意度 25%、主題切合度 10%＞");
  }

  // ============ S3b 為什麼是現在（生成式 AI 才可能）============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "沒有生成式 AI，這個產品不會存在");
    s.addText("以前做不到", { x: M, y: 1.55, w: 5.3, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: MUT, margin: 0 });
    s.addText("現在，在 MaiMate 裡", { x: 6.35, y: 1.55, w: 6.3, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: GREEN, margin: 0 });
    const rows = [
      { old: "個人化理財教練只屬於 VIP", why: "一份行為分析報告要分析師花數小時，散戶請不起",
        now: "LLM 把統計結果翻成每個人聽得懂的人話——一次不到一塊錢，每個散戶都請得起" },
      { old: "「一句話下單」不敢做", why: "傳統 NLU 抽參數太脆弱，金融場景錯不起",
        now: "Tool-use 結構化抽取意圖與參數，加確認卡兜底——就算聽錯，也不會成交" },
      { old: "跨源即時推理只有人腦行", why: "行情 × 個人歷史 × 市場脈絡的交叉判斷無法寫成規則",
        now: "Agent 自主決定查什麼、查幾輪，回答附時間戳與依據" },
      { old: "行為警示沒人理", why: "規則引擎只會跳「超過閾值」的通知，沒有脈絡",
        now: "「上次這個模式你少賺 31 萬」——用你自己的歷史數字說服你" },
    ];
    rows.forEach((r, i) => {
      const y = 1.98 + i * 1.08;
      card(s, M, y, 5.3, 0.96, "F4F7FD");
      s.addText([
        { text: r.old, options: { bold: true, color: INK, fontSize: 13 } },
        { text: "　" + r.why, options: { color: MUT, fontSize: 10.5 } },
      ], { x: M + 0.25, y: y + 0.08, w: 4.9, h: 0.82, fontFace: FONT, valign: "middle", margin: 0 });
      arrowRight(s, 5.95, y + 0.48);
      card(s, 6.35, y, 6.3, 0.96, ICE);
      s.addText(r.now, { x: 6.6, y: y + 0.08, w: 5.85, h: 0.82, fontFace: FONT, fontSize: 12, color: NAVY, valign: "middle", margin: 0 });
    });
    s.addText("連開發本身也是：30 小時做出這一套，靠的是 Kiro spec-driven 的 AI 開發流程。", {
      x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, margin: 0 });
    s.addNotes("回應評審提問「有了 AI 可以做以前做不到的事，如何應用在專案」。四件事各對應一個模型能力：自然語言生成（翻譯人話）、結構化 tool-use（安全下單）、Agent 多輪推理（跨源查證）、個人化脈絡（行為介入）。最後一句把 Kiro 加分項也掛進來。＜創意度 25%、AI設計 15%＞");
  }

  // ============ S4 產品總覽 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "一個畫面：健檢、對話、行情");
    card(s, M, 1.8, W - 2 * M, 4.5, "F4F7FD");
    // left panel
    card(s, M + 0.3, 2.1, 3.6, 3.9, WHITE);
    s.addText("行為健檢", { x: M + 0.55, y: 2.3, w: 3, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    card(s, M + 0.55, 2.8, 3.1, 0.85, ICE);
    s.addText([{ text: "追高指數  ", options: { fontSize: 12, color: MUT } }, { text: "65%", options: { fontSize: 22, bold: true, color: RED } }],
      { x: M + 0.75, y: 2.93, w: 2.8, h: 0.6, fontFace: FONT, margin: 0 });
    card(s, M + 0.55, 3.8, 3.1, 0.85, ICE);
    s.addText([{ text: "年度機會成本  ", options: { fontSize: 12, color: MUT } }, { text: "2,660萬", options: { fontSize: 20, bold: true, color: NAVY } }],
      { x: M + 0.75, y: 3.93, w: 2.9, h: 0.6, fontFace: FONT, margin: 0 });
    card(s, M + 0.55, 4.8, 3.1, 0.85, ICE);
    s.addText([{ text: "持倉集中警示  ", options: { fontSize: 12, color: MUT } }, { text: "98.6%", options: { fontSize: 20, bold: true, color: GOLD } }],
      { x: M + 0.75, y: 4.93, w: 2.9, h: 0.6, fontFace: FONT, margin: 0 });
    // middle chat
    card(s, M + 4.2, 2.1, 4.55, 3.9, WHITE);
    s.addText("AI 對話", { x: M + 4.45, y: 2.3, w: 3, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    card(s, M + 4.45, 2.8, 3.9, 0.75, ICE);
    s.addText("「BTC 現在適合我加倉嗎？」", { x: M + 4.65, y: 2.93, w: 3.6, h: 0.5, fontFace: FONT, fontSize: 12.5, color: INK, margin: 0 });
    card(s, M + 4.75, 3.7, 3.75, 1.2, NAVY);
    s.addText("「BTC 現價 ○○（10:32），但你目前 BTC 已佔持倉 42%，高於你過去一年的舒適區間…」", {
      x: M + 4.95, y: 3.83, w: 3.4, h: 1, fontFace: FONT, fontSize: 11.5, color: WHITE, margin: 0 });
    card(s, M + 4.45, 5.05, 4.05, 0.62, "FFF4E0");
    s.addText("下單確認卡：買入 BTC／5,000 TWD／市價　[確認] [取消]", {
      x: M + 4.6, y: 5.15, w: 3.9, h: 0.45, fontFace: FONT, fontSize: 10.5, color: INK, margin: 0 });
    // right market
    card(s, M + 9.05, 2.1, 3.05, 3.9, WHITE);
    s.addText("即時行情", { x: M + 9.3, y: 2.3, w: 2.5, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    ["BTC/TWD", "ETH/TWD", "SOL/TWD", "DOGE/TWD"].forEach((m, i) => {
      card(s, M + 9.3, 2.8 + i * 0.8, 2.55, 0.62, ICE);
      s.addText(m, { x: M + 9.45, y: 2.9 + i * 0.8, w: 2.3, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: NAVY, margin: 0 });
    });
    s.addText("桌機網頁。資料雙向流動——不只瀏覽資訊，也執行投資決策。", {
      x: M, y: 6.5, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13, color: MUT, margin: 0 });
    s.addNotes("工作坊 Leon 明講平台可為桌機網頁，且要「資料雙向流動、非唯讀儀表板」——這頁的措辭直接呼應他的原話。");
  }

  // ============ S5 數據 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "官方給的資料，我們全部用上、而且真的跑過");
    const rows = [
      [{ text: "資料源", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "用途", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "角色", options: { bold: true, color: WHITE, fill: { color: NAVY } } }],
      ["官方 CSV（10,000 筆／2025 全年）", "行為分析引擎：追高殺低、機會成本、集中度、出入金畫像", "核心差異化"],
      ["MAX Public API（REST + WebSocket）", "即時行情、K 線、深度圖", "市場即時性"],
      ["MAX Private API（Lv2 + KYC 已完成）", "餘額查詢、下單執行（僅開交易權限，不開提領）", "交易閉環"],
      ["CoinMarketCap（第三方）", "全市場脈絡補充", "延伸視角"],
    ];
    s.addTable(rows, {
      x: M, y: 1.75, w: 7.3, colW: [2.55, 3.3, 1.45],
      fontFace: FONT, fontSize: 11.5, color: INK, valign: "middle",
      border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.62, margin: 0.08,
    });
    const months = Object.keys(report.activity_profile.trades_per_month);
    const vals = Object.values(report.activity_profile.trades_per_month);
    s.addText("每月交易筆數（解析自官方資料集）", { x: 8.35, y: 1.75, w: 4.3, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: NAVY, margin: 0 });
    s.addChart(pres.ChartType.bar, [{
      name: "每月交易筆數",
      labels: months.map(m => m.slice(5)),
      values: vals,
    }], {
      x: 8.35, y: 2.2, w: 4.35, h: 3.4,
      barDir: "col", chartColors: [NAVY],
      showLegend: false, showTitle: false, showValue: false,
      catAxisLabelColor: MUT, valAxisLabelColor: MUT,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      valGridLine: { color: "E5EAF5", size: 0.5 }, catGridLine: { style: "none" },
    });
    s.addText("全年 4,674 筆買賣、5,326 筆出入金；最活躍的 5 月與 8 月各 416 筆。", {
      x: 8.35, y: 5.7, w: 4.35, h: 0.6, fontFace: FONT, fontSize: 11, color: MUT, margin: 0 });
    s.addText("每一列都有對應的程式與輸出，不是規劃中——是已經在跑的。", {
      x: M, y: 6.35, w: 7.5, h: 0.5, fontFace: FONT, fontSize: 13, color: INK, margin: 0 });
    s.addNotes("＜切合度 10%：各資料源組合成投資工具＞＜加分 +5%：Lv2 Private API，講到這頁時秀 Lv2 認證截圖＞");
  }

  // ============ S6 洞察（暗色）============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY_D };
    s.addText("這個帳戶的一年，AI 是這樣讀的", { x: M, y: 0.55, w: W - 2 * M, h: 0.75, fontFace: FONT, fontSize: 30, bold: true, color: WHITE, margin: 0 });

    const stats = [
      { n: "65%", label: "的買入發生在高點", sub: "2,350 筆買入，65% 買在近 7 筆均價之上——他習慣性追高，自己卻不知道", c: RED },
      { n: "NT$2,660萬", label: "一年的機會成本", sub: "每筆賣出若持有至年末的價差總和——衝動的價格，第一次被算出來", c: GOLD },
      { n: "34.1%", label: "殺低比例，其實不高", sub: "他不恐慌，只是愛追高。資料不支持的結論，我們不會硬給", c: GREEN },
      { n: "14.2%", label: "下跌後才出金的比例", sub: "417 筆提領大多與行情無關——出金習慣其實很健康", c: GREEN },
    ];
    stats.forEach((st, i) => {
      const x = M + (i % 2) * 6.2, y = 1.6 + Math.floor(i / 2) * 1.85;
      card(s, x, y, 5.95, 1.6, NAVY);
      s.addText(st.n, { x: x + 0.35, y: y + 0.18, w: 2.6, h: 0.75, fontFace: FONT, fontSize: 30, bold: true, color: st.c, margin: 0 });
      s.addText(st.label, { x: x + 0.35, y: y + 0.95, w: 2.7, h: 0.4, fontFace: FONT, fontSize: 12, color: "A9B7D9", margin: 0 });
      s.addText(st.sub, { x: x + 3.05, y: y + 0.25, w: 2.75, h: 1.2, fontFace: FONT, fontSize: 11.5, color: ICE, margin: 0 });
    });

    card(s, M, 5.5, W - 2 * M, 1.4, "22315E");
    s.addText([
      { text: "最痛的一筆：", options: { bold: true, color: GOLD } },
      { text: "1 月 8 日，他以 14.2 元賣掉 6,216 顆 DOGE。年末價格 64.54 元——那一個決定，少賺 ", options: { color: WHITE } },
      { text: "NT$312,924", options: { bold: true, color: RED } },
      { text: "。下次同樣的模式出現時，MaiMate 會把這個數字放到他眼前。", options: { color: WHITE } },
    ], { x: M + 0.4, y: 5.75, w: W - 2 * M - 0.8, h: 0.95, fontFace: FONT, fontSize: 15, margin: 0 });
    s.addNotes("整場簡報的記憶點。全部是真實資料算出的數字（analysis/precompute.py）。評審給的資料，我們挖出了他們自己沒想到的故事。＜創意度 25% 主戰場＞");
  }

  // ============ S7 AI ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "AI 自己決定查什麼——但下單的最後一步永遠是人");
    card(s, M, 1.85, 5.8, 4.45, ICE);
    s.addText("一次提問，AI 的思考路徑", { x: M + 0.3, y: 2.05, w: 5.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
    const steps = ["收到問題", "自己判斷需要哪些資料", "查歷史／查行情／查餘額（可多輪）", "結果回填，繼續想（最多 8 輪）", "引用具體數字回答，附時間戳"];
    steps.forEach((t, i) => {
      const y = 2.6 + i * 0.7;
      s.addShape("ellipse", { x: M + 0.35, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: NAVY } });
      s.addText(String(i + 1), { x: M + 0.35, y: y + 0.05, w: 0.42, h: 0.42, fontFace: FONT, fontSize: 13, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
      s.addText(t, { x: M + 0.95, y: y, w: 4.6, h: 0.55, fontFace: FONT, fontSize: 13.5, color: INK, valign: "middle", margin: 0 });
    });
    s.addShape("roundRect", { x: M + 6.1, y: 1.85, w: 6.05, h: 2.55, rectRadius: 0.09, fill: { color: "F4F7FD" }, line: { type: "none" } });
    s.addText("它手上的工具", { x: M + 6.4, y: 2.0, w: 5, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
    s.addText([
      { text: "查個人行為指標（health_report）", options: { bullet: true, breakLine: true } },
      { text: "查 MAX 即時行情：ticker／K線／深度", options: { bullet: true, breakLine: true } },
      { text: "查帳戶餘額（Private API）", options: { bullet: true, breakLine: true } },
      { text: "發起下單確認卡——注意，是「發起」，不是「下單」", options: { bullet: true } },
    ], { x: M + 6.4, y: 2.45, w: 5.5, h: 1.85, fontFace: FONT, fontSize: 12.5, color: INK, paraSpaceAfter: 6, margin: 0 });
    card(s, M + 6.1, 4.65, 6.05, 1.65, "FDF0EF");
    circleIcon(s, ic.shield, M + 6.4, 4.98, 0.65, RED);
    s.addText([
      { text: "真正送單的函式，AI 根本碰不到。", options: { bold: true, color: RED } },
      { text: "它只能產生確認卡；實際下單由系統在你按下確認後觸發，憑證 60 秒過期、只能用一次。加上護欄：不報明牌、不碰個資。", options: { color: INK } },
    ], { x: M + 7.3, y: 4.85, w: 4.7, h: 1.35, fontFace: FONT, fontSize: 12, margin: 0 });
    s.addNotes("＜AI設計 15%：原文「上下文理解、主動分析數據、自動化執行交易決策」全覆蓋＞確認機制呼應 MaiCoin 自家 AI Native OS 的「所有金額異動均設明確確認機制」——評審是 MaiCoin 的人，這句要講出來。");
  }

  // ============ S8 流程 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "等一下 Demo，就走這五步");
    const flow = [
      { t: "打開 Dashboard", d: "健檢首屏直接亮出：追高 65%、機會成本 2,660 萬", c: NAVY },
      { t: "「我去年表現怎麼樣？」", d: "AI 查個人歷史，用具體數字回答", c: NAVY },
      { t: "「BTC 現在適合我加倉嗎？」", d: "AI 同時查行情與持倉，給脈絡、不給明牌", c: GOLD },
      { t: "「用 5,000 買 BTC」", d: "確認卡片跳出：幣種、數量、預估價、手續費", c: GOLD },
      { t: "按下確認", d: "Private API 送單成交，餘額與健檢即時更新", c: GREEN },
    ];
    flow.forEach((f, i) => {
      const y = 1.95 + i * 0.94;
      s.addShape("ellipse", { x: M, y: y, w: 0.55, h: 0.55, fill: { color: f.c } });
      s.addText(String(i + 1), { x: M, y: y, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
      s.addText(f.t, { x: M + 0.8, y: y - 0.02, w: 3.7, h: 0.6, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
      s.addText(f.d, { x: M + 4.6, y: y - 0.02, w: 7.6, h: 0.6, fontFace: FONT, fontSize: 13, color: INK, valign: "middle", margin: 0 });
      if (i < flow.length - 1) s.addShape("line", { x: M + 0.27, y: y + 0.55, w: 0, h: 0.39, line: { color: "C4CFE6", width: 1.5 } });
    });
    s.addNotes("使用者流程＝Demo 劇本，一條龍走完。首屏是靜態預計算，就算現場網路掛了也一定亮得出來。＜完成度 10%＞");
  }

  // ============ S9 架構（完整架構圖：元件＋資料流）============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "完整架構：全 serverless，30 小時裡我們只寫產品");

    const box = (x, y, w, h, fill, txt, opts = {}) => {
      s.addShape("roundRect", { x, y, w, h, rectRadius: 0.07, fill: { color: fill }, line: opts.line || { color: "D5DEF0", width: 0.75 } });
      s.addText(txt, { x: x + 0.08, y, w: w - 0.16, h, fontFace: FONT, fontSize: opts.fs || 11, bold: !!opts.bold, color: opts.color || INK, align: "center", valign: "middle", margin: 0 });
    };
    const arrow = (x, y, w, h, color) => {
      s.addShape("line", { x, y, w, h, line: { color: color || "8FA0C9", width: 1.75, endArrowType: "arrow" } });
    };
    const groupLabel = (x, y, txt) => s.addText(txt, { x, y, w: 2.3, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: MUT, margin: 0 });

    // 使用者
    box(M, 3.45, 1.25, 0.85, NAVY, "使用者", { color: WHITE, bold: true, fs: 13, line: { type: "none" } });
    arrow(M + 1.25, 3.87, 0.42, 0, NAVY);

    // 前端群組
    s.addShape("roundRect", { x: 2.27, y: 2.65, w: 2.45, h: 2.45, rectRadius: 0.09, fill: { color: "F4F7FD" }, line: { color: "C4CFE6", width: 1, dashType: "dash" } });
    groupLabel(2.42, 2.72, "前端（靜態託管）");
    box(2.47, 3.1, 2.05, 0.7, WHITE, "CloudFront CDN");
    box(2.47, 3.95, 2.05, 0.7, WHITE, "S3｜React SPA");
    arrow(4.72, 3.87, 0.38, 0, NAVY);

    // API Gateway
    box(5.1, 3.45, 1.72, 0.85, NAVY, "API Gateway", { color: WHITE, bold: true, fs: 12, line: { type: "none" } });
    arrow(6.82, 3.87, 0.38, 0, NAVY);

    // Lambda 群組
    s.addShape("roundRect", { x: 7.2, y: 1.55, w: 2.45, h: 4.8, rectRadius: 0.09, fill: { color: "F4F7FD" }, line: { color: "C4CFE6", width: 1, dashType: "dash" } });
    groupLabel(7.35, 1.62, "Lambda（Python）");
    box(7.4, 2.0, 2.05, 0.75, WHITE, "/chat｜Agent 迴圈", { bold: true });
    box(7.4, 2.95, 2.05, 0.75, WHITE, "/health｜健檢查詢");
    box(7.4, 3.9, 2.05, 0.75, WHITE, "/market｜行情代理");
    box(7.4, 4.85, 2.05, 0.75, WHITE, "/order｜下單執行", { bold: true });

    // 右側資源
    box(10.05, 1.7, 2.65, 1.05, "FFF4E0", "Bedrock Converse + Tool Use\nGuardrails（AWS 基礎模型）", { fs: 10.5, bold: true });
    box(10.05, 3.0, 2.65, 0.7, ICE, "DynamoDB｜session＋下單憑證", { fs: 10.5 });
    box(10.05, 3.9, 2.65, 0.7, ICE, "S3｜CSV + health_report.json", { fs: 10.5 });
    box(10.05, 4.8, 2.65, 0.7, ICE, "MAX API｜Public / Private", { fs: 10.5 });
    box(10.05, 5.7, 2.65, 0.6, ICE, "CoinMarketCap（第三方）", { fs: 10.5 });

    // Lambda → 資源連線
    arrow(9.65, 2.35, 0.4, -0.12);          // chat → Bedrock
    arrow(9.65, 3.32, 0.4, 0);              // → DynamoDB
    arrow(9.65, 4.25, 0.4, 0);              // → S3 data
    arrow(9.65, 5.18, 0.4, -0.02);          // → MAX API
    arrow(9.65, 5.95, 0.4, 0.03);           // → CMC

    // 下單流（底部）
    card(s, M, 6.55, W - 2 * M, 0.62, "FDF0EF");
    s.addText([
      { text: "下單流：", options: { bold: true, color: RED } },
      { text: "① /chat 產生確認卡＋60 秒憑證（存 DynamoDB）→ ② 使用者按確認 → ③ /order 驗證並銷毀憑證 → ④ MAX Private API 成交。LLM 碰不到 ③④。", options: { color: INK } },
    ], { x: M + 0.25, y: 6.63, w: W - 2 * M - 0.5, h: 0.45, fontFace: FONT, fontSize: 11.5, valign: "middle", margin: 0 });

    s.addNotes("官方要求的 AWS 架構圖。講三點：全 serverless 的理由（30 小時不管伺服器）、行為分析離線預計算（Demo 首屏零外部依賴）、下單流的安全設計（紅色那條）。repo 的 infra/template.yaml 就是這張圖的 SAM 實作，一鍵部署。＜可行性 20%＞");
  }

  // ============ S9b 模型選擇與成本效益 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "模型怎麼選、錢花在哪");
    // 左：模型分工
    const rows = [
      [{ text: "工作", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "模型（皆為 Bedrock）", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "為什麼", options: { bold: true, color: WHITE, fill: { color: NAVY } } }],
      ["日常對話＋工具調度", "Claude Haiku", "迴圈一次要跑 3–6 趟模型，快與便宜是體驗的一部分；≈ NT$0.3／次"],
      ["深度歸因＋複雜分析", "Claude Sonnet", "推理較強，只在需要時升級；≈ NT$2.2／次"],
      ["安全護欄", "Bedrock Guardrails", "模型層攔明牌與個資，程式層再攔一次"],
    ];
    s.addTable(rows, {
      x: M, y: 1.8, w: 7.15, colW: [1.95, 1.9, 3.3],
      fontFace: FONT, fontSize: 11.5, color: INK, valign: "middle",
      border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.8, margin: 0.08,
    });
    s.addText([
      { text: "再省一手：", options: { bold: true, color: NAVY } },
      { text: "系統提示與工具定義用 prompt caching，重複讀取一折計價——迴圈越多趟省越多。單價以 Bedrock 主控台現價估算。", options: { color: MUT } },
    ], { x: M, y: 5.35, w: 7.15, h: 0.75, fontFace: FONT, fontSize: 11.5, margin: 0 });
    s.addText("基礎設施：Demo 期間近乎 0 元（free tier）；千人規模每月估 < NT$3,000（全 serverless，用多少付多少）。", {
      x: M, y: 6.15, w: 7.15, h: 0.7, fontFace: FONT, fontSize: 11.5, color: MUT, margin: 0 });
    // 右：價值對比
    card(s, 8.05, 1.8, 4.65, 4.95, NAVY_D);
    s.addText("成本效益，一句話", { x: 8.4, y: 2.05, w: 4, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: GOLD, margin: 0 });
    s.addText("NT$0.6", { x: 8.4, y: 2.55, w: 4, h: 0.7, fontFace: FONT, fontSize: 40, bold: true, color: WHITE, margin: 0 });
    s.addText("混合平均每次對話成本（85% 日常＋15% 深度）", { x: 8.4, y: 3.3, w: 3.95, h: 0.4, fontFace: FONT, fontSize: 11, color: "A9B7D9", margin: 0 });
    s.addText("NT$11,480", { x: 8.4, y: 3.85, w: 4, h: 0.7, fontFace: FONT, fontSize: 40, bold: true, color: RED, margin: 0 });
    s.addText("這個帳戶平均每筆賣出的機會成本（2,660 萬 ÷ 2,317 筆）", { x: 8.4, y: 4.6, w: 3.95, h: 0.4, fontFace: FONT, fontSize: 11, color: "A9B7D9", margin: 0 });
    card(s, 8.35, 5.25, 4.05, 1.15, "22315E");
    s.addText("一年只要攔下「一筆」衝動交易，就抵掉這位用戶 16 年的 AI 成本。", {
      x: 8.55, y: 5.4, w: 3.7, h: 0.9, fontFace: FONT, fontSize: 13.5, bold: true, color: WHITE, margin: 0 });
    s.addNotes("回應評審提問「為何使用這些模型＋成本效益分析」。三個論點：①模型分工按工作特性（迴圈要快用 Haiku、深度才用 Sonnet）②prompt caching 讓多輪迴圈的成本可控 ③價值錨點：月重度使用 ≈ NT$60，攔一筆衝動交易 = 16 年成本。被追問時補：不自架模型是因為競賽限 AWS 基礎模型＋30 小時內 Bedrock 免運維是唯一合理解。＜可行性 20%＞");
  }

  // ============ S10 限制 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "成本與限制，先講清楚");
    const rows = [
      [{ text: "項目", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "限制／成本", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
       { text: "我們的做法", options: { bold: true, color: WHITE, fill: { color: NAVY } } }],
      ["Bedrock 模型費用", "依 token 計價；一輪對話含工具呼叫約 3–6 次模型往返", "常規問答走輕量模型，深度分析才升級；單次回覆上限 1,500 tokens"],
      ["MAX API 用量", "Public API 有每分鐘請求上限", "行情快取 5 秒＋失敗指數退避重試"],
      ["Private API 權限", "需 Lv2 KYC；API Key 權限可細分", "只開「交易」、不開「提領」；金鑰放 Secrets Manager，不進版控"],
      ["真實下單風險", "Demo 是正式環境，會真的成交", "確認卡強制攔截＋憑證 60 秒過期＋最小額度測試"],
      ["現場網路風險", "外部 API 可能臨時失效", "離線 mock 自動接手＋預錄影片備援"],
    ];
    s.addTable(rows, {
      x: M, y: 1.8, w: W - 2 * M, colW: [2.4, 4.4, 5.33],
      fontFace: FONT, fontSize: 12, color: INK, valign: "middle",
      border: { type: "solid", color: "D5DEF0", pt: 0.75 }, rowH: 0.72, margin: 0.08,
    });
    s.addNotes("＜可行性 20%：評分原文要求「說明各使用項目的限制，如費用、權限、用量」——這頁照著做，主動揭露反而加分＞");
  }

  // ============ S11 Kiro ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "規格先行：.kiro 目錄就是我們的開發紀律");
    const cols = [
      { icon: ic.tools, bg: NAVY, t: "Steering", body: "把紅線寫死在最上游：不報明牌、下單必確認、CSV 欄位定義、架構約定——AI 生成的每一行程式都在這個框裡。" },
      { icon: ic.check, bg: GOLD, t: "Specs", body: "每個功能先寫規格再寫程式。行為引擎的驗收條件，已經全部用真實資料打勾。" },
      { icon: ic.db, bg: GREEN, t: "MCP", body: "MAX 的 MCP server 直接接進 Kiro——開發時 AI 自己查行情、下測試單，不用手動兜 API。" },
    ];
    cols.forEach((c, i) => {
      const x = M + i * 4.1;
      card(s, x, 1.9, 3.8, 3.7, ICE);
      circleIcon(s, c.icon, x + 0.35, 2.25, 0.75, c.bg);
      s.addText(c.t, { x: x + 0.35, y: 3.15, w: 3.2, h: 0.5, fontFace: FONT, fontSize: 16.5, bold: true, color: NAVY, margin: 0 });
      s.addText(c.body, { x: x + 0.35, y: 3.7, w: 3.15, h: 1.8, fontFace: FONT, fontSize: 12.5, color: INK, margin: 0 });
    });
    s.addText("GitHub repo 裡的 .kiro/ 目錄與開發過程截圖，都是佐證。", {
      x: M, y: 6.0, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13, color: MUT, margin: 0 });
    s.addNotes("＜加分 +5%：採用 Kiro＞不要只說「我們有用」，講 spec-driven 在 30 小時內帶來的速度差。");
  }

  // ============ S12 商業 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "這是只有交易所做得出來的產品");
    const cols = [
      { t: "給誰用", body: "MAX 活躍用戶裡的中階散戶：有交易量、繳過學費、還沒有自己的紀律系統——行為洞察對他們價值最大。" },
      { t: "為什麼是 MAX", body: "行為數據只有交易所自己有，外部工具永遠拿不到。確認卡機制也延續了 MaiCoin「所有金額異動須明確授權」的產品哲學——這個產品長在 MAX 身上最自然。" },
      { t: "怎麼長大", body: "先當 MAX App 的免費健檢功能養黏著；再推訂閱制進階分析；最後把行為 API 開放給量化用戶。" },
    ];
    cols.forEach((c, i) => {
      const x = M + i * 4.1;
      card(s, x, 1.9, 3.8, 4.0, i === 1 ? NAVY : ICE);
      s.addText(c.t, { x: x + 0.35, y: 2.2, w: 3.1, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: i === 1 ? GOLD : NAVY, margin: 0 });
      s.addText(c.body, { x: x + 0.35, y: 2.8, w: 3.15, h: 2.9, fontFace: FONT, fontSize: 12.5, color: i === 1 ? ICE : INK, margin: 0 });
    });
    s.addText("投資人不缺數據——缺的是「關於自己的數據」。", {
      x: M, y: 6.25, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    s.addNotes("＜商業性 20%＞中間那張卡是給 MaiCoin 評審聽的：這產品跟你們既有哲學一致、而且只有你們做得出來。");
  }

  // ============ S13 交付物 ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    bigTitle(s, "交付物");
    const items = [
      { icon: ic.bolt, bg: GOLD, t: "Live Demo 網址", d: "https://<CloudFront URL>（決賽部署後填入）" },
      { icon: ic.video, bg: NAVY, t: "完整流程錄影", d: "一條龍 Demo 影片（同時是現場備援）" },
      { icon: ic.github, bg: INK, t: "GitHub Repo", d: "原始碼＋.kiro/ 規格＋執行說明" },
      { icon: ic.key, bg: GREEN, t: "MAX Lv2 帳號", d: "KYC 已完成，Private API 已啟用" },
    ];
    items.forEach((it, i) => {
      const x = M + (i % 2) * 6.2, y = 1.95 + Math.floor(i / 2) * 1.9;
      card(s, x, y, 5.95, 1.6, ICE);
      circleIcon(s, it.icon, x + 0.35, y + 0.42, 0.75, it.bg);
      s.addText(it.t, { x: x + 1.35, y: y + 0.3, w: 4.4, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: NAVY, margin: 0 });
      s.addText(it.d, { x: x + 1.35, y: y + 0.85, w: 4.4, h: 0.55, fontFace: FONT, fontSize: 12.5, color: MUT, margin: 0 });
    });
    s.addNotes("官方要求五項全在前面講完：解題方向 S3、AI 技術 S7、數據應用 S5、使用者流程 S8、AWS 架構 S9。");
  }

  // ============ S14 收尾 ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY_D };
    s.addShape("ellipse", { x: 10.6, y: 4.6, w: 4.6, h: 4.6, fill: { color: NAVY } });
    s.addText("市場數據，人人都有。", { x: M, y: 2.3, w: W - 2 * M, h: 0.8, fontFace: FONT, fontSize: 36, bold: true, color: ICE, margin: 0 });
    s.addText([
      { text: "懂你的", options: { color: GOLD } },
      { text: "，只有這一個。", options: { color: WHITE } },
    ], { x: M, y: 3.15, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 36, bold: true, margin: 0 });
    s.addText("MaiMate｜隊伍：第五名", { x: M, y: 6.5, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13, color: "8FA0C9", margin: 0 });
    s.addNotes("收尾一句話講完就下台，不要拖。Q&A 常見問題準備：模型費用細節（S10）、為何不做 App（桌機網頁是命題允許形式）、下單安全（S7）。");
  }

  const out = path.join(__dirname, "MaiMate_提案簡報.pptx");
  await pres.writeFile({ fileName: out });
  console.log("written:", out);
})();
