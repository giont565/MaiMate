/**
 * 鏡 6＋7 素材：真實下單的一鏡到底（確認卡 → 人按下 → 成交 → 稽核軌跡自動展開）。
 *
 *   node scripts/record_live_order.js <輸出目錄>
 *   LINE="幫我買 500 元的 USDT" PICK=2 node scripts/record_live_order.js 素材
 *
 * 與 record_demo.js 的差別：**有頭**瀏覽器。腳本把流程帶到確認卡就停手，
 * 由人在那個視窗按下「確認」——腳本永遠不碰那顆按鈕（見下方 assert）。
 *
 * ⚠ 確認卡 60 秒過期。腳本印出提示後要立刻按，過期會拿到 410，那一單得重來。
 * ⚠ 成交後 app.js 會 showTrail()，稽核軌跡是「本次對話」的真跡——鏡 7 不必再單獨補拍。
 * ⚠ MAX App 的成交推播在手機上，這支錄不到；推播要另外用手機螢幕錄影拍。
 *
 * 輸出 webm；轉 mp4 同 record_demo.js：
 *   ffmpeg -i out.webm -vf "scale=780:1688:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.DEMO_BASE || "https://d1z0776b4u2tmf.cloudfront.net";
const OUTDIR = process.argv[2] || ".";
const LINE = process.env.DEMO_LINE || "幫我買 500 元的 USDT";
const PICK = Number(process.env.PICK || 2); // 1=試水溫 2=全額買入 3=先不動
const WAIT_HUMAN_MS = Number(process.env.WAIT_HUMAN_MS || 300000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function creep(page, total, steps, ms) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, total / steps);
    await sleep(ms);
  }
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const mark = (s) => console.log(`  ${String((Date.now() - t0) / 1000).padStart(6)}s  ${s}`);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);

  const sid = await page.evaluate(() => sessionStorage.maimate_sid);
  console.log(`  session_id = ${sid}`);

  mark("輸入意圖");
  const input = page.locator("#q");
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.type(LINE, { delay: 110 });
  await sleep(600);
  await page.locator("button[type=submit]").click();

  mark("等三方案（實測 5–20 秒）");
  await page.locator(".scen").first().waitFor({ timeout: 120000 })
    .catch(() => { throw new Error("三方案卡沒出現——場地網路掉包，重跑一次"); });
  const labels = await page.locator(".scen").allInnerTexts();
  labels.forEach((t, i) => console.log(`    方案${i + 1}：${t.split("\n")[0]}`));
  await sleep(2500);
  await creep(page, 360, 18, 150);
  await sleep(2000);

  mark(`點方案 ${PICK}`);
  const card = page.locator(".scen").nth(PICK - 1);
  await card.scrollIntoViewIfNeeded();
  await card.click();

  await page.locator(".confirm").waitFor({ timeout: 120000 });
  mark("確認卡出現");

  // ── 交棒點 ────────────────────────────────────────────────────────────
  // 這支腳本不得具備按下確認的能力。改壞了要當場炸掉，而不是安靜地花掉使用者的錢。
  const src = fs.readFileSync(__filename, "utf8");
  if (/\.confirm\s+\.ok["'`]\s*\)\s*\.?\s*click|ok\.click\(/.test(src)) {
    throw new Error("record_live_order.js 不得點擊確認鈕——那一按必須是人做的");
  }
  console.log("\n  ╔══════════════════════════════════════════════╗");
  console.log("  ║  👉 現在在瀏覽器視窗按「確認」——60 秒內      ║");
  console.log("  ╚══════════════════════════════════════════════╝\n");

  const done = page.locator(".done");
  await done.waitFor({ timeout: WAIT_HUMAN_MS })
    .catch(() => { throw new Error("等不到成交訊息——可能是確認卡過期（410）或沒按下去"); });
  mark("已成交");
  console.log(`  ${await done.innerText()}`);

  await sleep(1500);
  const trail = page.locator(".trail");
  await trail.waitFor({ timeout: 30000 }).catch(() => console.log("  ⚠ 稽核軌跡沒展開，等下用 shot_audit_trail.js 補"));
  await trail.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(1200);
  await creep(page, 300, 15, 160); // 慢慢帶過整條軌跡
  await sleep(4000);

  mark("收工");
  await ctx.close();
  await browser.close();

  const vid = fs.readdirSync(OUTDIR).filter((f) => f.endsWith(".webm")).pop();
  console.log("✔ 影片：", `${OUTDIR}/${vid}`);
  console.log("✔ 鏡 7 可直接用這支的尾段；要單獨高解析截圖：");
  console.log(`    TRAIL_BASE=${BASE} TRAIL_SESSION=${sid} node scripts/shot_audit_trail.js 鏡7_本次成交.png`);
})();
