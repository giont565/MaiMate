# Tasks — audit-log

- [x] 1. `audit.py`：log/trail 實作（DynamoDB＋本地 fallback）
- [x] 2. loop.py dispatch 埋點（tool_call 前後）
- [x] 3. prepare_order／order handler 生命週期埋點
- [x] 4. 前端 session_id（uuid + sessionStorage）隨請求帶上
- [x] 5. `GET /audit` handler＋SAM 路由
- [x] 6. 前端「決策軌跡」摺疊面板
- [x] 7. 驗收：跑完 Golden Path，trail 完整依序含 tool_calls + draft→confirmed→executed
  - 實測軌跡 13 列、含兩筆真實成交（`TEST_CHECKLIST` D15）
  - ⚠ 軌跡存在**產生它的那套環境**的 DynamoDB；換環境查同一個 `session_id` 會回空陣列，
    要重現得在該環境重跑一次 Golden Path
