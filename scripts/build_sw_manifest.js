#!/usr/bin/env node
/* build_sw_manifest.js — 產出 service worker 的 precache 清單
 *
 * 為什麼要用產生器：手寫的清單一定會漂。前端每加一個檔，就多一個「沒被快取、
 * 但沒人發現」的破口——而且破口只在真的斷網時才會現形，也就是決賽現場。
 *
 * 產出 frontend/sw-assets.js（sw.js 用 importScripts 載入）。
 * scripts/smoke_hostapp.js 有一條斷言比對清單與實際目錄，漏跑本程式會直接紅。
 *
 * 用法：npm run build:sw
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "frontend");
const OUT = path.join(ROOT, "sw-assets.js");

// 這些不進快取：sw 自己（會造成更新不了）、產出的清單本身、說明文件
const SKIP = new Set(["sw.js", "sw-assets.js", "brand/README.md"]);
// .mp4 是入口動畫 01–03 幕的素材（brand/intro-shot1-3.mp4，約 1 MB）。不收的話斷網時
// intro.html 會退回 CSS 版前三幕——不會壞，但離線 demo 就看不到實拍那段。
const EXT = new Set([".html", ".js", ".css", ".png", ".svg", ".webmanifest", ".jpg", ".webp", ".mp4"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

const assets = walk(ROOT)
  .filter((f) => !SKIP.has(f))
  .filter((f) => EXT.has(path.extname(f).toLowerCase()));

// 版本＝內容雜湊：任何檔案改動都會換版本，舊快取自動淘汰。
// 用時間戳當版本會讓「沒改東西也重出」變成新版本，白白讓使用者重抓。
const crypto = require("crypto");
const hash = crypto.createHash("sha256");
for (const f of assets) hash.update(f).update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest("hex").slice(0, 10);

fs.writeFileSync(OUT, `/* 自動生成——請勿手改。重生：npm run build:sw
 * 內容：service worker 的 precache 清單與版本（版本＝所有檔案內容的雜湊，
 * 改了任何檔就換版本，舊快取自動淘汰）。 */
self.SW_VERSION = ${JSON.stringify(version)};
self.SW_ASSETS = ${JSON.stringify(assets, null, 2)};
`);

console.log(`sw-assets.js 已產出：${assets.length} 個檔，版本 ${version}`);
