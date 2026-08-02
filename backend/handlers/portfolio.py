"""GET /portfolio — 帳戶持倉分布（Screen 8「你的資金目前放在哪裡？」的資料源）。

為什麼要有這支：insights 那頁原本讀 `frontend/mocks/account.js`，那是 `data/health_report.json`
（命題方 CSV）產的 2025-12 靜態快照。私人／錄影環境**已經連上真實 MAX 帳戶**，卻還在拿
CSV 那份講「你的資金 98.6% 在現金」——真帳戶其實幾乎全是幣，意思正好相反。

兩種來源、同一個形狀（差別只在 `account_source` 與有沒有 `amount`）：
  · 有 MAX 金鑰 → 真帳戶即時餘額 × 即時報價
  · 沒有金鑰   → `demo_account.holdings_view()`（命題方資料），比賽環境走這條

⚠ 佔比的分母與三方案卡**同一套基準**（`scenarios.py:44`）：只算 `balance`，不含
`locked`／`staked`。兩個畫面用不同基準就會給出兩個百分比，而使用者無從判斷哪個對——
那比少一個數字更糟。被排除的部位改列在 `excluded` 裡，不靜默丟掉。
"""
import json


def handler(event, context):
    from ..agent import demo_account

    if demo_account.active():
        view = demo_account.holdings_view()
        if view is None:
            return _resp(503, {"code": "no_account_data", "retryable": True,
                               "message": "沒有 MAX 金鑰，示範帳戶資料也讀不到——不臨時編數字。"})
        return _resp(200, view)

    from ..agent import holdings

    try:
        return _resp(200, holdings.valued_holdings())
    except Exception as exc:  # noqa: BLE001 — 連不上帳戶要老實說，不退回 CSV 冒充即時
        return _resp(503, {"code": "account_unavailable", "retryable": True,
                           "message": f"連不上 MAX 帳戶：{exc}"})


def _resp(status, payload):
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(payload, ensure_ascii=False)}
