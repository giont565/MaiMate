"""POST /chat — 對話入口。

body（README §3）: {"messages": [...Converse 格式...], "mode": "cautious|growth|pro"?, "session_id": "uuid"?}
mode 未傳則由 profile engine 從 health_report 推斷。
"""
import json

from ..agent import audit, guardrails, loop, profile


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    messages = body.get("messages") or []
    if not messages:
        return _resp(400, {"code": "bad_request", "message": "messages 不可為空", "retryable": False})
    audit.set_session(body.get("session_id"))

    # 輸入清洗：最後一則使用者訊息去個資
    last = messages[-1]
    for block in last.get("content", []):
        if "text" in block:
            block["text"] = guardrails.scrub_input(block["text"])

    prof = profile.profile_for(mode=body.get("mode"))
    out, confirm_data, tool_trail, scenarios_data = loop.run_agent(messages, profile=prof)
    text = "".join(b.get("text", "") for b in out.get("content", []))
    ok, _hits = guardrails.check_output(text)
    if not ok:
        text = guardrails.SAFE_FALLBACK
    payload = {"reply": text, "messages": messages, "mode": prof["mode"]}
    if confirm_data:
        payload["confirm"] = confirm_data
    if scenarios_data:
        payload["scenarios"] = scenarios_data
    if tool_trail:
        payload["tool_trail"] = tool_trail
    return _resp(200, payload)


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
