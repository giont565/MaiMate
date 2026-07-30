"""POST /order — 下單確認流的第二段（execute）。

body: {"confirm_token": "..."}
唯一能真正送單的入口：前端在使用者按下確認卡後呼叫。
LLM 只能透過 prepare_order 產生確認卡，碰不到這裡。
憑證正式版存 DynamoDB（TABLE_NAME 環境變數）；本地開發 fallback 記憶體。
"""
import json
import os
import time

from ..agent import tools

TABLE = os.environ.get("TABLE_NAME")

if TABLE:
    import boto3
    _ddb = boto3.resource("dynamodb").Table(TABLE)


def _pop_order(token):
    if not TABLE:
        # 記憶體 fallback 也要驗過期，否則本地／單機測出來的 410 行為與線上不同。
        order = tools._pending_orders.pop(token, None)
        if order and order.get("expires_at", 0) > time.time():
            return order
        return None
    item = _ddb.delete_item(Key={"pk": f"order#{token}"}, ReturnValues="ALL_OLD").get("Attributes")
    if item and item.get("expires_at", 0) > time.time():
        return json.loads(item["order"])
    return None


def handler(event, context):
    from ..agent import audit
    body = json.loads(event.get("body") or "{}")
    token = body.get("confirm_token")
    audit.set_session(body.get("session_id"))
    if not token:
        return _resp(400, {"code": "bad_request", "message": "缺少 confirm_token", "retryable": False})
    if body.get("action") == "cancel":
        # 使用者主動喊停。「AI 不會自己下單」是紅線賣點，使用者按下取消卻在軌跡上
        # 留不下任何證據很可惜；順帶讓憑證立刻失效，不要讓它在剩下的 TTL 裡繼續可用。
        order = _pop_order(token)
        audit.log("user_cancelled", confirm_token=token,
                  market=(order or {}).get("market"), side=(order or {}).get("side"),
                  volume_twd=(order or {}).get("volume_twd"))
        return _resp(200, {"ok": True, "cancelled": True, "message": "已取消，沒有送出任何訂單"})

    order = _pop_order(token)
    if order is None:
        audit.log("expired", confirm_token=token)
        return _resp(410, {"code": "token_expired", "message": "確認憑證無效或已過期，請重新發起", "retryable": False})
    audit.log("user_confirmed", confirm_token=token, market=order.get("market"),
              side=order.get("side"), volume_twd=order.get("volume_twd"))
    from ..integrations import max_private
    try:
        result = max_private.place_order(order)
    except ValueError as e:
        # 下單前的檢查沒過（低於交易所最低量、取不到現價…）。這是使用者看得懂、
        # 也改得了的狀況，不該以 500 Internal Server Error 呈現——實測就是這樣讓
        # 使用者按下確認後只看到一句「Internal Server Error」。憑證已被消耗，
        # 所以請他重新發起而不是重按。
        audit.log("rejected", confirm_token=token, reason=str(e),
                  market=order.get("market"), side=order.get("side"),
                  volume_twd=order.get("volume_twd"))
        return _resp(400, {"code": "order_rejected", "message": str(e), "retryable": False})
    audit.log("executed", confirm_token=token,
              exchange_order_id=(result or {}).get("id") if isinstance(result, dict) else None)
    return _resp(200, {"ok": True, "order": order, "exchange_response": result})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
