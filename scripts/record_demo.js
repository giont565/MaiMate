/**
 * #8 主片鏡 1–5 自動錄影（390×844）。跑線上站，全程真實 API、真實數字。
 *
 *   DEMO_BASE=<前端網址> node scripts/record_demo.js <輸出目錄>
 *
 * 刻意**不按**「確認賣出」——那張卡是真錢真單。腳本停在確認卡、把游標停在按鈕上收尾。
 * 三方案金額隨 ETH 即時報價浮動，每次錄出來的數字都會不一樣，這是正常的。
 *
 * 輸出 webm；要 mp4 用：
 *   ffmpeg -i out.webm -vf "scale=780:1688:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4
 *
 * ⚠ recordVideo.size 必須等於 viewport，寫成 2 倍不會放大畫面，只會在右下補灰邊（實測踩過）。
 * 要高解析度就照上面那行用 ffmpeg 放大。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.DEMO_BASE || "https://d1z0776b4u2tmf.cloudfront.net";
const OUTDIR = process.argv[2] || ".";
const LINE = process.env.DEMO_LINE || "ETH 跌太多了，幫我全部賣掉！";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 慢速捲動：拆成多次小步，看起來像手指滑，不是瞬移 */
async function creep(page, total, steps, ms) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, total / steps);
    await sleep(ms);
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  // 這些時間點就是旁白對軌用的依據，跑完貼給 narrate_demo.sh 對時
  const mark = (s) => console.log(`  ${String((Date.now() - t0) / 1000).padStart(6)}s  ${s}`);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);

  mark("鏡1 健檢首屏");
  await sleep(2500);
  await creep(page, 380, 19, 130);
  await sleep(1800);
  await creep(page, 420, 21, 130);
  await sleep(1800);

  mark("鏡2 輸入");
  const input = page.locator("#q");
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.type(LINE, { delay: 110 });
  await sleep(600);
  await page.locator("button[type=submit]").click();

  // 工具 chips 逐一亮起就是鏡 2 的畫面；API 實測 5–20 秒
  mark("鏡2 等待工具鏈");
  await page.locator(".scen").first().waitFor({ timeout: 120000 })
    .catch(() => { throw new Error("三方案卡沒出現——場地網路掉包，重跑一次"); });
  mark("鏡3 方案卡已出現");

  await sleep(3000);
  await creep(page, 300, 15, 160);
  await sleep(2500);

  mark("鏡4 三方案卡");
  await creep(page, 420, 21, 150);
  await sleep(2200);
  await creep(page, 380, 19, 150);
  await sleep(3000); // 停在卡片底部小字（1/8 賣 DOGE 少賺 NT$312,924）

  mark("鏡5 點金框卡");
  const partial = page.locator(".scen").first(); // .pick 金框永遠是第一張（保守方案）
  await partial.scrollIntoViewIfNeeded();
  await partial.click();
  await page.locator(".confirm").waitFor({ timeout: 120000 });
  mark("鏡5 確認卡出現");
  await sleep(2500);
  const btn = page.locator(".confirm .ok");
  await btn.scrollIntoViewIfNeeded();
  await btn.hover(); // 只 hover，絕不 click
  await sleep(4000);

  mark("收工");
  await ctx.close(); // 關 context 才會寫出影片檔
  await browser.close();

  const vid = fs.readdirSync(OUTDIR).filter((f) => f.endsWith(".webm")).pop();
  console.log("✔ 影片：", `${OUTDIR}/${vid}`);
})();
