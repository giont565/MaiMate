"""GET /behavior — 用真實帳戶的成交紀錄算行為健檢。

沒有 MAX 金鑰時回 409 並指向 /health（命題方示範資料集）——**不拿示範資料冒充真帳戶**，
那正是這整條要修的問題。
"""
import json


def handler(event, context):
    from ..agent import demo_account

    if demo_account.active():
        return _resp(409, {
            "code": "no_account_keys", "retryable": False,
            "message": "這個環境沒有 MAX 金鑰，算不出你自己的行為健檢。"
                       "GET /health 是命題方提供的示範資料集，不是你的帳戶。",
        })

    # 診斷用參數：一次抓十幾個市場會撞到 60 秒上限，要能單獨量測。
    #   ?markets=eth,btc  只抓指定市場   ?pages=1  每個市場只翻一頁
    q = event.get("queryStringParameters") or {}
    only = [c.strip().lower() for c in (q.get("markets") or "").split(",") if c.strip()]
    try:
        pages = max(1, min(int(q.get("pages") or 0), 20)) if q.get("pages") else None
    except ValueError:
        pages = None

    from ..agent import behavior
    try:
        return _resp(200, behavior.build_report(only=only or None, max_pages=pages))
    except Exception as exc:  # noqa: BLE001 — 連不上或翻頁失敗要說實話，不退回示範資料
        return _resp(503, {"code": "history_unavailable", "retryable": True,
                           "message": f"取不到成交紀錄：{exc}"})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
