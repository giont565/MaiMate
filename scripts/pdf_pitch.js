/* 把 docs/PITCH_DECK.html 印成 docs/PITCH_DECK.pdf（1280×720 橫式，11 頁）
 * 用法：node scripts/pdf_pitch.js
 */
const path = require("path");

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { ({ chromium } = require("playwright-core")); }
  const launchOpts = {};
  try { await chromium.launch().then(b => b.close()); }
  catch { launchOpts.executablePath = "/opt/pw-browsers/chromium"; }

  const src = path.join(__dirname, "..", "docs", "PITCH_DECK.html");
  const out = path.join(__dirname, "..", "docs", "PITCH_DECK.pdf");

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto("file://" + src, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(800);
  await page.pdf({
    path: out,
    width: "1280px",
    height: "720px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  console.log("→", out);
})();
