"""GET /market?market=btctwd&kind=ticker — 行情代理（含快取）。"""
import json

from ..integrations import max_public


def handler(event, context):
    q = event.get("queryStringParameters") or {}
    market = q.get("market", "btctwd")
    kind = q.get("kind", "ticker")
    period = q.get("period")
    try:
        data = max_public.fetch(market, kind, period=period)
        return _resp(200, data)
    except ValueError as e:
        return _resp(400, {"code": "bad_request", "message": str(e), "retryable": False})
    except Exception:
        return _resp(502, {"code": "upstream_error", "message": "MAX API 暫時無法取得", "retryable": True})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
