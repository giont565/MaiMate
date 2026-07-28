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


def place_order(order):
    """送出訂單（Write）。order 來自 tools.execute_order 驗證過的確認卡。

    僅接受經過確認流程的 order dict；市價單以 TWD 金額換算量。
    """
    params = {
        "market": order["market"],
        "side": order["side"],
        "ord_type": order["ord_type"],
        "volume": str(order.get("volume") or ""),
    }
    if order["ord_type"] == "limit":
        params["price"] = str(order["price"])
    return _signed_request("POST", "/api/v3/wallet/spot/order", params)
