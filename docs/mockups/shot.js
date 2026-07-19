/* 把三個 mockup 畫面截成 PNG（390×844 @2x） */
const path = require("path");
(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { ({ chromium } = require("playwright-core")); }
  const launchOpts = {};
  try { await chromium.launch().then(b => b.close()); }
  catch { launchOpts.executablePath = "/opt/pw-browsers/chromium"; }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const name of ["screen1", "screen2", "screen3"]) {
    await page.goto("file://" + path.join(__dirname, name + ".html"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(__dirname, name + ".png") });
    console.log("shot:", name + ".png");
  }
  await browser.close();
})();
