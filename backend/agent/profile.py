"""Profile Engine 簡版（#10，spec: .kiro/specs/profile-engine/）。

從 health_report 以確定性規則推斷使用者模式，輸出 system prompt 追加段落。
三模式共用同一套工具與確認機制——差異只在語氣與提醒強度，不在安全性。
"""

# 分類閾值（design.md 常數表；驗證案例：月均 389 筆＋追高 65% → growth）
LOW_FREQ = 20      # 月均筆數低於此 → cautious（新手低頻）
HIGH_FREQ = 100    # 月均筆數高於此才可能 pro
HIGH_CHASE = 60    # 追高指數高於此：低頻者 → cautious；高頻者 → growth（有經驗但行為有風險）
LOW_CHASE = 40     # 追高指數低於此且高頻 → pro

MODES = ("cautious", "growth", "pro")

_PROMPT_ADDONS = {
    "cautious": """
【使用者模式：安心白話（cautious）】
- 用大白話與生活比喻解釋，每個專有名詞都要跟著一句白話說明。
- 每一步先確認使用者理解再往下；防詐提醒優先於一切。
- 使用者表達下單意圖時，先用一句話確認他理解風險與金額，再呼叫 prepare_order。
- 語氣像耐心的家人，多鼓勵、不催促。""",
    "growth": """
【使用者模式：成長陪跑（growth）】
- 回答附上教育脈絡：這個數字為什麼重要、跟他的行為健檢哪一項有關。
- 正常確認流；在關鍵決策點連結他的歷史行為數據提醒（不阻止、給脈絡）。
- 語氣像一起變強的教練。""",
    "pro": """
【使用者模式：專業效率（pro）】
- 資訊密度高：直接給數字與結論，省略基礎解釋。
- 正常確認流；提醒精簡為一句話。
- 語氣像專業交易台同事。""",
}


def infer_profile(report):
    """回傳 {"mode", "evidence", "prompt_addon"}。確定性規則，可單元測試。"""
    monthly = report.get("activity_profile", {}).get("trades_per_month", {})
    monthly_avg = round(sum(monthly.values()) / max(len(monthly), 1), 1) if monthly else 0
    chase = report.get("chase_index", {}).get("buy_above_ma_pct", 0)

    if monthly_avg < LOW_FREQ or (chase > HIGH_CHASE and monthly_avg < HIGH_FREQ):
        mode = "cautious"
    elif monthly_avg > HIGH_FREQ and chase < LOW_CHASE:
        mode = "pro"
    else:
        mode = "growth"

    return {"mode": mode,
            "evidence": {"monthly_trades_avg": monthly_avg, "chase_pct": chase,
                         "rule": f"月均 {monthly_avg} 筆、追高 {chase}% → {mode}"},
            "prompt_addon": _PROMPT_ADDONS[mode]}


def profile_for(mode=None, report=None):
    """mode 有效就直接用（Demo 切換覆寫）；否則從 report 推斷。"""
    if mode in MODES:
        return {"mode": mode, "evidence": {"override": "demo 手動切換"},
                "prompt_addon": _PROMPT_ADDONS[mode]}
    if report is None:
        import json
        from . import tools
        report = json.loads(tools.HEALTH_REPORT.read_text())
    return infer_profile(report)
