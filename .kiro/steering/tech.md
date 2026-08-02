# Tech Steering — 技術棧約定

## 架構（四層 serverless）

前端**零建置多頁 vanilla JS**（S3 + CloudFront）→ API Gateway + Lambda（Python 3.12）
→ AI 層 Bedrock（Converse API + tool use）→ 資料層 S3 / DynamoDB / MAX API。

## 硬性規定

1. **模型僅限 AWS Bedrock 提供之基礎模型**（競賽規定）。modelId 一律使用
   `us.` 開頭的跨區 inference profile **完整 ID（含日期版本）**。
   - 血的教訓（08-01）：用了不存在的短別名當 `MODEL_SONNET`，凡是含「為什麼／分析／
     歸因／比較」的深度意圖問題**一律 500**，而驗收腳本沒有一句會觸發深度意圖，所以全綠。
     現行值見 `backend/agent/loop.py:9,14`；改 modelId 後必須用深度意圖句實測。
2. 呼叫模型一律走 **Converse API**（跨模型通用，換模型不改程式）。
3. Agent 迴圈上限 8 輪，防止失控燒 token。
4. 對外 API 呼叫（MAX/第三方）一律包 **快取 + 指數退避重試**；行情快取 TTL 5 秒。
5. 下單確認 token 存 DynamoDB，60 秒過期、單次有效。

## 程式風格

- Python：標準函式庫優先，重依賴（pandas 等）只用在離線分析，Lambda 內不用。
- 每個 Lambda handler 單一職責，**五支**：`/chat` `/health` `/market` `/order` `/audit`
  （`infra/template.yaml` 的 ChatFunction／HealthFunction／MarketFunction／
  OrderFunction／AuditFunction）。
- 錯誤回應一律結構化 JSON（code / message / retryable）。
- 前端**零建置**：純 HTML + vanilla JS，不得引入打包器或框架，`node_modules` 不進 production
  （node 只用於煙測與簡報產生器）。

## Demo 風險管理（完成度 10% 的保險）

- `frontend/mocks/` 內建離線模式：API 失敗時自動 fallback 預錄回應（`account.js`／`chat.js`／
  `home.js`／`onboarding.js`）。
- 決賽前錄好完整 Demo 影片作最終備援。
- `data/health_report.json` 為靜態預計算，Demo 首屏零外部依賴。
- 比賽環境沒有 MAX 金鑰時走示範帳戶，但畫面必須有明確標示（`scripts/smoke_demo_account.js` 守這條）。

## 開發順序（每步完成都可獨立 Demo）

1. analysis/（無外部依賴）→ 2. agent/ + Read 工具 → 3. frontend/
→ 4. Private API 下單流（Lv2 KYC 核可後）→ 5. 離線備援 + 預錄影片。
