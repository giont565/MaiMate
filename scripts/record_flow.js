/**
 * #8 主片（**新版產品動線**）自動錄影 390×844：
 *   welcome.html → onboarding(#/consent → #/profile 六題 → #/analyzing → #/profile-result)
 *   → home.html（行為健檢卡＋模組堆疊＋常駐輸入列）→ chat.html（Golden Path）
 *
 *   DEMO_BASE=https://d1z0776b4u2tmf.cloudfront.net node scripts/record_flow.js <輸出目錄>
 *
 * 與 scripts/record_demo.js 的關係：**兩支並存，不是取代**。
 *   record_demo.js  = 舊動線（index.html 單頁），v2/v3 成片與 DEMO_SUBTITLES.srt 對的是它的時間軸，
 *                     不要改它，那是新動線任何一環卡住時唯一還能立刻交片的備援。
 *   record_flow.js  = 新動線，五頁三種導覽機制（hash router／localStorage 守衛／sessionStorage 導覽信封）。
 *
 * ── 紅線：絕不按「確認賣出」 ────────────────────────────────────────────────
 * 那顆按鈕在**有 MAX 金鑰的環境**就是真錢真單、不可逆（07-31 #20720919534、08-01 #20727214652）。
 * 本檔三道防線，任何一道被改掉都會當場炸掉而不是安靜地花掉使用者的錢：
 *   ① 只 hover 不 click（見結尾）
 *   ② 自檢：原始碼裡出現「點確認鈕」的字樣就 throw（同 record_live_order.js 的做法）
 *   ③ 網路層攔截：POST /order 一律 abort。就算有人手滑點下去也送不出交易所。
 * 要錄「真的按下去」那一鏡，用 scripts/record_live_order.js（有頭瀏覽器、由人按）。
 *
 * 輸出 webm；轉 mp4：
 *   ffmpeg -i out.webm -vf "scale=780:1688:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4
 * ⚠ recordVideo.size 必須等於 viewport，寫成 2 倍只會在右下補灰邊（record_demo.js 實測踩過）。
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.DEMO_BASE || "https://d1z0776b4u2tmf.cloudfront.net";
const OUTDIR = process.argv[2] || ".";
const LINE = process.env.DEMO_LINE || "ETH 跌太多了，幫我全部賣掉！";
/* SKIP_ONBOARDING=1：只重錄 home→chat 那一段。用 smoke 腳本的既定做法一行帶過問卷
   （smoke_home.js:84、smoke_chat.js:82、smoke_demo_account.js:117-121、smoke_hostapp.js:31）：
   home.html?demo=STEADY_PLANNER 會建立完整的 consent／profile／analysisJob／profileResult，
   之後 goto chat.html 不會被守衛踢回 welcome.html。 */
const SKIP_ONBOARDING = process.env.SKIP_ONBOARDING === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 問卷 6 題的作答（值＝onboarding.js:94 QUESTIONS 的 opts[].v）。
   Q6 選 concise＝「成長陪跑」，與 DEMO_SCRIPT 開錄前檢查的預設模式徽章一致。 */
const ANSWERS = [
  ["exploring"],                                          // Q1 投資經驗（單選）
  ["longTermGrowth", "steadyHabit"],                      // Q2 投資目標（最多 2）
  ["mediumLong"],                                         // Q3 持有期間（單選）
  ["investigate"],                                        // Q4 波動反應（單選）
  ["newsToHoldings", "riskAlerts", "termExplain"],        // Q5 希望麥麥先做什麼（最多 3）
  ["concise"],                                            // Q6 說話方式（單選）＝成長陪跑
];

/** 捲到某個元素並定格。比 mouse.wheel(px) 穩：home.html 是動態模組堆疊，像素位移會漂。
 *  selector 可以是字串（取第一個）或已經 nth 過的 Locator。 */
async function hold(page, selector, ms) {
  const node = typeof selector === "string" ? page.locator(selector).first() : selector;
  await node.scrollIntoViewIfNeeded();
  await sleep(ms);
}

(async () => {
  // ── 防線②：這支腳本不得具備按下確認的能力 ──
  const src = fs.readFileSync(__filename, "utf8");
  if (/\.confirm\s+\.ok["'`]\s*\)\s*\.?\s*click|\bok\.click\(/.test(src)) {
    throw new Error("record_flow.js 不得點擊確認鈕——那一按必須是人做的，而且不在這支腳本裡");
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch();               // headless：沒有人可以手滑
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: OUTDIR, size: { width: 390, height: 844 } },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  });
  const page = await ctx.newPage();

  // ── 防線③：POST /order 一律不出網。只擋下單，不影響 /chat、/health、/market、/audit ──
  await page.route(/\/order(\?|$)/, (route) => {
    if (route.request().method() === "POST") {
      console.log("  🚫 攔下一次 POST /order——錄影腳本永遠不下單");
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  const t0 = Date.now();
  // 這些時間點就是旁白對軌用的依據，跑完貼給 narrate_*.sh 對時
  const mark = (s) => console.log(`  ${String((Date.now() - t0) / 1000).padStart(6)}s  ${s}`);

  if (!SKIP_ONBOARDING) {
    // ══ 鏡 1｜入口（Screen 1 welcome.html）══════════════════════════════════
    await page.goto(`${BASE}/welcome.html`, { waitUntil: "networkidle" });
    /* CTA 一開始是 disabled「載入中…」：welcome.js 打 /api/v1/maimate/entry-context，
       這支後端沒有這條路由（實測 404、0.6 秒），失敗即回退 MOCK_ENTRY。
       所以 entryState 恆為 READY_NEW_USER，CTA 永遠是「開始和麥麥認識彼此」→ #/consent。 */
    await page.waitForFunction(() => {
      const b = document.getElementById("btn-cta");
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    mark("鏡1 入口 welcome");
    await sleep(3200);
    await hold(page, "#btn-demo", 2600);   // 捲到「先看示範帳戶」，讓兩條入口都入鏡
    await page.locator("#btn-cta").scrollIntoViewIfNeeded();
    await sleep(800);
    await page.locator("#btn-cta").click();

    // ══ 鏡 2｜資料授權（Screen 2 onboarding.html#/consent）═══════════════════
    await page.waitForFunction(() => location.hash === "#/consent", null, { timeout: 30000 });
    mark("鏡2 資料授權");
    await sleep(3400);
    await hold(page, "#btn-consent", 2400);
    await page.locator("#btn-consent").click();
    /* onboarding.js:213 按下後先跑「正在建立安全的只讀連結⋯」→「✓ 資料已連結」，
       900ms 之後才換頁。那 0.9 秒正是這一鏡最好看的畫面，不要用 waitForTimeout 硬等，
       等 hash 換掉即可。 */
    await page.waitForFunction(() => location.hash === "#/profile", null, { timeout: 30000 });

    // ══ 鏡 3｜六題問卷（Screen 3）══════════════════════════════════════════
    mark("鏡3 問卷 Q1");
    for (let i = 0; i < ANSWERS.length; i++) {
      await page.waitForFunction((n) => {
        const p = document.getElementById("qprog");
        return p && p.textContent.trim().startsWith(String(n));
      }, i + 1, { timeout: 20000 });
      await sleep(i === 0 ? 2200 : 1500);             // 讓人讀得完題目
      for (const v of ANSWERS[i]) {
        await page.locator(`.chip[data-v="${v}"]`).click();
        await sleep(420);
      }
      await sleep(600);
      await page.locator("#btn-next").click();        // 第 6 題時這顆叫「看麥麥的整理」
    }
    // 摘要（onboarding.js:318 renderSummary，沒有換 hash，等 #summary.on）
    await page.waitForSelector("#summary.on", { timeout: 20000 });
    mark("鏡3 問卷摘要");
    await hold(page, "#sum-tags", 3200);
    await page.locator("#btn-finish").click();

    // ══ 鏡 4｜分析中（Screen 4 #/analyzing）════════════════════════════════
    await page.waitForFunction(() => location.hash === "#/analyzing", null, { timeout: 30000 });
    mark("鏡4 分析中（5 階段）");
    /* 五個階段各 650ms（investment-analysis.js:16 stageDurationMs），總長 3.25 秒，
       完成後 700ms 自動跳 #/profile-result（onboarding-analysis.js:145）。
       整段不到 4 秒，不要在這裡加 sleep，加了會錯過自動跳頁。 */
    await page.waitForFunction(() => location.hash === "#/profile-result", null, { timeout: 60000 });

    // ══ 鏡 5｜你的投資樣貌（Screen 5 #/profile-result）══════════════════════
    mark("鏡5 投資樣貌");
    await page.waitForSelector("#btn-profile-confirm", { timeout: 30000 });
    await sleep(3600);
    await hold(page, "#btn-profile-confirm", 2600);
    await page.locator("#btn-profile-confirm").click();   // 「這很像我，進入 MaiMate」
    await page.waitForURL(/home\.html/, { timeout: 30000 });
  } else {
    /* 只重錄 home→chat：用 smoke 腳本的既定 bootstrap，一行帶過整條 onboarding。 */
    await page.goto(`${BASE}/home.html?demo=STEADY_PLANNER`, { waitUntil: "networkidle" });
    mark("（SKIP_ONBOARDING）demo bootstrap 完成");
  }

  // ══ 鏡 6｜新首頁（Screen 6 home.html）════════════════════════════════════
  await page.waitForSelector(".bottom-nav", { timeout: 30000 });
  await page.waitForSelector("#home-content:not([hidden])", { timeout: 30000 });
  mark("鏡6 新首頁");
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(2400);
  await hold(page, '[data-module-id="module_health_score"]', 3600);   // 行為健檢：分數環＋2×2
  await hold(page, '[data-module-id="module_today_relevant"]', 3000); // 今天，什麼和你有關
  await hold(page, '[data-module-id="module_personalized_insights"]', 3000); // 麥麥幫你看到的事
  await hold(page, '[data-module-id="module_account_snapshot"]', 2600);

  // 常駐輸入列：打字 → 送出 → 換頁到 chat.html（home.js:1157 submitChat → 導覽信封）
  mark("鏡6 常駐輸入列打字");
  const homeInput = page.locator("#home-chat-input");
  await homeInput.scrollIntoViewIfNeeded();
  await homeInput.click();
  await homeInput.type(LINE, { delay: 110 });
  await sleep(700);
  await page.locator("#home-chat-submit").click();

  // ══ 鏡 7｜問麥麥 Golden Path（Screen 8 chat.html）═══════════════════════
  await page.waitForURL(/chat\.html/, { timeout: 30000 });
  /* chat.js:1000「預填但不自動送出」——問題會出現在 #q 裡，要自己按送出。
     這一拍在產品上是對的：使用者可以先改問題再送。 */
  await page.waitForFunction(() => {
    const q = document.getElementById("q");
    return q && q.value.trim().length > 0;
  }, null, { timeout: 20000 });
  mark("鏡7 問題已帶入 chat");
  await sleep(2200);
  await page.locator("#chat-send").click();

  mark("鏡7 等後端（實測 6–13 秒，chat.js 逾時 30 秒）");
  await page.locator(".scen").first().waitFor({ timeout: 120000 })
    .catch(() => { throw new Error("三方案卡沒出現——場地網路掉包或後端逾時，重跑一次"); });
  mark("鏡7 三方案卡已出現");

  /* 逾時保護真的踩到時 chat.js:678 會貼 GOLDEN_MOCK（寫死 ethtwd 的舊數字）冒充後端結果。
     畫面上唯一看得出來的是 #chat-offline 徽章。錄到那個就是廢片，當場停掉重錄。 */
  if (!(await page.locator("#chat-offline[hidden]").count())) {
    throw new Error("頂欄亮了「離線展示」——這一輪走的是 GOLDEN_MOCK 假數字，不能當主片，重跑");
  }

  await hold(page, ".card-ai", 3500);            // 定格：AI 回覆與反問
  await hold(page, ".scen", 3600);               // 定格：第一張（chat.js:441 給 .pick 藍框）先賣 25%
  await hold(page, page.locator(".scen").nth(2), 3400).catch(() => {}); // 第三張（先不動）
  mark("鏡7 三方案定格完成");

  /* 確認卡有兩種到達方式：後端同一輪就回 confirm（chat.js:693），或要再點一張卡。
     已經有卡就不要再點——多點一次會多送一輪 /chat，畫面上多出一段重複對話。 */
  if (!(await page.locator(".confirm").count())) {
    mark("鏡7 點第一張方案卡");
    await page.locator(".scen").first().click();
    await page.locator(".confirm").waitFor({ timeout: 120000 });
  }
  mark("鏡7 確認卡出現");
  await hold(page, ".confirm", 3000);

  // ── 防線①：只 hover，絕不 click ──
  const okBtn = page.locator(".confirm .ok");
  await okBtn.scrollIntoViewIfNeeded();
  await okBtn.hover();
  await sleep(4200);

  mark("收工");
  await ctx.close();                              // 關 context 才會寫出影片檔
  await browser.close();

  const vid = fs.readdirSync(OUTDIR).filter((f) => f.endsWith(".webm")).pop();
  console.log("✔ 影片：", `${OUTDIR}/${vid}`);
  console.log("  鏡 8 收尾另外錄：DEMO_BASE=" + BASE + " node scripts/record_outro.js <輸出目錄>");
})();
