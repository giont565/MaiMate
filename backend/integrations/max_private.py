"""MAX Private API 串接（需 Lv2 KYC + API Key）。

安全規則（data-schema.md）：
- 金鑰只從環境變數／Secrets Manager 讀，嚴禁寫進程式或 git。
- API Key 權限只開「讀取＋交易」，不開「提領」。

簽章方式：payload = base64(JSON{path, nonce, ...params})，
signature = HMAC-SHA256(secret, payload)。細節以官方 v3 文件為準。

**GET 也必須送出 JSON body**：MAX 會把 base64 解碼後的 X-MAX-PAYLOAD 與 request body
逐位元組比對，不一致就回 2014（`Payload is not consistent with body...`），而且這道檢查
在驗簽章「之前」——所以簽章對不對根本還輪不到。官方 Go SDK 的 auth_middleware.go
是用 RoundTripper 直接把 body 覆寫成 payload 的原文，GET 也不例外（generated client 的
localVarPostBody 是非 nil 的空 map，所以每一條請求都帶 body）。
"""
import base64
import hashlib
import hmac
import http.client
import json
import os
import time
import urllib.parse
from decimal import ROUND_DOWN, Decimal

HOST = "max-api.maicoin.com"
BASE = f"https://{HOST}"


def _keys():
    key = os.environ.get("MAX_API_KEY")
    secret = os.environ.get("MAX_API_SECRET")
    if not key or not secret:
        raise RuntimeError("MAX_API_KEY / MAX_API_SECRET 未設定（環境變數或 Secrets Manager）")
    return key, secret


def _build_request(method, path, params=None, nonce=None):
    """組出 (target, body_bytes, headers)。抽出來是為了能在沒有金鑰的環境下驗證
    payload 與 body 的位元組一致性（tests/test_max_private.py）。"""
    key, secret = _keys()
    body = dict(params or {})
    body["path"] = path
    body["nonce"] = nonce if nonce is not None else int(time.time() * 1000)

    # 只序列化一次，同一份 bytes 同時當 request body 與 payload 的來源。
    # 分兩次 json.dumps 就是 2014 的溫床——只要有一個欄位（例如 nonce）重算過，
    # 兩邊就差一個位元組，MAX 照樣拒收。
    raw = json.dumps(body).encode()
    payload = base64.b64encode(raw).decode()
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-MAX-ACCESSKEY": key,
        "X-MAX-PAYLOAD": payload,
        "X-MAX-SIGNATURE": signature,
        "Content-Type": "application/json",
    }
    # payload 裡的 path 不含 query string（Go SDK 取的是 req.URL.Path），
    # GET 的參數則同時放 query string 與 payload，兩種讀法都成立。
    target = path
    if method == "GET" and params:
        target += "?" + urllib.parse.urlencode(params)
    return target, raw, headers


def _signed_request(method, path, params=None):
    target, raw, headers = _build_request(method, path, params)

    # 用 http.client 而非 urllib：urllib 的 Request.add_header 會把 header 名稱
    # 做 .capitalize()（X-MAX-PAYLOAD → X-max-payload）。HTTP 規範雖不分大小寫，
    # 但簽章類 header 遇到嚴格比對的閘道就會讀不到，症狀是「payload 裡沒有 path」。
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        conn.request(method, target, body=raw, headers=headers)
        resp = conn.getresponse()
        answer = resp.read()
        if resp.status >= 400:
            # MAX 把真正的原因（簽章錯／權限不足／nonce 超時）放在 response body，
            # 只看狀態碼查不出所以然。
            raise RuntimeError(f"MAX API {resp.status} {path}：{answer.decode()[:300] or '(無回應內容)'}")
        return json.loads(answer)
    finally:
        conn.close()


def balances():
    """查各幣別餘額（Read）。"""
    return _signed_request("GET", "/api/v3/wallet/spot/accounts")


def _history_params(timestamp=None, order="asc", limit=1000, **optional):
    """驗證 MAX v3 歷史查詢的共同參數（官方單頁上限 1,000）。"""
    if order not in ("asc", "desc"):
        raise ValueError("order must be asc or desc")
    try:
        limit = int(limit)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit must be an integer") from exc
    if not 1 <= limit <= 1000:
        raise ValueError("limit must be between 1 and 1000")
    params = {"order": order, "limit": limit}
    if timestamp is not None:
        try:
            timestamp = int(timestamp)
        except (TypeError, ValueError) as exc:
            raise ValueError("timestamp must be an integer") from exc
        if timestamp <= 0:
            raise ValueError("timestamp must be greater than zero")
        params["timestamp"] = timestamp
    params.update({key: value for key, value in optional.items() if value is not None})
    return params


def trades(market=None, timestamp=None, from_id=None, order="asc", limit=1000):
    """查 spot 已成交紀錄（Read）；不建立、取消或修改訂單。"""
    params = _history_params(timestamp, order, limit, market=market, from_id=from_id)
    return _signed_request("GET", "/api/v3/wallet/spot/trades", params)


def deposits(currency=None, timestamp=None, order="asc", limit=1000):
    """查外部入金歷史（Read）。"""
    params = _history_params(timestamp, order, limit, currency=currency)
    return _signed_request("GET", "/api/v3/deposits", params)


def withdrawals(currency=None, state=None, timestamp=None, order="asc", limit=1000):
    """查外部出金歷史（Read）；此函式不具提領能力。"""
    params = _history_params(timestamp, order, limit, currency=currency, state=state)
    return _signed_request("GET", "/api/v3/withdrawals", params)


def history_since(kind, start_timestamp, end_timestamp=None, page_size=1000, max_pages=100):
    """依 ``created_at`` 由舊到新取得指定期間歷史，並去重與限制最大頁數。

    MAX 的三個歷史端點都使用毫秒級 ``timestamp``、``order``、``limit``。每頁滿載時
    下一頁從最後時間戳加一毫秒繼續，避免重複；若 API 無法推進游標就明確報錯，不回傳
    一份看似完整、實際被截斷的年度資料。
    """
    fetchers = {"trades": trades, "deposits": deposits, "withdrawals": withdrawals}
    if kind not in fetchers:
        raise ValueError("kind must be trades, deposits or withdrawals")
    try:
        cursor = int(start_timestamp)
        start = cursor
        end = None if end_timestamp is None else int(end_timestamp)
    except (TypeError, ValueError) as exc:
        raise ValueError("history timestamps must be integers") from exc
    if cursor <= 0 or (end is not None and end < cursor):
        raise ValueError("history timestamp range is invalid")
    if max_pages <= 0:
        raise ValueError("max_pages must be greater than zero")

    rows = []
    seen = set()
    fetcher = fetchers[kind]
    for _page in range(max_pages):
        batch = fetcher(timestamp=cursor, order="asc", limit=page_size)
        if not isinstance(batch, list):
            raise RuntimeError(f"MAX {kind} history returned a non-list response")
        timestamps = []
        for item in batch:
            if not isinstance(item, dict) or item.get("created_at") is None:
                raise RuntimeError(f"MAX {kind} history row has no created_at")
            created = int(item["created_at"])
            timestamps.append(created)
            if created < start or (end is not None and created > end):
                continue
            identity = item.get("id") or item.get("uuid") or (
                created, item.get("market"), item.get("amount"), item.get("volume"))
            if identity not in seen:
                seen.add(identity)
                rows.append(item)
        if len(batch) < page_size or not timestamps:
            break
        newest = max(timestamps)
        if end is not None and newest >= end:
            break
        next_cursor = newest + 1
        if next_cursor <= cursor:
            raise RuntimeError(f"MAX {kind} history pagination did not advance")
        cursor = next_cursor
    else:
        raise RuntimeError(f"MAX {kind} history exceeded {max_pages} pages")
    return sorted(rows, key=lambda item: (int(item["created_at"]), str(item.get("id") or item.get("uuid") or "")))


def resolve_volume(order):
    """把確認卡的 volume_twd 換算成 MAX 要的下單量（base currency）。

    prepare_order 存的是 volume_twd（使用者講的是「用 5000 買 BTC」），但 MAX 的
    /order 只吃 base currency 的 volume——兩者名字不同，直接 order["volume"] 會拿到空字串，
    等於送出一張沒有數量的單。

    回傳 (volume_str, detail)；detail 供稽核與確認卡顯示。
    """
    from . import max_public

    if order.get("volume"):  # 呼叫端已自行算好就尊重它
        return str(order["volume"]), None

    market = order["market"]
    amount_twd = float(order.get("volume_twd") or 0)
    if amount_twd <= 0:
        raise ValueError("確認卡缺少 volume_twd，無法換算下單量")

    rules = max_public.market_rules(market)
    if order["ord_type"] == "limit":
        price = float(order["price"])
    else:
        price = float(max_public.fetch(market, "ticker")["data"].get("last") or 0)
    if price <= 0:
        raise ValueError(f"取不到 {market} 現價，無法換算下單量")

    # 兩道下限取大者才是真正的門檻。只報 min_quote_amount 會誤導——ETH 的
    # min_quote 是 250，但 0.005 ETH 的門檻約 NT$310，使用者照 250 改還是會被退。
    floor = max(rules["min_quote_amount"], rules["min_base_amount"] * price)
    if amount_twd < floor:
        raise ValueError(
            f"{market.upper()} 單筆最低 NT${floor:,.0f}"
            f"（金額下限 NT${rules['min_quote_amount']:,.0f}、"
            f"數量下限 {rules['min_base_amount']} {rules['base_unit'].upper()}≈NT${rules['min_base_amount'] * price:,.0f}，取大者），"
            f"這張單只有 NT${amount_twd:,.0f}"
        )

    # 無條件捨去到該市場的精度：進位會讓實際花費超過使用者在確認卡上看到的金額。
    step = Decimal(1).scaleb(-rules["base_precision"])
    volume = (Decimal(str(amount_twd)) / Decimal(str(price))).quantize(step, rounding=ROUND_DOWN)
    if float(volume) < rules["min_base_amount"]:
        raise ValueError(
            f"{market} 單筆最低數量 {rules['min_base_amount']} {rules['base_unit'].upper()}"
            f"（約 NT${rules['min_base_amount'] * price:,.0f}），"
            f"NT${amount_twd:,.0f} 只能換到 {volume}"
        )
    volume_str = _trim(volume)
    detail = {"price_used": price, "amount_twd": amount_twd,
              "volume": volume_str, "base_unit": rules["base_unit"]}
    return volume_str, detail


def _trim(value):
    """去掉 quantize 補出來的尾隨零。不用 Decimal.normalize()——它會把 100 變成
    1E+2，而 DOGE 這類最小量就是 100，送出去會被當成無效數量。"""
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def place_order(order):
    """送出訂單（Write）。order 來自 tools.execute_order 驗證過的確認卡。

    僅接受經過確認流程的 order dict；市價單以 TWD 金額換算量。
    """
    volume, _ = resolve_volume(order)
    params = {
        "market": order["market"],
        "side": order["side"],
        "ord_type": order["ord_type"],
        "volume": volume,
    }
    if order["ord_type"] == "limit":
        params["price"] = str(order["price"])
    return _signed_request("POST", "/api/v3/wallet/spot/order", params)
