/**
 * 鏡 8 收尾（1:26–1:32）：切回健檢首屏，定格 logo＋slogan。
 *
 *   DEMO_BASE=<前端網址> node scripts/record_outro.js <輸出目錄>
 *
 * 六秒定格，沒有互動——首屏是靜態預計算（health_report.json），斷網也必亮，
 * 所以這一鏡永遠錄得到，不受場地網路影響。
 *
 * 口白：「MaiMate——AI 有手，方向盤在你手上。」
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.DEMO_BASE || "https://d1z0776b4u2tmf.cloudfront.net";
const OUTDIR = process.argv[2] || ".";
const HOLD_MS = Number(process.env.HOLD_MS || 7000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 0)); // 頂欄麥麥要完整入鏡
  await sleep(1200);

  // 頂欄麥麥要在 IDLE（成交後會切 BULLISH 六秒，那是鏡 6 的表情，不是收尾的）
  const mood = await page.evaluate(() => document.querySelector(".mai")?.className || "");
  console.log(`  頂欄狀態：${mood || "（找不到 .mai，用畫面自行確認）"}`);

  await sleep(HOLD_MS);

  await ctx.close();
  await browser.close();
  const vid = fs.readdirSync(OUTDIR).filter((f) => f.endsWith(".webm")).pop();
  console.log("✔ 影片：", `${OUTDIR}/${vid}`);
})();
