# Design — chat-agent

## Architecture

前端 SPA → POST /chat（Lambda）→ agent/loop.py（Bedrock Converse tool-use 迴圈）
→ tools.py dispatch → integrations（health_report / max_public / max_private）。
下單走雙段：prepare（LLM 可見）→ 前端確認 → POST /order → execute（LLM 不可見）。

## Components

| 元件 | 職責 | 現況 |
|---|---|---|
| agent/loop.py | Converse 迴圈、8 輪上限、工具結果回填 | 骨架完成 |
| agent/tools.py | 工具 schema 與 dispatch；pending order 管理 | 骨架完成 |
| agent/guardrails.py | PII 清洗、明牌句式攔截 | 完成 |
| handlers/chat.py | 入口、清洗、輸出檢查 | 完成（缺 confirm 欄位帶出） |
| handlers/order.py | token 驗證（DynamoDB）、送單 | 完成 |

## Key Decisions

1. **模型分工**：日常/工具調度 Haiku、深度分析 Sonnet；modelId 以主控台 us. 開頭
   inference profile 為準。
2. **prepare/execute 分離**：唯一能送單的函式不在 LLM 工具清單，
   token 60 秒單次有效存 DynamoDB。
3. **health_report 靜態預計算**：query_user_history 零外部依賴、零延遲。

## Error Handling

工具失敗 → toolResult status=error 回填，讓模型自行調整說法；
上游 API 失敗 → 結構化錯誤 {code, message, retryable}。
