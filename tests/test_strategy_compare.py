"""進場方式比較的三條不可退讓的性質。

會寫這支測試是因為這個工具最容易出的三種錯，都不會報錯、只會安靜地講錯話：
1. 三種方式被偷偷排序或標上推薦（踩紅線 1「永不報明牌」）。
2. 金額切十份後低於交易所單筆下限，卻照樣把方案端出去
   （＝07/31「買 500 元 ETH 推薦 125 元試水溫」那次事故的同一個坑）。
3. 網格在多頭情境被講成賺錢——它在那段的特徵是「錢還在現金裡」。
"""
import json
import unittest
from unittest.mock import patch

from backend.agent import tools

BTC_RULES = {"market": "btctwd", "base_unit": "btc", "base_precision": 8,
             "min_base_amount": 0.0001, "min_quote_amount": 250.0, "status": "active"}
BTC_PRICE = 2_045_631.0


def compare(amount_twd, market="btctwd", risk_mode=None):
    with patch("backend.integrations.max_public.market_rules", return_value=BTC_RULES), \
         patch("backend.integrations.max_public.fetch",
               return_value={"data": {"last": str(BTC_PRICE)}}):
        return tools.compare_entry_strategies(market, amount_twd, risk_mode)


class EntryStrategyComparisonTests(unittest.TestCase):
    def test_all_three_strategies_are_presented_for_every_scenario(self):
        """對等呈現：不論哪個情境、哪個風險等級，三種方式都必須在。"""
        for mode in ("cautious", "growth", "pro"):
            result = compare(50_000, risk_mode=mode)
            for name, scenario in result["scenarios"].items():
                self.assertEqual(set(scenario["strategies"]), {"lump_sum", "dca", "grid"},
                                 f"{mode}/{name} 少了方式，會變成隱性推薦")

    def test_output_never_recommends_one_strategy(self):
        """紅線 1：輸出裡不得出現推薦字樣，風險等級只能決定先看哪個數字。"""
        blob = json.dumps(compare(50_000, risk_mode="cautious"), ensure_ascii=False)
        for word in ("建議使用", "推薦使用", "最適合你", "你應該選"):
            self.assertNotIn(word, blob)
        tier = compare(50_000, risk_mode="cautious")["risk_tier"]
        self.assertEqual(tier["primary_metric"], "max_drawdown_pct")

    def test_amount_below_exchange_minimum_is_flagged(self):
        """切十份後每份 200 元 < BTC 單筆下限 250 元 → 必須擋下並說出最低總額。"""
        f = compare(2_000)["feasibility"]
        self.assertEqual(f["status"], "below_minimum")
        self.assertEqual(f["exchange_floor_twd"], 250)
        self.assertEqual(f["min_total_twd"], 2_500)

    def test_amount_above_minimum_passes(self):
        f = compare(50_000)["feasibility"]
        self.assertEqual(f["status"], "ok")
        self.assertEqual(f["per_slice_twd"], 5_000)

    def test_grid_uptrend_shows_the_cash_drag_not_a_profit(self):
        """多頭情境下網格的真相是踏空：期末幾乎全是現金、報酬遠低於一次全買。"""
        up = compare(50_000)["scenarios"]["uptrend"]["strategies"]
        self.assertGreater(up["grid"]["end_cash_pct"], 50,
                           "網格在多頭應該大量沒進場，這個數字就是踏空成本")
        self.assertLess(up["grid"]["return_pct"], up["lump_sum"]["return_pct"])

    def test_unknown_market_is_honest(self):
        result = compare(50_000, market="xrptwd")
        self.assertIn("error", result)
        self.assertIn("btctwd", result["available_markets"])

    def test_feasibility_degrades_gracefully_when_market_data_is_down(self):
        """場地網路每 5 次掉 1 次：行情掛掉時要如實回 unknown，不能猜門檻。"""
        with patch("backend.integrations.max_public.market_rules",
                   side_effect=RuntimeError("connection reset")):
            f = tools.compare_entry_strategies("btctwd", 50_000)["feasibility"]
        self.assertEqual(f["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
