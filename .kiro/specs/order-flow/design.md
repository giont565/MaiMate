# Design — order-flow

## Architecture

```
使用者：「用 5,000 買 BTC」
   │
   ▼  POST /chat
agent/loop.py ──呼叫──► tools.prepare_order   （LLM 可見，只產草稿）
   │                        │ 產生 confirm_token（60s、單次）→ DynamoDB
   │◄───────────────────────┘
   │  回應帶 confirm 欄位
   ▼
前端渲染確認卡 ──使用者按「確認」──► POST /order
                                      │  handlers/order.py
                                      │  1. 撈 token（撈不到／過期 → 410）
                                      │  2. 先刪 token（單次性靠這一步保證）
                                      │  3. integrations/max_private.place_order
                                      ▼
                                   MAX 交易所成交 → 回填對話 → 健檢重載
```

**雙段分離就是這張圖的重點**：上半段 LLM 碰得到但送不出單，下半段送得出單但 LLM 碰不到，
中間隔著一個只有人能按的按鈕。

## Components

| 元件 | 職責 |
|---|---|
| `backend/agent/tools.py` | `prepare_order` toolSpec 與實作；`execute_order` **不在** TOOLS 與 dispatch 表 |
| `backend/handlers/order.py` | token 驗證與銷毀、呼叫 place_order、結構化錯誤 |
| `backend/integrations/max_private.py` | 簽章、`resolve_volume`（TWD→base，含最小量與精度）、下單 |
| `backend/agent/audit.py` | 生命週期埋點 |
| `frontend/chat.js` | 確認卡渲染、倒數、按鈕鎖定（防連按） |

## Key Decisions

1. **先刪 token 再送單**：順序反過來的話，連按在成交回應返回前會通過第二次驗證。
   單次性由「刪除成功才繼續」保證，不是靠前端鎖按鈕（前端鎖只是體驗，不是安全機制）。
2. **60 秒而不是 5 分鐘**：時間窗越短，重放與「離開座位後被別人按下去」的風險越小；
   代價是使用者猶豫太久要重新產生，這個代價可以接受。
3. **金額改用 TWD 表達**：使用者講的是「5,000 塊」，不是「0.0001 BTC」。
   換算與精度檢查放在 `max_private.resolve_volume`，錯誤在送出前就攔。
4. **沒有金鑰時走示範帳戶而不是報錯**：比賽環境拿不到金鑰時，Demo 仍要走得完，
   但四道視覺標示保證看得出來不是真帳戶（`scripts/smoke_demo_account.js` 守這條）。

## Error Handling

| 情況 | HTTP | code | retryable |
|---|---|---|---|
| token 過期／不存在／已使用 | 410 | `token_expired` | false |
| 低於交易所最小下單量 | 400 | `below_min_order` | false |
| 交易所回錯（含簽章 2014） | 502 | `exchange_error` | 視情況 |
| 沒有金鑰 | — | 走示範帳戶並標示 | — |

## 踩過的六個坑（每一個都足以讓下單失敗）

簽章 2014／volume 讀錯 key／憑證沒寫進 DynamoDB／三方案金額低於交易所下限／
貼齊門檻時被四捨五入到門檻以下／確認鈕連按。
**共同特徵：單元測試全綠，只有真的送一次單才會發現。**
