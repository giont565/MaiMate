/**
 * 提案簡報 HTML → PDF（決賽表單 Q8 用）。
 *
 *   node scripts/build_deck_pdf.js [輸出.pdf]
 *
 * 這台機器沒有 Keynote／PowerPoint／LibreOffice，pptx 開不了也匯不出 PDF；
 * 但 `docs/MaiMate_提案簡報.html` 與 pptx 同源（都由 build_deck.js 產），
 * 且每張 .slide 本來就寫了 page-break-after，直接用 Chromium 列印最乾淨。
 *
 * 16:9、1280×720pt，背景要印出來（深色底簡報，printBackground 關掉會整片白）。
 */
const path = require("path");
const { chromium } = require("playwright");

const SRC = path.resolve(__dirname, "../docs/MaiMate_提案簡報.html");
const OUT = path.resolve(process.argv[2] || "../docs/MaiMate_提案簡報.pdf");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto("file://" + SRC, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: OUT,
    width: "1280px",
    height: "720px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  console.log("✔", OUT);
})();
