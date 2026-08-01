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


def has_keys():
    """這個環境有沒有配置帳戶金鑰。**只讀存在性，不讀值、不印值、不打任何 API。**

    判斷與 _keys() 同一套（空字串＝沒有：模板 Environment 區塊變動時金鑰會被清成空）。
    唯一的用途是讓上層決定要不要改用示範帳戶（backend/agent/demo_account.py）——
    降級的條件只能是「金鑰不存在」這個部署時就決定、整個 Lambda 生命週期不會變的靜態事實。
    **絕不可以用 try/except balances() 來偵測**：場地網路每 5 次掉 1 次 TLS，
    把呼叫失敗也當成沒金鑰，有金鑰的錄影環境就會在一段對話中間靜默換成示範資料，
    而畫面完全正常——那正是本專案最忌諱的「看不出來的失效」。
    """
    return bool(os.environ.get("MAX_API_KEY")) and bool(os.environ.get("MAX_API_SECRET"))


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
