"""GET /audit?session_id= — 決策軌跡查詢（#12）。

回傳 {"trail": [{seq, ts, type, payload}]}（README §3 契約）；前端「決策軌跡」面板用。
"""
import json

from ..agent import audit


def handler(event, context):
    sid = (event.get("queryStringParameters") or {}).get("session_id")
    if not sid:
        return _resp(400, {"code": "bad_request", "message": "缺少 session_id", "retryable": False})
    return _resp(200, {"session_id": sid, "trail": audit.trail(sid)})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
