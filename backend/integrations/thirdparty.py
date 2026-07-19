"""第三方資料源：CoinMarketCap（延伸視角，非必要依賴）。

免費方案有月額度與 rate limit——限制已列入簡報「成本與限制」頁。
金鑰走環境變數 CMC_API_KEY；未設定時回傳 None，上層自動略過此資料源。
"""
import json
import os
import urllib.request

BASE = "https://pro-api.coinmarketcap.com"


def quote(symbol):
    api_key = os.environ.get("CMC_API_KEY")
    if not api_key:
        return None
    req = urllib.request.Request(
        f"{BASE}/v2/cryptocurrency/quotes/latest?symbol={symbol.upper()}&convert=TWD",
        headers={"X-CMC_PRO_API_KEY": api_key},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read())
