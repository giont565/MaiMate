#!/usr/bin/env node
/**
 * make_posters.js — 從每支影片抽一張代表幀當 poster
 *
 *   node scripts/make_posters.js
 *   → docs/pitch_shots/auto/*.jpg，並改寫 PITCH_DECK.html 裡對應的 img src
 *
 * 為什麼需要：
 * 簡報右側那格在螢幕上是影片，poster 只是載入前的墊檔，所以一直沒人發現它們配錯。
 * 但印成 PDF 時**播不了影片，評審看到的就是 poster**——第 6 頁講「從 MAX 進來」，
 * poster 卻是投資健檢的畫面。手挑一張截圖仍然可能挑錯，直接從影片抽幀才不會不一致。
 *
 * 抽第 55% 的位置：開頭常常還在淡入或空白，結尾常常已經捲走。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT_DIR = path.join(DOCS, 'pitch_shots', 'auto');
const DECK = path.join(DOCS, 'PITCH_DECK.html');
const PROBE = path.join(DOCS, '_probe.html');   // 必須放在 docs/ 底下才讀得到相對路徑的影片

const AT = 0.55;

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let html = fs.readFileSync(DECK, 'utf8');
  const pairs = [...html.matchAll(/data-video="([^"]+)"\s+src="([^"]+)"/g)]
    .map(m => ({ video: m[1], oldPoster: m[2] }));
  const uniq = [...new Map(pairs.map(p => [p.video, p])).values()];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 980 }, deviceScaleFactor: 2 });
  const done = [];

  for (const { video } of uniq) {
    const name = path.basename(video).replace(/\.[^.]+$/, '');
    fs.writeFileSync(PROBE,
      `<body style="margin:0;background:#000"><video id=v src="${video}" muted></video>`);
    await page.goto('file://' + PROBE);
    const ok = await page.evaluate(async at => {
      const v = document.getElementById('v');
      const meta = await new Promise(r => {
        if (v.readyState >= 1) return r(true);
        v.onloadedmetadata = () => r(true);
        v.onerror = () => r(false);
        setTimeout(() => r(false), 15000);
      });
      if (!meta || !isFinite(v.duration)) return null;
      v.style.width = v.videoWidth + 'px';
      v.style.height = v.videoHeight + 'px';
      await new Promise(r => { v.onseeked = () => r(); v.currentTime = v.duration * at; });
      await new Promise(r => setTimeout(r, 250));
      return { w: v.videoWidth, h: v.videoHeight, t: +(v.currentTime).toFixed(2) };
    }, AT);

    if (!ok) { console.log(`   ✗ ${video} 抽不到幀，維持原本的 poster`); continue; }

    await page.setViewportSize({ width: ok.w, height: ok.h });
    const png = path.join(OUT_DIR, name + '.png');
    const jpg = path.join(OUT_DIR, name + '.jpg');
    await page.locator('#v').screenshot({ path: png });
    try {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86', png, '--out', jpg],
                   { stdio: 'ignore' });
      fs.unlinkSync(png);
    } catch (_) { fs.renameSync(png, jpg); }
    done.push({ video, poster: path.relative(DOCS, jpg), t: ok.t, size: `${ok.w}x${ok.h}` });
    console.log(`   ✓ ${video}  @${ok.t}s  ${ok.w}x${ok.h}`);
  }

  await browser.close();
  fs.rmSync(PROBE, { force: true });

  // 改寫 deck 裡的 src，只動有成功抽到幀的
  let changed = 0;
  for (const d of done) {
    const re = new RegExp(`(data-video="${d.video.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+src=")[^"]+(")`, 'g');
    html = html.replace(re, (m, a, b) => { changed++; return a + d.poster + b; });
  }
  fs.writeFileSync(DECK, html);
  console.log(`\n→ 抽出 ${done.length} 張，改寫 ${changed} 處 img src`);
  console.log(`   PDF 裡那幾格現在會顯示影片實際的畫面，不再是配錯的截圖`);
})();
