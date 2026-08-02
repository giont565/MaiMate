# Tasks — order-flow

- [x] 1. `prepare_order` 工具（產確認卡＋token）；`execute_order` 隔離於 TOOLS 與 dispatch 表外
  - 回歸測試：`tests/test_order_flow.py`
- [x] 2. token 存 DynamoDB（`order#<token>`，60 秒單次），本地開發 fallback 記憶體
- [x] 3. `chat` handler 以 `confirm` 欄位帶出確認卡（`loop.py` 攔截 → `handlers/chat.py` 帶出）
- [x] 4. 前端確認卡渲染＋倒數＋按鈕鎖定
- [x] 5. `resolve_volume`：TWD → base volume，含最小下單量與精度檢查（捨去不四捨五入）
- [x] 6. Lv2 API Key 建立與權限設定（只開讀取＋交易，不開提領）
  - 07/29 實測 `/api/v3/info` 回 `level: 2`
- [x] 7. token 過期／重放回 410 且不重試 —— 單元測試＋線上實測
  - 實測：1.7 秒內連按三次確認，一次成交、其餘 410
- [x] 8. **最小額度真實成交 E2E**（issue #4）
  - 實測：MAX 真實成交兩筆（`#20720919534`／`#20721028463`），
    交易所 App 推播與帳戶餘額變動為證
- [x] 9. 沒有 MAX 金鑰時的示範帳戶回退＋四道畫面標示（PR #78）
  - 煙測：`npm run smoke:demo`
- [x] 10. 生命週期留痕（draft → confirmed → executed），`GET /audit` 可還原

## 未完成

- [ ] 11. D14 人工驗證：確認卡產生後等 61 秒再按確認，親眼看到 410
  - 自動化測不了這項（真按下去等於送單），腳本目前只測等價性質「過期後憑證撈不到」
- [ ] 12. 官方環境的真實成交重現
  - 官方環境的 Lambda 缺 MAX 金鑰（issue #70）；補上金鑰前該環境走示範帳戶
