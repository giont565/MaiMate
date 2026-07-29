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

- [x] execute_order 不在 LLM 工具清單（tools.TOOLS）內 — 已實作＋回歸測試
- [x] token 過期／重放皆回 410，不重試 — 已實作＋回歸測試（tests/test_order_flow.py）
- [ ] API Key 只開「讀取＋交易」，不開「提領」 — 人工設定，Demo 前檢查
- [ ] 金鑰只從環境變數／Secrets Manager 讀 — 已實作（max_private._keys）
- [ ] Demo 使用最小額度測試單

## 待辦

- [x] chat handler 將 prepare_order 的結果以 `confirm` 欄位回傳前端（loop.py:130 攔截，chat.py:37 帶出）
- [x] Lv2 API Key 建立與權限設定（本人操作）— 07/29 實測 `/api/v3/info` 回 `level: 2`
- [x] volume_twd → base volume 換算（max_private.resolve_volume，含最小量／精度檢查）
- [ ] 端到端測試：最小額度真實下單一次 — **需先重部署**（線上跑的還是 2014 那版），
      且 `sam deploy` 會洗掉手動設的金鑰，照 DEPLOY.md「部署後手動設定」重做
