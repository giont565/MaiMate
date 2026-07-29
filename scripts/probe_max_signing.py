#!/usr/bin/env python3
"""MAX Private API 簽章實驗台（#4 除錯用，非產品程式碼）。

前三輪已排除：路徑（四條全 2014）、JSON 序列化格式（四種變體全 2014）、
header 大小寫（改 http.client 仍 2014）；錯誤簽章也回 2014 → 檢查順序在驗簽章之前。

07/28 對照官方 Go SDK 找到真因：`auth_middleware.go` 用 RoundTripper 把 request body
**整個覆寫成 payload 的原文**，generated client 的 localVarPostBody 是非 nil 的空 map，
所以連 GET 都帶 JSON body。MAX 的檢查是「base64 解碼後的 X-MAX-PAYLOAD == request body」，
我們的 GET 不送 body，這條比對必定不過——就是 2014 的第一個子句。

本輪實驗 E 直接驗證這個假設；A 是舊寫法的對照組，應該仍然失敗。
若 E 通過就結案（產品程式碼 backend/integrations/max_private.py 已照此修正）。

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


def send(payload_obj, key, secret, req_path=REQ_PATH, send_body=True, method="GET"):
    """送一次請求。send_body=True 時 body 就是 payload 的原文（位元組完全相同）。"""
    raw = json.dumps(payload_obj).encode()
    payload = base64.b64encode(raw).decode()
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    headers = {"X-MAX-ACCESSKEY": key, "X-MAX-PAYLOAD": payload, "X-MAX-SIGNATURE": sig}
    data = None
    if send_body:
        data = raw
        headers["Content-Type"] = "application/json"
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        conn.request(method, req_path, body=data, headers=headers)
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
    ok = []

    print("── 實驗 E：GET 是否必須附上與 payload 位元組相同的 body（本輪主假設）")
    if run("GET 附 body，body 與 payload 同一份 bytes", {"path": REQ_PATH, "nonce": now()},
           key, secret):
        ok.append("GET 附 body（＝主假設成立）")

    print("\n── 對照組 A：舊寫法（不送 body）——預期仍 2014")
    if run("GET 不送 body", {"path": REQ_PATH, "nonce": now()}, key, secret, send_body=False):
        ok.append("GET 不送 body")

    if not ok:
        print("\n── 實驗 C：主假設也不成立時，再掃 payload 裡 path 的寫法（都附 body）")
        for label, p in [
            ("去掉 /api 前綴", REQ_PATH.replace("/api", "", 1)),
            ("不帶開頭斜線", REQ_PATH.lstrip("/")),
            ("完整網址", f"https://{HOST}{REQ_PATH}"),
        ]:
            if run(label, {"path": p, "nonce": now()}, key, secret):
                ok.append(label)

    print()
    print(f"成功的組合：{ok or '（無）'}")
    if not ok:
        print("三輪都不通 → 往帳戶層查：Lv2 KYC 是否完成、這把 key 是否已啟用、"
              "權限是否勾了「個人及帳戶[讀取]」（issue #3）。")


if __name__ == "__main__":
    main()
