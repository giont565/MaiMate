# MaiMate 前端交接小抄

更新：2026-07-28。分支 `feat/frontend-screen6-home`（最新 commit `b836101`）。
接手前把本檔讀完；有疑問先看 `docs/` 下的三份 Screen 7 討論文件。

## 0. 工作位置與 Git

- Repo：`giont565/MaiMate`；工作副本：**`/Users/rich777/maimate`**（origin 指向 GitHub）
- 分支：`feat/frontend-screen6-home`。PR #28（Screen 1–5）**已合併進 main**；本分支是 Screen 6/7 與真帳戶切換，尚未開 PR。
- Issue #29：向後端要三項聚合值（各幣種持倉比例／帳戶變化歸因／持有期間分布）。
- 對外動作（push／PR／issue／留言）先取得 user 同意。

## 1. 不可違反

1. 只動 `frontend/`、`scripts/`、`docs/`、`package.json`；不碰 `backend/`、`data/`、`infra/`、`rag/`。
2. 官方 CSV、RAG 語料、API Key、Secret、私鑰、助記詞絕不進 git 或對話。
3. **零建置靜態 SPA**：純 HTML＋vanilla JS＋JSDoc typedef。不引入框架、打包器、TypeScript 工具鏈。
4. UI 只呼叫 Service／Adapter，不直接讀 Mock。
5. AI 不報明牌、不預測價格、不保證獲利；`execute_order` 永不進 LLM 工具清單。
6. **數字必須指得出來源**。報告沒有的一律顯示「資料不足」，不補假值。
7. `mm_events` 只准白名單欄位：`e`／`q`／`src`／`intent`／`tool`／`style`／`status`／`guard`，且值必須是列舉值（禁自由文字、金額、持倉、問題原文）。
8. 不把投資樣貌寫成人格、能力、風險等級、績效或健康分數。
9. user 說「定稿」才 commit；push 前仍需確認。

## 2. 資料來源（2026-07-28 起，最重要的一節）

**全站使用隊友共用的真實帳戶**：`data/health_report.json`。
資料橋：`npm run build:account` → `scripts/build_account_mock.js` → `frontend/mocks/account.js`（產出檔要 commit）。
`frontend/mocks/onboarding.js` 由 account.js 推導，**不得自行編造帳戶數字**。

真帳戶事實：
- 期間 2025-01-01～2025-12-31，10,000 列紀錄
- 買賣 **4,674 筆**（買 2,357／賣 2,317），平均每月 **389.5 筆**
- 2025-12 **375 筆** vs 2025-11 **395 筆**
- 最大持有 **TWD 現金 98.6%**（2025-12），其餘 **1.4% 未細分**；前期快照 2025-11 為 98.5%
- 追高 65.0%（2,350 筆買入）；出金 417 筆，14.2% 在下跌後
- 唯一有明細的事件：**2025-01-08 賣 DOGE 6,216.214174 @14.2，年末 64.54，少賺 NT$312,924**

**報告沒有**（→ 顯示資料不足，已開 issue #29）：逐筆交易明細、各幣種持倉比例、持有期間分布、交易日期分布。

語意陷阱：**現金占比高 ≠ 持倉集中**。TWD 98.6% 代表「資金多在現金」（保守），寫成「過度集中」是講反話，煙測有 guard 會擋。

## 3. 各畫面現況

| Screen | 檔案 | 路由 |
|---|---|---|
| 1 入口 | `welcome.html` / `welcome.js` | `welcome.html` |
| 2 授權 / 3 問卷 / 4 分析 / 5 樣貌 | `onboarding.html` ＋ `onboarding.js`／`onboarding-analysis.js`／`investment-analysis.js`／`onboarding-core.js` | `#/consent` `#/profile` `#/analyzing` `#/profile-result` |
| 6 首頁 | `home.html` / `home.js` / `home-core.js` / `home-service.js` | `/maimate/home` → `home.html` |
| 7 問麥麥 | `chat.html` / `chat.js` / `chat-core.js` / `chat-service.js` | `/maimate/chat` → `chat.html` |
| 8 深入了解 | `insights.html` / `insights.js`（**目前仍是 placeholder，待建**） | `/maimate/insights` |
| 設定 | `settings.html` / `settings.js` | `/maimate/settings` |
| Golden Path（舊） | `index.html` / `app.js` | CI `npm run smoke` 仍測這頁 |

跨頁機制：`navigation-context.js`（路由白名單＋sessionStorage context envelope）、`chat-context.js`（來源卡與預填，使用者確認才送出）。

**Screen 7 兩條路線共存**：分析對話走 `MM_CHAT_SERVICES`（工具→結構化區塊→依據→追問）；使用者自己表達交易意圖走 Golden Path（三方案卡＋確認卡，**AI 不代按**）。要求 AI 自行下單走安全邊界。

**首頁三種版面**＝問卷 Q6 溝通風格（guided／concise／analytical），只改呈現密度，不改數字與證據。

## 4. 護欄（改動前先看，否則會被擋）

- `chat-core.js`：禁語全物件掃描＋**數字一致性檢查**（回答文字裡每個 %／金額／筆數都必須在該回答的 evidence 裡找得到）。改文案要同步補 evidence，否則整則被換成安全模板。
- `home-core.js`：Response／Narrative／Attribution 驗證、快取 sanitizer、Route Guard。
- 煙測含反向 guard：畫面不得出現 `52%`／`72%`／`0.7 筆`／`16 天前`／`最近 30 天`；現金不得被寫成集中；缺明細不得給歸因比重。

## 5. 必跑驗證（七套，全綠才算完成）

```bash
cd /Users/rich777/maimate
npm run smoke            # Golden Path（CI 也跑這支）
npm run smoke:welcome    # Screen 1
npm run smoke:onboarding # Screen 2/3
npm run smoke:analysis   # Screen 4/5
npm run smoke:home       # Screen 6
npm run smoke:chat       # Screen 7
npm run smoke:regressions # 審查抓到的 6 個缺陷迴歸
```
零建置專案，沒有 lint／typecheck／build；語法用 `node --check`，流程與 RWD 用 Playwright。
本機預覽：`cd frontend && python3 -m http.server 8788`。

## 6. 設計系統

色票 `--bg:#FBFCFE`／`--red:#E64A4D`／`--blue:#1E4DA7`／`--txt:#0F172A`／`--tint:#EEF3FC`；字級 44/28/17/14；圓角只有 16/12；平塗，禁徑向光暈與假數據點；角色圖只用 `maimate_hero.png`；互動元件 ≥44px；顧 `prefers-reduced-motion`；375×812 與 390×844 不得水平捲動。

## 7. 下一步

- **Screen 8（深入了解）**：只做真帳戶撐得住的——現金集中度、12 個月交易節奏（真值）、2025-01-08 賣出回顧、名詞解釋；歸因／持有分布做成「資料不足＋已向後端請求（issue #29）」。
- 待隊友補資料後：跑 `npm run build:account` 即可，不必改程式。
- 本分支尚未開 PR。

## 8. 教訓（2026-07-28）

前端最初用了一份**自行編造的示範帳戶**（8 筆交易、BTC 52%），與後端真實帳戶並存了好幾天，直到 user 發現才全面重切，代價是 Screen 4–7 的文案與四支煙測全部重寫。
**接手前先確認資料來源是不是專案既有的真實資料，再決定要不要造 mock。**
