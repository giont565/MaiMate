"""Bedrock Converse API tool-use 迴圈（Agent 核心）。"""
import os
import re

from . import audit, tools

# 以主控台實際顯示的 us. 開頭 inference profile ID 為準（見 tech.md）
# 模型分工路由（#5）：日常對話與工具調度走 Haiku；深度歸因/分析意圖升級 Sonnet
MODEL_HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MODEL_SONNET = "us.anthropic.claude-sonnet-4-5-v1:0"
MODEL_ID = MODEL_HAIKU  # 相容既有引用；實際每輪由 pick_model 決定
_DEEP_INTENT = re.compile(r"歸因|分析|為什麼|為何|檢討|評估|回顧|深入|總結|比較|解釋一下|怎麼看")
# prompt caching：真環境驗證通過後把 ENABLE_PROMPT_CACHE=1 設進 Lambda 環境變數（見 DEPLOY.md）
_CACHE_ON = os.environ.get("ENABLE_PROMPT_CACHE") == "1"
MAX_TURNS = 8

SYSTEM = [{"text": """你是 MaiMate，使用者的個人投資特助。

規則：
1. 永不主動建議買賣特定標的。你的角色是呈現事實與個人化脈絡，決策留給使用者。
2. 回答涉及使用者個人狀況時，必須先呼叫 query_user_history，並引用具體數字。
3. 回答市場問題時，必須呼叫 get_market_data 取得即時數據，並註明資料時間。
4. 使用者表達買賣意圖時，必須先呼叫 calculate_trade_scenarios 產生三方案
   （數字全由程式計算，你不得自行編造）；使用者選定方案後才呼叫 prepare_order
   產生確認卡片；實際下單由系統在使用者確認後執行，你無法直接下單。
5. 資料不支持的結論不要硬給；訊號矛盾時如實說明。
6. 「虧損」與「少賺」是兩件事，絕不混用：
   - 真實虧損/獲利＝realized_pnl（賣價 vs 平均買入成本，錢包實際賺賠）
   - 少賺＝機會成本 opportunity_cost（賣出後價格續漲的假設差額）——這不是虧損，
     不得說成「虧了」，要說「少賺」或「機會成本」。
   被問「虧最多」：優先給 realized_pnl 的最大單筆真實虧損；報告若沒有該區塊，
   先一句話說明「報告只有機會成本（少賺）」再直接給出最痛單筆少賺的日期、幣別、金額。
   永遠拿手上的數據回答，不要只建議使用者自己去平台查。
7. 金額一律「NT$」開頭並加千分位逗號（例：NT$312,924；小數照原值保留）。
8. 回覆會顯示在聊天氣泡裡：用簡短段落與編號列表，可用 **粗體** 強調數字；
   不要用標題（#）、表格或程式碼區塊語法。
"""}]

# 工具鏈 chips 用的中文標籤（前端「決策軌跡」與 tool_trail 欄位）
_TOOL_LABELS = {
    "query_user_history": "查交易史",
    "get_market_data": "查行情",
    "get_account_balance": "查餘額",
    "prepare_order": "擬定訂單草稿",
    "calculate_trade_scenarios": "方案試算",
    "query_knowledge": "查知識庫",
}


def _trail_summary(name, tool_input):
    label = _TOOL_LABELS.get(name, name)
    hint = tool_input.get("market") or tool_input.get("section") or ""
    return f"{label}（{hint}）" if hint else label


def pick_model(messages):
    """意圖路由（#5）：最後一則使用者訊息含深度分析意圖 → Sonnet，否則 Haiku。"""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            text = "".join(b.get("text", "") for b in msg.get("content", []) if "text" in b)
            if text:
                return MODEL_SONNET if _DEEP_INTENT.search(text) else MODEL_HAIKU
    return MODEL_HAIKU

_br = None


def _client():
    """延遲初始化（本地單元測不需 boto3；region 可用環境變數覆寫，見 DEPLOY.md）。"""
    global _br
    if _br is None:
        import boto3
        _br = boto3.client("bedrock-runtime",
                           region_name=os.environ.get("BEDROCK_REGION", "us-east-1"))
    return _br


def run_agent(messages, profile=None):
    """messages: Converse API 格式的對話歷史；profile: profile_for() 的結果（可選）。

    回傳 (assistant_message, confirm_data, tool_trail, scenarios_data)。
    confirm_data 為最後一次 prepare_order 的工具結果（含 confirm_token + confirmation_card）；
    scenarios_data 為最後一次 calculate_trade_scenarios 的成功結果（§3 契約 scenarios 欄位）；
    tool_trail 為本輪工具呼叫足跡 [{"seq","tool","summary"}]（前端 chips 用）。
    """
    confirm_data = None
    scenarios_data = None
    tool_trail = []

    system = list(SYSTEM)
    if profile:
        system.append({"text": profile["prompt_addon"]})
    tool_list = list(tools.TOOLS)
    if _CACHE_ON:  # system＋工具定義掛 cache 點（真環境驗證後啟用）
        system.append({"cachePoint": {"type": "default"}})
        tool_list.append({"cachePoint": {"type": "default"}})

    model_id = pick_model(messages)
    for _ in range(MAX_TURNS):
        resp = _client().converse(
            modelId=model_id,
            system=system,
            messages=messages,
            toolConfig={"tools": tool_list},
            inferenceConfig={"maxTokens": 1500, "temperature": 0.3},
        )
        out = resp["output"]["message"]
        messages.append(out)

        if resp["stopReason"] != "tool_use":
            return out, confirm_data, tool_trail, scenarios_data

        results = []
        for block in out["content"]:
            if "toolUse" in block:
                tu = block["toolUse"]
                try:
                    result = tools.dispatch(tu["name"], tu["input"])
                    content = [{"json": {"result": result}}]
                    status = "success"
                    tool_trail.append({"seq": len(tool_trail) + 1, "tool": tu["name"],
                                       "summary": _trail_summary(tu["name"], tu["input"])})
                    # 攔截 prepare_order / 三方案結果帶出至 handler（§3 契約 confirm / scenarios）
                    if tu["name"] == "prepare_order":
                        confirm_data = result
                    elif tu["name"] == "calculate_trade_scenarios" and "scenarios" in result:
                        scenarios_data = result["scenarios"]
                except Exception as e:  # 回填錯誤讓模型自行調整，而非整段中斷
                    content = [{"text": f"tool error: {e}"}]
                    status = "error"
                audit.log("tool_call", tool=tu["name"],
                          input_summary=_trail_summary(tu["name"], tu["input"]), status=status)
                results.append({"toolResult": {
                    "toolUseId": tu["toolUseId"], "content": content, "status": status,
                }})
        messages.append({"role": "user", "content": results})

    return {"role": "assistant",
            "content": [{"text": "分析步驟過多，請把問題拆小一點再問我一次。"}]}, confirm_data, tool_trail, scenarios_data
