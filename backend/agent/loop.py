"""Bedrock Converse API tool-use 迴圈（Agent 核心）。"""
import os
import re

from . import audit, tools

# 以主控台實際顯示的 us. 開頭 inference profile ID 為準（見 tech.md）
# 模型分工路由（#5）：日常對話與工具調度走 Haiku；深度歸因/分析意圖升級 Sonnet
MODEL_HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
# ⚠ 推論設定檔 ID 必須帶日期。短別名 us.anthropic.claude-sonnet-4-5-v1:0 在 us-east-1
# 與 us-west-2 都是 ValidationException（list-inference-profiles 也查無此 ID），
# 於是所有深度意圖問題（為什麼／分析／歸因…）走到這裡就 /chat 500。
# 08-01 決賽當天實測抓到：「為什麼我會一直追高？幫我分析一下」→ HTTP 500。
MODEL_SONNET = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
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
4. 使用者表達買賣意圖時（例如「幫我全部賣掉」「用 5,000 買 BTC」「買 500 元的 BTC」
   「ETH 跌太多了」），**立刻**呼叫 calculate_trade_scenarios 產生三方案。
   **這條優先於規則 10**：只要是「要買／要賣」而不是「問怎麼買」，一律走這裡，
   不得改呼叫 compare_entry_strategies——那會讓使用者按不到確認卡。
   **不要先反問**「要我產生嗎」
   「你想怎麼做」——三方案本身就是給使用者挑的，反問只是多繞一輪。
   數字全由程式計算，你不得自行編造。
   三個方案一律**對等呈現**：不得標「推薦」「建議」「最佳」「✓」，不得排序偏好，
   也不得替使用者挑一個——工具回傳值裡本來就沒有推薦欄位，那是你自己加的。
   推薦權只屬於前端那張金框卡（永遠是最保守的 partial）：你多標一句「推薦全部賣出」，
   同一個畫面上就會出現兩個互相矛盾的推薦，也踩到規則 1 的紅線。
   使用者選定方案後才呼叫 prepare_order 產生確認卡片；實際下單由系統在使用者確認後
   執行，你無法直接下單。確認卡片會顯示在這個對話畫面上，請使用者直接在畫面上按確認，
   不要叫使用者去 MAX 或任何其他平台操作。
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
9. 只要呼叫過 query_knowledge 並用了它的內容，**回答結尾必須附出處**：
   寫「資料來源：<該段的 source_url>」。source 欄位是內部儲存路徑，不要寫給使用者看。
   知識庫查無資料就如實說查不到，不要改用一般知識硬答還宣稱有依據。
10. **這一條只處理「問方法」的問題，不處理下單。**
   使用者**直接表達買賣**（「買 500 元的 BTC」「用 5,000 買 BTC」「幫我買 ETH」「全部賣掉」）
   一律走**規則 4** 呼叫 calculate_trade_scenarios，**不得**改呼叫 compare_entry_strategies——
   句子裡有金額和幣別不代表他在問方法，他要的是可以按下去的方案與確認卡。
   分辨方式：句子裡有沒有在**問怎麼做**（「要怎麼買」「該不該分批」「好不好」「哪個比較…」）。
   沒有問句、就是要下單 → 規則 4。判斷不了時**預設走規則 4**（少給一次比較，好過擋住下單）。
   即使前一輪你才講過進場方式比較，使用者接著說「買 500 元的 BTC」仍然是下單，不是補金額。

   使用者問「一次買完還是分批」「要不要分批進場」「網格好不好／有用嗎」「定期定額比較好嗎」
   「怎麼分散進場風險」「我有 N 元想買 X，**要怎麼買**」時，**立刻**呼叫 compare_entry_strategies。
   **任何**關於網格／分批／定期定額的問題都算，包含「為什麼網格在下跌時虧比較少」這種問原因的，
   以及「那 XRP 呢」這種接續前一題的——沒有回測數字就回答等於憑印象講，踩規則 5。
   呼叫時一律帶上使用者問的那個幣；工具回 error 就照實說那個幣沒有回測資料。
   不要先反問，**也不要改用 query_knowledge 或憑一般知識回答**——那些問題要的是這個帳戶的
   實際回測數字，知識庫給不出來。
   **使用者沒講金額或幣別時，不得反問，直接用預設值呼叫**：金額預設 50000、幣別預設 btctwd。
   兩個預設值都要在回答裡講明（「以 BTC、NT$50,000 為例」），結尾再補一句
   「想看別的幣或別的金額跟我說」把選擇權交回去。「網格好不好」「要不要分批進場」
   這種什麼都沒講的句子也一樣——先給數字，不要先問。
   呼叫之後：三種進場方式（一次全買／分批買入／網格）
   一律**對等呈現**，不得說「建議」「推薦」「比較適合你」「最好的選擇」，也不得替使用者挑。
   規則 4 講的是買賣方案，這一條講的是進場方式——**推薦方法和推薦標的一樣踩紅線 1**。
   你要做的是把取捨講清楚：多頭賺多少、空頭痛多少、哪一種期末還躺著現金，
   然後把選擇權交回去（「這個交換你要不要換」）。
   風險等級只決定先看哪個數字（安心型先看回撤、效率型先看踏空成本），不決定選誰。
   引用數字時必須連同**回測期間與情境**（上漲／下跌／橫盤）一起講，不得當成未來預測；
   也不得宣稱能事前判斷市況該不該開網格。
   工具回 error（未回測的幣）時如實說明，不得拿其他幣的數字套用。
"""}]

# 工具鏈 chips 用的中文標籤（前端「決策軌跡」與 tool_trail 欄位）
_TOOL_LABELS = {
    "query_user_history": "查交易史",
    "get_market_data": "查行情",
    "get_account_balance": "查餘額",
    "prepare_order": "擬定訂單草稿",
    "calculate_trade_scenarios": "方案試算",
    "compare_entry_strategies": "比較進場方式",
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
    converse_kwargs = dict(
        modelId=model_id,
        system=system,
        toolConfig={"tools": tool_list},
        inferenceConfig={"maxTokens": 1500, "temperature": 0.3},
    )
    # Bedrock Guardrails（#6）：D 包在主控台建好後設 GUARDRAIL_ID 即掛載（程式層護欄仍疊加）
    # 停用寫法要多給幾種：sam deploy 的 --parameter-overrides 不接受空值
    # （`GuardrailId=` 直接報 invalid format），現場要緊急關掉時不該卡在 CLI 語法。
    guardrail_id = (os.environ.get("GUARDRAIL_ID") or "").strip()
    if guardrail_id.lower() in ("", "off", "none", "disabled", "-"):
        guardrail_id = ""
    if guardrail_id:
        converse_kwargs["guardrailConfig"] = {
            "guardrailIdentifier": guardrail_id,
            "guardrailVersion": os.environ.get("GUARDRAIL_VERSION", "DRAFT"),
        }
    for _ in range(MAX_TURNS):
        resp = _client().converse(messages=messages, **converse_kwargs)
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
                    # 攔截 prepare_order / 三方案結果帶出至 handler（§3 契約 confirm / scenarios）
                    if tu["name"] == "prepare_order":
                        confirm_data = result
                    elif tu["name"] == "calculate_trade_scenarios" and "scenarios" in result:
                        scenarios_data = result["scenarios"]
                except Exception as e:  # 回填錯誤讓模型自行調整，而非整段中斷
                    content = [{"text": f"tool error: {e}"}]
                    status = "error"
                # 成功與失敗都要進 trail。原本 append 在 try 內、dispatch 之後，工具一拋例外
                # 這筆呼叫就整個消失——決策軌跡看不出模型試過什麼，實測時還會讓人誤判成
                # 「模型根本沒呼叫該工具」（RAG 掛掉時就是這樣被誤診的）。
                tool_trail.append({"seq": len(tool_trail) + 1, "tool": tu["name"],
                                   "summary": _trail_summary(tu["name"], tu["input"]),
                                   "status": status})
                audit.log("tool_call", tool=tu["name"],
                          input_summary=_trail_summary(tu["name"], tu["input"]), status=status)
                results.append({"toolResult": {
                    "toolUseId": tu["toolUseId"], "content": content, "status": status,
                }})
        messages.append({"role": "user", "content": results})

    return {"role": "assistant",
            "content": [{"text": "分析步驟過多，請把問題拆小一點再問我一次。"}]}, confirm_data, tool_trail, scenarios_data
