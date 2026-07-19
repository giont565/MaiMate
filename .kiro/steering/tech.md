# Tech Steering — 技術棧約定

## 架構（四層 serverless）

前端 React SPA（S3 + CloudFront）→ API Gateway + Lambda（Python 3.12）
→ AI 層 Bedrock（Converse API + tool use、Guardrails）→ 資料層 S3 / DynamoDB / MAX API。

## 硬性規定

1. **模型僅限 AWS Bedrock 提供之基礎模型**（競賽規定）。modelId 一律使用
   `us.` 開頭的跨區 inference profile ID，實際 ID 以主控台為準。
2. 呼叫模型一律走 **Converse API**（跨模型通用，換模型不改程式）。
3. Agent 迴圈上限 8 輪，防止失控燒 token。
4. 對外 API 呼叫（MAX/第三方）一律包 **快取 + 指數退避重試**；行情快取 TTL 5 秒。
5. 下單確認 token 存 DynamoDB，60 秒過期、單次有效。

## 程式風格

- Python：標準函式庫優先，重依賴（pandas 等）只用在離線分析，Lambda 內不用。
- 每個 Lambda handler 單一職責：/chat /health /market /order 四支。
- 錯誤回應一律結構化 JSON（code / message / retryable）。

## Demo 風險管理（完成度 10% 的保險）

- frontend/src/mock/ 內建離線模式：API 失敗時自動 fallback 預錄回應。
- 決賽前錄好完整 Demo 影片作最終備援。
- health_report.json 為靜態預計算，Demo 首屏零外部依賴。

## 開發順序（每步完成都可獨立 Demo）

1. analysis/（無外部依賴）→ 2. agent/ + Read 工具 → 3. frontend/
→ 4. Private API 下單流（Lv2 KYC 核可後）→ 5. 離線備援 + 預錄影片。
