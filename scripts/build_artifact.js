#!/usr/bin/env node
/**
 * build_artifact.js — 產出「可部署成網址」的簡報
 *
 *   node scripts/build_artifact.js
 *   → docs/PITCH_DECK.artifact.html
 *
 * 跟 bundle_deck.js 的差別只有兩個，設計與內容一個字都不動：
 *
 *  1. 圖片會壓過再內嵌。單檔版是 17.8 MB，部署平台上限 16 MB。
 *     沒有透明度的圖轉成 JPEG（brandsheet 2044KB → 396KB 這種等級），
 *     有透明度的（麥麥公仔）維持 PNG，不然去背會變回白底方塊。
 *     影片不動——那是這份簡報最重要的東西。
 *  2. 拆掉 <!doctype><html><head><body> 骨架，平台會自己包一層。
 *
 * 上台請照舊用 PITCH_DECK.standalone.html，那份是無損的。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DOCS = path.join(__dirname, '..', 'docs');
const SRC = path.join(DOCS, 'PITCH_DECK.html');
const OUT = path.join(DOCS, 'PITCH_DECK.artifact.html');
const TMP = path.join(__dirname, '..', '.artifact_tmp');

const VIDEO_MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                     '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

/* 圖片品質。塞不下時會自動往下降，不夠才動影片——
 * 圖片糊一點沒人會發現，影片整支不見那一頁就沒東西看了。 */
const QUALITY_STEPS = [78, 66, 55];
let jpegQuality = QUALITY_STEPS[0];

/* 這幾支就算超過上限也不能丟：它們是那一頁的內容本身。
 * 第 8 頁整頁就是在講這段九幕動畫，退回截圖等於那頁白講。 */
const KEEP_VIDEOS = ['demo/02_intro.webm'];

function hasAlpha(abs) {
  try {
    const out = execFileSync('sips', ['-g', 'hasAlpha', abs], { encoding: 'utf8' });
    return /hasAlpha:\s*yes/.test(out);
  } catch (_) {
    return true;          // 問不出來就當它有透明度，寧可大一點也不要破圖
  }
}

/** 回傳 {buf, mime}；壓不動或壓不贏原檔就用原檔 */
function encodeImage(abs, rel) {
  const ext = path.extname(abs).toLowerCase();
  const original = fs.readFileSync(abs);
  const mime = IMAGE_MIME[ext];
  if (ext === '.svg' || ext === '.gif' || ext === '.webp') return { buf: original, mime };
  if (hasAlpha(abs)) return { buf: original, mime, kept: '有透明度' };

  const dest = path.join(TMP, rel.replace(/[\/\\]/g, '__') + '.jpg');
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(jpegQuality),
                          abs, '--out', dest], { stdio: 'ignore' });
    const jpg = fs.readFileSync(dest);
    if (jpg.length >= original.length) return { buf: original, mime, kept: '轉檔沒變小' };
    return { buf: jpg, mime: 'image/jpeg', saved: original.length - jpg.length };
  } catch (_) {
    return { buf: original, mime, kept: 'sips 失敗' };
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let html = fs.readFileSync(SRC, 'utf8');
const seen = new Map();
let missing = [], savedTotal = 0, inlined = 0;

function toDataUri(rel) {
  if (seen.has(rel)) return seen.get(rel);
  const abs = path.join(DOCS, rel);
  if (!fs.existsSync(abs)) { missing.push(rel); seen.set(rel, null); return null; }

  const ext = path.extname(abs).toLowerCase();
  let uri = null;
  if (VIDEO_MIME[ext]) {
    const buf = fs.readFileSync(abs);
    uri = `data:${VIDEO_MIME[ext]};base64,${buf.toString('base64')}`;
  } else if (IMAGE_MIME[ext]) {
    const { buf, mime, saved } = encodeImage(abs, rel);
    if (saved) savedTotal += saved;
    uri = `data:${mime};base64,${buf.toString('base64')}`;
  }
  if (uri) inlined++;
  seen.set(rel, uri);
  return uri;
}

/* 影片太多會超過部署上限。與其整份塞不進去，不如捨棄幾支最大的——
 * 那幾格會退回顯示原本的截圖（poster 還在），簡報結構完全不受影響。
 * 上台用的是無損的 standalone，這裡犧牲的只有線上對稿版。
 * 捨棄哪幾支一定要印出來：靜靜地少掉幾支影片，看的人會以為那幾頁本來就沒錄。 */
const LIMIT = 16 * 1024 * 1024;
const SRC_HTML = html;
const dropped = [];
const droppedSet = new Set();

function inlineAll() {
  let out = SRC_HTML.replace(/\b(src|poster|data-video)="([^"]+)"/g, (m, attr, val) => {
    if (/^(https?:|data:|\/\/|#)/.test(val)) return m;
    if (attr === 'data-video' && droppedSet.has(val)) return '';  // 屬性整個拿掉，留 img 的截圖
    const uri = toDataUri(val);
    return uri ? `${attr}="${uri}"` : m;
  });
  out = out.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, val) => {
    if (/^(https?:|data:|\/\/|#)/.test(val)) return m;
    const uri = toDataUri(val);
    return uri ? `url(${uri})` : m;
  });
  return out;
}

html = inlineAll();

/* 預設「完整優先」：不降畫質、不丟影片，超過上限就照實講，由人決定怎麼辦。
 * 加 --fit 才會為了塞進部署上限犧牲東西。
 * 這個預設是刻意的——安靜地降級，看的人會以為簡報本來就長那樣。 */
const FIT = process.argv.includes('--fit');

// 量了再砍——用估的會失準（第一版就估錯，砍不到東西）。
// 第一步：把圖片品質往下降。圖片轉檔結果在 seen 裡，換品質要清掉重轉。
for (let i = 1; FIT && i < QUALITY_STEPS.length && Buffer.byteLength(html) > LIMIT; i++) {
  jpegQuality = QUALITY_STEPS[i];
  seen.clear(); savedTotal = 0; inlined = 0; missing = [];
  html = inlineAll();
}

// 第二步：還是塞不下才動影片，從最大的開始，且永遠跳過 KEEP_VIDEOS。
if (FIT && Buffer.byteLength(html) > LIMIT) {
  const bySize = [...new Set([...SRC_HTML.matchAll(/\bdata-video="([^"]+)"/g)].map(m => m[1]))]
    .filter(f => !/^(https?:|data:)/.test(f) && !KEEP_VIDEOS.includes(f))
    .map(rel => {
      const abs = path.join(DOCS, rel);
      return { rel, size: fs.existsSync(abs) ? fs.statSync(abs).size : 0 };
    })
    .sort((a, b) => b.size - a.size);

  for (const v of bySize) {
    if (Buffer.byteLength(html) <= LIMIT) break;
    dropped.push(v);
    droppedSet.add(v.rel);
    html = inlineAll();
  }
}

// 拆骨架：平台會自己包 <!doctype><html><head></head><body>
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
if (!headMatch || !bodyMatch) {
  console.error('✗ 解析不出 head/body——PITCH_DECK.html 結構變了');
  process.exit(1);
}
const head = headMatch[1]
  .replace(/<meta\s+charset=[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  .trim();
const bodyAttrs = bodyMatch[1].trim();
const body = bodyMatch[2].trim();
const out = `${head}\n${bodyAttrs ? `<div ${bodyAttrs}>\n${body}\n</div>` : body}\n`;

fs.writeFileSync(OUT, out);
fs.rmSync(TMP, { recursive: true, force: true });

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
const size = Buffer.byteLength(out);
console.log(`→ ${path.relative(process.cwd(), OUT)}  ${mb(size)}（內嵌 ${inlined} 個素材，圖片省下 ${mb(savedTotal)}）`);
if (jpegQuality !== QUALITY_STEPS[0]) {
  console.log(`   ↓ 圖片品質降到 ${jpegQuality}（起始 ${QUALITY_STEPS[0]}）才塞得進 16 MB——影片全數保留`);
}
if (dropped.length) {
  console.log(`   ✂ 為了塞進 16 MB，這 ${dropped.length} 支影片沒放進線上版，該格顯示截圖：`);
  dropped.forEach(v => console.log(`     · ${v.rel}（${mb(v.size)}）`));
  console.log(`   → 上台請用 PITCH_DECK.standalone.html，那份是完整的`);
}
if (size > LIMIT) {
  console.log(`   ⚠ 超過部署上限 16 MB ${mb(size - LIMIT)}——這份是完整版，無法部署成網址。`);
  console.log(`     要壓到能部署：node scripts/build_artifact.js --fit（會降畫質、可能丟影片）`);
  console.log(`     不想犧牲就直接發 PITCH_DECK.standalone.html 給隊友，本機開一樣完整。`);
}
const vids = missing.filter(f => /\.(mp4|webm|mov)$/i.test(f));
if (vids.length) {
  console.log(`   ℹ 尚未錄製 ${vids.length} 支影片，該格顯示截圖：`);
  vids.forEach(f => console.log(`     · ${f}`));
}
const imgs = missing.filter(f => !/\.(mp4|webm|mov)$/i.test(f));
if (imgs.length) {
  console.log(`   ⚠ 找不到 ${imgs.length} 個圖檔（會破圖）：`);
  imgs.forEach(f => console.log(`     · ${f}`));
}
