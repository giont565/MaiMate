# Design — behavior-engine

## Architecture

```
data/MaiCoin_transactions.csv （不進 git，放 Drive/S3）
        │  analysis/precompute.py（標準函式庫，無外部依賴，本機離線跑）
        ▼
data/health_report.json ── backend/agent/tools.query_user_history ── Agent
        │
        └─ backend/handlers/health.py → GET /health?section=…  → 前端首屏
```

單向資料流：**CSV 只在離線階段被讀一次**，線上路徑（Lambda／前端）永遠只碰 JSON。
所以 Demo 現場不需要 CSV、不需要重算，也就不會在台上因為資料處理慢而卡住。

## Components

| 元件 | 職責 |
|---|---|
| `analysis/precompute.py` | 解析 CSV → 五組指標＋已實現損益＋三組聚合，輸出 JSON |
| `data/health_report.json` | 唯一事實來源；欄位定義見 `.kiro/steering/data-schema.md` |
| `backend/agent/tools.py` | `query_user_history(section)` 依區塊回傳，附 `key_findings` |
| `backend/handlers/health.py` | `GET /health?section=all\|chase_index\|…` |

## 輸出區塊

`generated_at`／`row_count`／`period`／`chase_index`／`opportunity_cost`／`realized_pnl`／
`concentration`／`cash_flow_behavior`／`activity_profile`／`holdings_snapshot`／
`change_attribution`／`holding_period_distribution`

## Key Decisions

1. **標準函式庫實作，不用 pandas**：Lambda 不需要裝重依賴，任何人 `python3` 直接跑得動。
2. **欄位尾端空白要 strip**：原始 CSV 每行尾端有多餘空白，`fieldnames` 與值都要處理，
   否則欄位對不上而且不會報錯——只會全部算成 0。
3. **已實現損益用移動平均成本法**：先進先出與移動平均會給出不同數字，
   輸出裡帶 `method` 欄位標明採用哪一種，避免被問到時說不清楚。
4. **機會成本與已實現損益並列輸出**：這兩個數字合起來才是完整敘事
   （少賺 2,660 萬、真實只虧 963、整年其實賺 117,482），單獨拿一個出來講都會誤導。

## Error Handling

- CSV 不存在／欄位對不上 → 直接 raise，不產生半套 JSON（半套 JSON 會安靜地讓前端顯示錯值）。
- 前端與 handler 面對缺區塊 → 顯示「資料不足」並隱藏該區塊，不得填 0 或占位符。
