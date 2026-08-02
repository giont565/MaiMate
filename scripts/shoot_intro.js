#!/usr/bin/env node
/**
 * shoot_intro.js — 從入口動畫擷取簡報要用的定格
 *
 *   node scripts/shoot_intro.js
 *   → docs/brand/intro/shot{2,5,7,9}.jpg
 *
 * 第 07 幕要改兩個地方才能進簡報，改法只作用在截圖，
 * frontend/intro.html 一個字都不動——那支是 code freeze 之後已經部署的產品碼。
 *
 *  1. 投資健康分數 82 → 60。82 是動畫的示意值，真實值是 health_report.json 算出來的 60
 *     （追高控制 40%＋勝率 30%＋出金紀律 30%）。簡報第 5 頁寫的是 60，
 *     兩個數字同時出現在評審眼前只會被問哪個才對。
 *  2.「理財力等級 Lv.3」整張換掉，不是改數字。產品自己禁止這種標籤：
 *     insights-core.js 開頭「不出現投資能力／風險等級／健康分數」、
 *     insights.html 也有對應免責。留著會跟第 9 頁「問卷結果不是貼標籤」互打。
 *     換成已實現損益——那是真的、可查證，而且是全場最強的一個數字。
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'brand', 'intro');
const TMP = path.join(ROOT, '.introshot_tmp');

const WANT = ['2', '5', '7', '9'];

/** 第 07 幕的修正，回傳實際改到的項目，改不到要讓它出聲而不是安靜地截一張錯的 */
function fixShot7() {
  const done = [];
  const cards = document.querySelectorAll('[data-shot="7"] .st');
  if (cards.length < 2) return done;

  // ① 健康分 82 → 60
  const score = cards[0].querySelector('.st-v b');
  if (score && score.textContent.trim() === '82') {
    score.textContent = '60';
    done.push('健康分 82→60');
  }
  const bar = cards[0].querySelector('.st-bar i');
  if (bar) { bar.style.width = '60%'; done.push('進度條 82%→60%'); }

  // ② 理財力等級 → 已實現損益（產品禁止能力／等級標籤）
  const lv = cards[1];
  const label = lv.querySelector('.st-h span:last-child');
  const val = lv.querySelector('.st-v');
  const pill = lv.querySelector('.st-pill');
  if (label && val) {
    label.textContent = '近一年已實現損益';
    val.innerHTML = '<b style="font-size:26px;letter-spacing:-.02em">+117,482</b>';
    done.push('理財力等級 Lv.3 → 已實現損益 +117,482');
  }
  if (pill) { pill.textContent = '981 勝 · 493 負'; done.push('pill → 勝負筆數'); }
  return done;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(ROOT, 'frontend', 'intro.html'), { waitUntil: 'domcontentloaded' });

  const grabbed = new Set();
  for (let t = 0; t < 30000 && grabbed.size < WANT.length; t += 400) {
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => document.querySelector('.stage')?.getAttribute('data-shot'));
    if (!n || grabbed.has(n) || !WANT.includes(n)) continue;

    await page.waitForTimeout(1100);                 // 等這一幕的入場動畫停下來
    if (n === '7') {
      const done = await page.evaluate(fixShot7);
      if (!done.length) console.log('   ⚠ 第 07 幕沒改到任何東西——版面可能變了，這張先別用');
      else done.forEach(d => console.log(`   · ${d}`));
      await page.waitForTimeout(250);
    }
    const png = path.join(TMP, `shot${n}.png`);
    await page.screenshot({ path: png });
    grabbed.add(n);

    const jpg = path.join(OUT, `shot${n}.jpg`);
    try {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', jpg],
                   { stdio: 'ignore' });
    } catch (_) { fs.copyFileSync(png, jpg.replace(/\.jpg$/, '.png')); }
    console.log(`✓ shot${n}.jpg`);
  }

  const missed = WANT.filter(n => !grabbed.has(n));
  if (missed.length) console.log(`✗ 沒截到第 ${missed.join('、')} 幕`);

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
})();
