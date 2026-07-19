# Design — trade-scenarios

## 位置

`backend/agent/scenarios.py`（新檔），註冊為工具 `calculate_trade_scenarios` 進 tools.py。

## 介面

```python
def calculate_trade_scenarios(market: str, side: str, fraction: float,
                              balances: dict, ticker: dict, report: dict) -> dict:
    """回傳 {"scenarios": [
        {"key": "partial", "label": "賣出 25%", "amount_twd": .., "fee_twd": ..,
         "post_concentration_pct": .., "behavior_note": ".."},
        {"key": "full", ...}, {"key": "pause", ...}],
        "disclaimer": "以當下價格估算…"}"""
```

## 工具鏈組合（LLM 視角）

意圖 → get_account_balance + get_market_data + query_user_history（已有工具）
→ calculate_trade_scenarios（新）→ LLM 轉人話 → 使用者選 → prepare_order（已有）。

toolSpec 的 description 要明確告訴 LLM：「使用者表達買賣意圖時，必須先呼叫本工具
產生方案，不得自行編造數字方案」——同步更新 SYSTEM 規則。

## 計算細節

- 手續費：MAX 現貨掛牌費率常數（maker/taker，以官網公告為準，附 source 註記）
- 集中度：執行後 balance×price 佔總資產比
- behavior_note：從 report.chase_index / opportunity_cost 取相關數字組句（模板，非 LLM）

## 不做的事

滑價模擬（P1）、限價深度分析（P1）、多標的組合方案（P2）。
