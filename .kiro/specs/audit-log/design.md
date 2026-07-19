# Design — audit-log

## 位置

`backend/agent/audit.py`（新檔）＋ loop.py dispatch 埋點＋ order.py 事件埋點
＋ handlers/audit.py（新 GET endpoint）＋ SAM 路由。

## 儲存

共用現有 DynamoDB SessionTable（省資源）：
- pk = `audit#<session_id>`，屬性含 seq（遞增）、ts、type、payload(JSON)
- 本地開發 fallback：append 到記憶體 list（與 tools._pending_orders 同模式）

## 介面

```python
def log(session_id: str, type: str, **payload) -> None: ...
def trail(session_id: str) -> list[dict]: ...   # 依 seq 排序
```

埋點位置：
1. `loop.py` dispatch 前後（tool_call，含 status success/error）
2. `tools.prepare_order`（draft_created）
3. `handlers/order.py`（user_confirmed / expired / executed）

## session_id 來源

前端產生 uuid 存 sessionStorage，隨每個 /chat /order 請求帶上；handler 透傳。

## Demo 面板

前端「決策軌跡」摺疊區：時間軸列出 tool 呼叫與訂單事件，
Golden Path 演完點開——這就是簡報第 9 頁「看得見的 AI」的實體。
