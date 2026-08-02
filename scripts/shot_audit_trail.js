/**
 * 鏡 7 素材：把 07-31 真實成交那次的稽核軌跡，用產品自己的面板渲染出來截圖。
 *
 *   node scripts/shot_audit_trail.js <輸出檔.png>
 *
 * 資料完全真實（GET /audit，含 executed #20720919534、#20721028463），只是換 session 回放——
 * 面板平常只在**成交成功後**才自動展開（app.js showTrail()），不下真單就拍不到。
 *
 * ⚠ 環境限定：那個 session 在隊長帳號（us-east-1）的 DynamoDB，
 *   官方環境的表沒有這筆，指過去只會拿到空陣列。
 * ⚠ 面板標題寫「本次對話」，所以要在**乾淨頁面**單獨拍，旁白也要講明是那次成交的軌跡。
 */
const { chromium } = require("playwright");

const BASE = process.env.TRAIL_BASE || "https://d1ttogc25b56n5.cloudfront.net";
const SESSION = process.env.TRAIL_SESSION || "d3e6e6f9-da55-475e-90de-5495b270ae1e";
const OUT = process.argv[2] || "鏡7_稽核軌跡.png";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, // 截圖吃得到 3x，投影不糊（錄影吃不到，那條路要靠 ffmpeg 放大）
  });
  await page.goto(BASE, { waitUntil: "networkidle" });

  const count = await page.evaluate(async (sid) => {
    const r = await fetch(`${API}/audit?session_id=${sid}`).then((x) => x.json());
    renderTrail(r.trail);
    return (r.trail || []).length;
  }, SESSION);
  if (!count) throw new Error("軌跡是空的——十之八九是連到了官方環境，改用舊環境網址");

  const panel = page.locator(".trail");
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  await panel.screenshot({ path: OUT });                              // 只有面板
  await page.screenshot({ path: OUT.replace(/\.png$/, "_全屏.png") }); // 含頂欄麥麥
  console.log(`✔ ${count} 列軌跡已截圖：${OUT}`);
  await browser.close();
})();
