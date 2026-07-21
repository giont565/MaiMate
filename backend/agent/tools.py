"""Agent 工具定義與 dispatch。

紅線（見 .kiro/steering/product.md）：
- prepare_order 與 execute_order 分離；LLM 只能呼叫 prepare_order。
- execute_order 僅由系統在收到前端確認 token 後觸發，不進 TOOLS 清單。
"""
import json
import os
import time
import uuid
from pathlib import Path

HEALTH_REPORT = Path(__file__).parent.parent.parent / "data" / "health_report.json"
# RAG 知識庫（#9）：B 包建好 Bedrock KB 後設 KB_ID 環境變數，工具即自動註冊（見 DEPLOY.md）
KB_ID = os.environ.get("KB_ID")

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
        "description": (
            "查 MAX 交易所即時行情：最新成交價、24h 漲跌、K 線、買賣深度。"
            "kline 回傳已由程式轉成具名 OHLCV，time_utc/time_taipei 是權威時間；"
            "禁止自行換算 Unix timestamp。要求最近 N 根時，必須逐根完整列出 data 最後 N 筆。"
            "depth 回傳已排序（asks 低→高、bids 高→低）並附 best_ask/best_bid/"
            "spread_twd/spread_pct——價差引用這些欄位，禁止自行計算。"
        ),
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
        "name": "calculate_trade_scenarios",
        "description": (
            "使用者表達買賣意圖時**必須先呼叫本工具**產生三個帶真實數字的方案"
            "（保守版/原意圖版/暫停版，含預估金額、手續費、執行後持倉佔比、個人行為註記）。"
            "所有數字由程式計算，你不得自行編造方案數字。"
            "sell 給 fraction（全賣=1.0）；buy 給 amount_twd。"
            "使用者從方案中選定後，才用該方案的金額呼叫 prepare_order。"
        ),
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "market": {"type": "string", "description": "交易對，如 ethtwd"},
                "side": {"type": "string", "enum": ["buy", "sell"]},
                "fraction": {"type": "number", "description": "sell 用：佔持倉比例，全賣=1.0，預設 1.0"},
                "amount_twd": {"type": "number", "description": "buy 用：TWD 金額"},
            },
            "required": ["market", "side"],
        }},
    }},
    {"toolSpec": {
        "name": "prepare_order",
        "description": "使用者從三方案中明確選定後呼叫。只產生確認卡片與 confirm_token，不會真正下單。",
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


if KB_ID:
    TOOLS.append({"toolSpec": {
        "name": "query_knowledge",
        "description": (
            "查防詐與投資教育知識庫（RAG）。使用者問知識性問題"
            "（如「什麼是定期定額」「這是不是詐騙話術」「新手怎麼開始」）時呼叫；"
            "回答引用結果時必須附出處。"
        ),
        "inputSchema": {"json": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "檢索問句"}},
            "required": ["query"],
        }},
    }})


def query_knowledge(query):
    """Bedrock KB 檢索（#9）。回傳片段＋出處；KB 未建時本函式不會被註冊。"""
    import boto3
    rt = boto3.client("bedrock-agent-runtime",
                      region_name=os.environ.get("BEDROCK_REGION", "us-east-1"))
    resp = rt.retrieve(
        knowledgeBaseId=KB_ID,
        retrievalQuery={"text": query},
        retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": 4}},
    )
    results = [{
        "text": (r.get("content") or {}).get("text", "")[:600],
        "source": ((r.get("location") or {}).get("s3Location") or {}).get("uri", "unknown"),
    } for r in resp.get("retrievalResults", [])]
    return {"results": results,
            "data_notes": "引用 results 回答時必須附 source 出處；results 為空就如實說知識庫查無資料。"}


def query_user_history(section="all"):
    report = json.loads(HEALTH_REPORT.read_text())
    data = report if section == "all" else {section: report[section]}
    # 無論查哪個區塊都附重點摘要：模型選錯區塊時仍拿得到關鍵數字，避免答非所問。
    # 用語紀律：「虧損」只能指 realized_pnl（真實賺賠）；opportunity_cost 是「少賺」，兩者不得混用。
    chase, oc, worst = report["chase_index"], report["opportunity_cost"], report["opportunity_cost"]["worst_single_sell"]
    peak = report["concentration"]["peak_concentration"]
    findings = {
        "追高指數": f"{chase['buy_above_ma_pct']}% 的買入發生在 7 日均價上方（全年 {chase['buy_total']} 筆買入）",
        "年度賣出機會成本（少賺，非虧損）": f"NT${oc['total_missed_twd']:,.0f}（賣出後若持有至年底的少賺總額）",
        "最痛單筆少賺（機會成本）": (
            f"{worst['date']} 以 {worst['sell_price']} 賣出 {worst['currency'].upper()} "
            f"{worst['qty']:,.2f} 顆，年底價 {worst['eoy_price']}，少賺 NT${worst['missed_twd']:,.0f}"
        ),
        "峰值持倉集中度": f"{peak['month']} 單一資產占比 {peak['top_pct']}%",
        "下跌後出金比例": f"{report['cash_flow_behavior']['withdrawals_after_7d_btc_drop_pct']}%（習慣相對健康）",
    }
    rp = report.get("realized_pnl")
    if rp:
        findings["已實現損益總計（真實賺賠）"] = (
            f"NT${rp['total_realized_twd']:,.0f}（虧損 {rp['loss_trades']} 筆／獲利 {rp['profit_trades']} 筆，移動平均成本法）"
        )
        wl = rp.get("worst_single_loss")
        if wl:
            findings["最大單筆真實虧損"] = (
                f"{wl['date']} 以 {wl['sell_price']} 賣出 {wl['currency'].upper()} {wl['qty']:,.2f} 顆"
                f"（平均成本 {wl['avg_cost']}），實虧 NT${abs(wl['pnl_twd']):,.0f}"
            )
        notes = (
            "兩類數字都有、意義不同，回答時必須標示是哪一種："
            "①真實虧損/獲利＝realized_pnl（賣價 vs 平均買入成本，錢包實際賺賠）"
            "②少賺＝opportunity_cost（賣後價格續漲的假設差額，不是虧損）。"
            "被問『虧最多』優先給 realized_pnl.worst_single_loss，可再補充機會成本作對照。"
        )
    else:
        notes = (
            "本報告目前只有行為指標與機會成本（少賺），尚無已實現損益。"
            "被問『虧最多/最痛的一筆』時：如實說明「這是少賺（機會成本），不是實際虧損」，"
            "並直接給出 worst_single_sell 的日期、幣別、金額，不要只請使用者自行去平台查詢。"
        )
    return {**data, "key_findings": findings, "data_notes": notes}


def get_market_data(market, kind):
    from ..integrations import max_public
    return max_public.fetch(market, kind)


def get_account_balance():
    from ..integrations import max_private
    return max_private.balances()


def calculate_trade_scenarios(market, side, fraction=1.0, amount_twd=None):
    from . import scenarios
    return scenarios.calculate_trade_scenarios(market, side, fraction=fraction, amount_twd=amount_twd)


def prepare_order(market, side, volume_twd, ord_type, price=None):
    token = str(uuid.uuid4())
    order = {"market": market, "side": side, "volume_twd": volume_twd,
             "ord_type": ord_type, "price": price, "expires_at": time.time() + CONFIRM_TTL_SEC}
    _pending_orders[token] = order
    from . import audit
    audit.log("draft_created", market=market, side=side, volume_twd=volume_twd,
              ord_type=ord_type, confirm_token=token)
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
    "calculate_trade_scenarios": calculate_trade_scenarios,
    "prepare_order": prepare_order,
}
if KB_ID:
    _DISPATCH["query_knowledge"] = query_knowledge


def dispatch(name, tool_input):
    return _DISPATCH[name](**tool_input)
