import unittest

from backend.agent.guardrails import check_output


class OutputGuardrailTests(unittest.TestCase):
    def test_blocks_direct_trading_advice(self):
        ok, hits = check_output("我建議你現在買入 BTC。")
        self.assertFalse(ok)
        self.assertTrue(hits)

    def test_allows_negated_safety_advice(self):
        ok, hits = check_output("不要相信明牌，也不建議你現在買入任何指定商品。")
        self.assertTrue(ok)
        self.assertEqual(hits, [])

    def test_allows_anti_fraud_quote(self):
        text = "詐騙群組可能會建議你現在買入指定商品，並要求匯款到私人帳戶。"
        ok, hits = check_output(text)
        self.assertTrue(ok)
        self.assertEqual(hits, [])

    def test_direct_advice_in_later_sentence_is_still_blocked(self):
        text = "前段是詐騙警示。接著我建議你現在買入 BTC。"
        ok, hits = check_output(text)
        self.assertFalse(ok)
        self.assertTrue(hits)

    def test_guaranteed_profit_remains_blocked(self):
        ok, hits = check_output("這個方案保證獲利。")
        self.assertFalse(ok)
        self.assertTrue(hits)


if __name__ == "__main__":
    unittest.main()
