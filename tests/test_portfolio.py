"""GET /portfolio：真實帳戶持倉分布。

守三件事：
  ① 佔比分母與三方案卡同基準（只算 balance，不含 locked／staked）
  ② 被排除的部位要列出來，不靜默消失——「少一個幣」在畫面上看不出來
  ③ 連不上帳戶就回 503，**不退回報告快照冒充即時餘額**

⚠ 用 mock.patch 打真模組的屬性，不要換掉 sys.modules：後者會讓其他測試檔拿到假模組，
  單獨跑綠、整套跑紅（實測 3 errors 1 failure）。
"""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.handlers import chat, portfolio  # noqa: E402
from backend.integrations import max_private, max_public  # noqa: E402


class LiveHoldingsTest(unittest.TestCase):
    def _run(self, accounts, prices):
        with mock.patch.object(max_private, "balances", lambda: accounts), \
                mock.patch.object(max_public, "twd_prices", lambda: prices):
            return portfolio._live_holdings()

    def test_佔比只算可動用餘額且加總為百(self):
        out = self._run([{"currency": "twd", "balance": "5827.47"},
                         {"currency": "eth", "balance": "3.057"}],
                        {"eth": 60590.0})
        self.assertEqual(out["total_value_twd"], 191051)
        self.assertEqual([h["currency"] for h in out["holdings"]], ["ETH", "TWD"])
        self.assertAlmostEqual(sum(h["pct_of_account"] for h in out["holdings"]), 100.0, places=1)
        self.assertEqual(out["account_source"], "max_private")

    def test_質押與鎖定不計入佔比但要列出來(self):
        out = self._run([{"currency": "twd", "balance": "1000"},
                         {"currency": "ada", "balance": "0", "staked": "8888.8"},
                         {"currency": "eth", "balance": "1", "locked": "0.5"}],
                        {"ada": 5.55, "eth": 60000.0})
        self.assertNotIn("ADA", [h["currency"] for h in out["holdings"]])
        excluded = {e["currency"]: e["amount"] for e in out["excluded"]}
        self.assertEqual(excluded["ADA"], 8888.8)
        self.assertEqual(excluded["ETH"], 0.5)
        eth = next(h for h in out["holdings"] if h["currency"] == "ETH")
        self.assertEqual(eth["value_twd"], 60000)  # 只算可動用的 1 顆，不是 1.5
        self.assertTrue(any("鎖定或質押" in n for n in out["data_notes"]))

    def test_查無報價的幣不當零元吃掉(self):
        out = self._run([{"currency": "twd", "balance": "1000"},
                         {"currency": "xyz", "balance": "10"}], {})
        self.assertNotIn("XYZ", [h["currency"] for h in out["holdings"]])
        self.assertTrue(any("查無 TWD 報價" in n and "XYZ" in n for n in out["data_notes"]))

    def test_連不上帳戶回五零三而不是退回報告(self):
        def boom():
            raise RuntimeError("signature 2014")
        with mock.patch.object(max_private, "balances", boom), \
                mock.patch.object(max_private, "has_keys", lambda: True):
            resp = portfolio.handler({}, None)
        self.assertEqual(resp["statusCode"], 503)
        body = json.loads(resp["body"])
        self.assertEqual(body["code"], "account_unavailable")
        self.assertNotIn("holdings", body)


class RouteDispatchTest(unittest.TestCase):
    """ChatFunction 兼服務 GET /portfolio——分流錯了會讓 POST /chat 整條掛掉。"""

    def test_非portfolio路徑不會被攔截(self):
        event = {"requestContext": {"http": {"method": "POST", "path": "/chat"}}, "body": "{}"}
        resp = chat.handler(event, None)
        self.assertEqual(resp["statusCode"], 400)  # messages 空 → 走到原本的驗證
        self.assertIn("messages", json.loads(resp["body"])["message"])

    def test_portfolio路徑會被分流(self):
        event = {"requestContext": {"http": {"method": "GET", "path": "/portfolio"}}}
        with mock.patch.object(portfolio, "handler", lambda e, c: {"statusCode": 299}):
            self.assertEqual(chat.handler(event, None)["statusCode"], 299)


if __name__ == "__main__":
    unittest.main()
