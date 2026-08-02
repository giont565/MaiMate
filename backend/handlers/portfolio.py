"""GET /portfolio — 帳戶持倉分布（Screen 8「你的資金目前放在哪裡？」的資料源）。

為什麼要有這支：insights 那頁原本讀 `frontend/mocks/account.js`，那是 `data/health_report.json`
（命題方 CSV）產的 2025-12 靜態快照。私人／錄影環境**已經連上真實 MAX 帳戶**，卻還在拿
CSV 那份講「你的資金 98.6% 在現金」——真帳戶其實幾乎全是幣，意思正好相反。

兩種來源、同一個形狀（差別只在 `account_source` 與有沒有 `amount`）：
  · 有 MAX 金鑰 → 真帳戶即時餘額 × 即時報價
  · 沒有金鑰   → `demo_account.holdings_view()`（命題方資料），比賽環境走這條

⚠ 佔比的分母與三方案卡**同一套基準**（`scenarios.py:44`）：只算 `balance`，不含
`locked`／`staked`。兩個畫面用不同基準就會給出兩個百分比，而使用者無從判斷哪個對——
那比少一個數字更糟。被排除的部位改列在 `excluded` 裡，不靜默丟掉。
"""
import json
from datetime import datetime, timedelta, timezone

_TAIPEI = timezone(timedelta(hours=8))


def handler(event, context):
    from ..agent import demo_account

    if demo_account.active():
        view = demo_account.holdings_view()
        if view is None:
            return _resp(503, {"code": "no_account_data", "retryable": True,
                               "message": "沒有 MAX 金鑰，示範帳戶資料也讀不到——不臨時編數字。"})
        return _resp(200, view)

    try:
        rows = _live_holdings()
    except Exception as exc:  # noqa: BLE001 — 連不上帳戶要老實說，不退回 CSV 冒充即時
        return _resp(503, {"code": "account_unavailable", "retryable": True,
                           "message": f"連不上 MAX 帳戶：{exc}"})
    return _resp(200, rows)


def _live_holdings():
    from ..integrations import max_private, max_public

    accounts = max_private.balances()
    prices = dict(max_public.twd_prices())
    prices["twd"] = 1.0

    holdings, excluded, unpriced = [], [], []
    for account in accounts or []:
        currency = str(account.get("currency") or "").lower()
        if not currency:
            continue
        amount = _num(account.get("balance"))
        # 鎖定／質押不計入佔比（與三方案卡同基準），但要講出來，不能靜默消失
        parked = _num(account.get("locked")) + _num(account.get("staked"))
        if parked > 0:
            excluded.append({"currency": currency.upper(), "amount": parked})
        if amount <= 0:
            continue
        price = prices.get(currency)
        if price is None:
            # 查無 TWD 報價（例如已下市或只有 USDT 交易對）——列出來，不當 0 元吃掉
            unpriced.append(currency.upper())
            continue
        holdings.append({"currency": currency.upper(), "amount": amount,
                         "value_twd": amount * price})

    total = sum(h["value_twd"] for h in holdings)
    for h in holdings:
        h["pct_of_account"] = round(h["value_twd"] / total * 100, 1) if total > 0 else 0.0
        h["value_twd"] = round(h["value_twd"])
    holdings.sort(key=lambda h: h["value_twd"], reverse=True)

    notes = ["市值＝可動用餘額 × MAX 即時報價（/api/v2/tickers）；佔比分母與三方案卡同一套基準。"]
    if excluded:
        notes.append("鎖定或質押中的部位不計入佔比："
                     + "、".join(f"{e['currency']} {e['amount']:g}" for e in excluded))
    if unpriced:
        notes.append("查無 TWD 報價、未計入市值：" + "、".join(unpriced))

    return {
        "account_source": "max_private",
        "as_of": datetime.now(_TAIPEI).isoformat(timespec="seconds"),
        "valuation_method": "MAX 即時報價",
        "total_value_twd": round(total),
        "holdings": holdings,
        "excluded": excluded,
        "data_notes": notes,
    }


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
