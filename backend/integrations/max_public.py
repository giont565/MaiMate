"""MAX Public API integration (read-only).

Market data is normalized before it reaches the agent so deterministic values such
as order-book ordering and spread are never delegated to the LLM.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

BASE = "https://max-api.maicoin.com"
CACHE_TTL = 5.0
MARKETS_TTL = 3600.0  # 下單限制幾乎不變，不需要跟行情一樣每 5 秒重抓
TICKERS_TTL = 30.0    # 全市場報價只拿來算「佔總資產比例」，30 秒的價差不影響百分比
_cache = {}
_markets_cache = {}
_tickers_cache = {}

ENDPOINTS = {
    "ticker": "/api/v3/ticker?market={market}",
    "kline": "/api/v3/k",
    "depth": "/api/v3/depth?market={market}&limit=20",
}

TAIPEI_TZ = timezone(timedelta(hours=8))


def _iso_times(timestamp):
    ts = int(float(timestamp))
    dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
    return (
        ts,
        dt_utc.isoformat().replace("+00:00", "Z"),
        dt_utc.astimezone(TAIPEI_TZ).isoformat(),
    )


def _normalize_ticker(ticker):
    """Attach authoritative UTC/Taipei times without changing MAX's raw fields."""
    if not isinstance(ticker, dict):
        raise ValueError(f"unexpected ticker response: {ticker!r}")
    normalized = dict(ticker)
    if ticker.get("at") is not None:
        _ts, utc_iso, taipei_iso = _iso_times(ticker["at"])
        normalized.update({
            "time_utc": utc_iso,
            "time_taipei": taipei_iso,
        })
    return normalized


def _normalize_kline(rows):
    normalized = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            raise ValueError(f"unexpected kline row: {row!r}")
        ts, utc_iso, taipei_iso = _iso_times(row[0])
        normalized.append({
            "timestamp": ts,
            "time_utc": utc_iso,
            "time_taipei": taipei_iso,
            "open": row[1],
            "high": row[2],
            "low": row[3],
            "close": row[4],
            "volume": row[5],
        })
    return sorted(normalized, key=lambda candle: candle["timestamp"])


def _price(level):
    if not isinstance(level, (list, tuple)) or len(level) < 2:
        raise ValueError(f"unexpected depth level: {level!r}")
    try:
        return Decimal(str(level[0]))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"invalid depth price: {level!r}") from exc


def _normalize_depth(book):
    if not isinstance(book, dict):
        raise ValueError(f"unexpected depth response: {book!r}")

    asks = sorted(book.get("asks", []), key=_price)
    bids = sorted(book.get("bids", []), key=_price, reverse=True)
    normalized = dict(book)
    normalized.update({
        "asks": asks,
        "bids": bids,
        "ask_sort_order": "price_ascending",
        "bid_sort_order": "price_descending",
    })

    if not asks or not bids:
        normalized.update({
            "best_ask": None,
            "best_bid": None,
            "spread_twd": None,
            "spread_pct": None,
        })
        return normalized

    best_ask = _price(asks[0])
    best_bid = _price(bids[0])
    spread = best_ask - best_bid
    spread_pct = (spread / best_bid * Decimal("100")) if best_bid else None
    normalized.update({
        "best_ask": float(best_ask),
        "best_bid": float(best_bid),
        "spread_twd": float(spread),
        "spread_pct": round(float(spread_pct), 6) if spread_pct is not None else None,
    })
    return normalized


def _get(url, retries=3):
    delay = 1.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=8) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2


def market_rules(market):
    """回傳該市場的下單限制：最小量、最小金額、數量精度。

    來源 /api/v3/markets（公開端點，免簽章）。TWD 金額換算下單量時必須用它，
    憑空取整會被 MAX 以低於最小量退件。
    """
    now = time.time()
    hit = _markets_cache.get("all")
    if not hit or hit[0] <= now:
        rows = _get(BASE + "/api/v3/markets")
        hit = (now + MARKETS_TTL, {row["id"]: row for row in rows})
        _markets_cache["all"] = hit
    rules = hit[1].get(market)
    if rules is None:
        raise ValueError(f"MAX 沒有這個市場：{market}")
    return {
        "market": market,
        "base_unit": rules["base_unit"],
        "quote_unit": rules["quote_unit"],
        "base_precision": int(rules["base_unit_precision"]),
        "min_base_amount": float(rules["min_base_amount"]),
        "min_quote_amount": float(rules["min_quote_amount"]),
        "status": rules.get("status"),
    }


def twd_prices():
    """回傳 {幣別小寫: TWD 現價}，一次 HTTP 拿完全部 TWD 市場（/api/v2/tickers，35 個市場）。

    用途是把多幣持倉換算成 TWD 以計算「執行後佔總資產比例」。原本 scenarios 只認得
    當下操作的那一個幣，其餘一律當 0 元，分母被低估、佔比就被高估——實測 USDT 買入
    NT$500 那張卡顯示 8.6%，真值 0.106%（帳戶還有 BTC/DOGE/GRT/ADA 沒被計入）。

    逐幣打 /api/v3/ticker 也做得到，但持倉幾個幣就幾次往返；這個端點一次拿完，
    30 秒快取，對三方案試算來說綽綽有餘。取不到就回空 dict，呼叫端自行降級。
    """
    now = time.time()
    hit = _tickers_cache.get("twd")
    if hit and hit[0] > now:
        return hit[1]
    try:
        rows = _get(BASE + "/api/v2/tickers")
    except Exception:  # noqa: BLE001 — 行情拿不到不該讓整個三方案掛掉
        return {}
    prices = {}
    for market, row in (rows or {}).items():
        if not market.endswith("twd"):
            continue
        try:
            prices[market[:-3]] = float(row["last"])
        except (KeyError, TypeError, ValueError):
            continue
    prices["twd"] = 1.0
    _tickers_cache["twd"] = (now + TICKERS_TTL, prices)
    return prices


def _positive_int(value, name, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if parsed <= 0:
        raise ValueError(f"{name} must be greater than zero")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{name} must not exceed {maximum}")
    return parsed


def fetch(market, kind, period=None, timestamp=None, limit=None):
    """取得公開行情；Kline 可指定起始 Unix 秒數與最多 10,000 根。

    ``timestamp`` 與 ``limit`` 僅適用於 Kline。預設仍取 48 根，保持既有聊天與
    行情面板的流量不變；年度報酬可明確傳入 2026-01-01 與較大 limit 回看年初價。
    """
    if kind not in ENDPOINTS:
        raise ValueError(f"unknown kind: {kind}")
    if kind == "kline":
        period = _positive_int(60 if period is None else period, "kline period")
        limit = _positive_int(48 if limit is None else limit, "kline limit", maximum=10000)
        timestamp = None if timestamp is None else _positive_int(timestamp, "kline timestamp")
    elif period is not None or timestamp is not None or limit is not None:
        raise ValueError("period, timestamp and limit are only supported for kline")

    key = f"{kind}:{market}:{period}:{timestamp}:{limit}"
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    if kind == "kline":
        params = {"market": market, "period": period, "limit": limit}
        if timestamp is not None:
            params["timestamp"] = timestamp
        url = BASE + ENDPOINTS[kind] + "?" + urllib.parse.urlencode(params)
    else:
        url = BASE + ENDPOINTS[kind].format(market=market)
    data = _get(url)
    if kind == "ticker":
        data = _normalize_ticker(data)
    elif kind == "kline":
        data = _normalize_kline(data)
    elif kind == "depth":
        data = _normalize_depth(data)

    fetched = datetime.now(timezone.utc)
    result = {
        "kind": kind,
        "market": market,
        "period_minutes": period if kind == "kline" else None,
        "requested_timestamp": timestamp if kind == "kline" else None,
        "limit": limit if kind == "kline" else None,
        "fetched_at_utc": fetched.isoformat().replace("+00:00", "Z"),
        "fetched_at_taipei": fetched.astimezone(TAIPEI_TZ).isoformat(),
        "data": data,
    }
    _cache[key] = (now + CACHE_TTL, result)
    return result
