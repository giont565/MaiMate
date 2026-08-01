#!/usr/bin/env node
/**
 * fix_mascot_alpha.js — 補回去背圖裡「輪廓內部的透明洞」
 *
 *   node scripts/fix_mascot_alpha.js <輸入.png> [輸出.png]
 *
 * 為什麼需要：frontend/brand/maimate_body.png 的左眼是 alpha=0 的洞，
 * 背景會直接穿過去——黑底看起來像瞎了一隻眼，白底又看不出來。
 *
 * 做法：從四邊往內 flood fill 標出「外部」的透明像素；
 * 剩下沒被標到、卻仍然透明的，就是被輪廓包住的洞，填成不透明白色。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const IN  = process.argv[2] || 'docs/brand/mascot.png';
const OUT = process.argv[3] || IN;

(async () => {
  const b64 = fs.readFileSync(IN).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');

  const { dataUrl, holes, w, h } = await page.evaluate(async (src) => {
    const im = new Image();
    await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = src; });
    const c = document.getElementById('c');
    c.width = im.width; c.height = im.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data, W = c.width, H = c.height;

    // 從邊界 flood fill，標出「外部」的透明像素
    const outside = new Uint8Array(W * H);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x;
      if (outside[i] || d[i * 4 + 3] > 8) return;   // 已標過，或不夠透明
      outside[i] = 1; stack.push(x, y);
    };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }

    // 沒被標到卻仍透明 → 輪廓內部的洞，補成不透明白
    let holes = 0;
    for (let i = 0; i < W * H; i++) {
      if (!outside[i] && d[i * 4 + 3] < 250) {
        d[i * 4] = 254; d[i * 4 + 1] = 254; d[i * 4 + 2] = 254; d[i * 4 + 3] = 255;
        holes++;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), holes, w: W, h: H };
  }, 'data:image/png;base64,' + b64);

  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`✓ ${path.relative(process.cwd(), OUT)}  ${w}×${h}`);
  console.log(`   補回 ${holes.toLocaleString()} 個內部透明像素`);
})();
