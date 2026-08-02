"""POST /chat — 對話入口。

body（README §3）: {"messages": [...Converse 格式...], "mode": "cautious|growth|pro"?, "session_id": "uuid"?}
mode 未傳則由 profile engine 從 health_report 推斷。
"""
import json

from ..agent import audit, demo_account, guardrails, loop, profile

# 用到帳戶資料的工具。示範帳戶標示只在這段對話真的碰過帳戶資料時才加——
# 「什麼是手續費」這種與帳戶無關的問題被貼上示範帳戶前綴，反而是另一種不誠實。
# prepare_order 一定要在名單裡：Golden Path 第二輪（點方案卡 → 出確認卡）本輪只跑這一支，
# 漏了它，台上最關鍵的那張確認卡就會是「程式標示 0 道」的裸卡。
_ACCOUNT_TOOLS = {"get_account_balance", "calculate_trade_scenarios", "prepare_order"}


def handler(event, context):
    """POST /chat；另外兼服務 GET /portfolio。

    為什麼擠在同一支函式：MAX_API_KEY／SECRET 刻意不進版控，是部署後由人在 Lambda
    主控台加上去的（DEPLOY.md §2）。另開一支 PortfolioFunction 就得再手動加一次金鑰，
    漏了會安靜地拿不到餘額；ChatFunction 已經有金鑰了。分流放在最前面，不碰下面的對話流程。
    """
    route = (event.get("requestContext") or {}).get("http") or {}
    path = str(route.get("path") or "").rstrip("/")
    if route.get("method") == "GET" and path.endswith("/portfolio"):
        from . import portfolio
        return portfolio.handler(event, context)
    if route.get("method") == "GET" and path.endswith("/behavior"):
        from . import behavior
        return behavior.handler(event, context)

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
    used_knowledge_base = any(
        item.get("tool") == "query_knowledge"
        for item in (tool_trail or [])
        if isinstance(item, dict)
    )
    ok, _hits = guardrails.check_output(text, educational=used_knowledge_base)
    if not ok:
        text = guardrails.SAFE_FALLBACK
    payload = {"reply": text, "messages": messages, "mode": prof["mode"]}
    # 示範帳戶模式的第二道標示：由**程式**保證回覆講明，不靠模型自律
    # （工具的 data_notes 是第一道、前端橫幅是第三道；任一道失效還有另外兩道）。
    # 放在 check_output 之後，這句固定文案不參與護欄判定。
    if demo_account.in_use() and _touched_account_data(messages, tool_trail):
        as_of = demo_account.as_of()
        payload["account_source"] = demo_account.ACCOUNT_SOURCE
        payload["account_notice"] = demo_account.notice(as_of)
        if "示範帳戶" not in text:
            payload["reply"] = demo_account.reply_prefix(as_of) + text
    if confirm_data:
        payload["confirm"] = confirm_data
    if scenarios_data:
        payload["scenarios"] = scenarios_data
    if tool_trail:
        payload["tool_trail"] = tool_trail
    return _resp(200, payload)


def _touched_account_data(messages, tool_trail):
    """這**段對話**碰過帳戶資料沒有——看整段歷史，不是只看這一輪。

    只看本輪 tool_trail 會無聲地漏掉兩種最常出現的輪次，而且漏掉時三道標示同時歸零
    （payload 沒有 account_source → 前端不出橫幅；也不加回覆前綴），只剩模型自律：
      ① 追問輪：「我帳戶裡有哪些幣？」→「那 TWD 佔比多少？」第二題模型直接引用歷史裡
         上一輪的工具結果作答，本輪 tool_trail 是空的。實測這種輪次會講出
         「TWD 佔**你帳戶**的 98.6%」——把示範資料講成使用者的真帳戶，正是要防的紅線。
      ② 確認卡那一輪：本輪只跑 prepare_order（已補進 _ACCOUNT_TOOLS）。
    messages 是 Converse 歷史，loop.py 每一輪都把 toolUse 區塊原樣留在裡面，
    所以掃它一次就同時涵蓋本輪與先前所有輪次。
    """
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        for block in msg.get("content") or []:
            tool_use = block.get("toolUse") if isinstance(block, dict) else None
            if isinstance(tool_use, dict) and tool_use.get("name") in _ACCOUNT_TOOLS:
                return True
    return any(item.get("tool") in _ACCOUNT_TOOLS
               for item in (tool_trail or []) if isinstance(item, dict))


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
