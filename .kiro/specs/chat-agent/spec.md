# Spec — 對話 Agent（chat-agent）

## 目標

Bedrock Converse API tool-use 迴圈：AI 自主決定查個人歷史、查即時行情或交叉引用，
展現「上下文理解、主動分析數據」（評分 AI設計 15% 的原文要求）。

## 工具（LLM 可見）

| 工具 | 資料源 | 說明 |
|---|---|---|
| query_user_history | health_report.json | 個人行為指標 |
| get_market_data | MAX Public API | ticker / kline / depth |
| get_account_balance | MAX Private API (Read) | 即時餘額 |
| prepare_order | — | 只產確認卡＋token，不下單 |

execute_order 不在 LLM 工具清單，僅由 /order handler 於前端確認後觸發。

## 驗收劇本（Demo 一條龍）

1. 「我去年操作表現怎麼樣？」→ 呼叫 query_user_history → 引用追高 65%、機會成本數字
2. 「BTC 現在適合我加倉嗎？」→ 同時呼叫 get_market_data + query_user_history，
   交叉引用即時價與個人集中度，不給買賣建議、給脈絡
3. 「用 5000 買 BTC」→ prepare_order → 確認卡出現 → 確認後成交 → 餘額更新

## 待辦

- [ ] MAX Public API 串接（max_public.py，快取 5s + 指數退避）
- [ ] MAX Private API 串接（max_private.py，Lv2 KYC 核可後）
- [ ] Guardrails 設定（不報明牌 / 個資）
- [ ] 前端確認卡片元件與 /order handler
