# Requirements — deploy-drill

## Introduction

把「從零部署到驗收」變成 Kiro 可逐項執行的 spec（#14）。三個目的一次達成：
①測試環境真的架起來 ②`docs/DEPLOY.md` 的 SOP 被實際走過一遍並計時
③過程截圖即 Kiro 加分證據（README 評分表 +5%）。

前提：AWS 帳號可登入、Bedrock 模型已開通、官方 CSV 在本機（Drive 下載，鐵則1 不進 git）。

## Requirements

### R1 資料先於建置

1. WHEN 執行部署 THEN 系統 SHALL 先產生 `data/health_report.json` 再 `sam build`
   —— 該檔隨 Lambda 打包（`CodeUri: ../`），先建置等於部署舊資料
2. 產出 SHALL 含四個區塊：`realized_pnl`、`holdings_snapshot`、`change_attribution`、
   `holding_period_distribution`（對應 issue #27／#29）
3. 官方 CSV SHALL NOT 進 git；產物 `health_report.json` SHALL 進 git

### R2 憑證隔離

1. `MAX_API_KEY` / `MAX_API_SECRET` SHALL 只在 AWS 主控台輸入
2. 金鑰 SHALL NOT 出現在任何檔案、commit、Kiro 對話紀錄或截圖中（鐵則2）
3. 設定 SHALL 用主控台「新增環境變數」，SHALL NOT 用
   `aws lambda update-function-configuration --environment`
   —— 該參數為整組取代，會清掉模板設好的 `TABLE_NAME`／`KB_ID`／`BEDROCK_REGION`

### R3 前端指向一致

1. WHEN 部署前端 THEN 所有 `frontend/*.html` 的 `window.API_BASE` SHALL 指向同一個本次 ApiUrl
2. 驗證方式 SHALL 為 `grep -oh 'window.API_BASE = "[^"]*"' frontend/*.html | sort -u`
   只輸出一行；SHALL NOT 逐檔列名（前端每加一頁就多一處）

### R4 部署版本可判別

1. 系統 SHALL 提供不需登入即可判斷「線上是不是新版」的方法：
   `/audit` 不回 404、`/market` 回傳含 `fetched_at_taipei`
2. WHEN 任一判別失敗 THEN 演練 SHALL 中止並回頭查，SHALL NOT 繼續往下測

### R5 計時與紀錄

1. 演練 SHALL 記錄開始與結束時間，目標 < 60 分鐘
2. 完成後 SHALL 把實測時間填回 `docs/DEPLOY.md` 末行
3. 過程中發現的坑 SHALL 直接改進 `docs/DEPLOY.md`（不另開文件）

### R6 Kiro 證據

1. 執行過程 SHALL 產出可作 +5% 證據的截圖：Specs 面板、task 逐項勾選、
   MCP 設定、steering 自動載入、credit 用量
2. 截圖 SHALL NOT 包含金鑰、CSV 內容或個資

## 非目標

不做 CI/CD 自動部署（決賽時程內人工執行即可）、不做多環境（dev/staging）切分。
