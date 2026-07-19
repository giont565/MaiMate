"""MAX Public API 串接（免帳號，只有 Read）。

文件：https://max-api.maicoin.com/doc/v3.html
規則（tech.md）：行情快取 TTL 5 秒＋指數退避重試。
"""
import json
import time
import urllib.request
import urllib.error

BASE = "https://max-api.maicoin.com"
CACHE_TTL = 5.0
_cache = {}  # key -> (expires_at, data)

ENDPOINTS = {
    "ticker": "/api/v3/ticker?market={market}",
    "kline": "/api/v3/k?market={market}&period=60&limit=48",
    "depth": "/api/v3/depth?market={market}&limit=20",
}


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


def fetch(market, kind):
    if kind not in ENDPOINTS:
        raise ValueError(f"unknown kind: {kind}")
    key = f"{kind}:{market}"
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    data = _get(BASE + ENDPOINTS[kind].format(market=market))
    result = {"kind": kind, "market": market, "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"), "data": data}
    _cache[key] = (now + CACHE_TTL, result)
    return result
