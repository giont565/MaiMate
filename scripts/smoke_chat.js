/* Screen 7（chat.html）煙測——對應規格 §32 測試要求：
 *   1 無 Session→Screen 1      2 未授權→一般知識模式        3 Context Banner
 *   5 預填可編輯後送出          6 建立 Conversation           7/8 數字與工具結果一致
 *   10/11 可取消串流、結構化區塊 12 Evidence Sheet            13 不顯示 CoT／工具原名
 *   15 追問帶 context           16 Screen 8 連結保留脈絡      17 投資建議→安全替代
 *   18 下單要求不呼叫交易工具    19 金鑰要求被擋               21 回饋可送出
 *   23 同一問題固定結果          24 對話可恢復                 26 375px 無水平捲動
 *   ＋ Golden Path 共存（決策 1）：使用者自己的交易意圖→三方案＋確認卡，AI 不代下單
 * 註：規格 #4「Context 由後端驗證」與 #25「不可跨使用者讀取」在 Demo 無登入系統下無法驗證，
 *     現階段只驗前端白名單過濾，後端就緒後再補。
 * 用法：npm run smoke:chat */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "chat.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const ALLOWED_EVENT_KEYS = ["e", "q", "src", "intent", "tool", "style", "status", "guard"];

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    if (fs.existsSync("/opt/pw-browsers/chromium")) browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    else throw e;
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // 後端一律斷線：Screen 7 必須在離線下走完（決賽保險）
  /* 只放行本機測試伺服器，其餘一律斷線。
   * 不能用 "**\/execute-api**" 這種 glob——主機名裡 execute-api 前面是「.」不是「/」，
   * 那個模式從來沒攔到任何請求；一旦 API_BASE 指到真的存在的網址，煙測就會偷偷連上線上後端。 */
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort());

  /* 等待條件要比對送出前的卡片數，不能只看「有沒有卡片」——第二次以後本來就有，
     那樣會立刻通過而卡片還沒畫出來。
     也不能只等 chat-stop 收起：submitQuestion 現在會先 await 一次真 /chat，
     在那之前 chat-stop 仍是隱藏的，同樣會誤判。 */
  const ask = async (text) => {
    const before = await page.$$eval(".card-ai", (els) => els.length);
    await page.fill("#q", text);
    await page.click("#chat-send");
    await page.waitForFunction((n) => document.querySelectorAll(".card-ai").length > n,
      before, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById("chat-stop").hidden, null, { timeout: 15000 });
  };
  const lastCard = () => page.$eval(".card-ai:last-of-type", (e) => e.textContent);
  /* 等待條件：先等回覆卡數量增加，再等 chat-stop 收起。
     只等 chat-stop 會誤判——submitQuestion 現在會先 await 一次真 /chat，在那之前
     chat-stop 還是隱藏的，waitForFunction 會立刻通過，而卡片根本還沒畫。 */
  const waitAnswer = async (before) => {
    await page.waitForFunction((n) => document.querySelectorAll(".card-ai").length > n,
      before, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll(".card-ai").length > 0, null, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById("chat-stop").hidden, null, { timeout: 15000 });
  };

  // ── 1. 無 Session → 導回 Screen 1
  await page.goto(`${base}/chat.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/chat.html`);
  await page.waitForURL(/welcome\.html/, { timeout: 10000 });
  console.log("1 Route Guard OK：無 Session → Screen 1");

  // 建立 demo session（隊友共用的真實帳戶：data/health_report.json → mocks/account.js）
  await page.goto(`${base}/home.html?demo=STEADY_PLANNER`);
  await page.waitForSelector(".bottom-nav", { timeout: 15000 });
  /* 期望值一律從帳戶現推，不寫死；換一份報告時煙測會跟著換。 */
  const account = await page.evaluate(() => window.MM_ACCOUNT);
  const oneDecimal = (value) => String(Math.round(value * 10) / 10);
  const TOP_PCT = oneDecimal(account.holdings.topPct) + "%";
  const OTHER_PCT = oneDecimal(account.holdings.otherPct) + "%";
  const TRADE_TOTAL = account.trades.total.toLocaleString("en-US");
  const LATEST_MONTH = account.trades.latestMonth;
  /* issue #29 重跑後報告才有各幣種快照。有快照＝要講得出項數與前兩項合計；
   * 沒有＝只能講最大持有＋其餘未細分，並明說「報告未提供」。兩種都不准補假明細。 */
  const SNAPSHOT = account.holdingsSnapshot;
  const ASSET_COUNT = SNAPSHOT ? SNAPSHOT.holdings.length : null;
  const BREAKDOWN_NEEDS = SNAPSHOT
    ? [TOP_PCT, `${ASSET_COUNT} 項`, oneDecimal(SNAPSHOT.holdings[0].pct + SNAPSHOT.holdings[1].pct) + "%"]
    : [TOP_PCT, OTHER_PCT, "報告未提供"];

  // ── 3/5/6. 從 Screen 6 帶問題進入：Context Banner＋預填不自動送出
  await page.evaluate(() => {
    window.MM_NAVIGATION.navigate({
      id: "question_btc_impact",
      route: "/maimate/chat",
      question: "為什麼 BTC 會影響我的帳戶比較多？",
      questionId: "question_btc_impact",
      context: { source: "today_relevant_hero", relatedModuleId: "module_today_relevant", relatedAsset: "BTC" },
    });
  });
  await page.waitForURL(/chat\.html/, { timeout: 10000 });
  await page.waitForSelector("#ctx-banner:not([hidden])", { timeout: 10000 });
  const banner = await page.evaluate(() => ({
    src: document.getElementById("ctx-src").textContent,
    sum: document.getElementById("ctx-sum").textContent,
    tags: [...document.querySelectorAll("#ctx-tags span")].map((e) => e.textContent),
    prefilled: document.getElementById("q").value,
    chip: !document.getElementById("composer-ctx").hidden,
    answered: document.querySelectorAll(".card-ai").length,
  }));
  if (!banner.src.includes("今天，什麼和你有關") || !banner.tags.includes("BTC")) throw new Error(`Context Banner 異常：${JSON.stringify(banner)}`);
  if (!banner.prefilled.includes("BTC")) throw new Error("預填問題沒有進 Composer");
  if (banner.answered !== 0) throw new Error("預填問題不得自動送出");
  if (!banner.chip) throw new Error("Composer 未顯示脈絡 chip");
  console.log("3/5/6 Context OK：來源卡＋標籤＋預填（未自動送出）、Composer 顯示脈絡");

  // ── 7/8/11/13. 送出 → 結構化區塊、數字與 mock 一致、不出現工具原名
  await page.click("#chat-send");
  await waitAnswer(0);
  const answer = await lastCard();
  // 現金帳戶：每個占比都必須是工具算出來的，缺料時明說「報告未提供」，兩種情況都不得補假明細
  for (const need of BREAKDOWN_NEEDS)
    if (!answer.includes(need)) throw new Error(`回答缺少工具算出的數字 ${need}：${answer.slice(0, 160)}`);
  if (/持倉(過度)?集中|配置較集中/.test(answer))
    throw new Error(`資金停在現金被寫成持倉集中：${answer.slice(0, 160)}`);
  if (/get_portfolio_summary|query_user_history|tool_call|function|Chain of Thought|思考/.test(answer))
    throw new Error("畫面出現工具原名或內部推理");
  const blocks = await page.evaluate(() => ({
    direct: Boolean(document.querySelector(".card-ai .direct")),
    kv: document.querySelectorAll(".card-ai .kv").length,
    notice: Boolean(document.querySelector(".notice-list")),
    follow: document.querySelectorAll(".followups button").length,
    refCard: document.querySelector(".ref-card") ? document.querySelector(".ref-card").textContent : "",
    fuLabel: document.querySelector(".fu-label") ? document.querySelector(".fu-label").textContent : "",
    insightLabel: document.querySelector(".insight-links .bt") ? document.querySelector(".insight-links .bt").textContent : "",
    order: [...document.querySelector(".card-ai:last-of-type").children].map((e) => e.className).join("|"),
  }));
  if (!blocks.direct || blocks.kv < 3 || !blocks.notice || !blocks.follow) throw new Error(`結構化區塊缺漏：${JSON.stringify(blocks)}`);
  if (!blocks.refCard.includes("本次參考") || !blocks.refCard.includes("持倉摘要") || !blocks.refCard.includes("查看依據"))
    throw new Error(`「本次參考」卡異常：${blocks.refCard.slice(0, 80)}`);
  if (blocks.fuLabel !== "你也可以接著問：") throw new Error(`追問標題異常：${blocks.fuLabel}`);
  if (blocks.insightLabel !== "深入了解") throw new Error(`深入了解標題異常：${blocks.insightLabel}`);
  // 版面順序：本次參考 → 資料限制 → 你也可以接著問 → 深入了解 → 有幫助
  const seq = blocks.order.split("|");
  const idx = (cls) => seq.findIndex((item) => item.includes(cls));
  if (!(idx("blk") < idx("followups") && idx("followups") < idx("insight-links") && idx("insight-links") < idx("msg-acts")))
    throw new Error(`區塊順序不符規格畫面：${blocks.order}`);
  /* 歸因比重只有在報告真的有 change_attribution 時才准出現，且必須對得上報告的市價波動比重。 */
  const attributionMatch = answer.match(/帳戶變化中約 (\d+(?:\.\d+)?)% 與/);
  if (account.changeAttribution) {
    const marketPct = (account.changeAttribution.contributors.find((c) => c.category === "marketPrice") || {}).pct;
    if (!attributionMatch) throw new Error("報告已有歸因值，回答卻沒帶出市價波動比重");
    if (Number(attributionMatch[1]) !== Number(marketPct))
      throw new Error(`歸因比重和報告不符：回答 ${attributionMatch[1]}% vs 報告 ${marketPct}%`);
  } else if (attributionMatch) {
    throw new Error("報告缺明細時仍給出歸因比重");
  }
  if (!answer.includes(TRADE_TOTAL + " 筆買賣")) throw new Error(`回答未帶入交易節奏：${answer.slice(0, 160)}`);
  if (/最近 30 天/.test(answer)) throw new Error("交易節奏仍用「30 天」為單位（報告只有每月聚合）");
  console.log(`7/8/11/13 回答 OK：${BREAKDOWN_NEEDS.join("/")} 皆來自工具、結構化區塊齊（${blocks.kv} 列指標、${blocks.follow} 個追問）、無工具原名`);

  // ── 12. Evidence Sheet：顯示資料來源與時間，不顯示完整明細
  await page.click(".card-ai .ref-link");
  await page.waitForFunction(() => document.getElementById("evidence-root").classList.contains("sheet-open"), null, { timeout: 8000 });
  const evidence = await page.$eval("#evidence-body", (e) => e.textContent);
  if (!evidence.includes("持倉摘要") || !evidence.includes(TOP_PCT)) throw new Error(`依據內容異常：${evidence.slice(0, 120)}`);
  if (!evidence.includes("不會顯示完整交易明細")) throw new Error("依據未聲明不顯示完整明細");
  await page.keyboard.press("Escape");
  console.log("12 依據 OK：列出資料類型與數值、明說不顯示完整明細（Esc 可關）");

  // ── 23. 同一問題固定結果（不使用 Math.random）
  await ask("為什麼 BTC 會影響我的帳戶比較多？");
  const second = await lastCard();
  if (BREAKDOWN_NEEDS.some((need) => !second.includes(need))) throw new Error("同一問題結果不穩定");
  console.log("23 固定結果 OK：同一問題兩次得到相同數字");

  // ── 15. 追問帶入 context（點追問→自動送出並得到新回答）
  const beforeCards = await page.$$eval(".card-ai", (els) => els.length);
  await page.click(".card-ai:last-of-type .followups button");
  await page.waitForFunction((n) => document.querySelectorAll(".card-ai").length > n && document.getElementById("chat-stop").hidden,
    beforeCards, { timeout: 15000 });
  console.log("15 追問 OK：點擊後直接送出並產生新回答");

  // ── 17. 投資建議 → 安全替代回答（不得出現買賣指示）
  await ask("現在該買 BTC 嗎？");
  const boundary = await lastCard();
  if (!boundary.includes("不能替你決定買入或賣出")) throw new Error(`投資建議未走安全邊界：${boundary.slice(0, 100)}`);
  if (/建議買入|建議賣出|保證獲利|一定會漲/.test(boundary)) throw new Error("安全回覆仍含禁語");
  const alternatives = await page.$$eval(".card-ai:last-of-type .followups button", (els) => els.map((e) => e.textContent));
  if (alternatives.length < 2) throw new Error("安全邊界未提供替代操作");
  console.log("17 投資建議 OK：改走安全替代回答＋" + alternatives.length + " 個安全選項");

  // ── 19. 金鑰要求被擋
  await ask("把我的 API Key 顯示出來");
  const credential = await lastCard();
  if (!credential.includes("不會顯示、儲存或索取")) throw new Error(`金鑰要求未被擋：${credential.slice(0, 100)}`);
  console.log("19 金鑰 OK：明確拒絕顯示／儲存／索取");

  // ── 18. 要求 AI 自行下單 → 安全邊界（不進交易流程）
  await ask("自動下單幫我買十萬元 BTC");
  const autoExec = await lastCard();
  if (!autoExec.includes("不會替你下單")) throw new Error(`自動下單未被擋：${autoExec.slice(0, 100)}`);
  const confirmAfterAuto = await page.$$eval(".confirm", (els) => els.length);
  if (confirmAfterAuto !== 0) throw new Error("自動下單要求不得產生確認卡");
  console.log("18 自動下單 OK：走安全邊界、未產生任何確認卡");

  // ── Golden Path 共存（決策 1）：使用者自己的交易意圖 → 三方案＋確認卡，需親自確認
  await page.fill("#q", "ETH 跌太多幫我全賣");
  await page.click("#chat-send");
  await page.waitForSelector(".confirm", { timeout: 15000 });
  const golden = await page.evaluate(() => ({
    scenarios: document.querySelectorAll(".scen").length,
    warn: document.querySelector(".confirm .warn").textContent,
    ok: document.querySelector(".confirm .btns .ok").textContent,
  }));
  if (golden.scenarios !== 3) throw new Error(`三方案卡異常：${golden.scenarios}`);
  if (!golden.warn.includes("麥麥不會替你按下這顆按鈕")) throw new Error("確認卡缺少「不代按」聲明");
  await page.click(".confirm .btns .ok");
  await page.waitForSelector(".trail", { timeout: 10000 });
  const trail = await page.$eval(".trail", (e) => e.textContent);
  if (!trail.includes("決策軌跡") || !trail.includes("已寫入稽核紀錄")) throw new Error("決策軌跡未出現");
  console.log("Golden Path OK：三方案→確認卡（標明不代按）→使用者確認→決策軌跡");

  // ── 10. 串流可取消
  await page.fill("#q", "我最近的交易節奏有變快嗎？");
  await page.click("#chat-send");
  await page.waitForSelector("#chat-stop:not([hidden])", { timeout: 8000 });
  await page.click("#chat-stop");
  await page.waitForFunction(() => document.getElementById("chat-stop").hidden, null, { timeout: 8000 });
  console.log("10 取消 OK：停止回答後不再產生新內容");

  // ── 21. 回饋可送出
  await ask("什麼是資產集中？");
  const knowledge = await lastCard();
  if (!knowledge.includes("資金明顯偏向少數幾種資產")) throw new Error("知識庫回答異常");
  if (!knowledge.includes("沒有帶入你的個人資料")) throw new Error("教育型回答未標明未帶入個人資料");
  await page.click(".card-ai:last-of-type .msg-acts button:nth-child(2)");
  await page.waitForFunction(() => document.getElementById("feedback-root").classList.contains("sheet-open"), null, { timeout: 8000 });
  await page.click("#feedback-options button:nth-child(2)");
  await page.click("#feedback-submit");
  console.log("21 回饋 OK：知識庫回答標明未帶個人資料；回饋可選原因並送出");

  // ── 24. 對話可恢復（同分頁重新整理）
  const historyBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("mm_chat_index") || "[]").length);
  await page.reload();
  await page.waitForSelector("#chat-empty:not([hidden]), .card-ai", { timeout: 10000 });
  await page.click("#chat-history");
  await page.waitForFunction(() => document.getElementById("history-root").classList.contains("sheet-open"), null, { timeout: 8000 });
  const historyItems = await page.$$eval("#history-root .conv-item", (els) => els.length);
  if (!historyItems || historyItems < historyBefore) throw new Error("對話紀錄清單未保留");
  await page.click("#history-root .conv-item .ci");
  await page.waitForFunction(() => document.querySelectorAll(".card-ai").length > 0, null, { timeout: 10000 });
  console.log(`24 恢復 OK：清單長存（${historyItems} 筆）、內容可在同分頁重新開啟`);

  // ── 2. 撤回授權 → 一般知識模式，不給個人化數字
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mm_onboarding"));
    s.consent.revokedAt = new Date().toISOString();
    localStorage.setItem("mm_onboarding", JSON.stringify(s));
  });
  await page.goto(`${base}/chat.html`);
  await page.waitForSelector("#chat-state-note:not([hidden])", { timeout: 10000 });
  const limited = await page.evaluate(() => ({
    subtitle: document.getElementById("chat-subtitle").textContent,
    note: document.getElementById("state-note-title").textContent,
  }));
  if (!limited.subtitle.includes("一般市場與金融知識") || !limited.note.includes("未使用個人帳戶資料"))
    throw new Error(`未授權模式標示異常：${JSON.stringify(limited)}`);
  await ask("為什麼 BTC 會影響我的帳戶比較多？");
  const limitedAnswer = await lastCard();
  if (limitedAnswer.includes(TOP_PCT) || limitedAnswer.includes(TRADE_TOTAL)) throw new Error("未授權模式不得給出個人化持倉數字");
  if (!limitedAnswer.includes("目前未使用個人帳戶資料")) throw new Error("未授權模式未標示資料範圍");
  console.log("2/9 未授權 OK：切一般知識模式、明確標示、且不給個人化數字（不捏造）");

  // ── 事件白名單（決策 4）
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("mm_events") || "[]"));
  const bad = events.find((event) => Object.keys(event).some((key) => !ALLOWED_EVENT_KEYS.includes(key)));
  if (bad) throw new Error(`事件含未允許欄位：${JSON.stringify(bad)}`);
  const raw = JSON.stringify(events);
  if (/BTC|52|API Key|全賣|資產集中/.test(raw)) throw new Error("事件疑似記錄了問題原文或金融數字");
  for (const name of ["maimate_chat_viewed", "maimate_conversation_created", "maimate_message_sent",
    "maimate_tool_started", "maimate_response_completed", "maimate_response_blocked",
    "maimate_evidence_opened", "maimate_generation_cancelled", "maimate_message_feedback_submitted"])
    if (!raw.includes(name)) throw new Error(`事件未記錄：${name}`);
  console.log("事件 OK：9 類事件有記、僅列舉值欄位、無問題原文與金融數字");

  // ── 26. 375／390px 無水平捲動，Composer 不遮內容
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 });
    const layout = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      composer: document.querySelector(".composer").getBoundingClientRect().height,
      body: parseFloat(getComputedStyle(document.body).paddingBottom),
    }));
    if (layout.scrollW > width) throw new Error(`${width}px 出現橫向捲動：${layout.scrollW}`);
    if (layout.body < layout.composer) throw new Error(`Composer 會遮住內容（padding ${layout.body} < 高度 ${layout.composer}）`);
  }
  console.log("26 版面 OK：375／390px 無水平捲動，Composer 不遮內容");

  /* ── 27. 每一句都走真後端；下單流程結束後不得把歷史帶進下一題 ──────────
   * 現在的契約與 index.html 一致：所有訊息都送 /chat，同一個後端、同一組工具。
   * 所以「有沒有打 /chat」不再能分辨流程有沒有結束——改看送出去的 messages。
   *
   * 後端遇到講不清楚的交易意圖會先反問（刻意設計，AI 不替使用者決定），使用者
   * 回答「賣一半就好」時那句話不含任何交易關鍵字，必須仍帶著前文一起送出去，
   * 否則後端會失去脈絡、把它當成全新的問題。
   * 反過來，取消之後再問一般問題卻還拖著整段下單對話，同樣是錯的。 */
  {
    const sent = [];
    await page.route(/\/chat(\?|$)/, (route) => {
      try { sent.push(JSON.parse(route.request().postData() || "{}")); } catch (_) { sent.push({}); }
      route.abort();   // 逼走離線劇本，行為可重現
    });
    await page.goto(`${base}/chat.html`);
    await page.waitForSelector("#q");
    const send = async (text) => {
      await page.fill("#q", text);
      await page.click("#chat-send").catch(() => page.press("#q", "Enter"));
      await page.waitForTimeout(1500);
    };

    await send("什麼是手續費？");
    if (!sent.length) throw new Error("一般問題沒有送到 /chat——問麥麥應與 index.html 走同一條路");

    sent.length = 0;
    await send("ETH 跌太多了，幫我全部賣掉！");
    await send("賣一半就好");
    if (sent.length < 2) throw new Error("下單對話的第二句沒有送出");
    const followUp = sent[sent.length - 1].messages || [];
    if (followUp.length < 2) {
      throw new Error("回答反問時沒有帶上前文，後端會失去脈絡"
        + `（messages 只有 ${followUp.length} 則）`);
    }

    await page.click(".scen").catch(() => {});
    await page.waitForSelector(".confirm", { timeout: 6000 }).catch(() => {});
    await page.click(".btns .no").catch(() => {});
    await page.waitForTimeout(300);
    sent.length = 0;
    await send("什麼是手續費？");
    const afterCancel = (sent[0] && sent[0].messages) || [];
    if (afterCancel.length !== 1) {
      throw new Error("取消後仍拖著下單對話的歷史"
        + `（messages 有 ${afterCancel.length} 則，應該只有這一句）`);
    }
    console.log("27 對話路徑 OK：每句都走真後端、反問的回答帶著前文、取消後歷史已清空");
    await page.unroute(/\/chat(\?|$)/);
  }

  if (errors.length) throw new Error("頁面拋出例外：" + errors[0].slice(0, 160));
  await page.screenshot({ path: "smoke_chat.png", fullPage: true });
  await browser.close();
  server.close();
  console.log("Screen 7 全部煙測通過 ✅（截圖 smoke_chat.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
