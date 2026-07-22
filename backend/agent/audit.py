"""Audit Log（#12，spec: .kiro/specs/audit-log/）。

append-only 留痕：工具呼叫＋訂單生命週期（draft_created → user_confirmed /
expired / cancelled → executed）。GET /audit?session_id= 可還原完整決策軌跡。
儲存共用 SessionTable：pk = audit#<session_id>，單一 item 的 events list 以
UpdateExpression list_append 追加（原子、append-only，程式不提供更新/刪除路徑）。
本地開發 fallback：記憶體 dict（與 tools._pending_orders 同模式）。
input_summary 只記摘要（如 market=ethtwd），不記使用者原文或 PII。
"""
import json
import os
import time

TABLE = os.environ.get("TABLE_NAME")
_local = {}          # session_id -> [events]（本地 fallback）
_current = {"sid": None}   # Lambda 單請求單執行緒；handler 進入時 set_session

if TABLE:
    import boto3
    _ddb = boto3.resource("dynamodb").Table(TABLE)


def set_session(session_id):
    _current["sid"] = session_id or "anon"


def log(event_type, **payload):
    """寫一筆稽核事件到目前 session。永不拋錯——稽核失敗不能弄壞主流程。"""
    sid = _current["sid"] or "anon"
    event = {"ts": round(time.time(), 3), "type": event_type, "payload": payload}
    try:
        if TABLE:
            _ddb.update_item(
                Key={"pk": f"audit#{sid}"},
                UpdateExpression="SET events = list_append(if_not_exists(events, :empty), :e)",
                ExpressionAttributeValues={":e": [json.dumps(event, ensure_ascii=False)], ":empty": []},
            )
        else:
            _local.setdefault(sid, []).append(event)
    except Exception:
        pass


def trail(session_id):
    """依寫入順序回傳 [{seq, ts, type, payload}]。"""
    if TABLE:
        item = _ddb.get_item(Key={"pk": f"audit#{session_id}"}).get("Item") or {}
        events = [json.loads(e) for e in item.get("events", [])]
    else:
        events = _local.get(session_id, [])
    return [{"seq": i + 1, **e} for i, e in enumerate(events)]
