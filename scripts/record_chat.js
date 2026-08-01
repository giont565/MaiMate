#!/usr/bin/env node
/**
 * record_chat.js — 錄線上站的 Golden Path 對話流程
 *
 *   node scripts/record_chat.js
 *   → docs/demo/chat_full.webm ＋ 各段落時間戳（貼進簡報用）
 *
 * 為什麼要從線上錄：file:// 的 Origin 是 null，API 會被 CORS 擋掉。
 * 從線上站錄到的才是真的實機畫面。
 *
 * ⚠️ 全程不點「確認」——那是真錢、不可逆。錄到確認卡出現就停。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SITE = process.env.SITE || 'https://d1z0776b4u2tmf.cloudfront.net/';
const OUT  = path.join(__dirname, '..', 'docs', 'demo');
const TMP  = path.join(__dirname, '..', '.rec_chat');
const MSG  = 'ETH 跌太多了，幫我全部賣掉！';

const marks = [];
let t0 = 0;
const mark = name => {
  const t = (Date.now() - t0) / 1000;
  marks.push({ name, t: +t.toFixed(1) });
  console.log(`   ${t.toFixed(1).padStart(5)}s  ${name}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    recordVideo: { dir: TMP, size: { width: 390, height: 844 } },
  });
  const p = await ctx.newPage();
  t0 = Date.now();

  await p.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3500);
  mark('健檢首屏就緒');

  // 捲到輸入框，逐字打（看起來像人在打）
  await p.evaluate(() => document.getElementById('q')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await p.waitForTimeout(1500);
  await p.click('#q');
  await p.type('#q', MSG, { delay: 85 });
  await p.waitForTimeout(900);
  mark('打完恐慌那句');

  await p.keyboard.press('Enter');
  mark('送出 → 開始查');

  // 等工具 chips 與回覆
  await p.waitForTimeout(2500);
  mark('工具 chips 出現');

  // 等真正的回覆（用字數成長判斷，不要用關鍵字——健檢卡本來就有「機會成本」）
  await p.waitForFunction(() => {
    const t = document.body.innerText;
    return /決策邏輯|我需要你確認|你現在是想要/.test(t);
  }, null, { timeout: 90000 }).catch(() => console.log('   ⚠ 等第一輪回覆逾時'));
  await p.waitForTimeout(2500);
  mark('第一輪回覆到齊（含反問）');

  // 慢慢捲過工具 chips 與反問脈絡
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(1250); }
  mark('看完反問脈絡');

  // 第二輪：回答它的反問，觸發三方案
  await p.evaluate(() => document.getElementById('q')?.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(800);
  await p.click('#q');
  await p.type('#q', '我是因為跌幅感到不安。給我三個方案比較', { delay: 70 });
  await p.waitForTimeout(700);
  await p.keyboard.press('Enter');
  mark('送出第二輪 → 要三方案');

  await p.waitForFunction(() => /手續費|執行後|方案|集中度/.test(document.body.innerText),
    null, { timeout: 90000 }).catch(() => console.log('   ⚠ 等三方案逾時'));
  await p.waitForTimeout(3000);
  for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 210); await p.waitForTimeout(1300); }
  mark('三方案卡');
  await p.waitForTimeout(2500);

  // 點方案卡 → 只會產生訂單草稿與確認卡，不會下單
  const clicked = await p.evaluate(() => {
    const cands = [...document.querySelectorAll('button,[role=button],[class*=card],[class*=scenario],li,div')]
      .filter(e => e.offsetParent && e.children.length < 8 &&
                   /先賣|25\s*%|分批|保守/.test(e.innerText || '') && (e.innerText || '').length < 160);
    if (!cands.length) return false;
    const el = cands[0];
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  });
  console.log(clicked ? '   → 已點方案卡' : '   ⚠ 找不到方案卡');
  await p.waitForTimeout(7000);
  mark('確認卡（不按）');
  await p.waitForTimeout(4500);
  mark('結束');

  await p.close();
  await ctx.close();

  const f = fs.readdirSync(TMP).find(x => x.endsWith('.webm'));
  const dest = path.join(OUT, 'chat_full.webm');
  fs.renameSync(path.join(TMP, f), dest);
  fs.rmSync(TMP, { recursive: true, force: true });
  await browser.close();

  console.log(`\n✓ docs/demo/chat_full.webm  ${Math.round(fs.statSync(dest).size / 1024)} KB`);
  console.log('\n段落時間戳（貼進簡報的 #t=start,end）：');
  const g = n => marks.find(m => m.name === n)?.t ?? 0;
  const win = {
    '第 9 頁 它先去查':   [g('打完恐慌那句'),           g('第一輪回覆到齊（含反問）')],
    '第 10 頁 先反問':    [g('第一輪回覆到齊（含反問）'), g('送出第二輪 → 要三方案')],
    '第 11 頁 三方案':    [g('送出第二輪 → 要三方案'),   g('確認卡（不按）')],
    '第 12 頁 確認卡':    [g('確認卡（不按）'),          g('結束')],
  };
  for (const [k, [a, b]] of Object.entries(win)) console.log(`  ${k}:  #t=${a},${b}`);
  fs.writeFileSync(path.join(OUT, 'chat_marks.json'), JSON.stringify({ marks, win }, null, 2));
})();
