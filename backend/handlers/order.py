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
    order = _pop_order(token)
    if order is None:
        audit.log("expired", confirm_token=token)
        return _resp(410, {"code": "token_expired", "message": "確認憑證無效或已過期，請重新發起", "retryable": False})
    audit.log("user_confirmed", confirm_token=token, market=order.get("market"),
              side=order.get("side"), volume_twd=order.get("volume_twd"))
    from ..integrations import max_private
    result = max_private.place_order(order)
    audit.log("executed", confirm_token=token,
              exchange_order_id=(result or {}).get("id") if isinstance(result, dict) else None)
    return _resp(200, {"ok": True, "order": order, "exchange_response": result})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
