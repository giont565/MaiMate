#!/usr/bin/env python3
"""MAX Private API 連線自檢（#4 簽章驗證用）。

用途：在本機用你自己的金鑰打一次真 API，把 MAX 回傳的**原始錯誤**印出來，
不用等部署＋看 CloudWatch。簽章邏輯與 Lambda 完全共用同一份程式碼。

用法：
    python3 scripts/check_max_private.py

金鑰來源優先序：環境變數 → 互動輸入（不回顯、不寫進 shell 歷史）。
本程式**不會**印出金鑰內容，只印遮罩後的前後各 4 碼供比對。
"""
import getpass
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def mask(s):
    return f"{s[:4]}…{s[-4:]}（長度 {len(s)}）" if len(s) > 8 else "（太短，可能貼錯）"


def main():
    key = os.environ.get("MAX_API_KEY") or getpass.getpass("MAX_API_KEY（輸入時不顯示）: ").strip()
    secret = os.environ.get("MAX_API_SECRET") or getpass.getpass("MAX_API_SECRET（輸入時不顯示）: ").strip()
    if not key or not secret:
        sys.exit("✘ 未提供金鑰")
    os.environ["MAX_API_KEY"], os.environ["MAX_API_SECRET"] = key, secret

    print(f"  key    = {mask(key)}")
    print(f"  secret = {mask(secret)}")
    for name, val in (("MAX_API_KEY", key), ("MAX_API_SECRET", secret)):
        if val != val.strip():
            print(f"  ⚠ {name} 前後有空白——貼上時多帶了空格或換行，這會讓簽章必定失敗")
        elif any(c.isspace() for c in val):
            # 實際踩過：多行貼上時 read -s 會把下一行指令當成輸入吃掉，
            # export 再讓它留在整個 shell session，症狀是 2008（金鑰不存在）。
            print(f"  ⚠ {name} 中間有空白字元，這不是金鑰。多半是 `read -s` 把下一行"
                  f"指令吃進去了：先 `unset {name}` 再重跑，並在提示出現後單獨貼一個值。")
        elif len(val) != 40:
            print(f"  ⚠ {name} 長度 {len(val)}，MAX 金鑰是 40 字元——可能貼到別的東西")

    from backend.integrations import max_private

    # 逐條試：把「簽章對不對」與「路徑對不對」分開。
    # /api/v3/info 是官方文件範例用的私有端點——它若通過就證明簽章正確，
    # 剩下的失敗全是路徑問題；它若也失敗，問題在簽章組法。
    candidates = sys.argv[1:] or [
        "/api/v3/info",
        "/api/v3/wallet/spot/accounts",
        "/api/v3/wallet/m/accounts",
        "/api/v2/members/accounts",
    ]
    ok_paths = []
    for path in candidates:
        print(f"\n→ GET {path}")
        try:
            data = max_private._signed_request("GET", path)
        except Exception as e:  # noqa: BLE001 — 這支就是要把原始錯誤秀出來
            print(f"  ✘ {e}")
            continue
        ok_paths.append(path)
        if isinstance(data, list):
            nonzero = [d for d in data if float(d.get("balance", 0) or 0) > 0]
            print(f"  ✔ 成功：{len(data)} 筆，其中 {len(nonzero)} 個有餘額")
            for d in nonzero[:8]:
                print(f"      {str(d.get('currency', '?')).upper():6} {d.get('balance')}")
        else:
            print(f"  ✔ 成功：{json.dumps(data, ensure_ascii=False)[:300]}")

    print()
    if not ok_paths:
        print("全部失敗。對照：")
        print("  2014 → payload 與 body 不一致／path 寫錯。已知成因：GET 沒送 body。")
        print("         若這版仍 2014，跑 python3 scripts/probe_max_signing.py 掃其餘變體")
        print("  2004 → 簽章不符：secret 貼錯或前後有空白")
        print("  2006 → nonce 超出伺服器時間 ±30 秒：檢查本機時鐘")
        print("  2001 → 金鑰無效或已刪除")
        print("  403  → 權限沒開『個人及帳戶[讀取]』")
        print("  提到驗證等級 → Lv2 KYC 未完成（issue #3）")
        sys.exit(1)
    print(f"可用路徑：{', '.join(ok_paths)}")
    if "/api/v3/info" in ok_paths:
        print("→ 簽章組法正確；失敗的那幾條純粹是路徑不對，改 max_private.py 的路徑即可。")


if __name__ == "__main__":
    main()
