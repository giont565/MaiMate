import unittest

from backend.agent import guardrails
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

    def test_allows_generic_dca_education_from_knowledge_base(self):
        text = "定期定額是固定時間投入固定金額。一般會建議你現在買入並長期持有。"
        ok, hits = check_output(text, educational=True)
        self.assertTrue(ok)
        self.assertEqual(hits, [])

    def test_blocks_specific_asset_advice_from_knowledge_base(self):
        ok, hits = check_output("我建議你現在買入 BTC。", educational=True)
        self.assertFalse(ok)
        self.assertTrue(hits)

    def test_blocks_guaranteed_profit_from_knowledge_base(self):
        ok, hits = check_output("定期定額保證獲利。", educational=True)
        self.assertFalse(ok)
        self.assertTrue(hits)


if __name__ == "__main__":
    unittest.main()


class AntiFraudContextTests(unittest.TestCase):
    """防詐回答會大量引用「保證獲利」這類詞，但那是在說它是紅旗，不是在承諾。

    08/01 線上實測：F3 送「這是不是詐騙話術：保證每天 3% 獲利，穩賺不賠」，
    RAG 正確答出並附出處，卻被輸出護欄整段換成 SAFE_FALLBACK——好答案被自己人打掉。
    """

    def assert_allowed(self, text):
        ok, hits = guardrails.check_output(text)
        self.assertTrue(ok, f"不該攔：{text}（命中 {hits}）")

    def assert_blocked(self, text):
        ok, _ = guardrails.check_output(text)
        self.assertFalse(ok, f"必須攔：{text}")

    def test_negated_guarantee_is_not_a_guarantee(self):
        self.assert_allowed("這幾乎肯定是詐騙。在合法市場中，沒有任何商品可以保證獲利。")
        self.assert_allowed("沒有人能保證賺，報酬與風險無法脫鉤。")
        self.assert_allowed("合法投資不會保證報酬。")

    def test_quoting_a_scam_line_is_not_making_the_claim(self):
        self.assert_allowed("詐騙集團常說保證獲利，這是典型話術。")

    def test_newline_counts_as_a_sentence_boundary(self):
        """_SAFETY_CONTEXT 原本寫 [^。！？\\\\n]，raw string 裡是「反斜線＋n」不是換行，
        所以換行從來沒被當成句子邊界。附出處的回答正好會換行。"""
        self.assert_allowed("「保證每天 3% 獲利」是紅旗——合法投資不會保證報酬。\n"
                            "資料來源：https://www.sfb.gov.tw/")

    def test_real_promises_are_still_blocked(self):
        self.assert_blocked("這檔保證獲利，放心買。")
        self.assert_blocked("我保證賺，你現在進場就對了。")
        self.assert_blocked("建議你現在買入 BTC。")
        self.assert_blocked("BTC 一定會漲。")


    def test_fraud_label_after_the_phrase_also_counts(self):
        """模型最自然的寫法是把警告放在後面：「『保證獲利』…都是典型詐騙話術」。
        只看前綴 16 字會漏掉，實測 F3 三次全被換成安全罐頭語就是這個原因。"""
        self.assert_allowed("「保證獲利」「穩賺不賠」都是典型詐騙話術。")
        self.assert_allowed("只要出現保證獲利這種說法，就是詐騙警訊。")

    def test_recommendation_without_fraud_framing_is_still_blocked(self):
        self.assert_blocked("推薦你現在賣出 ETH。")
