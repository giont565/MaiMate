/* 首頁整合煙測（healthScore／marketWatch 兩個新模組）
 *
 * 這條線在補一個具體的洞：home.html 原本連 API_BASE 都沒有，home-service 打的
 * /api/v1/maimate/* 後端從來沒實作過，所以整個「最終成品」跑的全是 mocks/home.js
 * ——畫面完整、品牌到位，但沒有一筆真資料。這兩個模組是新線上第一批吃真後端的。
 *
 * 所以這支測的重點不只是「有沒有畫出來」，而是四件會靜默出錯的事：
 *   1. 真假資料要標示得出來 → live 說資料來源，demo 就明說是示範資料
 *   2. 首頁渲染不得排在 /health 後面 → 後端慢／掛掉時整頁不能卡在骨架畫面
 *   3. 抓不到 K 線就零張圖＋明說，不畫假 K 棒
 *   4. 新模組的文案不得踩 MM_HOME_PROHIBITED_NARRATIVE（不替使用者評等、貼標籤）
 *
 * 用法：npm run smoke:home:integration（自帶伺服器，離線可跑）
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

const HEALTH = {
  chase_index: { buy_above_ma_pct: 65.0, buy_total: 2350 },
  opportunity_cost: { total_missed_twd: 26598877 },
  realized_pnl: { total_realized_twd: 117482, loss_trades: 493, profit_trades: 981 },
  concentration: { peak_concentration: { top_pct: 98.6, month: "2025-12", top_currency: "twd" } },
  cash_flow_behavior: { withdrawals_after_7d_btc_drop_pct: 14.2, twd_withdrawal_count: 417 },
};

function makeBars(n = 48, base = 60000) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const up = i < n / 2;
    const open = base + (up ? i : n - i) * 10;
    const close = open + (up ? 8 : -8);
    rows.push({
      timestamp: 1785387600 + i * 3600,
      time_utc: "2026-07-30T05:00:00Z",
      time_taipei: `2026-07-30T${String(13 + (i % 10)).padStart(2, "0")}:00:00+08:00`,
      open, high: Math.max(open, close) + 5, low: Math.min(open, close) - 5, close, volume: 1.5,
    });
  }
  return rows;
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "home.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const ok = (m) => console.log(m);

// 路徑尾端錨在 `?` 或字串尾。貪心的萬用字元 glob（星星加斜線再接 health）會連
// health-core.js 一起攔下來當 API 回 JSON，瀏覽器只丟一個看不出原因的 SyntaxError。
const HEALTH_PATH = /\/health(\?|$)/;
const MARKET_PATH = /\/market(\?|$)/;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  try {
    /* ── 1. 純函式：health-core 的降級規矩 ────────────────────────────── */
    {
      const core = require(path.join(ROOT, "health-core.js"));
      const full = core.score(HEALTH);
      assert(full.ok && full.score >= 0 && full.score <= 100, "健康分算不出來");
      assert(full.factors.length === 3 && !full.partial, "三個子項齊全時不該標 partial");

      /* 缺子項要把權重攤到其餘，不是補 0——補 0 會讓「缺資料」看起來像「表現很差」。 */
      const noPnl = core.score({ chase_index: HEALTH.chase_index, cash_flow_behavior: HEALTH.cash_flow_behavior });
      assert(noPnl.ok && noPnl.partial && noPnl.factors.length === 2, "缺子項未攤權重");
      assert(noPnl.score > 0, `缺子項被當成 0 分：${noPnl.score}`);
      assert(/追高控制57%＋出金紀律43%/.test(noPnl.formula), `公式未反映攤權重：${noPnl.formula}`);

      assert(!core.score({}).ok, "一個子項都沒有時仍給了分數");
      assert(!core.realized({}).ok, "沒有 realized_pnl 卻回了損益");

      /* 缺欄位的格子給「—」，不是 0、也不是 NaN。 */
      const partialCards = core.cards({ chase_index: { buy_above_ma_pct: 65 } });
      assert(partialCards[0].value === "65%" && partialCards[1].value === "—" && partialCards[3].value === "—",
        `缺欄位未給破折號：${partialCards.map((c) => c.value).join("/")}`);
      assert(!partialCards.some((c) => /NaN|undefined|null/.test(c.value + c.label)), "卡片出現 NaN／undefined");

      /* 現金集中 ≠ 加密資產過度集中，標籤必須講得出幣別，否則 98.6% 會被反向誤讀。 */
      assert(core.cards(HEALTH)[2].label.includes("現金"), "TWD 集中未標示為現金");
      ok("1 health-core OK：攤權重／無子項不給分／缺欄位給「—」／現金集中標示正確");
    }

    /* ── 2. 純函式：market-core ───────────────────────────────────────── */
    {
      const core = require(path.join(ROOT, "market-core.js"));
      assert(core.parseTicker({ data: { last: 2091464.5 } }).price === 2091464.5, "ticker 讀不出價格");
      assert(!core.parseTicker({ data: {} }).ok, "沒有 last 卻回 ok");
      assert(!core.parseTicker({ data: { last: 0 } }).ok, "價格 0 應視為讀不到");
      assert(!core.parseTicker(null).ok, "null payload 未擋下");
      /* 首次載入沒有前值，不能閃一片綠——那是假的變化。 */
      assert(core.direction(undefined, 100) === "flat", "首次渲染就報漲跌");
      assert(core.direction(100, 101) === "up" && core.direction(101, 100) === "down", "漲跌方向錯");
      assert(core.validate(core.buildPayload({})), "預設 payload 自己驗不過");
      assert(!core.validate({ title: "x", markets: [] }), "空標的清單未擋下");
      ok("2 market-core OK：讀價／0 價視為無資料／首次不假報漲跌");
    }

    /* ── 3. 文案不得踩禁用詞（不替使用者評等、不貼標籤）──────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: "100" } } }));
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector(".health-card");

      const banned = await page.evaluate(() => {
        const list = ["投資健康分", "投資健康分數", "FOMO", "恐慌型", "衝動型", "保守型", "積極型", "高風險型"];
        const text = document.querySelector(".health-card").innerText
          + document.querySelector(".market-card").innerText;
        return list.filter((word) => text.includes(word));
      });
      assert(banned.length === 0, `新模組文案踩到禁用詞：${banned.join("、")}`);
      ok("3 文案 OK：健檢與行情兩張卡都沒有評等／貼標籤用語");
      await page.close();
    }

    /* ── 4. 健檢卡：真資料要標示得出來 ────────────────────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: "100" } } }));
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector(".health-card");
      /* /health 是背景載入的，真資料回來會走既有的 maimate:home-updated 重畫一次。 */
      await page.waitForSelector(".health-source:text-matches('資料來源')", { timeout: 8000 });

      assert(!errors.length, `首頁有 JS 錯誤：${errors.join("；")}`);
      const cells = await page.locator(".health-cell b").allInnerTexts();
      assert(cells.join("|") === "65%|2,660萬|98.6%|14.2%", `四格數字不對：${cells.join("|")}`);
      const ring = await page.locator(".health-ring-inner b").innerText();
      assert(/^\d{1,3}$/.test(ring), `圓環分數不是整數：${ring}`);
      const pnl = await page.locator(".health-pnl").innerText();
      assert(pnl.includes("+NT$117,482") && pnl.includes("981勝/493負"), `已實現損益不對：${pnl}`);
      assert((await page.locator(".health-formula").first().innerText()).includes("追高控制40%"),
        "公式沒印在卡上（分數必須可追溯，不能是黑箱評等）");
      ok("4 健檢卡 OK：四格數字／圓環／已實現損益／公式上卡，來源標示為線上資料");
      await page.close();
    }

    /* ── 5. 後端掛掉：畫面照樣出來，而且明說是示範資料 ────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      /* 不 fulfill、也不 abort——直接讓請求懸著，模擬場地那種「ping 不掉但 TLS 被 reset」。
         首頁若把渲染排在 /health 後面，這裡就會卡在骨架畫面出不來。 */
      await page.route(HEALTH_PATH, () => {});
      await page.route(MARKET_PATH, (r) => r.abort());
      const started = Date.now();
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector("#home-content:not([hidden])", { timeout: 6000 });
      await page.waitForSelector(".health-card");
      const elapsed = Date.now() - started;
      assert(elapsed < 6000, `後端無回應時首頁被拖住 ${elapsed}ms`);

      const source = await page.locator(".health-source").innerText();
      assert(source.includes("示範資料"), `後端掛掉卻沒說是示範資料：${source}`);
      /* 這是整條線的起點：不要再有「畫面全都正常但資料是假的」。 */
      assert(!source.includes("資料來源"), "示範資料被標成線上資料");
      ok(`5 降級 OK：/health 無回應時 ${elapsed}ms 內畫出首頁，並明示為示範資料`);
      await page.close();
    }

    /* ── 6. 行情列：展開 K 線、互斥、週期切換 ─────────────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      let lastKlineUrl = "";
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => {
        const url = r.request().url();
        if (url.includes("kind=kline")) {
          lastKlineUrl = url;
          const m = new URL(url).searchParams.get("market");
          return r.fulfill({ json: { kind: "kline", market: m, period_minutes: 60, data: makeBars() } });
        }
        const m = new URL(url).searchParams.get("market");
        return r.fulfill({ json: { kind: "ticker", market: m, data: { last: m === "dogetwd" ? 2.3509 : 100.5 } } });
      });
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector(".market-card");

      /* 行情列就地更新，且 DOGE 不能被截成 2.35（與 index.html 的 fmt() 同語意）。 */
      await page.waitForSelector('.market-row[data-market="dogetwd"] .market-price:text-matches("2.3509")', { timeout: 8000 });

      await page.locator('.market-row[data-market="btctwd"] .market-tick').click();
      await page.waitForSelector('.market-row[data-market="btctwd"] svg');
      const rects = await page.locator('.market-row[data-market="btctwd"] svg rect').count();
      const lines = await page.locator('.market-row[data-market="btctwd"] svg line').count();
      assert(rects === 48 && lines === 48, `K 棒數不對：${rects} 實體／${lines} 影線`);
      const bad = await page.evaluate(() => [...document.querySelectorAll(".market-card svg rect")]
        .some((r) => ["x", "y", "width", "height"].some((a) => !Number.isFinite(Number(r.getAttribute(a))))));
      assert(!bad, "K 棒座標出現 NaN");

      /* 一次只開一列：K 線很高，兩張以上會把其他模組推出視窗。 */
      await page.locator('.market-row[data-market="ethtwd"] .market-tick').click();
      await page.waitForSelector('.market-row[data-market="ethtwd"] svg');
      assert(await page.locator('.market-row[data-market="btctwd"] .market-panel[hidden]').count() === 1,
        "展開第二列時第一列沒有收起來");

      await page.locator('.market-row[data-market="ethtwd"] .market-period[data-period="1440"]').click();
      await page.waitForFunction(() => true);
      await page.waitForTimeout(300);
      assert(lastKlineUrl.includes("period=1440"), `週期切換沒送出：${lastKlineUrl}`);
      ok("6 行情 OK：48 根無 NaN／互斥展開／週期送出 1440／DOGE 價格不被截斷");
      await page.close();
    }

    /* ── 7. 抓不到 K 線：零張圖＋明說，不畫假 K 棒 ────────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => {
        const url = r.request().url();
        if (url.includes("kind=kline")) return r.abort();
        return r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: 100.5 } } });
      });
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector(".market-card");
      await page.locator('.market-row[data-market="btctwd"] .market-tick').click();
      /* 等錯誤狀態，不要把「載入中…」誤讀成錯誤訊息。 */
      await page.waitForSelector(".market-empty:not(.loading)");
      assert(await page.locator(".market-card svg").count() === 0, "取不到資料卻仍畫了 K 線");
      assert((await page.locator(".market-empty:not(.loading)").innerText()).includes("取不到"),
        "沒有明說取不到 K 線資料");
      ok("7 誠實 OK：K 線取不到時零張圖＋明說，不畫假 K 棒");
      await page.close();
    }

    /* ── 8. 熱區 ≥44px（Apple HIG 最小觸控目標）──────────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => {
        const url = r.request().url();
        if (url.includes("kind=kline")) {
          return r.fulfill({ json: { kind: "kline", market: "btctwd", period_minutes: 60, data: makeBars() } });
        }
        return r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: 100.5 } } });
      });
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector(".market-card");
      await page.locator('.market-row[data-market="btctwd"] .market-tick').click();
      await page.waitForSelector(".market-period");

      const small = await page.evaluate(() => {
        const sel = ".market-tick, .market-period, .health-card .module-action";
        return [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || "").trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) };
        }).filter((x) => x.w < 44 || x.h < 44);
      });
      assert(small.length === 0, `熱區小於 44px：${JSON.stringify(small)}`);
      ok("8 熱區 OK：行情列、週期鈕、健檢卡按鈕皆 ≥44px");
      await page.close();
    }

    /* ── 9. sw-assets 有收錄三支 core（漏了會離線靜默壞掉）─────────────── */
    {
      const assets = fs.readFileSync(path.join(ROOT, "sw-assets.js"), "utf8");
      ["kline-core.js", "market-core.js", "health-core.js"].forEach((f) => {
        assert(assets.includes(`"${f}"`), `sw-assets.js 沒有收錄 ${f}——離線會靜默壞掉，記得跑 npm run build:sw`);
      });
      ok("9 SW 清單 OK：三支 core 都在快取名單內");
    }

    /* ── 10. index.html 與 home.html 的健檢用語必須逐字相同 ──────────────
     * 兩頁現在吃同一顆 health-core，這支是在防「有人為了排版在其中一頁手改字串」。
     * 同一個健檢在兩個畫面講成兩套說法，使用者會以為那是兩件不同的事。 */
    {
      const grab = async (url, sel) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
        await page.route(MARKET_PATH, (r) => r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: "100" } } }));
        await page.goto(url);
        await page.waitForSelector(sel.ready);
        const out = await page.evaluate((s) => ({
          cards: [...document.querySelectorAll(s.card)].map((e) => e.textContent.trim()),
          notes: [...document.querySelectorAll(s.note)].map((e) => e.textContent.trim()),
          score: (document.querySelector(s.score) || {}).textContent,
        }), sel);
        await page.close();
        return out;
      };

      const idx = await grab(`${base}/index.html`, {
        ready: "#hero .ring", card: "#health .card .l", note: "#insights .insight", score: "#hero .ring i b",
      });
      const home = await grab(`${base}/home.html?demo=STEADY_PLANNER`, {
        ready: ".health-card", card: ".health-cell span", note: ".health-insight", score: ".health-ring-inner b",
      });

      assert(idx.cards.length === 4 && home.cards.length === 4,
        `四格數量不符：index ${idx.cards.length}／home ${home.cards.length}`);
      idx.cards.forEach((label, i) => {
        assert(label === home.cards[i], `第 ${i + 1} 格標籤兩頁不一致：\n  index：${label}\n  home ：${home.cards[i]}`);
      });
      assert(idx.notes.length === home.notes.length, "insight 句數兩頁不一致");
      idx.notes.forEach((text, i) => {
        assert(text === home.notes[i], `第 ${i + 1} 句 insight 兩頁不一致：\n  index：${text}\n  home ：${home.notes[i]}`);
      });
      /* 同一份 /health 在兩頁必須算出同一個分數——這是共用 core 的重點。 */
      assert(idx.score.trim() === home.score.trim(),
        `健檢分兩頁不一致：index ${idx.score}／home ${home.score}`);
      ok(`10 兩頁用語一致 OK：四格標籤／${idx.notes.length} 句 insight／健檢分 ${idx.score.trim()} 皆逐字相同`);
    }

    /* ── 11. 年度報酬純函式（return-core）──────────────────────────────
     * 模組還沒接上畫面——2026 的年初市值與 2025 的逐月淨流都要等 B 包（見 issue）。
     * 但算法先測起來放：等資料一到就只剩接線，不必在決賽日現寫財務數學。 */
    {
      const core = require(path.join(ROOT, "return-core.js"));

      /* 年初 100 萬、年中入金 50 萬、年末 170 萬。真正賺的是 20 萬，
         天真 ROI 卻會報 +70%——差的 54% 全是「錢搬進來」不是「錢變多」。 */
      const r = core.modifiedDietz({
        start: "2026-01-01", end: "2026-12-31",
        startValueTwd: 1000000, endValueTwd: 1700000,
        flows: [{ date: "2026-07-01", amountTwd: 500000 }],
      });
      assert(r.ok && Math.abs(r.ratio - 0.1598) < 0.001, `Modified Dietz 算錯：${r.ratio}`);
      assert(r.ratio < (1700000 - 1000000) / 1000000, "報酬率沒有把入金剔除");

      /* 沒有出入金時應退化成單純的市值變化。 */
      const plain = core.modifiedDietz({ start: "2026-01-01", end: "2026-12-31",
        startValueTwd: 1000000, endValueTwd: 1200000, flows: [] });
      assert(Math.abs(plain.ratio - 0.2) < 1e-9, `無流量時算錯：${plain.ratio}`);

      /* 未滿一年不得年化——那是外推不是事實。 */
      const ytd = core.summarize({ year: 2026, source: "live", complete: false,
        start: "2026-01-01", end: "2026-08-01", startValueTwd: 1000000, endValueTwd: 1100000, flows: [] });
      assert(ytd.ok && ytd.annualized === null, "未滿一年卻給了年化數字");
      assert(ytd.label === "年初至今", `當年度標籤錯：${ytd.label}`);
      assert(!core.annualize(0.1, 213).ok, "七個月的報酬被年化了");
      assert(core.annualize(0.1, 730).ok, "滿兩年卻不給年化");

      /* 分母 ≤ 0 不能硬給數字；期間外的流量要擋下來而不是默默丟掉。 */
      assert(!core.modifiedDietz({ start: "2026-01-01", end: "2026-12-31",
        startValueTwd: 0, endValueTwd: 100, flows: [{ date: "2026-06-01", amountTwd: -50 }] }).ok,
      "分母 ≤ 0 仍給了報酬率");
      assert(core.modifiedDietz({ start: "2026-01-01", end: "2026-06-30",
        startValueTwd: 100, endValueTwd: 100, flows: [{ date: "2026-09-01", amountTwd: 10 }] }).reason
        === "FLOW_OUT_OF_RANGE", "期間外的出入金沒被擋下");

      /* 逐期串接：兩個各 +10% 的月份要得到 +21%，不是 +20%。 */
      const twr = core.chain([
        { start: "2026-01-01", end: "2026-02-01", startValueTwd: 100, endValueTwd: 110, flows: [] },
        { start: "2026-02-01", end: "2026-03-01", startValueTwd: 110, endValueTwd: 121, flows: [] },
      ]);
      assert(twr.ok && Math.abs(twr.ratio - 0.21) < 1e-9, `TWR 串接錯：${twr.ratio}`);
      /* 任一期算不出來就整條不給——少串一期不是近似，是算錯。 */
      assert(!core.chain([{ start: "2026-01-01", end: "2026-02-01", endValueTwd: 110 }]).ok,
        "缺期初市值仍串出了 TWR");

      /* 缺什麼要講得出來，不能只說「資料不足」。 */
      assert(core.reasonText("NO_START_VALUE") === "缺年初市值", "缺漏原因沒有具體說明");
      ok("11 return-core OK：剔除入金／未滿一年不年化／分母≤0 不給數字／TWR 串接");
    }

    /* ── 12. 三種模式在三個畫面必須同名同序 ────────────────────────────
     * index.html 的模式徽章（app.js MODE_LABELS）、home.html 的版面切換、
     * onboarding 問卷 Q6，講的是同一件事「麥麥怎麼跟你說話」。原本 index 叫
     * 安心白話／成長陪跑／專業效率，home 與問卷叫陪我慢慢看懂／先告訴我重點／
     * 給我更多數據——同一個設定在三個畫面三套名字，使用者會以為是三件事。 */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: HEALTH }));
      await page.route(MARKET_PATH, (r) => r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: "100" } } }));

      await page.goto(`${base}/index.html`);
      await page.waitForSelector("#mode-badge");
      /* app.js 頂層的 const 不掛在 window 上，但在同一個 global lexical scope
         裡查得到名字，所以 evaluate 可以直接讀。 */
      const modes = await page.evaluate(() => MODE_ORDER.map((k) => MODE_LABELS[k]));

      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector("#home-style-badge:not([hidden])");
      /* home 的徽章是循環切換，所以要點三下才看得完整組標籤。
         從目前這一個開始收集，繞一圈回到原點，順序必須和 index 的 MODE_ORDER 一致。 */
      const badge = page.locator("#home-style-badge");
      const start = await badge.textContent();
      const cycle = [start.trim()];
      for (let i = 0; i < 2; i++) {
        await badge.click();
        await page.waitForFunction(
          (prev) => document.getElementById("home-style-badge").textContent.trim() !== prev,
          cycle[cycle.length - 1]
        );
        cycle.push((await badge.textContent()).trim());
      }
      await page.close();

      assert(modes.length === 3 && cycle.length === 3,
        `模式數量不是三個：index ${modes.length}／home ${cycle.length}`);
      assert(new Set(cycle).size === 3, `home 徽章循環有重複：${cycle.join("／")}`);
      /* 兩邊起點不一定相同（home 跟著問卷答案），所以比對的是「同一組標籤、同一個
         循環順序」，而不是逐位相等。 */
      const from = modes.indexOf(cycle[0]);
      assert(from >= 0, `home 的「${cycle[0]}」不在 index 的模式清單裡：${modes.join("／")}`);
      cycle.forEach((label, i) => {
        const expected = modes[(from + i) % modes.length];
        assert(label === expected,
          `第 ${i + 1} 個模式兩頁不同：\n  index.html：${expected}\n  home.html ：${label}`);
      });

      /* 問卷 Q6 是使用者第一次選這個設定的地方，也要同名。 */
      const q6 = fs.readFileSync(path.join(ROOT, "onboarding.js"), "utf8")
        .match(/id: "communicationStyle"[\s\S]*?\]\s*\}/)[0];
      modes.forEach((label) => {
        assert(q6.includes(`l: "${label}"`), `問卷 Q6 缺少「${label}」選項（三個畫面必須同名）`);
      });
      ok(`12 模式同名 OK：${modes.join("／")} 在 index、home、問卷 Q6 三處一致`);
    }

    /* ── 13. 持倉來源：/health 的 holdings_snapshot 要真的蓋過本機快照 ──────
     * mocks/account.js 裡的 holdingsSnapshot 是 /health 報告的靜態複本（數字逐位
     * 相同），所以「有沒有走真資料」用線上那份是看不出來的——兩邊長得一樣。
     * 這裡故意餵一份和快照完全不同的報告：真的有接線就會顯示 BTC 70%，
     * 還在吃本機快照就會顯示現金 98.6%。
     *
     * 這條擋的是「不會報錯的失敗」：precompute 重跑後 /health 變了、
     * mocks/account.js 沒變，新 UI 會安靜地顯示過期數字而畫面完全正常。 */
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const shifted = Object.assign({}, HEALTH, {
        holdings_snapshot: {
          asOf: "2026-06-30",
          method: "各幣最後成交價估值",
          holdings: [
            { currency: "btc", pct: 70, value_twd: 700000 },
            { currency: "twd", pct: 20, value_twd: 200000 },
            { currency: "eth", pct: 10, value_twd: 100000 },
          ],
        },
      });
      await page.route(HEALTH_PATH, (r) => r.fulfill({ json: shifted }));
      await page.route(MARKET_PATH, (r) => r.fulfill({ json: { kind: "ticker", market: "btctwd", data: { last: "100" } } }));
      await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
      await page.waitForSelector("#account-snapshot-grid");
      const snapshot = await page.evaluate(
        () => document.getElementById("account-snapshot-grid").innerText
      );
      await page.close();

      assert(snapshot.includes("BTC"),
        `最大持有沒有跟著 /health 走（仍是本機快照？）：\n${snapshot}`);
      assert(!snapshot.includes("98.6"),
        `畫面仍顯示本機快照的 98.6%，表示 /health 沒有生效：\n${snapshot}`);
      assert(/70(\.0)?%/.test(snapshot), `占比未反映 /health 的 70%：\n${snapshot}`);
      ok("13 持倉來源 OK：/health 的 holdings_snapshot 蓋過 mocks/account.js 的靜態複本");
    }

    console.log("全部通過 ✅");
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
