"""年度報酬資料契約（Issue #47）。

這裡只整理 Modified Dietz／TWR 所需的原始資料，不在後端重複計算報酬率：

- 2025 demo：官方 CSV 的月末市值 + TWD 外部出入金，輸出逐月 periods。
- 2026 live：MAX read-only balances/trades/deposits/withdrawals 回推年初持倉，搭配
  年初 Kline 與目前價格，輸出年度層資料供 Modified Dietz 使用。

帳戶內買賣只是資產重配置，永遠不會放進 flows。
"""
from collections import defaultdict
from calendar import monthrange
from datetime import date, datetime, timezone


def _float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _date_of(ts_ms):
    return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _month_of(ts_ms):
    return _date_of(ts_ms)[:7]


def _next_month(year, month):
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _round_money(value):
    rounded = round(float(value), 2)
    return int(rounded) if rounded.is_integer() else rounded


def _monthly_flow_rows(amounts, cap_date=None):
    result = []
    for month, amount in sorted(amounts.items()):
        if abs(amount) <= 1e-9:
            continue
        year, month_number = map(int, month.split("-"))
        day = date(year, month_number, monthrange(year, month_number)[1])
        if cap_date is not None and day > cap_date:
            day = cap_date
        result.append({"date": day.isoformat(), "amount_twd": _round_money(amount)})
    return result


def external_twd_flows(rows):
    """回傳逐月 TWD 外部淨流；入金正、出金負，買賣與非 TWD 列排除。"""
    monthly = defaultdict(float)
    for row in rows:
        action = row.get("action")
        if str(row.get("currency", "")).lower() != "twd" or action not in ("deposit", "withdrawal"):
            continue
        amount = abs(_float(row.get("change")) * _float(row.get("price"), 1.0))
        monthly[_month_of(row["ts"])] += amount if action == "deposit" else -amount
    return _monthly_flow_rows(monthly)


def _monthly_values(rows):
    balances = {}
    prices = {}
    result = {}
    for row in sorted(rows, key=lambda item: item["ts"]):
        currency = str(row["currency"]).lower()
        balances[currency] = _float(row.get("balance"))
        prices[currency] = _float(row.get("price"))
        result[_month_of(row["ts"])] = _round_money(sum(
            balance * prices.get(cur, 0.0)
            for cur, balance in balances.items()
            if balance > 0
        ))
    return result


def _opening_value(rows):
    """用各幣第一列的 balance-change 回推資料期間開始前一刻的持倉市值。"""
    seen = set()
    total = 0.0
    for row in sorted(rows, key=lambda item: item["ts"]):
        currency = str(row["currency"]).lower()
        if currency in seen:
            continue
        seen.add(currency)
        balance_before = _float(row.get("balance")) - _float(row.get("change"))
        if balance_before > 0:
            total += balance_before * _float(row.get("price"))
    return _round_money(total)


def build_demo_annual_return(rows, monthly_values=None):
    """把官方 CSV 列轉成 ``annual_return`` 的 demo 年度映射。"""
    if not rows:
        return {}
    ordered = sorted(rows, key=lambda item: item["ts"])
    values = dict(monthly_values or _monthly_values(ordered))
    years = sorted({int(_date_of(row["ts"])[:4]) for row in ordered})
    result = {}
    for year in years:
        year_rows = [row for row in ordered if int(_date_of(row["ts"])[:4]) == year]
        year_values = {
            month: value for month, value in values.items() if month.startswith(f"{year}-")
        }
        all_flows = external_twd_flows(year_rows)
        flow_by_month = defaultdict(list)
        for flow in all_flows:
            flow_by_month[flow["date"][:7]].append(flow)

        opening = _opening_value(year_rows)
        previous = opening
        periods = []
        for month in range(1, 13):
            key = f"{year}-{month:02d}"
            if key not in year_values:
                continue
            next_year, next_month = _next_month(year, month)
            periods.append({
                "start": f"{year}-{month:02d}-01",
                "end": f"{next_year}-{next_month:02d}-01",
                "start_value_twd": _round_money(previous),
                "end_value_twd": _round_money(year_values[key]),
                "flows": flow_by_month.get(key, []),
            })
            previous = year_values[key]

        missing_months = [
            f"{year}-{month:02d}" for month in range(1, 13)
            if f"{year}-{month:02d}" not in year_values
        ]
        first_day = _date_of(year_rows[0]["ts"])
        last_day = _date_of(year_rows[-1]["ts"])
        complete = not missing_months and first_day == f"{year}-01-01" and last_day == f"{year}-12-31"
        result[str(year)] = {
            "source": "demo",
            "complete": complete,
            "start": f"{year}-01-01",
            "end": f"{year}-12-31" if complete else last_day,
            "start_value_twd": opening,
            "end_value_twd": _round_money(previous) if periods else None,
            "periods": periods,
            "missing": [f"missing_month_value:{month}" for month in missing_months],
        }
    return result


def _balance_map(rows):
    result = {}
    for row in rows or []:
        currency = str(row.get("currency", "")).lower()
        if not currency:
            continue
        result[currency] = (
            _float(row.get("balance")) + _float(row.get("locked")) + _float(row.get("staked"))
        )
    return result


def _market_pair(market, market_units=None):
    if market_units is not None:
        rules = market_units(market)
        if rules and rules.get("base_unit") and rules.get("quote_unit"):
            return rules["base_unit"].lower(), rules["quote_unit"].lower()
    for quote in ("twd", "usdt", "usdc", "btc", "eth"):
        if market.endswith(quote) and len(market) > len(quote):
            return market[:-len(quote)], quote
    raise ValueError(f"cannot determine market units for {market}")


def reconstruct_start_balances(current_balances, trades, deposits, withdrawals, market_units=None):
    """從現有餘額反向套用年度事件，回推年初各幣數量。"""
    balances = _balance_map(current_balances)
    for trade in trades or []:
        base, quote = _market_pair(str(trade["market"]).lower(), market_units)
        volume = _float(trade.get("volume"))
        funds = _float(trade.get("funds"))
        side = str(trade.get("side", "")).lower()
        if side in ("bid", "buy"):
            balances[base] = balances.get(base, 0.0) - volume
            balances[quote] = balances.get(quote, 0.0) + funds
        elif side in ("ask", "sell"):
            balances[base] = balances.get(base, 0.0) + volume
            balances[quote] = balances.get(quote, 0.0) - funds
        elif side != "self-trade":
            raise ValueError(f"unknown trade side: {side}")
        for amount_key, currency_key in (
            ("fee", "fee_currency"),
            ("self_trade_bid_fee", "self_trade_bid_fee_currency"),
        ):
            currency = str(trade.get(currency_key) or "").lower()
            if currency:
                balances[currency] = balances.get(currency, 0.0) + _float(trade.get(amount_key))

    for item in deposits or []:
        if str(item.get("state", "done")).lower() != "done":
            continue
        currency = str(item.get("currency", "")).lower()
        balances[currency] = balances.get(currency, 0.0) - _float(item.get("amount"))
    for item in withdrawals or []:
        if str(item.get("state", "done")).lower() != "done":
            continue
        currency = str(item.get("currency", "")).lower()
        balances[currency] = balances.get(currency, 0.0) + _float(item.get("amount"))
        fee_currency = str(item.get("fee_currency") or "").lower()
        if fee_currency:
            balances[fee_currency] = balances.get(fee_currency, 0.0) + _float(item.get("fee"))
    return {currency: (0.0 if abs(amount) < 1e-12 else amount) for currency, amount in balances.items()}


def _live_flows(deposits, withdrawals, price_at, as_of):
    monthly = defaultdict(float)
    missing = set()
    for action, rows, sign in (("deposit", deposits or [], 1), ("withdrawal", withdrawals or [], -1)):
        for item in rows:
            if str(item.get("state", "done")).lower() != "done":
                continue
            currency = str(item.get("currency", "")).lower()
            timestamp = int(item["created_at"])
            price = 1.0 if currency == "twd" else price_at(currency, timestamp)
            if price is None:
                missing.add(f"missing_flow_price:{currency}:{_date_of(timestamp)}")
                continue
            monthly[_month_of(timestamp)] += sign * abs(_float(item.get("amount")) * price)
    return (_monthly_flow_rows(monthly, cap_date=as_of.date()), sorted(missing))


def build_live_annual_return(year, as_of, current_balances, trades, deposits, withdrawals,
                             price_at, current_prices, market_units=None):
    """由已抓取的 MAX read-only 資料組合 live Modified Dietz 契約。"""
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(as_of.timestamp() * 1000)
    in_range = lambda item: start_ms <= int(item["created_at"]) <= end_ms
    trades = [item for item in trades or [] if in_range(item)]
    deposits = [item for item in deposits or [] if in_range(item)]
    withdrawals = [item for item in withdrawals or [] if in_range(item)]

    opening = reconstruct_start_balances(
        current_balances, trades, deposits, withdrawals, market_units=market_units)
    current = _balance_map(current_balances)
    missing = []

    def value_of(balances, prices, label):
        total = 0.0
        for currency, amount in balances.items():
            if abs(amount) < 1e-12:
                continue
            if amount < -1e-8:
                missing.append(f"negative_{label}_balance:{currency}")
            price = 1.0 if currency == "twd" else prices.get(currency)
            if price is None:
                missing.append(f"missing_{label}_price:{currency}")
                continue
            total += amount * price
        if any(item.startswith(f"missing_{label}_price:") for item in missing):
            return None
        return _round_money(total)

    start_prices = {}
    for currency, amount in opening.items():
        if currency != "twd" and abs(amount) >= 1e-12:
            start_prices[currency] = price_at(currency, start_ms)
    start_value = value_of(opening, start_prices, "start")
    end_value = value_of(current, current_prices, "end")
    flows, flow_missing = _live_flows(deposits, withdrawals, price_at, as_of)
    missing.extend(flow_missing)
    return {
        "source": "live",
        "complete": False,
        "start": start.date().isoformat(),
        "end": as_of.date().isoformat(),
        "start_value_twd": start_value,
        "end_value_twd": end_value,
        "flows": flows,
        "missing": sorted(set(missing)),
        "event_counts": {
            "trades": len(trades),
            "deposits": len(deposits),
            "withdrawals": len(withdrawals),
        },
    }


def collect_live_annual_return(year=None, as_of=None):
    """使用 MAX read-only API 取得 live 年度資料；不包含任何下單／提領呼叫。"""
    from backend.integrations import max_private, max_public

    as_of = as_of or datetime.now(timezone.utc)
    year = int(year or as_of.year)
    start_ms = int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    end_ms = int(as_of.timestamp() * 1000)
    current_balances = max_private.balances()
    trade_rows = max_private.history_since("trades", start_ms, end_timestamp=end_ms)
    deposit_rows = max_private.history_since("deposits", start_ms, end_timestamp=end_ms)
    withdrawal_rows = max_private.history_since("withdrawals", start_ms, end_timestamp=end_ms)
    current_prices = max_public.twd_prices()
    historical_cache = {}

    def price_at(currency, timestamp_ms):
        if currency == "twd":
            return 1.0
        day = _date_of(timestamp_ms)
        key = (currency, day)
        if key in historical_cache:
            return historical_cache[key]
        day_start = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
        try:
            candles = max_public.fetch(
                f"{currency}twd", "kline", period=1440,
                timestamp=day_start, limit=2)["data"]
            price = _float(candles[0]["close"], default=None) if candles else None
        except Exception:  # 該幣沒有 TWD 市場或歷史 Kline 時，以 missing 明示
            price = None
        historical_cache[key] = price
        return price

    return build_live_annual_return(
        year, as_of, current_balances, trade_rows, deposit_rows, withdrawal_rows,
        price_at=price_at, current_prices=current_prices,
        market_units=max_public.market_rules,
    )
