"""MAX Private API 串接（需 Lv2 KYC + API Key）。

安全規則（data-schema.md）：
- 金鑰只從環境變數／Secrets Manager 讀，嚴禁寫進程式或 git。
- API Key 權限只開「讀取＋交易」，不開「提領」。

簽章方式：payload = base64(JSON{path, nonce, ...params})，
signature = HMAC-SHA256(secret, payload)。細節以官方 v3 文件為準。
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


def _signed_request(method, path, params=None):
    key, secret = _keys()
    body = dict(params or {})
    body["path"] = path
    body["nonce"] = int(time.time() * 1000)
    payload = base64.b64encode(json.dumps(body).encode()).decode()
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-MAX-ACCESSKEY": key,
        "X-MAX-PAYLOAD": payload,
        "X-MAX-SIGNATURE": signature,
    }
    target = path
    data = None
    if method == "GET":
        # GET：參數走 query string，不送 body、也不宣告 Content-Type。
        if params:
            target += "?" + urllib.parse.urlencode(params)
    else:
        # POST：body 必須與 payload 內容一致（含 path 與 nonce）。
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    # 用 http.client 而非 urllib：urllib 的 Request.add_header 會把 header 名稱
    # 做 .capitalize()（X-MAX-PAYLOAD → X-max-payload）。HTTP 規範雖不分大小寫，
    # 但簽章類 header 遇到嚴格比對的閘道就會讀不到，症狀是「payload 裡沒有 path」。
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        conn.request(method, target, body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        if resp.status >= 400:
            # MAX 把真正的原因（簽章錯／權限不足／nonce 超時）放在 response body，
            # 只看狀態碼查不出所以然。
            raise RuntimeError(f"MAX API {resp.status} {path}：{raw.decode()[:300] or '(無回應內容)'}")
        return json.loads(raw)
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
