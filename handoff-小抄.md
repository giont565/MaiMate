# MaiMate 前端交接小抄（給 Claude Code）

更新：2026-07-27。Codex 已完成 Onboarding Screen 4／5；請先完整讀完本檔，再繼續 Screen 6 或正式 API 串接。

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

## 6. Screen 6 下一步

- 不要直接改壞現有 `frontend/index.html`／`app.js`；PR #26 仍可能有首頁變更。
- Confirm／Continue 的 Mock `nextRoute` 暫時是 `index.html?src=onboarding`。
- Screen 6 接手後讀取：
  - `mm_onboarding.effectiveProfile`
  - `mm_onboarding.profileResult`
  - `mm_onboarding.profileConfirmationReminder`
- reminder 為 true 時顯示非阻斷提示：「你的投資樣貌尚未確認」。
- 首頁個人化只調整說明深度、排序與提醒方式，不產生買賣建議、自動下單或推薦幣種。

## 7. 必跑驗證

在正確工作副本執行：

```bash
cd '/Users/rich777/Documents/黑客松/maimate-codex'
npm run smoke:analysis
npm run smoke:onboarding
npm run smoke:welcome
npm run smoke
git diff --check
```

目前四套皆全綠。這是零建置專案，沒有 lint／typecheck／production build scripts；語法以 `node --check`，流程與 RWD 以 Playwright smoke 驗證。

## 8. 開工前檢查

1. `git status -sb`
2. `git remote -v`
3. 確認 PR #28 最新狀態與隊友是否有新提交。
4. 確認沒有 staged 的 `smoke_*.png`、CSV、語料、金鑰。
5. 若工作樹有他人變更，不要 `git add -A`；只 stage 本次明確檔案。
