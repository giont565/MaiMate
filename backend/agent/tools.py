"""Agent 工具定義與 dispatch。

紅線（見 .kiro/steering/product.md）：
- prepare_order 與 execute_order 分離；LLM 只能呼叫 prepare_order。
- execute_order 僅由系統在收到前端確認 token 後觸發，不進 TOOLS 清單。
"""
import json
import time
import uuid
from pathlib import Path

HEALTH_REPORT = Path(__file__).parent.parent.parent / "data" / "health_report.json"

# 下單確認 token（正式版存 DynamoDB；本地開發用記憶體）
_pending_orders = {}
CONFIRM_TTL_SEC = 60

TOOLS = [
    {"toolSpec": {
        "name": "query_user_history",
        "description": (
            "查詢使用者的行為健檢報告（由過去一年 10,000 筆交易紀錄預計算）。"
            "回答任何涉及使用者個人狀況的問題前必須先呼叫。五大區塊："
            "chase_index=追高殺低比率；"
            "opportunity_cost=賣出機會成本，內含 worst_single_sell（最痛/虧最多/少賺最多的單筆，"
            "含幣種/日期/賣出價/年底價/錯失金額——問『哪一筆虧最多/最痛』就查這裡）；"
            "concentration=持倉集中度月度變化；cash_flow_behavior=出入金習慣；"
            "activity_profile=交易活動畫像（每月筆數與幣種分布）。回傳一律附 key_findings 重點摘要。"
        ),
        "inputSchema": {"json": {
            "type": "object",
            "properties": {"section": {
                "type": "string",
                "enum": ["chase_index", "opportunity_cost", "concentration",
                         "cash_flow_behavior", "activity_profile", "all"],
                "description": "要查詢的指標區塊，不確定就用 all",
            }},
            "required": ["section"],
        }},
    }},
    {"toolSpec": {
        "name": "get_market_data",
        "description": "查 MAX 交易所即時行情：最新成交價、24h 漲跌、K 線、買賣深度。",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "market": {"type": "string", "description": "交易對，如 btctwd、ethtwd"},
                "kind": {"type": "string", "enum": ["ticker", "kline", "depth"]},
            },
            "required": ["market", "kind"],
        }},
    }},
    {"toolSpec": {
        "name": "get_account_balance",
        "description": "查使用者 MAX 帳戶目前各幣別餘額（Private API, Read）。",
        "inputSchema": {"json": {"type": "object", "properties": {}}},
    }},
    {"toolSpec": {
        "name": "prepare_order",
        "description": "使用者明確表達下單意圖時呼叫。只產生確認卡片與 confirm_token，不會真正下單。",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "market": {"type": "string"},
                "side": {"type": "string", "enum": ["buy", "sell"]},
                "volume_twd": {"type": "number", "description": "以 TWD 計的金額"},
                "ord_type": {"type": "string", "enum": ["market", "limit"]},
                "price": {"type": "number", "description": "限價單價格，市價單免填"},
            },
            "required": ["market", "side", "volume_twd", "ord_type"],
        }},
    }},
]


def query_user_history(section="all"):
    report = json.loads(HEALTH_REPORT.read_text())
    data = report if section == "all" else {section: report[section]}
    # 無論查哪個區塊都附重點摘要：模型選錯區塊時仍拿得到關鍵數字，避免答非所問
    chase, oc, worst = report["chase_index"], report["opportunity_cost"], report["opportunity_cost"]["worst_single_sell"]
    peak = report["concentration"]["peak_concentration"]
    return {
        **data,
        "key_findings": {
            "追高指數": f"{chase['buy_above_ma_pct']}% 的買入發生在 7 日均價上方（全年 {chase['buy_total']} 筆買入）",
            "年度賣出機會成本": f"NT${oc['total_missed_twd']:,.0f}（賣出後若持有至年底的少賺總額）",
            "最痛單筆賣出": (
                f"{worst['date']} 以 {worst['sell_price']} 賣出 {worst['currency'].upper()} "
                f"{worst['qty']:,.2f} 顆，年底價 {worst['eoy_price']}，少賺 NT${worst['missed_twd']:,.0f}"
            ),
            "峰值持倉集中度": f"{peak['month']} 單一資產占比 {peak['top_pct']}%",
            "下跌後出金比例": f"{report['cash_flow_behavior']['withdrawals_after_7d_btc_drop_pct']}%（習慣相對健康）",
        },
        "data_notes": (
            "報告由交易紀錄推算，只有行為指標與機會成本（賣出後價格續漲的少賺金額），"
            "沒有已實現損益。被問『虧最多/最痛的一筆』時：如實說明這個差異，"
            "並直接給出 worst_single_sell 的日期、幣別、金額作為最接近的答案，"
            "不要只請使用者自行去平台查詢。"
        ),
    }


def get_market_data(market, kind):
    from ..integrations import max_public
    return max_public.fetch(market, kind)


def get_account_balance():
    from ..integrations import max_private
    return max_private.balances()


def prepare_order(market, side, volume_twd, ord_type, price=None):
    token = str(uuid.uuid4())
    order = {"market": market, "side": side, "volume_twd": volume_twd,
             "ord_type": ord_type, "price": price, "expires_at": time.time() + CONFIRM_TTL_SEC}
    _pending_orders[token] = order
    return {"confirm_token": token, "confirmation_card": order,
            "notice": "已產生確認卡片，等待使用者於介面上確認後才會送出訂單。"}


def execute_order(confirm_token):
    """僅由 /order handler 在前端確認後呼叫。不在 LLM 工具清單內。"""
    order = _pending_orders.pop(confirm_token, None)
    if order is None or order["expires_at"] < time.time():
        return {"ok": False, "error": "confirm_token 無效或已過期"}
    from ..integrations import max_private
    return max_private.place_order(order)


_DISPATCH = {
    "query_user_history": query_user_history,
    "get_market_data": get_market_data,
    "get_account_balance": get_account_balance,
    "prepare_order": prepare_order,
}


def dispatch(name, tool_input):
    return _DISPATCH[name](**tool_input)
