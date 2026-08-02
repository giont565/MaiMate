# Design — chat-agent

## Architecture

前端 → POST /chat（Lambda）→ `backend/agent/loop.py`（Bedrock Converse tool-use 迴圈）
→ `tools.py` dispatch → integrations（health_report / max_public / max_private）。
下單走雙段：prepare（LLM 可見）→ 前端確認 → POST /order → execute（**LLM 不可見**）。

## LLM 可見的工具

| 工具 | 資料源 | 說明 |
|---|---|---|
| `query_user_history` | `data/health_report.json` | 個人行為指標，回傳附 `key_findings` |
| `get_market_data` | MAX Public API | ticker / kline / depth，附資料時間 |
| `get_account_balance` | MAX Private API（Read） | 即時餘額；無金鑰時走示範帳戶 |
| `calculate_trade_scenarios` | 程式計算 | 三方案（金額／手續費／集中度／行為註記） |
| `compare_entry_strategies` | `data/strategy_report.json` | 三種進場方式×三情境對等呈現 |
| `prepare_order` | — | 只產確認卡＋token，**不下單** |
| `query_knowledge` | Bedrock KB | 設定 `KB_ID` 時才註冊，回答附出處 |

`execute_order` 既不在工具清單、也不在 `_DISPATCH` 分派表——
模型就算幻覺出這個名字，也沒有東西會執行它。

## Components

| 元件 | 職責 | 現況 |
|---|---|---|
| `agent/loop.py` | Converse 迴圈、8 輪上限、模型路由、工具結果回填 | 完成 |
| `agent/tools.py` | 工具 schema 與 dispatch；pending order 管理 | 完成 |
| `agent/guardrails.py` | PII 清洗、明牌句式攔截、安全回覆 | 完成 |
| `handlers/chat.py` | 入口、清洗、輸出檢查、帶出 `confirm`／`scenarios`／`tool_trail` | 完成 |
| `handlers/order.py` | token 驗證（DynamoDB）、送單 | 完成 |

## Key Decisions

1. **模型分工**：日常對話與工具調度用 Haiku，深度歸因用 Sonnet，由 `pick_model` 依意圖選。
   modelId 必須是帶日期的完整 inference profile ID——短別名會讓深度意圖問題整批 500，
   而驗收腳本沒有一句會觸發深度意圖，所以測不到（見 `.kiro/steering/tech.md`）。
2. **prepare/execute 分離**：唯一能送單的函式不在 LLM 工具清單，token 60 秒單次有效存 DynamoDB。
3. **health_report 靜態預計算**：`query_user_history` 零外部依賴、零延遲。
4. **三方案一律對等呈現**：SYSTEM 規則禁止模型自行標「✓ 推薦」——實測約 1/6 機率會自己加，
   與 UI 相矛盾且踩紅線 1。這條修在 SYSTEM 規則而不是護欄：
   護欄一命中會把整段回覆換成安全罐頭語，反問敘事會整個消失，比原問題更糟。
5. **進場方式比較走護欄**（與上一條相反的取捨）：pattern 強制帶「你／您」，
   只攔祈使句、放行中性比較與教育敘述。誤攔的代價同樣是整段被換掉，
   所以改 pattern 前先看 `tests/test_guardrails.py::EntryMethodAdviceTests`——
   有一半案例就在守「不誤攔」。

## Error Handling

工具失敗 → `toolResult status=error` 回填，讓模型自行調整說法；
上游 API 失敗 → 結構化錯誤 `{code, message, retryable}`；
前端等待逾時 → 顯示逾時提示與取消鈕，不讓使用者卡在轉圈畫面（PR #76）。
