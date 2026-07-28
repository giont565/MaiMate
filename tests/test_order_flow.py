"""下單確認流的安全性驗收（order-flow spec 的「過期／重放皆回 410」）。

全程不打真 API：place_order 一律 mock，確保跑測試永遠不會真的送單。
"""
import json
import time
import unittest
from unittest.mock import patch

from backend.agent import tools
from backend.handlers import order as order_handler


def call(body):
    return order_handler.handler({"body": json.dumps(body)}, None)


class ConfirmTokenTests(unittest.TestCase):
    def setUp(self):
        tools._pending_orders.clear()
        self.addCleanup(tools._pending_orders.clear)
        # TABLE 未設定 → 走記憶體 fallback，與 Lambda 的 DynamoDB 路徑行為必須一致
        self.assertIsNone(order_handler.TABLE, "測試環境不該連到真的 DynamoDB")

    def prepare(self, **kw):
        card = tools.prepare_order(market="btctwd", side="buy", volume_twd=300,
                                   ord_type="market", **kw)
        return card["confirm_token"]

    @patch("backend.integrations.max_private.place_order", return_value={"id": 12345})
    def test_happy_path_executes_once(self, fake_place):
        token = self.prepare()
        resp = call({"confirm_token": token})
        self.assertEqual(resp["statusCode"], 200)
        self.assertEqual(fake_place.call_count, 1)
        self.assertEqual(json.loads(resp["body"])["exchange_response"], {"id": 12345})

    @patch("backend.integrations.max_private.place_order", return_value={"id": 12345})
    def test_replay_returns_410_and_does_not_send_twice(self, fake_place):
        token = self.prepare()
        call({"confirm_token": token})
        replay = call({"confirm_token": token})
        self.assertEqual(replay["statusCode"], 410)
        self.assertEqual(json.loads(replay["body"])["code"], "token_expired")
        self.assertEqual(fake_place.call_count, 1, "重放不得再送一次單")

    @patch("backend.integrations.max_private.place_order")
    def test_expired_token_returns_410(self, fake_place):
        token = self.prepare()
        tools._pending_orders[token]["expires_at"] = time.time() - 1
        resp = call({"confirm_token": token})
        self.assertEqual(resp["statusCode"], 410)
        fake_place.assert_not_called()

    @patch("backend.integrations.max_private.place_order")
    def test_unknown_token_returns_410(self, fake_place):
        resp = call({"confirm_token": "沒見過的 token"})
        self.assertEqual(resp["statusCode"], 410)
        fake_place.assert_not_called()

    @patch("backend.integrations.max_private.place_order")
    def test_missing_token_returns_400(self, fake_place):
        resp = call({})
        self.assertEqual(resp["statusCode"], 400)
        fake_place.assert_not_called()

    def test_execute_order_is_not_reachable_by_the_llm(self):
        """紅線：execute_order 永不進 LLM 工具清單（CLAUDE.md 鐵則 4）。"""
        self.assertNotIn("execute_order", tools._DISPATCH)
        self.assertNotIn("execute_order", {t["toolSpec"]["name"] for t in tools.TOOLS})


if __name__ == "__main__":
    unittest.main()
