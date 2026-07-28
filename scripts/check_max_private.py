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

    from backend.integrations import max_private

    print("\n→ GET /api/v3/wallet/spot/accounts")
    try:
        data = max_private.balances()
    except Exception as e:  # noqa: BLE001 — 這支就是要把原始錯誤秀出來
        print(f"✘ 失敗：{e}\n")
        print("常見對照：")
        print("  2004 / signature   → 簽章不符：secret 貼錯或前後有空白")
        print("  2006 / nonce       → 時間戳超出容許範圍：檢查本機時鐘")
        print("  2001 / unauthorized→ 金鑰無效或已刪除")
        print("  403 / permission   → API Key 權限沒開『個人及帳戶[讀取]』")
        print("  身分驗證等級不足    → Lv2 KYC 未完成（issue #3）")
        sys.exit(1)

    if isinstance(data, list):
        nonzero = [d for d in data if float(d.get("balance", 0) or 0) > 0]
        print(f"✔ 成功：{len(data)} 個幣別，其中 {len(nonzero)} 個有餘額")
        for d in nonzero[:8]:
            print(f"    {d.get('currency', '?').upper():6} {d.get('balance')}")
    else:
        print(f"✔ 成功，回傳：{json.dumps(data, ensure_ascii=False)[:400]}")


if __name__ == "__main__":
    main()
