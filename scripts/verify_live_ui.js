#!/usr/bin/env node
/* verify_live_ui.js — 已部署前端的自動驗收（#14 的 UI 半邊）
 *
 * `scripts/verify_live.py` 打的是後端 API，它的 docstring 說「要用眼睛看的留給
 * verify_live_ui.js」——就是這支。兩支合起來，`docs/TEST_CHECKLIST.md` 裡機器判得出來的
 * 部分就不用人一項一項手點。
 *
 * 這支要回答的核心問題是「**線上跑的到底是不是我這份 code**」。決賽日最可怕的不是部署失敗
 * （失敗會報錯，看得到），而是部署「看起來成功」但其實：
 *   - S3 sync 了、CloudFront 沒 invalidate → 使用者拿到快取的舊版
 *   - 漏 sync 某幾個檔 → 大部分頁面正常，某一頁行為是舊的
 *   - 某頁的 API_BASE 忘了改 → 該頁靜默走離線 mock，畫面與數字全都正常，但全是假的
 * 這三種都不會報錯。所以 L2 直接拿線上檔案的 sha256 跟本地 frontend/ 比對——
 * 這比任何「試紙」都硬：內容不一樣就是不一樣。
 *
 * 用法：
 *   node scripts/verify_live_ui.js --base https://xxxx.cloudfront.net
 *   node scripts/verify_live_ui.js --base https://... --skip-backend   # 後端還沒好時
 *   node scripts/verify_live_ui.js --base https://... --only L1,L2
 *
 * 安全：本程式只讀取頁面、不送出任何表單、不呼叫 /order、不輸入任何憑證。
 * 對後端唯一的接觸是讓頁面自己去打 /health 與 /market（GET）。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
// 這份清單漏一頁，該頁就沒人在看——而手寫版本已經漏過兩次：
//   07/31 host-app.html 不在清單裡，它指著已刪除的舊 API 而 L3.1 判定通過。
//   08/02 intro.html 不在清單裡，而它正是比賽環境唯一 403 的檔（入口動畫整段沒上去）。
// 靠人同步已經證明失敗，改成直接讀 frontend/，新增頁面不必記得回來補。
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();

// 本地「應該要有 API_BASE」的頁。L3.3 用它當期望集合——見該條的註解。
const hasApiBase = (src) => /window\.API_BASE\s*=\s*["']/.test(src);
const LOCAL_API_PAGES = PAGES.filter((p) => hasApiBase(fs.readFileSync(path.join(ROOT, p), "utf8")));

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
let BASE = arg("--base");
const SKIP_BACKEND = has("--skip-backend");
const ONLY = (arg("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!BASE) {
  console.error(`用法：node scripts/verify_live_ui.js --base https://<你的 CloudFront 網域>

拿網址：aws cloudformation describe-stacks --stack-name maimate \\
          --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" --output text`);
  process.exit(2);
}
BASE = BASE.replace(/\/+$/, "");
const runSection = (id) => ONLY.length === 0 || ONLY.includes(id);

// ---------- 結果收集 ----------
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${id} ${name}${detail ? `\n    ${detail}` : ""}`);
}
function skip(id, name, why) {
  results.push({ id, name, ok: null, detail: why });
  console.log(`− ${id} ${name}（略過：${why}）`);
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers };
}

// 本地 frontend/ 的相對路徑清單（含 mocks/ 子目錄與圖檔）
function localFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  })(ROOT);
  return out.sort();
}

(async () => {
  console.log(`驗收目標：${BASE}`);
  console.log(`本地對照：${ROOT}`);
  console.log(`（比對的是「本地 frontend/ 目前的內容」——請先確認你在想部署的那個 commit 上）\n`);

  // ══ L1 入口與傳輸 ══════════════════════════════════════════════════
  if (runSection("L1")) {
    console.log("── L1 入口與傳輸 ──");

    // HTTPS：S3 website endpoint 只有 http，手機 Safari 開啟「僅限 HTTPS」時會整個打不開（issue #39）
    check("L1.1", "網址是 HTTPS", BASE.startsWith("https://"),
      BASE.startsWith("https://") ? "" : `目前是 ${BASE.split(":")[0]}://。S3 website endpoint 不支援 HTTPS，手機 Safari 開「僅限 HTTPS」會直接拒連 → 要用 CloudFront 的 FrontendUrl`);

    // 根路徑：CloudFront DefaultRootObject 沒設好會 403，而評審拿到的網址就是根路徑
    try {
      const r = await get(`${BASE}/`);
      const isHtml = r.buf.slice(0, 512).toString().toLowerCase().includes("<html");
      check("L1.2", "根路徑直接載入首頁", r.status === 200 && isHtml,
        r.status === 200 && isHtml ? "" : `HTTP ${r.status}${isHtml ? "" : "（回應不是 HTML）"} → 檢查 CloudFront DefaultRootObject 是否為 index.html`);
    } catch (e) { check("L1.2", "根路徑直接載入首頁", false, `連不上：${e.message}`); }

    // 每一頁都要在。少一頁＝那頁沒 sync 上去，但其他頁正常，很難當場發現
    const missing = [];
    for (const p of PAGES) {
      try { const r = await get(`${BASE}/${p}`); if (r.status !== 200) missing.push(`${p}(${r.status})`); }
      catch (e) { missing.push(`${p}(${e.message})`); }
    }
    check("L1.3", `${PAGES.length} 個進入頁都取得到`, missing.length === 0,
      missing.length === 0 ? PAGES.join(" / ") : `取不到：${missing.join("、")}`);
  }

  // ══ L2 部署新鮮度（本節是這支腳本存在的理由）════════════════════════
  if (runSection("L2")) {
    console.log("\n── L2 部署新鮮度（線上檔案 vs 本地 frontend/）──");
    const files = localFiles();
    const stale = [], absent = [], errored = [];

    for (const rel of files) {
      const local = fs.readFileSync(path.join(ROOT, rel));
      try {
        // cache-bust 只影響「我這次抓到什麼」，不影響使用者拿到什麼——所以要抓兩份：
        // 帶 query 的繞過快取取得 origin 真實內容，不帶 query 的才是使用者實際拿到的
        const r = await get(`${BASE}/${rel}`);
        if (r.status !== 200) { absent.push(`${rel}(${r.status})`); continue; }
        if (sha(r.buf) !== sha(local)) stale.push({ rel, live: sha(r.buf), local: sha(local) });
      } catch (e) { errored.push(`${rel}(${e.message})`); }
    }

    check("L2.1", `線上檔案內容與本地一致（${files.length} 個檔）`,
      stale.length === 0 && absent.length === 0 && errored.length === 0,
      [
        stale.length ? `內容不同 ${stale.length} 個：${stale.slice(0, 6).map((s) => s.rel).join("、")}${stale.length > 6 ? " …" : ""}\n    → 最可能是 CloudFront 沒 invalidate（S3 已新、使用者拿到舊快取）。跑：\n      aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"` : "",
        absent.length ? `線上沒有 ${absent.length} 個：${absent.slice(0, 6).join("、")}\n    → 漏 sync。跑：aws s3 sync frontend/ s3://<FrontendBucket>/ --delete` : "",
        errored.length ? `抓取失敗：${errored.slice(0, 4).join("、")}` : "",
      ].filter(Boolean).join("\n    "));

    // 快取設定：invalidate 是人工動作，會忘。HTML 若被長時間快取，忘記 invalidate 的代價會放大成好幾小時
    try {
      const r = await get(`${BASE}/index.html`);
      const cc = r.headers.get("cache-control") || "(無)";
      const longCache = /max-age=(\d+)/.exec(cc);
      const secs = longCache ? Number(longCache[1]) : null;
      check("L2.2", "HTML 沒有被長時間快取", secs === null || secs <= 3600,
        secs === null || secs <= 3600 ? `Cache-Control: ${cc}` :
          `Cache-Control: ${cc}（${Math.round(secs / 3600)} 小時）→ 忘記 invalidate 時，使用者會拿到舊版長達這麼久。建議 HTML 設短快取或每次都 invalidate`);
    } catch (e) { check("L2.2", "HTML 沒有被長時間快取", false, `抓不到 header：${e.message}`); }
  }

  // ══ 以下需要瀏覽器 ═══════════════════════════════════════════════
  if (!runSection("L3") && !runSection("L4") && !runSection("L5")) { report(); return; }

  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    else { console.error(`\n瀏覽器啟動失敗：${e.message}\n先跑 npx playwright install chromium`); process.exit(2); }
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // 手機優先

  // ══ L3 設定一致性 ═════════════════════════════════════════════════
  if (runSection("L3")) {
    console.log("\n── L3 設定一致性 ──");
    // 從 HTML 原始碼抓，不用瀏覽器讀 window.API_BASE：home.html / chat.html 在還沒完成
    // onboarding 時會自動導回 welcome.html（正確行為），瀏覽器量測會撲空。
    // 這裡的判準與 DEPLOY.md §3 那行 `grep -oh 'window.API_BASE = ...' | sort -u` 完全一致。
    const found = [], none = [], unreachable = [];
    for (const p of PAGES) {
      try {
        const r = await get(`${BASE}/${p}`);
        if (r.status !== 200) { unreachable.push(`${p}(${r.status})`); continue; }
        const m = /window\.API_BASE\s*=\s*["']([^"']*)["']/.exec(r.buf.toString());
        if (m) found.push([p, m[1]]); else none.push(p);
      } catch (e) { unreachable.push(`${p}(${e.message})`); }
    }
    const uniq = [...new Set(found.map(([, v]) => v))];
    // 線上沒有 API_BASE 的頁，要分成兩種：本地也沒有（設計如此）與本地有（真故障，見 L3.3）。
    // 混在一起講成「另 N 頁不需要」，正是 L3.1 綠燈卻有一頁在跑假資料的原因。
    const foundNames = new Set(found.map(([p]) => p));
    const lostApi = LOCAL_API_PAGES.filter((p) => !foundNames.has(p) && !unreachable.some((u) => u.startsWith(`${p}(`)));
    const expectedNone = none.filter((p) => !LOCAL_API_PAGES.includes(p));

    // DEPLOY.md §3 標為「最常忘的一步」：漏改任一頁不會報錯，只會讓該頁靜默掉回離線 mock
    check("L3.1", "有 API_BASE 的頁面全部同一個值", uniq.length === 1 && unreachable.length === 0,
      unreachable.length ? `取不到：${unreachable.join("、")}`
        : uniq.length === 1 ? `${uniq[0]}（${found.length} 頁一致${expectedNone.length ? `；另 ${expectedNone.length} 頁不需要：${expectedNone.join("、")}` : ""}${lostApi.length ? `；⚠ ${lostApi.length} 頁該有卻沒有，見 L3.3` : ""}）`
          : uniq.length === 0 ? "所有頁面都沒有 API_BASE ——整站會跑離線 mock"
            : `發現 ${uniq.length} 個不同的值：\n    ${found.map(([p, v]) => `${p} → ${v}`).join("\n    ")}\n    → 值不同的那幾頁會打到錯的後端或直接掉回離線 mock（畫面正常、數字正常，但全是假的）`);

    const bad = found.filter(([, v]) => !/^https:\/\//.test(v));
    check("L3.2", "API_BASE 是 HTTPS 絕對網址", bad.length === 0,
      bad.length === 0 ? "" : `不合格：${bad.map(([p, v]) => `${p} → ${v || "(空字串)"}`).join("、")}（空值、localhost 或 http 都會讓線上頁面連不到後端）`);

    // L3.1 有個致命盲點：抓不到 API_BASE 的頁被丟進 none[]，而 none[] 完全不參與判定。
    // 於是「線上某頁的 API_BASE 整行不見了」＝L3.1 綠燈。2026-08-02 實測：比賽環境線上
    // home.html 沒有 API_BASE，L3.1 照樣通過，而 home-service 的 fetch 全部落到同源、
    // 失敗、靜默走 mock——畫面完整但沒有一筆真資料。所以要拿本地當期望集合對一次。
    check("L3.3", "本地有 API_BASE 的頁，線上也都有", lostApi.length === 0,
      lostApi.length === 0 ? `${LOCAL_API_PAGES.length} 頁應有、線上都有`
        : `線上這幾頁的 API_BASE 不見了：${lostApi.join("、")}\n    → 該頁的 fetch 會落到同源、失敗、靜默走離線 mock（畫面完整、數字正常，但沒有一筆真資料）。\n    → 多半是線上跑的是舊版該頁，重新部署本地 main 即可。`);

    // 真的不打 API 的頁沒有 API_BASE 是設計如此，不是漏改——講明白，免得下一個人以為漏了而去亂加。
    // 這行以前是寫死的「home / insights / settings」，而 home.html 後來拿到了 API_BASE，
    // 這句就變成叫人忽略一個真故障的安撫文案。改成用本地內容推導。
    if (expectedNone.length) console.log(`    （${expectedNone.join("、")} 本地就沒有 API_BASE，不打 API 的純前端頁，正常）`);
  }

  // ══ L4 真的連得到後端 ═════════════════════════════════════════════
  if (runSection("L4")) {
    console.log("\n── L4 真的連得到後端（不是靜默走離線 mock）──");
    if (SKIP_BACKEND) {
      skip("L4.1", "離線標示沒亮", "--skip-backend");
      skip("L4.2", "行情四格有真實數字", "--skip-backend");
    } else {
      const page = await ctx.newPage();
      const failed = [];
      page.on("requestfailed", (r) => failed.push(`${r.url().split("?")[0]} ${r.failure()?.errorText || ""}`));
      await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
      await page.waitForTimeout(6000); // 給行情輪詢跑至少一輪

      const offlineOn = await page.$eval("#offline", (e) => getComputedStyle(e).display !== "none").catch(() => null);
      check("L4.1", "離線標示沒亮", offlineOn === false,
        offlineOn === false ? "頁面確實連到了後端"
          : offlineOn === null ? "找不到 #offline 元素（頁面結構變了？）"
            : `離線標示亮著＝前端連不到 API，畫面上的數字全是 mock。\n    失敗的請求：${failed.slice(0, 3).join("；") || "(無，可能是回應非 2xx)"}\n    → 檢查 API_BASE 是否正確、後端是否部署、API Gateway CORS`);

      const ticks = await page.$$eval("#market .v", (els) => els.map((e) => e.textContent.trim())).catch(() => []);
      const live = ticks.filter((t) => t && t !== "—");
      check("L4.2", "行情四格有真實數字", ticks.length === 4 && live.length === 4,
        ticks.length === 4 && live.length === 4 ? ticks.join(" / ")
          : `目前：${ticks.join(" / ") || "(讀不到)"} → 行情沒有離線備援，「—」就代表 /market 打不通`);
      await page.close();
    }
  }

  // ══ L5 視覺與可用性 ═══════════════════════════════════════════════
  if (runSection("L5")) {
    console.log("\n── L5 視覺與可用性 ──");
    const page = await ctx.newPage();
    const errors = [], notFound = [];
    // 只收「真的 JS 爆掉」：pageerror 是未捕捉的例外，console error 另外過濾掉資源載入失敗。
    // 後端連不上時瀏覽器會噴一堆 "Failed to load resource"，那是 L4 的職責，混進來會讓
    // 這條在後端沒好時永遠紅燈，久了就沒人看了。
    page.on("pageerror", (e) => errors.push(`未捕捉例外：${String(e.message).slice(0, 120)}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/i.test(t)) return;
      errors.push(t.slice(0, 120));
    });
    page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url().replace(BASE, "").split("?")[0]); });

    await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
    await page.waitForTimeout(2000);

    // 圓環：CSS 沒套上會退化成橫向 bar，但頁面不報錯（#hero vs .hero 類 bug）
    const ring = await page.$eval("#hero .ring", (e) => ({ w: e.clientWidth, h: e.clientHeight, br: getComputedStyle(e).borderRadius })).catch(() => null);
    check("L5.1", "健康分圓環是圓的（CSS 有套上）", !!ring && ring.w >= 40 && Math.abs(ring.w - ring.h) <= 2 && ring.br !== "0px",
      ring ? `${ring.w}×${ring.h} radius=${ring.br}` : "找不到 #hero .ring");

    check("L5.2", "沒有 404 資源", notFound.length === 0,
      notFound.length === 0 ? "" : `404：${[...new Set(notFound)].slice(0, 6).join("、")} → 多半是圖檔沒 sync 上去`);

    check("L5.3", "沒有 JS 例外", errors.length === 0,
      errors.length === 0 ? "（資源載入失敗不計入本條，那由 L4 判定）" : `${errors.length} 筆，前三筆：\n    ${errors.slice(0, 3).join("\n    ")}`);

    // 觸控目標：量的是含 ::after 熱區的實際可點範圍（issue #13）。
    // 不能用 elementFromPoint——它只在 viewport 內有效，畫面外的元素會量到原始小方框而假通過
    const taps = await page.$$eval("a[href], button, [role=button], .pill, .badge", (nodes) =>
      nodes.filter((n) => n.offsetParent !== null).map((n) => {
        const r = n.getBoundingClientRect();
        const a = getComputedStyle(n, "::after");
        let w = r.width, h = r.height;
        if (a && a.content !== "none") {
          const ah = parseFloat(a.height), aw = parseFloat(a.width);
          if (!Number.isNaN(ah) && ah > h) h = ah;
          if (!Number.isNaN(aw) && aw > w) w = aw;
        }
        return { label: (n.textContent || n.className || n.tagName).trim().slice(0, 16), w: Math.round(w), h: Math.round(h) };
      }));
    const small = taps.filter((t) => t.h < 44 || t.w < 44);
    check("L5.4", `觸控目標 ≥44px（Apple HIG）`, small.length === 0,
      small.length === 0 ? `${taps.length} 個可點元素全數合格`
        : `${small.length} 個過小：${small.slice(0, 6).map((t) => `${t.label} ${t.w}×${t.h}`).join("；")}`);

    await page.close();
  }

  await browser.close();
  report();
})().catch((e) => { console.error("\n執行錯誤：", e.stack || e.message); process.exit(2); });

function report() {
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === null).length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`結果：${pass} 通過 / ${fail.length} 失敗${skipped ? ` / ${skipped} 略過` : ""}`);
  if (fail.length) {
    console.log(`\n失敗項（照 docs/TEST_CHECKLIST.md 的回報格式貼回群組即可）：`);
    for (const f of fail) console.log(`  ${f.id} ✗ ${f.name}`);
  }

  // 講清楚這支「沒有」測什麼——假裝測過比沒測更危險
  console.log(`\n本程式未涵蓋（要人或另一支腳本）：`);
  console.log(`  · 後端 API 行為與 AI 回答品質 → python3 scripts/verify_live.py`);
  console.log(`  · Golden Path 真的按下去（三方案→確認→成交）→ 人工，TEST_CHECKLIST D 段`);
  console.log(`  · 真實成交 E2E、Guardrails 攔截 → 人工，TEST_CHECKLIST G 段`);
  console.log(`  · 實機手感（iPhone 真的用手指按）→ 人工，issue #13`);
  console.log(`${"═".repeat(60)}`);
  process.exit(fail.length ? 1 : 0);
}
