#!/usr/bin/env python3
"""MAX Private API 簽章實驗台（#4 除錯用，非產品程式碼）。

已知（前兩輪實驗結論）：
- 四條路徑（含官方範例 /api/v3/info）全回 2014
- 錯誤簽章同樣回 2014 → MAX 在驗簽章「之前」就先檢查 payload
- 四種 JSON 序列化變體全回 2014 → 與格式無關

結論：被拒的是 payload 裡 path 這個「值」本身。本輪固定請求路徑，
只變動 payload 內的 path 寫法，找出 MAX 期待的格式。

不印任何金鑰。payload 只含 path 與 nonce，可安全貼出。
"""
import base64
import hashlib
import hmac
import http.client
import json
import os
import sys
import time

HOST = "max-api.maicoin.com"
REQ_PATH = sys.argv[1] if len(sys.argv) > 1 else "/api/v3/wallet/spot/accounts"


def send(payload_obj, key, secret, req_path=REQ_PATH, body=None):
    payload_str = json.dumps(payload_obj)
    payload = base64.b64encode(payload_str.encode()).decode()
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    headers = {"X-MAX-ACCESSKEY": key, "X-MAX-PAYLOAD": payload, "X-MAX-SIGNATURE": sig}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        conn.request("GET", req_path, body=data, headers=headers)
        r = conn.getresponse()
        return r.status, r.read().decode()[:180]
    finally:
        conn.close()


def run(label, payload_obj, key, secret, **kw):
    st, msg = send(payload_obj, key, secret, **kw)
    print(f"  {'✔' if st < 400 else '✘'} {label}")
    print(f"      payload：{json.dumps(payload_obj, ensure_ascii=False)}")
    print(f"      回應：{st} {msg}")
    time.sleep(0.3)
    return st < 400


def main():
    key = os.environ.get("MAX_API_KEY")
    secret = os.environ.get("MAX_API_SECRET")
    if not key or not secret:
        sys.exit("✘ 請先 export MAX_API_KEY / MAX_API_SECRET")

    def now():
        return int(time.time() * 1000)

    print(f"固定請求：GET https://{HOST}{REQ_PATH}\n")
    print("── 實驗 C：payload 裡的 path 寫法")
    ok = []
    for label, p in [
        ("原樣（含 /api 前綴）", REQ_PATH),
        ("去掉 /api 前綴", REQ_PATH.replace("/api", "", 1)),
        ("不帶開頭斜線", REQ_PATH.lstrip("/")),
        ("完整網址", f"https://{HOST}{REQ_PATH}"),
    ]:
        if run(label, {"path": p, "nonce": now()}, key, secret):
            ok.append(label)

    print("\n── 實驗 D：其他 payload 欄位組合")
    if run("只有 nonce（沒有 path）", {"nonce": now()}, key, secret):
        ok.append("只有 nonce")
    if run("path/nonce＋空 params", {"path": REQ_PATH, "nonce": now(), "params": {}}, key, secret):
        ok.append("含空 params")
    if run("GET 但附上與 payload 相同的 body", {"path": REQ_PATH, "nonce": now()}, key, secret,
           body={"path": REQ_PATH, "nonce": now()}):
        ok.append("GET 附 body")

    print()
    print(f"成功的組合：{ok or '（無）'}")


if __name__ == "__main__":
    main()
