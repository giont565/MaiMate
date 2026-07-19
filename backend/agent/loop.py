"""Bedrock Converse API tool-use 迴圈（Agent 核心）。"""
import boto3

from . import tools

# 以主控台實際顯示的 us. 開頭 inference profile ID 為準（見 tech.md）
MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MAX_TURNS = 8

SYSTEM = [{"text": """你是 MaiMate，使用者的個人投資特助。

規則：
1. 永不主動建議買賣特定標的。你的角色是呈現事實與個人化脈絡，決策留給使用者。
2. 回答涉及使用者個人狀況時，必須先呼叫 query_user_history，並引用具體數字。
3. 回答市場問題時，必須呼叫 get_market_data 取得即時數據，並註明資料時間。
4. 使用者表達下單意圖時，只能呼叫 prepare_order 產生確認卡片；
   實際下單由系統在使用者確認後執行，你無法直接下單。
5. 資料不支持的結論不要硬給；訊號矛盾時如實說明。
6. 使用者問「虧最多／賠最多／最痛的一筆」時：健檢報告沒有已實現損益，
   但有機會成本數據（opportunity_cost.worst_single_sell）。先一句話說明差異，
   然後必須直接給出該筆的日期、幣別、金額——不要只建議使用者自己去平台查。
   拿著手上的數據回答，永遠比指路更有價值。
7. 回覆會顯示在聊天氣泡裡：用簡短段落與編號列表，可用 **粗體** 強調數字；
   不要用標題（#）、表格或程式碼區塊語法。
"""}]

_br = boto3.client("bedrock-runtime", region_name="us-east-1")


def run_agent(messages):
    """messages: Converse API 格式的對話歷史。

    回傳 (assistant_message, confirm_data)。
    confirm_data 為最後一次 prepare_order 的工具結果（含 confirm_token + confirmation_card），
    若本輪未呼叫 prepare_order 則為 None。
    """
    confirm_data = None

    for _ in range(MAX_TURNS):
        resp = _br.converse(
            modelId=MODEL_ID,
            system=SYSTEM,
            messages=messages,
            toolConfig={"tools": tools.TOOLS},
            inferenceConfig={"maxTokens": 1500, "temperature": 0.3},
        )
        out = resp["output"]["message"]
        messages.append(out)

        if resp["stopReason"] != "tool_use":
            return out, confirm_data

        results = []
        for block in out["content"]:
            if "toolUse" in block:
                tu = block["toolUse"]
                try:
                    result = tools.dispatch(tu["name"], tu["input"])
                    content = [{"json": {"result": result}}]
                    status = "success"
                    # 攔截 prepare_order 結果帶出至 handler
                    if tu["name"] == "prepare_order":
                        confirm_data = result
                except Exception as e:  # 回填錯誤讓模型自行調整，而非整段中斷
                    content = [{"text": f"tool error: {e}"}]
                    status = "error"
                results.append({"toolResult": {
                    "toolUseId": tu["toolUseId"], "content": content, "status": status,
                }})
        messages.append({"role": "user", "content": results})

    return {"role": "assistant",
            "content": [{"text": "分析步驟過多，請把問題拆小一點再問我一次。"}]}, confirm_data
