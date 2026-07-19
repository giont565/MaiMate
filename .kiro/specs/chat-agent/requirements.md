# Requirements — chat-agent

## Introduction

對話 Agent：使用者以自然語言提問，AI 自主決定查個人歷史、查即時行情或交叉引用，
並在使用者明確授權下發起下單確認流。

## Requirements

### R1 個人化回答

**User Story:** 作為 MAX 用戶，我想用一句話問自己的操作表現，得到引用具體數字的回答。

#### Acceptance Criteria

1. WHEN 使用者問題涉及個人狀況 THEN 系統 SHALL 先呼叫 query_user_history 再回答
2. WHEN 回答引用個人指標 THEN 系統 SHALL 附上具體數字（如追高 65%、機會成本 NT$26,598,877）
3. IF health_report.json 無對應區塊 THEN 系統 SHALL 如實說明資料不足，不得編造

### R2 市場問答

**User Story:** 作為用戶，我想問市場現況，得到即時且附時間的回答。

#### Acceptance Criteria

1. WHEN 問題涉及行情 THEN 系統 SHALL 呼叫 get_market_data 並在回答附資料時間
2. WHEN 問題同時涉及個人與市場 THEN 系統 SHALL 交叉引用兩者（如現價 vs 個人持倉集中度）
3. WHEN 使用者要求買賣建議 THEN 系統 SHALL 給脈絡與數據、不給明牌（紅線）

### R3 授權式下單

**User Story:** 作為用戶，我想一句話發起下單，但成交前必須經過我明確確認。

#### Acceptance Criteria

1. WHEN 使用者表達下單意圖 THEN 系統 SHALL 只呼叫 prepare_order 產生確認卡與 token
2. WHEN chat 回應含 prepare_order 結果 THEN 回應 SHALL 以 confirm 欄位帶出確認卡供前端渲染
3. WHEN token 逾 60 秒或已使用 THEN /order SHALL 回 410 且不重試
4. execute_order SHALL NOT 出現在 LLM 可見的工具清單

### R4 安全與品質

1. WHEN 使用者輸入含個資（身分證/手機/卡號） THEN 系統 SHALL 先清洗再送模型
2. WHEN 模型輸出命中明牌句式 THEN 系統 SHALL 改走安全回覆
3. Agent 迴圈 SHALL 以 8 輪為上限
