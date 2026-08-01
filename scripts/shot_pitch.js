/* 抓線上站的簡報用截圖（390×844 @2x）→ docs/pitch_shots/
 *
 * 用法：node scripts/shot_pitch.js [--base https://d1ttogc25b56n5.cloudfront.net]
 *
 * 產出：
 *   01_health.png     健檢首屏（健康分＋四卡＋洞察）
 *   02_chips.png      工具鏈 chips（送出後 2.5 秒抓，抓得到就有）
 *   03_context.png    AI 反問＋機會成本脈絡
 *   04_scenarios.png  三方案卡
 *   05_confirm.png    下單確認卡（60 秒憑證）※ 只截圖，絕不按確認
 *   06_trail.png      決策軌跡（07-31 真實成交那次的 session）
 *
 * ⚠️ 本腳本會產生一張「訂單草稿」（prepare_order），不會送出任何真單。
 */
const path = require("path");
const fs = require("fs");

const argBase = process.argv.indexOf("--base");
const BASE = argBase > -1 ? process.argv[argBase + 1] : "https://d1ttogc25b56n5.cloudfront.net";
const TRAIL_SESSION = "d3e6e6f9-da55-475e-90de-5495b270ae1e"; // 07-31 兩筆真實成交的 session
const OUT = path.join(__dirname, "..", "docs", "pitch_shots");

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { ({ chromium } = require("playwright-core")); }
  const launchOpts = {};
  try { await chromium.launch().then(b => b.close()); }
  catch { launchOpts.executablePath = "/opt/pw-browsers/chromium"; }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name) });
    console.log("shot:", name);
  };

  // ── 01 健檢首屏 ──────────────────────────────────────────────
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const offline = await page.locator("text=離線展示").count();
  if (offline) console.warn("⚠️  頂欄亮『離線展示』＝沒連上後端，截圖不能用！");
  await shot("01_health.png");

  // ── 02–04 Golden Path ───────────────────────────────────────
  await page.fill("#q", "ETH 跌太多了，幫我全部賣掉！");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  await shot("02_chips.png");                    // 工具 chips 亮起的瞬間

  await page.waitForTimeout(9000);               // 等 LLM 回覆＋三方案渲染
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await shot("04_scenarios.png");

  await page.evaluate(() => window.scrollBy(0, -700));  // 往回捲到反問段
  await page.waitForTimeout(400);
  await shot("03_context.png");

  // ── 05 確認卡（只截圖，不按）─────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const cards = page.locator(".scen");
  if (await cards.count()) {
    await cards.first().click();
    await page.waitForTimeout(9000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await shot("05_confirm.png");
  } else {
    console.warn("⚠️  找不到方案卡，05_confirm.png 略過（選擇器可能已改）");
  }
  // 🚫 這裡絕對不要 click('確認賣出')——那是真錢、不可逆

  // ── 06 決策軌跡（07-31 真實成交）─────────────────────────────
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(async (sid) => {
    const api = window.API || window.API_BASE;
    const r = await fetch(api + "/audit?session_id=" + sid).then(r => r.json());
    if (typeof window.renderTrail === "function") window.renderTrail(r.trail);
  }, TRAIL_SESSION);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot("06_trail.png");

  await browser.close();
  console.log("\n完成 → docs/pitch_shots/  （請肉眼確認每張都沒有『離線展示』字樣）");
})();
