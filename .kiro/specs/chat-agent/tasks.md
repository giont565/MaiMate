# Tasks — chat-agent

- [x] 1. Agent 迴圈骨架（`loop.py`：Converse + tool use + 8 輪上限）
- [x] 2. 工具定義與 dispatch（`tools.py`：LLM 可見工具 7 個、`KB_ID` 設定時自動加掛
      `query_knowledge`、`execute_order` 隔離於清單與分派表之外）
- [x] 3. 護欄（`guardrails.py`：PII 清洗 + 明牌攔截 + 安全回覆）
- [x] 4. `/chat` handler（輸入清洗、輸出檢查）
- [x] 5. `loop.py` 將 `prepare_order` 的工具結果帶出至回應的 `confirm` 欄位
- [x] 6. `max_public.fetch` 串真 API 並以 btctwd ticker 煙霧測試
- [x] 7. Lv2 API Key 設定後 `get_account_balance` 端到端測試
  - 07/29 實測 `/api/v3/info` 回 `level: 2`；真實成交後帳戶餘額變動可對帳
- [x] 8. 模型分工：依訊息意圖選 Haiku/Sonnet（含「歸因／分析／為什麼」升級）
  - 08/01 修正：`MODEL_SONNET` 原本用了不存在的短別名，深度意圖問題一律 500；
    改為帶日期的完整 inference profile ID 後兩套環境皆已部署驗過
- [x] 9. 三方案對等呈現：SYSTEM 規則禁止模型自標「✓ 推薦」（實測約 1/6 機率會自己加）
- [x] 10. 端到端 Demo 劇本測試（三步一條龍，含真實成交）
  - 對應 `docs/TEST_CHECKLIST.md` D7–D15

## 未完成

- [ ] 11. Bedrock Guardrails 建立與掛載（issue #6）
  - 程式接點已就緒，設 `GUARDRAIL_ID` 即生效；目前**刻意不啟用**：
    要正確運作需對 input／output 套用不同政策，賽程內來不及調校，
    誤攔的代價是整段回覆被換成安全罐頭語。現階段靠 SYSTEM 規則＋`guardrails.py` 兩層。
- [ ] 12. `risk_mode` 未帶時由 profile engine 推斷值填入（目前預設 growth）
- [ ] 13. D16 語氣切換人工驗收：同一句「幫我全賣」跑三種模式，肉眼可辨
