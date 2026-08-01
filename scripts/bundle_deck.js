#!/usr/bin/env node
/**
 * bundle_deck.js — 把簡報打包成「單一 HTML 檔」
 *
 * 為什麼要這個：上台那台電腦不一定是你的。只複製 PITCH_DECK.html 過去，
 * brand/、pitch_shots/、demo/ 沒跟著走，圖和影片就全破。
 * 這支把所有本地素材轉成 data URI 內嵌，產出一個丟到哪都能開的檔案。
 *
 *   node scripts/bundle_deck.js
 *   → docs/PITCH_DECK.standalone.html
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SRC = path.join(DOCS, 'PITCH_DECK.html');
const OUT = path.join(DOCS, 'PITCH_DECK.standalone.html');

const MIME = {
  '.png': 'image/png',   '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',   '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp4': 'video/mp4',   '.webm': 'video/webm',   '.mov': 'video/quicktime',
};

let html = fs.readFileSync(SRC, 'utf8');

const seen = new Map();     // 同一個檔只轉一次，重複引用共用同一份 base64
let inlined = 0, missing = [], bytes = 0;

function toDataUri(rel) {
  if (seen.has(rel)) return seen.get(rel);
  const abs = path.join(DOCS, rel);
  if (!fs.existsSync(abs)) { missing.push(rel); seen.set(rel, null); return null; }
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext];
  if (!mime) { seen.set(rel, null); return null; }
  const buf = fs.readFileSync(abs);
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  seen.set(rel, uri);
  inlined++; bytes += buf.length;
  return uri;
}

// src / poster / data-video，只處理相對路徑（跳過 http、data:、絕對路徑）
html = html.replace(/\b(src|poster|data-video)="([^"]+)"/g, (m, attr, val) => {
  if (/^(https?:|data:|\/\/|#)/.test(val)) return m;
  const uri = toDataUri(val);
  return uri ? `${attr}="${uri}"` : m;
});

// CSS 裡的 url(...)（顆粒層那類 inline SVG 已經是 data:，會自動跳過）
html = html.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, val) => {
  if (/^(https?:|data:|\/\/|#)/.test(val)) return m;
  const uri = toDataUri(val);
  return uri ? `url(${uri})` : m;
});

// 標題加註，避免跟原始檔搞混
html = html.replace(/<title>([^<]*)<\/title>/, '<title>$1（單檔版）</title>');

fs.writeFileSync(OUT, html);

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`→ ${path.relative(process.cwd(), OUT)}`);
console.log(`   內嵌 ${inlined} 個素材（原始 ${mb(bytes)}）／輸出 ${mb(Buffer.byteLength(html))}`);
const vids = missing.filter(f => /\.(mp4|webm|mov)$/i.test(f));
const imgs = missing.filter(f => !/\.(mp4|webm|mov)$/i.test(f));
if (vids.length) {
  console.log(`   ℹ 尚未錄製 ${vids.length} 支影片——這幾格會維持顯示實機截圖，不影響上台：`);
  vids.forEach(f => console.log(`     · ${f}`));
}
if (imgs.length) {
  console.log(`   ⚠ 找不到 ${imgs.length} 個圖檔（會保留原路徑，開檔時該處會破圖）：`);
  imgs.forEach(f => console.log(`     · ${f}`));
}
