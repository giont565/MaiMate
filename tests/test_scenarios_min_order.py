"""三方案不得產生「交易所不可能接受」的卡片。

07/31 實測：使用者說「幫我買 500NTD 的 ETH」，三方案給出「先買 25% 試水溫＝NT$125」，
但 ethtwd 單筆最低是 max(NT$250, 0.005 ETH≈NT$310)。使用者點下那張金框推薦卡、
按確認，拿到 500 Internal Server Error——麥麥推薦了一個它自己做不到的動作。
"""
import unittest
from unittest.mock import patch

from backend.agent import scenarios

ETH_RULES = {"market": "ethtwd", "base_unit": "eth", "base_precision": 6,
             "min_base_amount": 0.005, "min_quote_amount": 250.0, "status": "active"}
ETH_PRICE = 62_000.0          # 0.005 ETH ≈ NT$310 → 門檻是 310 而非 250
BALANCES = {"twd": 6938.0, "eth": 3.03}


def build(amount_twd, price=ETH_PRICE):
    with patch("backend.integrations.max_public.market_rules", return_value=ETH_RULES):
        return scenarios.calculate_trade_scenarios(
            "ethtwd", "buy", amount_twd=amount_twd, balances=BALANCES,
            ticker={"last": str(price)}, report={})


class BuyScenarioMinimumTests(unittest.TestCase):
    def test_partial_is_never_below_the_exchange_minimum(self):
        result = build(500)
        partial = next(s for s in result["scenarios"] if s["key"] == "partial")
        floor = max(ETH_RULES["min_quote_amount"], ETH_RULES["min_base_amount"] * ETH_PRICE)
        self.assertGreaterEqual(partial["amount_twd"], floor)
        self.assertIn("最低", partial["label"], "抬過金額就要在標籤上講清楚，不能假裝還是 25%")

    def test_partial_stays_25_percent_when_it_clears_the_minimum(self):
        result = build(4000)          # 25% = NT$1,000，遠高於門檻
        partial = next(s for s in result["scenarios"] if s["key"] == "partial")
        self.assertEqual(partial["amount_twd"], 1000)
        self.assertEqual(partial["label"], "先買 25% 試水溫")

    def test_whole_request_below_minimum_is_rejected_with_a_usable_message(self):
        result = build(100)
        self.assertEqual(result["error"], "below_min_order")
        self.assertIn("310", result["message"])   # 報真正的門檻，不是 250

    def test_reports_the_floor_so_the_model_can_explain_it(self):
        self.assertEqual(build(500)["min_order_twd"], 310)

    def test_missing_market_rules_does_not_break_the_cards(self):
        """行情或規則暫時取不到時，三方案照出（resolve_volume 還有第二道防線）。"""
        with patch("backend.integrations.max_public.market_rules", side_effect=RuntimeError("boom")):
            result = scenarios.calculate_trade_scenarios(
                "ethtwd", "buy", amount_twd=500, balances=BALANCES,
                ticker={"last": str(ETH_PRICE)}, report={})
        self.assertEqual(len(result["scenarios"]), 3)


if __name__ == "__main__":
    unittest.main()
