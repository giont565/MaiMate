# Workflow Steering — 開發與協作紀律

適用對象：**所有隊員與所有 AI 開發工具**（Kiro 自動載入本檔；Claude Code 經 CLAUDE.md 引用；
用其他 AI 開發時，把本檔連同任務一起餵給它）。範圍與介面歸 README 管；**怎麼動手**歸本檔管。

## Git 紀律

1. 一律從 `git clone` 開始開發；**禁止**把沒有 git 歷史的本地快照當 initial commit 再
   「以本地版本為準」merge 回 main——這種合併會在多人開發時吃掉別人的改動。
2. 每日開工先 `git pull --rebase origin main`；功能在分支開發，完成後開 PR 合回 main。
3. 動到共用檔案（tools.py / loop.py 歸 A、infra 歸 D）先在 #dev 廣播（README 五規則重申）。

## 部署與設定（可重部署鐵則）

1. 環境相關值（API 網址、region、bucket 名）**不硬編碼**進版控；一律環境變數或部署時注入。
   - 已知例外：`frontend/index.html` 的 `window.API_BASE` 一行。把它視為「部署步驟的一部分」：
     **每次重部署（尤其 8/1 官方環境）必須改成新 ApiUrl**，此項列入 DEPLOY.md（#14）檢查清單。
2. 金鑰只走環境變數 / Secrets Manager（鐵則重申；OrderFunction 的 MAX 金鑰部署後手動注入）。
3. 部署後冒煙順序：`curl <ApiUrl>/health` → `curl "<ApiUrl>/market?market=btctwd&kind=ticker"`
   → 開前端完整走一輪對話。改後端記得 `sam build && sam deploy`、改前端記得重新 `aws s3 sync`，
   否則線上跑的還是舊程式。

## 前端 UI 原則

1. 輪詢刷新一律**就地更新**：初始化建好 DOM，之後只改 textContent / class；
   禁止 `innerHTML = ""` 清空重建（會閃爍跳動）。
2. 抓取失敗**保留上一次數值**，不得用占位符蓋掉；全部失敗才亮離線標示。
3. 任何使用者輸入或模型輸出插入 DOM 前必須先 escape（用 `app.js` 的 `esc`/`md`，防 XSS）；
   模型回覆只渲染粗體與換行兩種 markdown，system prompt 已約束模型不用標題/表格語法。

## Agent 工具開發原則

1. 工具 description 必須寫明每個區塊/參數裝什麼、對應哪類問題
   （例：「虧最多的一筆」→ `opportunity_cost.worst_single_sell`）。
   **模型選錯工具先怪描述，再怪模型**；模型答不出時先檢查工具回傳給了什麼素材，最後才調 prompt。
2. 資料查詢類工具回傳一律附 `key_findings` 中文摘要——模型（尤其 Haiku）選錯區塊時的保險。
3. 資料回答不了的問題，回傳附 `data_notes` 說明限制與最接近的替代答案；
   system prompt 已要求「說明差異後直接給數字，不准只指路」，新工具照此模式。
4. `execute_order` 永不進 LLM 工具清單；prepare/execute 分離不可合併（鐵則重申）。

## 驗證紀律（寫好 ≠ 測過）

1. 回報進度誠實區分「寫好」與「測過」；沒實際跑過的路徑不得在 tasks.md 打 [x]。
2. 後端改動最低標準：`python3 -m py_compile <改到的檔>` 通過＋被改函式本地實跑一次。
3. 前端改動最低標準：`npm run smoke` 全綠（首次先 `npm i` 並 `npx playwright install chromium`；
   腳本用 mock API 驗證：行情就地更新不重建、斷網保留舊值、氣泡渲染與 escape）。
4. 涉及 Bedrock 的 prompt / 路由改動：部署後用固定劇本句實測
   （「去年我虧最多的是哪一筆」「ETH 跌太多幫我全賣」），結果截圖存 Drive（也是 Kiro +5% 證據）。
