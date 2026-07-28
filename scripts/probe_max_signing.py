#!/usr/bin/env python3
"""MAX Private API 簽章實驗台（#4 除錯用，非產品程式碼）。

背景：/api/v3/info 等四條路徑全回 2014「Payload is not consistent with body
or wrong path in payload」，payload 組法已對照官方 Go SDK 確認一致、header
大小寫也已逐字送出，仍未解。本腳本用實驗切開剩下的可能性：

  實驗 A｜檢查順序：故意送錯誤簽章，看回 2004 還是 2014
          → 若錯簽章回 2004、正確簽章回 2014，代表簽章通過、卡在 payload
          → 若兩者都回 2014，代表 payload 比對發生在簽章驗證之前
  實驗 B｜序列化變體：同一份內容用四種 JSON 寫法送，看哪種被接受

不印任何金鑰內容。payload 只含 path 與 nonce，可安全貼出。
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
PATH = sys.argv[1] if len(sys.argv) > 1 else "/api/v3/info"


def send(payload_str, secret, key, bad_sig=False):
    payload = base64.b64encode(payload_str.encode()).decode()
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if bad_sig:
        sig = "0" * 64
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    try:
        conn.request("GET", PATH, headers={
            "X-MAX-ACCESSKEY": key,
            "X-MAX-PAYLOAD": payload,
            "X-MAX-SIGNATURE": sig,
        })
        r = conn.getresponse()
        return r.status, r.read().decode()[:200]
    finally:
        conn.close()


def main():
    key = os.environ.get("MAX_API_KEY")
    secret = os.environ.get("MAX_API_SECRET")
    if not key or not secret:
        sys.exit("✘ 請先 export MAX_API_KEY / MAX_API_SECRET")

    body = {"path": PATH, "nonce": int(time.time() * 1000)}
    variants = {
        "1 目前用法（有空格、插入順序）": json.dumps(body),
        "2 緊湊＋排序（等同 Go json.Marshal）": json.dumps(body, separators=(",", ":"), sort_keys=True),
        "3 緊湊、nonce 在前": json.dumps({"nonce": body["nonce"], "path": PATH}, separators=(",", ":")),
        "4 nonce 用字串": json.dumps({"path": PATH, "nonce": str(body["nonce"])}, separators=(",", ":")),
    }

    print(f"目標：GET https://{HOST}{PATH}\n")
    print("── 實驗 A：檢查順序（故意送錯誤簽章）")
    st, msg = send(variants["1 目前用法（有空格、插入順序）"], secret, key, bad_sig=True)
    print(f"  錯誤簽章 → {st} {msg}")
    print("  ↑ 若這裡是 2004/signature，代表簽章會被先驗；正確簽章卻回 2014 就是 payload 內容被拒")
    print("  ↑ 若這裡也是 2014，代表 payload 在簽章之前就被判定不合格\n")

    print("── 實驗 B：四種序列化變體（皆用正確簽章）")
    for name, payload_str in variants.items():
        # 每次重取 nonce，避免 nonce 只能用一次的限制
        fresh = payload_str.replace(str(body["nonce"]), str(int(time.time() * 1000)))
        st, msg = send(fresh, secret, key)
        mark = "✔" if st < 400 else "✘"
        print(f"  {mark} {name}")
        print(f"      送出：{fresh}")
        print(f"      回應：{st} {msg}")
        time.sleep(0.3)


if __name__ == "__main__":
    main()
