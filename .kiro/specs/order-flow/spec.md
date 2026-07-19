# Spec — 授權式下單流（order-flow）

## 目標

「提問 → AI 分析 → 確認卡 → 使用者授權 → 成交」的閉環，
同時滿足命題「對話式下單生態」與紅線「下單必經確認」。

## 流程

1. 使用者在對話中表達下單意圖（「用 5,000 買 BTC」）
2. LLM 呼叫 `prepare_order` → 產生確認卡 + confirm_token（60 秒、單次有效）
   - token 正式版存 DynamoDB（pk = `order#<token>`），本地開發 fallback 記憶體
3. 前端渲染確認卡（幣種／方向／金額／單型），使用者按「確認」
4. 前端 POST `/order` {confirm_token} → handler 驗證並刪除 token → `max_private.place_order`
5. 成交結果回填對話；健檢面板重新載入

## 安全需求

- [ ] execute_order 不在 LLM 工具清單（tools.TOOLS）內 — 已實作
- [ ] token 過期／重放皆回 410，不重試 — 已實作
- [ ] API Key 只開「讀取＋交易」，不開「提領」 — 人工設定，Demo 前檢查
- [ ] 金鑰只從環境變數／Secrets Manager 讀 — 已實作（max_private._keys）
- [ ] Demo 使用最小額度測試單

## 待辦

- [ ] chat handler 將 prepare_order 的結果以 `confirm` 欄位回傳前端（loop 需把工具結果帶出）
- [ ] Lv2 API Key 建立與權限設定（本人操作）
- [ ] 端到端測試：最小額度真實下單一次
