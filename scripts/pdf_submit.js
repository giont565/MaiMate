#!/usr/bin/env node
/**
 * pdf_submit.js — 產出決賽要繳交的 PDF
 *
 *   node scripts/pdf_submit.js
 *   → docs/繳交/F_Maincoin：智慧理財_第五名.pdf
 *
 * 主辦要求：10 MB 以下、檔名固定。
 *
 * 兩個跟一般列印不一樣的地方：
 *  1. 設 window.__PRINT__，讓簡報跳過「img 換成 video」那段。
 *     PDF 播不了影片，換過去只會印出一格空白——那幾頁右側就沒東西了。
 *  2. 超過 10 MB 會自己降圖片解析度重印，並印出實際降到多少。
 *     靜靜地交一份糊掉的 PDF，比交不出來更糟。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'PITCH_DECK.html');
const OUT_DIR = path.join(ROOT, 'docs', '繳交');
const OUT = path.join(OUT_DIR, 'F_Maincoin：智慧理財_第五名.pdf');
const WORK = path.join(ROOT, '.pdf_tmp');

const LIMIT = 10 * 1024 * 1024;
/* 每一級：圖片最長邊 px ＋ JPEG 品質。
 * PNG 是無損的，Chromium 會原封不動嵌進 PDF——轉成 JPEG 位元組省下來的比縮圖多得多。
 * 檔名維持 .png：瀏覽器看內容判斷格式，不看副檔名。 */
const STEPS = [
  { px: null, q: null },      // 原樣
  { px: 1600, q: 82 },
  { px: 1400, q: 72 },
  { px: 1100, q: 62 },
  { px: 950,  q: 55 },
  { px: 800,  q: 48 },
];
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';

function hasAlpha(p) {
  try { return /hasAlpha:\s*yes/.test(execFileSync('sips', ['-g', 'hasAlpha', p], { encoding: 'utf8' })); }
  catch (_) { return true; }
}

/** 把 docs/ 複製一份到工作目錄，圖片縮到 maxPx、轉成 JPEG 品質 q（null 則原樣） */
function stageAssets(maxPx, quality) {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs'), WORK, {
    recursive: true,
    filter: s => !/PITCH_DECK\.(standalone|artifact)\.html$|\.pdf$|node_modules/.test(s),
  });
  if (!maxPx && !quality) return;
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(png|jpe?g)$/i.test(e.name)) continue;
      try {
        if (maxPx) execFileSync('sips', ['-Z', String(maxPx), p], { stdio: 'ignore' });
        // 有透明度的（麥麥公仔）不能轉，轉了去背會變白底方塊
        if (quality && !hasAlpha(p)) {
          execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), p,
                                '--out', p], { stdio: 'ignore' });
        }
      } catch (_) { /* 處理不了就用原圖，總比中止好 */ }
    }
  };
  walk(WORK);
}

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  let size = Infinity, used = null;

  for (const step of STEPS) {
    stageAssets(step.px, step.q);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(() => { window.__PRINT__ = true; });
    await page.goto('file://' + path.join(WORK, 'PITCH_DECK.html'), { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(1000);
    await page.pdf({
      path: OUT, width: '1920px', height: '1080px', printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await page.close();

    size = fs.statSync(OUT).size;
    used = step;
    const label = step.px ? `最長邊 ${step.px}px／JPEG ${step.q}` : '原圖';
    console.log(`   ${label} → ${mb(size)}`);
    if (size <= LIMIT) break;
  }

  await browser.close();
  fs.rmSync(WORK, { recursive: true, force: true });

  console.log(`\n→ ${path.relative(process.cwd(), OUT)}  ${mb(size)}`);
  if (size > LIMIT) {
    console.log(`   ⚠ 仍超過 10 MB ${mb(size - LIMIT)}——要再減頁或再降解析度`);
    process.exitCode = 1;
  } else if (used && used.px) {
    console.log(`   ℹ 圖片縮到最長邊 ${used.px}px、JPEG 品質 ${used.q} 才符合 10 MB。`);
    console.log(`     這份是繳交用的；上台請用 PITCH_DECK.standalone.html（完整、會播影片）`);
  }
})();
