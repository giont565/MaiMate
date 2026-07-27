/* Screen 2＋3（onboarding.html）煙測——對應規格 14 條測試要求（#14 production build 在零建置棧以 node --check 語法檢查替代，見 package.json）：
 *   1 必要授權未勾選→主按鈕 disabled          2 選 Demo Data→進 Screen 3
 *   3 授權成功→儲存 ConsentRecord              4 授權失敗→使用者選擇不消失
 *   5 未完成 Screen 2→不能直進 Screen 3        6 單選題只能一個答案
 *   7 投資目標最多兩項（含「還在探索」互斥）    8 協助項目最多三項
 *   9 返回上一題答案保留                       10 略過問卷→仍可前進
 *   11 送出失敗→答案保留、可重送               12 重新整理→恢復進度；完成後刷新不回第一題
 *   13 375px 無水平捲動                        ＋事件記錄不含金融明細
 * 用法：npm run smoke:onboarding */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "frontend");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === "/" ? "onboarding.html" : req.url.split("?")[0]);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mm_onboarding") || "{}"));

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

  // ── 5. Route Guard：無授權直進 #/profile → 被踢回 #/consent
  await page.goto(`${base}/onboarding.html#/profile`);
  await page.waitForFunction(() => location.hash === "#/consent");
  const guardView = await page.$eval("#view-consent", (e) => !e.hidden);
  if (!guardView) throw new Error("Route Guard 後未顯示授權頁");
  await page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem("mm_events") || "[]");
    events.push({ e: "legacy_event", q: "experienceLevel", t: "legacy-time", answer: "must-be-removed" });
    localStorage.setItem("mm_events", JSON.stringify(events));
  });
  console.log("5 Route Guard OK：未授權直進 #/profile 被導回 #/consent");

  // ── 1. 必要授權未勾選 → 主按鈕 disabled（畫面骨架順檢）
  const demobar = await page.$eval(".demobar", (e) => e.textContent);
  if (!demobar.includes("Demo 模式") || !demobar.includes("不會連接或讀取你的真實")) throw new Error("Demo 模式提示缺失");
  const h2 = await page.$eval("#view-consent h2", (e) => e.textContent);
  if (!h2.includes("讓麥麥先認識你的投資足跡")) throw new Error(`主標異常：${h2}`);
  const reqCount = await page.$$eval("input[data-required]", (els) => els.length);
  const optCount = await page.$$eval("input[data-scope]:not([data-required])", (els) => els.length);
  if (reqCount !== 2 || optCount !== 2) throw new Error(`授權項數量異常：必要 ${reqCount}／選擇 ${optCount}`);
  await page.uncheck('input[data-scope="transactions"]');
  let btnState = await page.$eval("#btn-consent", (e) => ({ dis: e.disabled, hint: document.getElementById("consent-hint").textContent }));
  if (!btnState.dis || !btnState.hint.includes("必要項目")) throw new Error(`必要項關閉後按鈕未鎖：${JSON.stringify(btnState)}`);
  await page.check('input[data-scope="transactions"]');
  btnState = await page.$eval("#btn-consent", (e) => ({ dis: e.disabled }));
  if (btnState.dis) throw new Error("必要項勾回後按鈕仍鎖定");
  console.log("1 必要授權 OK：取消必要項→按鈕鎖定＋提示；勾回→解鎖（Demo 提示、標題、2必要+2選擇齊）");

  // ── 4. 授權失敗 → 錯誤卡出現、使用者選擇不消失
  await page.uncheck('input[data-scope="fundingHistory"]');      // 先做一個非預設選擇
  await page.click("#net-badge");                                 // demo：切到「連線會失敗」
  await page.click("#btn-consent");
  await page.waitForSelector("#err-consent.on");
  const errTxt = await page.$eval("#err-consent", (e) => e.textContent);
  if (!errTxt.includes("這次沒有連上") || !errTxt.includes("沒有被變更")) throw new Error(`錯誤卡文案異常：${errTxt}`);
  const keep = await page.$eval('input[data-scope="fundingHistory"]', (e) => e.checked);
  if (keep !== false) throw new Error("授權失敗後使用者的選擇被重置了");
  console.log("4 授權失敗 OK：錯誤卡（這次沒有連上）出現、入出金 off 選擇保留");

  // ── 3. 再試一次（連線恢復）→ Loading 文案 → ConsentRecord 落地 → 進 Screen 3
  await page.click("#net-badge");                                 // 恢復連線
  await page.click("#btn-retry");
  const loadingTxt = await page.$eval("#btn-consent", (e) => e.textContent);
  if (!loadingTxt.includes("正在建立安全的只讀連結")) throw new Error(`Loading 文案異常：${loadingTxt}`);
  await page.waitForFunction(() => document.getElementById("consent-hint").textContent.includes("只會讀取，不會操作"));
  await page.waitForFunction(() => location.hash === "#/profile");
  let st = await store(page);
  if (!st.consent || st.consent.source !== "internal") throw new Error(`ConsentRecord 異常：${JSON.stringify(st.consent)}`);
  const g = st.consent.grantedScopes;
  if (!g.includes("portfolio") || !g.includes("transactions") || g.includes("fundingHistory") || g.includes("interactionPersonalization"))
    throw new Error(`grantedScopes 異常：${g}`);
  if (st.portfolioSource !== "mock") throw new Error("portfolioSource 應為 mock");
  console.log("3 授權成功 OK：Loading→成功文案→ConsentRecord{source:internal, granted=必要2項}→#/profile");

  // ── 問卷骨架＋6. 單選題只能一個答案（Q1）
  const ptitle = await page.$eval("#page-title", (e) => e.textContent);
  const badge = await page.$eval("#step-badge", (e) => e.textContent);
  if (ptitle !== "讓麥麥更懂你" || badge !== "3 / 8") throw new Error(`Screen 3 頂欄異常：${ptitle}／${badge}`);
  const qp = await page.$eval("#qprog", (e) => e.textContent);
  if (qp !== "1 / 6") throw new Error(`問卷進度異常：${qp}`);
  const nextDis = await page.$eval("#btn-next", (e) => e.disabled);
  if (!nextDis) throw new Error("未作答時「下一題」應鎖定");
  await page.click('.chip[data-v="beginner"]');
  await page.click('.chip[data-v="advanced"]');
  let pressed = await page.$$eval('.chip[aria-pressed="true"]', (els) => els.map((e) => e.dataset.v));
  if (pressed.length !== 1 || pressed[0] !== "advanced") throw new Error(`單選異常：${pressed}`);
  await page.click('.chip[data-v="beginner"]');                   // 最終選 beginner
  console.log("6 單選 OK：改選會取代、同時只有一個 aria-pressed（Q1=1/6、未答鎖下一題）");

  // ── 7. Q2 投資目標最多兩項＋「還在探索」互斥
  await page.click("#btn-next");
  await page.click('.chip[data-v="longTermGrowth"]');
  await page.click('.chip[data-v="marketLiteracy"]');
  await page.click('.chip[data-v="behaviorReview"]');             // 第三項應被拒
  let hint = await page.$eval("#qhint", (e) => e.textContent);
  pressed = await page.$$eval('.chip[aria-pressed="true"]', (els) => els.length);
  if (pressed !== 2 || !hint.includes("最多選兩項")) throw new Error(`目標上限異常：${pressed}／${hint}`);
  await page.click('.chip[data-v="exploringGoal"]');              // 互斥：清掉其他，單獨成立
  pressed = await page.$$eval('.chip[aria-pressed="true"]', (els) => els.map((e) => e.dataset.v));
  if (pressed.length !== 1 || pressed[0] !== "exploringGoal") throw new Error(`「還在探索」互斥異常：${pressed}`);
  await page.click('.chip[data-v="exploringGoal"]');
  await page.click('.chip[data-v="longTermGrowth"]');             // 最終選長期累積
  console.log("7 目標上限 OK：第三項被拒＋提示；「還在探索」可單獨成立");

  // ── 9. 返回上一題答案保留
  await page.click("#btn-prev");
  const q1keep = await page.$eval('.chip[data-v="beginner"]', (e) => e.getAttribute("aria-pressed"));
  if (q1keep !== "true") throw new Error("返回上一題後 Q1 答案消失");
  await page.click("#btn-next");
  const q2keep = await page.$eval('.chip[data-v="longTermGrowth"]', (e) => e.getAttribute("aria-pressed"));
  if (q2keep !== "true") throw new Error("往前後 Q2 答案消失");
  console.log("9 上一題 OK：Q1/Q2 答案來回保留");

  // ── 12a. 重新整理恢復進度（作答到 Q3 途中刷新）
  await page.click("#btn-next");                                  // 到 Q3
  await page.reload();
  await page.waitForFunction(() => location.hash === "#/profile");
  const qpAfter = await page.$eval("#qprog", (e) => e.textContent);
  if (qpAfter !== "3 / 6") throw new Error(`刷新後進度異常：${qpAfter}（應停在 3 / 6）`);
  console.log("12a 刷新恢復 OK：作答到第 3 題刷新後仍在 3 / 6");

  // ── 8. Q5 協助項目最多三項（先答完 Q3/Q4）
  await page.click('.chip[data-v="flexible"]');
  await page.click("#btn-next");
  await page.click('.chip[data-v="investigate"]');
  await page.click("#btn-next");
  await page.click('.chip[data-v="newsToHoldings"]');
  await page.click('.chip[data-v="riskAlerts"]');
  await page.click('.chip[data-v="termExplain"]');
  await page.click('.chip[data-v="dailyDigest"]');                // 第四項應被拒
  hint = await page.$eval("#qhint", (e) => e.textContent);
  pressed = await page.$$eval('.chip[aria-pressed="true"]', (els) => els.length);
  if (pressed !== 3 || !hint.includes("最多選三項")) throw new Error(`協助上限異常：${pressed}／${hint}`);
  console.log("8 協助上限 OK：第四項被拒＋提示");

  // ── 摘要：3–5 個標籤＋完成/返回修改
  await page.click("#btn-next");
  await page.click('.chip[data-v="concise"]');
  const lastNext = await page.$eval("#btn-next", (e) => e.textContent);
  if (lastNext !== "看麥麥的整理") throw new Error(`末題按鈕文案異常：${lastNext}`);
  await page.click("#btn-next");
  await page.waitForSelector("#summary.on");
  const tags = await page.$$eval("#sum-tags .tagchip", (els) => els.map((e) => e.textContent));
  if (tags.length < 3 || tags.length > 5) throw new Error(`摘要標籤數異常：${tags.length}`);
  if (!tags.includes("剛開始接觸") || !tags.includes("重點摘要模式") || !tags.includes("優先提醒集中風險"))
    throw new Error(`標籤內容異常：${tags}`);
  await page.click("#btn-revise");                                // 返回修改 → 回 Q6
  const qp6 = await page.$eval("#qprog", (e) => e.textContent);
  if (qp6 !== "6 / 6") throw new Error(`返回修改異常：${qp6}`);
  await page.click("#btn-next");
  await page.waitForSelector("#summary.on");
  console.log("摘要 OK：標籤 " + tags.length + " 個（含經驗/風格/風險提醒）、返回修改可回 Q6");

  // ── 11. 送出失敗 → 答案保留、可重送
  await page.click("#net-badge");                                 // 連線會失敗
  await page.click("#btn-finish");
  await page.waitForSelector("#err-save2.on");
  const saveErr = await page.$eval("#err-save2", (e) => e.textContent);
  if (!saveErr.includes("答案還在，沒有不見")) throw new Error(`儲存錯誤文案異常：${saveErr}`);
  st = await store(page);
  if (!st.draft || st.draft.answers.experienceLevel !== "beginner") throw new Error("送出失敗後草稿答案遺失");
  await page.click("#net-badge");                                 // 恢復
  await page.click("#btn-resave2");
  await page.waitForFunction(() => location.hash === "#/analyzing");
  console.log("11 送出失敗 OK：答案保留（draft 仍在）→ 重新送出成功 → #/analyzing");

  // ── 12b. 完成後刷新/回訪不回第一題；profile 落地
  await page.goto(`${base}/onboarding.html#/profile`);
  await page.waitForSelector("#summary.on");
  const qHidden = await page.$eval("#q-area", (e) => e.style.display === "none");
  if (!qHidden) throw new Error("完成後回訪不應回到問卷第一題");
  st = await store(page);
  if (!st.profile || st.profile.status !== "completed" || st.profile.communicationStyle !== "concise" || st.draft)
    throw new Error(`完成後狀態異常：${JSON.stringify({ p: st.profile && st.profile.status, draft: !!st.draft })}`);
  console.log("12b 完成後回訪 OK：顯示摘要不回第一題；profile{completed, concise}、draft 已清");

  // ── 事件記錄：關鍵事件有記、只記 questionId 不記答案/金融明細
  const events = await page.evaluate(() => localStorage.getItem("mm_events") || "[]");
  for (const ev of ["onboarding_consent_viewed", "onboarding_optional_scope_changed", "onboarding_consent_granted",
    "onboarding_questionnaire_started", "onboarding_question_answered", "onboarding_questionnaire_completed"])
    if (!events.includes(ev)) throw new Error(`事件未記錄：${ev}`);
  const parsedEvents = JSON.parse(events);
  for (const event of parsedEvents)
    if (Object.keys(event).some((key) => !["e", "q"].includes(key))) throw new Error("事件記錄保留舊格式或未允許欄位");
  if (/beginner|longTermGrowth|concise|token|balance|372000|BTC/i.test(events)) throw new Error("事件記錄疑似含答案內容或金融明細");
  console.log("事件 OK：6 類事件有記；無答案內容/金融明細");

  // ── 2＋10. 全新使用者走 Demo Data → 進 Screen 3 → 略過問卷 → 仍可前進
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/onboarding.html#/consent`);
  await page.click("#btn-demo-data");
  await page.waitForFunction(() => location.hash === "#/profile");
  st = await store(page);
  if (!st.consent || st.consent.source !== "demo") throw new Error("Demo Session 的 ConsentRecord 異常");
  await page.click("#btn-skip");
  await page.waitForFunction(() => location.hash === "#/analyzing");
  st = await store(page);
  if (!st.profile || st.profile.status !== "skipped") throw new Error("略過後 questionnaireStatus 應為 skipped");
  // 已選 Demo Data 後回到授權頁：不再重複要求授權
  await page.goto(`${base}/onboarding.html#/consent`);
  const ctaTxt = await page.$eval("#btn-consent", (e) => e.textContent);
  if (!ctaTxt.includes("已完成授權")) throw new Error(`已授權回訪 CTA 異常：${ctaTxt}`);
  console.log("2+10 Demo Data OK：範例資料→#/profile；略過→#/analyzing；回訪不重複要求授權");

  // ── 13. 375px 無水平捲動（375×812 與 390×844 為主要尺寸）
  for (const w of [375, 390]) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 844 });
    await page.goto(`${base}/onboarding.html#/consent`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) throw new Error(`${w}px 出現橫向捲動：scrollWidth=${sw}`);
  }
  console.log("13 版面 OK：375/390px 皆無水平捲動");

  await page.screenshot({ path: "smoke_onboarding.png", fullPage: true });
  await browser.close();
  server.close();
  console.log("全部通過 ✅（截圖 smoke_onboarding.png）");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
