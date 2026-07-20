"""POST /chat — 對話入口。body: {"messages": [...Converse 格式...]}"""
import json

from ..agent import guardrails, loop


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    messages = body.get("messages") or []
    if not messages:
        return _resp(400, {"code": "bad_request", "message": "messages 不可為空", "retryable": False})

    # 輸入清洗：最後一則使用者訊息去個資
    last = messages[-1]
    for block in last.get("content", []):
        if "text" in block:
            block["text"] = guardrails.scrub_input(block["text"])

    out, confirm_data, tool_trail = loop.run_agent(messages)
    text = "".join(b.get("text", "") for b in out.get("content", []))
    ok, _hits = guardrails.check_output(text)
    if not ok:
        text = guardrails.SAFE_FALLBACK
    payload = {"reply": text, "messages": messages}
    if confirm_data:
        payload["confirm"] = confirm_data
    if tool_trail:
        payload["tool_trail"] = tool_trail
    return _resp(200, payload)


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
