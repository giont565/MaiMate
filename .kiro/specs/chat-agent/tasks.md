# Tasks — chat-agent

- [x] 1. Agent 迴圈骨架（loop.py：Converse + tool use + 8 輪上限）
- [x] 2. 工具定義與 dispatch（tools.py：5 個 LLM 工具、KB_ID 設定時自動加掛 query_knowledge + execute_order 隔離）
- [x] 3. 護欄（guardrails.py：PII 清洗 + 明牌攔截 + 安全回覆）
- [x] 4. /chat handler（輸入清洗、輸出檢查）
- [x] 5. loop.py 將 prepare_order 的工具結果帶出至 handler 回應的 confirm 欄位
  - 迴圈結束時掃描 messages 中最後一個 prepare_order 的 toolResult
  - handler 回應加入 {"confirm": {...}}；對應前端 addConfirmCard
- [x] 6. max_public.fetch 串真 API 並以 btctwd ticker 煙霧測試
- [ ] 7. Lv2 API Key 設定後，get_account_balance 端到端測試（本人操作金鑰）
- [x] 8. 模型分工：依訊息意圖選 Haiku/Sonnet（intent 簡則 Haiku，含「歸因/分析/為什麼」升級）
  - 07/21 pick_model 實作＋test_backend 路由單元測綠；Bedrock 真分流與 prompt caching 待部署驗（歸 #5 部署驗收）
- [ ] 9. Bedrock Guardrails 建立與掛載（不報明牌 / PII）
- [ ] 10. 端到端 Demo 劇本測試（S8 五步一條龍）
