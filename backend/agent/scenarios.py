"""三方案引擎（#11，spec: .kiro/specs/trade-scenarios/）。

Golden Path 核心：交易意圖 → 三個帶真實數字的方案（保守/原意圖/暫停）。
所有數字由本模組確定性計算（餘額×現價×費率），LLM 只負責講成人話。
"""

# MAX 現貨基礎費率（來源：MAX 官網費率表，2026-07 查證；上線前再對官網）
MAKER_FEE = 0.0008   # 掛單 0.08%
TAKER_FEE = 0.0016   # 吃單 0.16%（市價單以此計）
FEE_SOURCE = "MAX 現貨基礎費率 taker 0.16%（官網公告，2026-07 查證）"
PAUSE_ALERT_DROP = 0.10  # 暫停版預設提醒價：現價 -10%

DISCLAIMER = "以當下價格估算，實際成交可能有滑價；手續費依 MAX 公告基礎費率，未計 MAX Token 折抵。"


def calculate_trade_scenarios(market, side, fraction=1.0, amount_twd=None,
                              balances=None, ticker=None, report=None):
    """回傳 {"scenarios": [...], "disclaimer": ...} 或 {"error", "message"}。

    balances/ticker/report 未傳時自行抓取（LLM 只給 market/side/fraction/amount_twd）；
    參數保留可注入供單元測試。
    fraction：sell 時佔該幣持倉比例（全賣=1.0）；buy 時忽略、以 amount_twd 為準。
    """
    currency = market.replace("twd", "")
    if balances is None:
        from ..integrations import max_private
        balances = {a["currency"].lower(): float(a["balance"]) for a in max_private.balances()}
    if ticker is None:
        from ..integrations import max_public
        ticker = max_public.fetch(market, "ticker")["data"]
    if report is None:
        from . import tools
        import json
        report = json.loads(tools.HEALTH_REPORT.read_text())

    price = float(ticker.get("last") or 0)
    if price <= 0:
        return {"error": "no_price", "message": f"取不到 {market} 現價，請稍後再試"}

    qty = float(balances.get(currency, 0))
    twd = float(balances.get("twd", 0))
    total_value = twd + sum(float(b) * (price if c == currency else _price_of(c, balances, price))
                            for c, b in balances.items() if c != "twd")
    # 簡化：僅該幣以現價計值，其他幣別在 demo 資料中占比極低；總值以該幣＋TWD 為主
    cur_value = qty * price
    total_value = max(total_value, cur_value + twd, 1)

    # 交易所有單筆最低限制（金額與數量兩道，取大者）。不查這個就會產生「麥麥自己推薦、
    # 但送出去必被退件」的方案——實測 NT$500 買 ETH 時，25% 的 NT$125 低於 ethtwd 的
    # 下限，使用者點了那張金框推薦卡，拿到 500 Internal Server Error。
    floor_twd = _min_order_twd(market, price)

    if side == "sell":
        if qty <= 0:
            return {"error": "not_in_portfolio",
                    "message": f"你的帳戶目前沒有 {currency.upper()} 持倉，無法產生賣出方案"}
        fraction = min(max(float(fraction or 1.0), 0.0), 1.0)
        full_amount = cur_value * fraction
        partial_fraction = round(fraction * 0.25, 4)
        partial_amount = cur_value * partial_fraction
        scenarios = [
            _scenario("partial", f"先賣 {partial_fraction:.0%}，留倉觀察", partial_amount,
                      _post_pct(cur_value - partial_amount, total_value),
                      _sell_note(report)),
            _scenario("full", ("照原意圖全部賣出" if fraction == 1.0 else f"照原意圖賣出 {fraction:.0%}"),
                      full_amount, _post_pct(cur_value - full_amount, total_value),
                      _sell_note(report)),
            _pause(price, cur_value, total_value),
        ]
    elif side == "buy":
        if not amount_twd or amount_twd <= 0:
            return {"error": "missing_amount", "message": "買入方案需要金額（amount_twd）"}
        if amount_twd > twd:
            return {"error": "insufficient_twd",
                    "message": f"TWD 餘額 NT${twd:,.0f} 不足以買入 NT${amount_twd:,.0f}"}
        if amount_twd < floor_twd:
            return {"error": "below_min_order",
                    "message": (f"{market.upper()} 單筆最低 NT${floor_twd:,.0f}，"
                                f"NT${amount_twd:,.0f} 送出去會被交易所退件。"
                                f"請改用 NT${floor_twd:,.0f} 以上的金額。")}
        partial_amount = amount_twd * 0.25
        partial_label = "先買 25% 試水溫"
        if partial_amount < floor_twd:
            # 25% 低於交易所下限：抬到剛好可成交的金額，並在標籤上講清楚為什麼不是 25%。
            # 寧可標籤變醜，也不要給一張按下去會失敗的卡。
            partial_amount = floor_twd
            partial_label = f"先買 NT${floor_twd:,.0f} 試水溫（{market.upper()} 單筆最低）"
        scenarios = [
            _scenario("partial", partial_label, partial_amount,
                      _post_pct(cur_value + partial_amount, total_value), _buy_note(report)),
            _scenario("full", "照原意圖全額買入", amount_twd,
                      _post_pct(cur_value + amount_twd, total_value), _buy_note(report)),
            _pause(price, cur_value, total_value),
        ]
    else:
        return {"error": "bad_side", "message": f"未知方向：{side}"}

    return {"scenarios": scenarios, "fee_source": FEE_SOURCE,
            "min_order_twd": round(floor_twd), "disclaimer": DISCLAIMER}


def _min_order_twd(market, price):
    """該市場單筆最低可成交金額（TWD）。最低金額與最低數量兩道限制取大者。

    查不到規則時回 0（不擋）——行情/規則暫時取不到不該讓整個三方案掛掉，
    真的低於下限時 max_private.resolve_volume 還有第二道防線。
    """
    try:
        from ..integrations import max_public
        rules = max_public.market_rules(market)
    except Exception:
        return 0.0
    return max(float(rules["min_quote_amount"]), float(rules["min_base_amount"]) * price)


def _price_of(currency, balances, default_price):
    return 0  # 其他幣別不計值（demo 資料集中於單一幣＋TWD；避免多次行情查詢）


def _scenario(key, label, amount_twd, post_pct, note):
    return {"key": key, "label": label,
            "amount_twd": round(amount_twd),
            "fee_twd": round(amount_twd * TAKER_FEE),
            "post_concentration_pct": post_pct,
            "behavior_note": note}


def _pause(price, cur_value, total_value):
    return {"key": "pause", "label": f"先不動，設 -{PAUSE_ALERT_DROP:.0%} 價格提醒",
            "amount_twd": None, "fee_twd": None,
            "alert_price": round(price * (1 - PAUSE_ALERT_DROP), 4),
            "post_concentration_pct": _post_pct(cur_value, total_value),
            "behavior_note": "不產生任何訂單；到價時提醒你回來看看。"}


def _post_pct(value_after, total_value):
    return round(100 * max(value_after, 0) / total_value, 1)


def _sell_note(report):
    oc = report.get("opportunity_cost") or {}
    worst = oc.get("worst_single_sell") or {}
    if worst:
        return (f"2025 年你賣出後價格續漲的機會成本共 NT${oc.get('total_missed_twd', 0):,.0f}；"
                f"最痛一筆是 {worst.get('date')} 賣 {str(worst.get('currency', '')).upper()}"
                f"，少賺 NT${worst.get('missed_twd', 0):,.0f}。")
    return "提醒：賣出後若價格續漲，就成為機會成本。"


def _buy_note(report):
    chase = report.get("chase_index") or {}
    pct = chase.get("buy_above_ma_pct")
    if pct is not None:
        return f"提醒：2025 年你 {pct}% 的買入發生在近 7 筆均價上方（追高模式）——確認這次不是 FOMO。"
    return "提醒：分批買入可以降低追高風險。"
