# Tasks — audit-log

- [ ] 1. `audit.py`：log/trail 實作（DynamoDB＋本地 fallback）
- [ ] 2. loop.py dispatch 埋點（tool_call 前後）
- [ ] 3. prepare_order／order handler 生命週期埋點
- [ ] 4. 前端 session_id（uuid + sessionStorage）隨請求帶上
- [ ] 5. `GET /audit` handler＋SAM 路由
- [ ] 6. 前端「決策軌跡」摺疊面板
- [ ] 7. 驗收：跑完 Golden Path，trail 完整依序含 tool_calls + draft→confirmed→executed
