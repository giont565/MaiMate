# MaiMate 前端交接小抄（給 Claude Code）

更新：2026-07-27。Codex 已完成 Onboarding Screen 4／5，並在未提交工作樹完成 Screen 6；請先完整讀完本檔，再繼續 Screen 7／8 深化或正式 API 串接。

## 0. 工作位置與 Git

- Repo：`giont565/MaiMate`
- 正確工作副本：`/Users/rich777/Documents/黑客松/maimate-codex`
- 分支：`feat/frontend-screen1-welcome`（既有 PR #28）
- 不要再到 `/Users/rich777/maimate` 修改；那是舊 clone，目前有另一份未提交變更。
- 這個工作副本的 `origin` 目前指向上述舊 clone，不是 GitHub。若要 push，先確認 remote 指向 `https://github.com/giont565/MaiMate`，且 GitHub 憑證有效。
- 對外動作（push／PR／issue／留言）仍須先取得 user 同意。

## 1. 不可違反

1. 只動 `frontend/`、`docs/mockups/`、`docs/brand/`，以及前端煙測需要的 `scripts/`／`package.json`；不要碰 `backend/`、`data/`、`rag/`。
2. 官方 CSV、RAG 語料、API Key、Secret、私鑰、助記詞絕不進 git 或對話。
3. 維持零建置靜態 SPA：純 HTML＋vanilla JS，以 JSDoc typedef 表達型別；不要導入 React／Next.js／TypeScript 工具鏈或大型套件。
4. UI 只能呼叫 Service／Adapter，不得直接讀 Mock JSON。
5. AI 不報明牌、不預測價格、不保證獲利；`execute_order` 永不進 LLM 工具清單。
6. 數字必須可追溯。Demo 一律標「示範資料」。
7. `mm_events` 只准 `{e}` 或 `{e,q}`；不得存 timestamp、答案、自由文字、持倉、金額、token 或 metadata。
8. 不要把投資樣貌寫成人格、能力、風險認證、績效或健康分數。
9. 使用者說「定稿」才能 commit；push 前仍需確認。煙測截圖 `smoke_*.png` 已由 `.gitignore` 排除。

## 2. Screen 4／5 已完成

### Screen 4｜資料分析處理

- 路由：`frontend/onboarding.html#/analyzing`
- Screen 3「完成，開始分析」與「稍後再填」都已接入。
- Analysis Job 支援 queued／running／succeeded／failed、五個 stages、刷新續跑、相同 dataVersion 不重複建立。
- 返回或刷新不會自動重跑成功／失敗 Job。
- 最新分析失敗但有同版本舊結果時，顯示「查看上次結果」，不覆寫舊 result／corrections。
- Demo 故障情境可重試或切換本機展示結果。
- PR #28 舊狀態若只有 consent/profile、缺 `demoSession`，會就地遷移，不會誤判過期或清掉答案。
- 慢速請求有 route epoch guard；離開 Screen 4 後，晚到回應不會把使用者拉回 Screen 5。

### Screen 5｜投資樣貌結果

- 路由：`frontend/onboarding.html#/profile-result`
- 完整內容：Hero、摘要、動態資料 Chips、四個可展開 Dimension、穩定習慣、留意事項、陪伴方案、整體回饋、法律邊界、Sticky CTA。
- 四個 Dimension 共用同一個 renderer，沒有複製四套元件。
- 每個面向支援 accurate／partiallyAccurate／inaccurate／unsure。
- 部分像／不太像會開 Correction Sheet；選項使用穩定代碼，自由文字最多 200 字並做一般文字清洗。
- 回饋有 saving／saved／error／retry；不同 Dimension 寫入序列化，確認與稍後操作互斥，不會重複 PATCH／POST。
- `originalProfile` 永遠保留；修正只產生 `userCorrections` 與 `effectiveProfile`。
- 已確認結果再修正會切為 revised CTA；移除全部修正後可恢復 confirmed。
- Confirm／Continue 都使用 Service 回傳的 `nextRoute`，前端不寫死 Screen 6 URL。
- 「稍後再確認」會保存 draft effectiveProfile 與 `profileConfirmationReminder`。
- Header／Bottom Sheet／Accordion／Sticky CTA 已處理鍵盤、ARIA、焦點限制、Safe Area、375×812、390×844、`prefers-reduced-motion`。

## 3. 真實 Demo 數字

唯一資料來源仍是 `frontend/mocks/onboarding.js`：

- 8 筆交易（不是規格範例的 48 筆）
- 4 項資產
- 最大持倉 52%
- 前兩項合計 72%（不是 78%）
- 可用期間約 11 個月
- 問卷完成時為 6 題

現有資料不足以可靠算出：

- 持有中位數 96 天
- 高波動期間 1.6 倍

因此這兩個 Dimension 明確顯示「還需要更多資料」，不得補假數字。

## 4. 架構與檔案

| 檔案 | 責任 |
|---|---|
| `frontend/onboarding-core.js` | JSDoc Types、唯一 `OnboardingStore`、最小化 analytics、Demo Session |
| `frontend/investment-analysis.js` | 規則門檻、確定性 Mock Analysis、Profile Result、effectiveProfile、Mock／正式 Adapters |
| `frontend/onboarding-analysis.js` | Screen 4／5 UI Controller、Route async guard、Dimension renderer、Sheets、Feedback、CTA |
| `frontend/onboarding.html` | Screen 2～5 HTML／CSS 與共用 Design Tokens |
| `frontend/onboarding.js` | Screen 2／3 與四頁 hash route guards |
| `frontend/mocks/onboarding.js` | 唯一 Demo 帳戶資料 |
| `scripts/smoke_analysis.js` | Screen 4／5 完整 Playwright 煙測 |

核心位置：

- `InvestmentProfileResult`：`frontend/onboarding-core.js`
- `fallbackResult()`／`buildEffectiveProfile()`：`frontend/investment-analysis.js`
- `MockInvestmentAnalysisService`／`MockInvestmentProfileService`：同上
- `MaiCoinInvestmentAnalysisService`／`MaiCoinInvestmentProfileService`：同上
- `renderDimensions()`／Feedback／Confirm／Continue：`frontend/onboarding-analysis.js`

## 5. 正式 API 尚未完成

目前 active services 仍是 Mock；正式 Adapter 已對齊現有 contract，但切換前要和後端確認：

1. 正式 Onboarding Session 的取得與保存方式。
2. `GET /profile-result` 若要刷新後還原修正，需回傳 effectiveProfile、dimensionFeedback、userCorrections、overallFeedback，或另建 context endpoint。
3. 最新分析失敗時要安全取用舊結果，後端需提供 `dataVersion` 或等效來源版本。
4. 「只重建 Result、不重跑原始分析」端點尚未定義。
5. 正式服務是否允許 Demo fallback；若不允許，正式模式要隱藏該 CTA。
6. Screen 2 授權與 Screen 3 Profile 儲存仍是 Mock Service。
7. Bedrock narrative／Guardrails 屬後端；前端不得自行呼叫模型或計算 AI 金融結論。

## 6. Screen 6｜MaiMate 投資導航首頁（未提交）

### 路由與銜接

- Screen 6 實體路由：`frontend/home.html`
- 產品虛擬路由 `/maimate/home` 由 `frontend/navigation-context.js` 安全解析為 `home.html`。
- Screen 5 Confirm／Continue 的 Mock `nextRoute` 已改為 `home.html?src=onboarding`；`onboarding-analysis.js` 仍只依 Service 回應導向，不在 UI 寫死 Screen 6。
- Welcome 已完成狀態改進 `home.html?src=welcome`。
- Welcome「使用示範帳戶」改進 `home.html?demo=STEADY_PLANNER`；`bootstrapHomeDemo()` 會用既有 `OnboardingStore`、`AnalysisJob`、`InvestmentProfileResult`、`EffectiveInvestmentProfile` 建立同一套 Profile，不另造第二模型。
- 現有 `frontend/index.html`／`app.js` 保留為 Screen 7 Golden Path；沒有被改寫成首頁。
- Screen 8 洞察／教學先由 `frontend/insights.html` 提供可用 detail/list Placeholder；設定由 `frontend/settings.html` 提供 Placeholder，底部四個 Tab 不會 404。

### 首頁功能

- 第一屏：個人問候、既有 MaiMate 角色、Today Relevant、Plan Alignment 開頭、可直接追問的 Sticky Chat。
- 完整模組：
  - Today Relevant：同時交代市場、持倉與交易節奏。
  - Plan Alignment：問卷／effectiveProfile 的原本方向 vs 帳戶紀錄的近期行為。
  - Account Attribution：由 raw effect units 在 Service 正規化為 68／21／7／4，UI 只呈現後端型結果並標「依目前資料估算」。
  - Similar Moment：只引用既有 2026/01/08–09 兩筆 DOGE 交易，不使用規格中不存在的 3 月 4 筆交易。
  - 1～2 個主動洞察、情境式追問、學習卡、帳戶概況、Profile／Data Status。
- Draft Profile 可進首頁並看到非阻斷提醒；可返回 Screen 5。
- Route Guard 同時驗證 portfolio＋transactions 授權、問卷狀態、Analysis Job、Result/Job ID、dataVersion 與 effectiveProfile 原始 Result；舊版結果不會短暫被當成新首頁。
- 授權撤回會清除個人化快取，只保留一般市場解釋、金融知識與非個人化聊天。
- 模組可 dismiss／snooze，金額顯示偏好可保存；Attribution／Similar Moment／Learning 真正各自隔離例外並提供 retry，單一模組失敗不拖垮整頁。
- 快取先顯示、背景刷新；完整 Home Response 只存同分頁 `sessionStorage:mm_home_cache`，30 分鐘 TTL 且驗 dataVersion。它不會長期寫入 `mm_onboarding`，舊版 localStorage 快取會自動移除。
- 刷新只重建 Home Context，不會重跑 Screen 4 或重建 Profile。
- 通知 Bottom Sheet、Sticky Chat、Bottom Navigation、Safe Area、鍵盤／ARIA、375×812、390×844、`prefers-reduced-motion` 均已處理。

### Screen 6 Truth-first 固定資料

Screen 6 帳戶數字仍由 `frontend/mocks/onboarding.js` 經 Adapter 推導：

- 8 筆交易
- 最近 30 天 1 筆、前一個 30 天 1 筆
- 過去 12 個月平均每月約 0.7 筆
- 最近一筆交易為 16 天前
- 4 項持有資產
- BTC 52%
- 前兩項合計 72%

`frontend/mocks/home.js` 只新增版本化的首頁 raw inputs：

- 示範市場情境：BTC 當日約 -1.8%
- 上期持倉快照：BTC 49%，用來描述本期 52% 的變化
- 歸因 effect units：68／21／7／4
- 2026 年 1 月相似市場時刻
- 學習內容與受 Schema 限制的示範 narrative

這些資料不使用 `Math.random`，刷新後一致。UI 不直接讀任何 Mock；只有 Adapter／Service 可讀。

### Screen 6 架構

| 檔案 | 責任 |
|---|---|
| `frontend/home-core.js` | Home JSDoc types、Response／Narrative／Attribution validator、cache sanitizer、Route Guard |
| `frontend/mocks/home.js` | 僅首頁 raw market／prior snapshot／attribution／learning／structured-output inputs |
| `frontend/home-service.js` | Portfolio／Transaction／Market／EffectiveProfile／Attribution／SimilarMoment／Learning／Conversation Adapters；Mock／正式 Home Service；cache／refresh／dismiss／snooze／privacy |
| `frontend/home.html` | Screen 6 mobile-first shell、Design Tokens、可及性結構 |
| `frontend/home.js` | `moduleRenderers`、各 Home Module renderer、載入／局部錯誤／通知／Sticky Chat／Bottom Nav |
| `frontend/navigation-context.js` | 後端 action route allowlist、Screen 7／8 Context 的 sessionStorage envelope |
| `frontend/chat-context.js` | Screen 7 顯示來源卡、預填問題；使用者確認送出後才附最小 navigation context |
| `frontend/insights.html/.js` | Screen 8 detail/list Placeholder 與來源 Context |
| `frontend/settings.html/.js` | Settings Placeholder，銜接 Screen 5 與授權設定 |
| `scripts/smoke_home.js` | Screen 6 Route／Data／Cache／API／RWD／Screen 7／8 整合煙測 |

核心位置：

- `MaiMateHomeResponse` 等 JSDoc types：`frontend/home-core.js`
- `PortfolioAdapter` 等八個 Adapter：`frontend/home-service.js`
- `mmHomeBuildResponse()`：`frontend/home-service.js`
- Today Relevant／Plan Alignment／Attribution／Similar Moment 組裝：同上
- `MockMaiMateHomeService`／`MaiMatePersonalizedHomeService`：同上
- `moduleRenderers`／`renderHome()`：`frontend/home.js`
- Demo bootstrap：`frontend/investment-analysis.js` 的 `bootstrapHomeDemo()`
- Screen 7／8 action context：`frontend/navigation-context.js`

### Context 傳遞

- 首頁 action 的 route、question、IDs 與 context 由 Service Response 提供。
- `navigation-context.js` 只接受已知 `/maimate/*` route，拒絕跨網域、`javascript:`、protocol-relative、路徑穿越與未知 query/hash。
- 完整預填問題只暫存在 `sessionStorage`，不放 URL、不寫 analytics。
- 預填 Context 最長 10 分鐘，Screen 7 讀取後立即 consume。
- Screen 7 顯示來源卡與預填問題，但不自動送出；使用者按送出後，Chat Request 只附白名單 IDs，不重複外送完整問題。
- `mm_events` 仍只保存 `{e}` 或 `{e,q}`。
- `questionId` 必須符合 stable-ID 規則，自由文字不能落入 `q`。
- Screen 7 既有 health／scenario／confirm 數字 renderer 的 HTML 注入邊界也已補強；惡意數字與 market 字串不會形成 DOM 節點。

## 7. 正式 Home API／後端 TODO

active Home Service 仍為 `MockMaiMateHomeService`。`MaiMatePersonalizedHomeService` 已實作：

- `GET /api/v1/maimate/home`
- `POST /api/v1/maimate/home/refresh`
- `POST /api/v1/maimate/home/modules/:moduleId/dismiss`
- `POST /api/v1/maimate/home/modules/:moduleId/snooze`
- `PATCH /api/v1/maimate/preferences/privacy`

正式串接前仍需後端完成：

1. MAX 即時行情與 MaiCoin／MAX 持倉、交易、入出金 Adapter。
2. Market Exposure、Account Attribution、Plan Alignment、Similar Moment 的後端計算／搜尋。
3. Home modules ranking、cache dataVersion、narrativeVersion 與局部刷新。
4. Bedrock JSON Schema、Evidence／Number／Prohibited Phrase／Financial Advice validation 與 rule-template fallback。
5. 後端所有 Home Action 的 `route`／`context` 白名單契約。
6. Screen 7／8 正式頁面與 Conversation Context API。
7. Attribution 若無法可靠計算，必須回 unavailable；不可補假比例。
8. 相同 dataVersion 不重複呼叫 AI，也不可把完整交易紀錄送入模型。

## 8. 必跑驗證

在正確工作副本執行：

```bash
cd '/Users/rich777/Documents/黑客松/maimate-codex'
npm run smoke:analysis
npm run smoke:onboarding
npm run smoke:welcome
npm run smoke
npm run smoke:home
git diff --check
```

五套在本輪皆曾全綠。完成 Screen 6 Guard／cache／ARIA／module-isolation 收斂後，`smoke:home` 已再跑全綠；Golden Path `smoke` 在數字欄位 XSS 修正後也全綠。其後又補了一行 market uppercase-before-escape 與對應惡意確認卡測試，最終全部 JS `node --check`、`git diff --check` 全綠，但因本機工具額度用盡，無法再執行瀏覽器。接手者應優先重跑五套，特別是新增的確認卡 XSS case。這是零建置專案，沒有 lint／typecheck／production build scripts；語法以 `node --check`，流程、斷網、API Contract、Route Guard 與 RWD 以 Playwright smoke 驗證。

## 9. Git 狀態與接手檢查

1. `git status -sb`
2. `git remote -v`
3. HEAD `bb7cf00` 是 Screen 4／5 的本機 commit；目前 `origin/feat/frontend-screen1-welcome` 仍停在 `41a8f39`。
4. Screen 6 所有檔案目前尚未 stage／commit／push；必須等 user 再說「定稿」。
5. `origin` 目前仍指向 `/Users/rich777/maimate` 舊 clone，不是 GitHub。不可直接 push；需先讓 user 確認 remote 修正。
6. 確認 PR #28 最新狀態與隊友是否有新提交。
7. 確認沒有 staged 的 `smoke_*.png`、CSV、語料、金鑰。
8. 若工作樹有他人變更，不要 `git add -A`；只 stage 本次明確檔案。
