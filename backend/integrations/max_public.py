"""MAX Public API integration (read-only).

Market data is normalized before it reaches the agent so deterministic values such
as order-book ordering and spread are never delegated to the LLM.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

BASE = "https://max-api.maicoin.com"
CACHE_TTL = 5.0
_cache = {}

ENDPOINTS = {
    "ticker": "/api/v3/ticker?market={market}",
    "kline": "/api/v3/k?market={market}&period={period}&limit=48",
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


def fetch(market, kind, period=None):
    if kind not in ENDPOINTS:
        raise ValueError(f"unknown kind: {kind}")
    if kind == "kline":
        try:
            period = 60 if period is None else int(period)
        except (TypeError, ValueError) as exc:
            raise ValueError("kline period must be an integer number of minutes") from exc
        if period <= 0:
            raise ValueError("kline period must be greater than zero")
    elif period is not None:
        raise ValueError("period is only supported for kline")

    key = f"{kind}:{market}:{period}"
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    data = _get(BASE + ENDPOINTS[kind].format(market=market, period=period))
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
        "fetched_at_utc": fetched.isoformat().replace("+00:00", "Z"),
        "fetched_at_taipei": fetched.astimezone(TAIPEI_TZ).isoformat(),
        "data": data,
    }
    _cache[key] = (now + CACHE_TTL, result)
    return result
