"""CoinMarketCap BTC/TWD smoke check.

The API key is read only from CMC_API_KEY and is never printed.
"""
import argparse
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.integrations.thirdparty import quote


def main():
    parser = argparse.ArgumentParser(description="Verify the CoinMarketCap quote integration.")
    parser.add_argument("--symbol", default="BTC", help="Cryptocurrency symbol (default: BTC)")
    parser.add_argument(
        "--require-key",
        action="store_true",
        help="Fail instead of skipping when CMC_API_KEY is not set.",
    )
    args = parser.parse_args()

    if not os.environ.get("CMC_API_KEY"):
        print("CMC_API_KEY_PRESENT=False")
        if args.require_key:
            print("CMC_LIVE_SMOKE=FAIL (missing CMC_API_KEY)")
            return 2
        print("CMC_LIVE_SMOKE=SKIP")
        return 0

    symbol = args.symbol.upper()
    try:
        result = quote(symbol)
    except HTTPError as exc:
        print(f"CMC_HTTP_STATUS={exc.code}")
        print("CMC_LIVE_SMOKE=FAIL")
        return 1
    except (URLError, TimeoutError) as exc:
        print(f"CMC_NETWORK_ERROR={type(exc).__name__}")
        print("CMC_LIVE_SMOKE=FAIL")
        return 1

    status = result.get("status") or {}
    items = (result.get("data") or {}).get(symbol) or []
    item = items[0] if items else {}
    twd = (item.get("quote") or {}).get("TWD") or {}
    price = twd.get("price")
    updated = twd.get("last_updated") or item.get("last_updated")
    checks = {
        "status_ok": status.get("error_code") == 0,
        "symbol_matches": item.get("symbol") == symbol,
        "currency_twd": bool(twd),
        "positive_price": isinstance(price, (int, float)) and price > 0,
        "last_updated_present": bool(updated),
    }

    for name, ok in checks.items():
        print(f"{name}={ok}")
    print(f"price_twd_rounded={round(price, 2) if checks['positive_price'] else 'N/A'}")
    print(f"last_updated={updated or 'N/A'}")

    if not all(checks.values()):
        print("CMC_LIVE_SMOKE=FAIL")
        return 1
    print("CMC_LIVE_SMOKE=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
