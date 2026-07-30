"""MAX Private API 簽章組法的離線驗證（不需金鑰、不打真 API）。

#4 卡住兩天的 2014（`Payload is not consistent with body or wrong path in payload`）
就是「GET 沒送 body，payload 卻有內容」造成的。這幾條 assert 用假金鑰就能擋下同類回歸，
不必等部署完打真 API 才發現。
"""
import base64
import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import patch

from backend.integrations import max_private

FAKE = {"MAX_API_KEY": "k" * 40, "MAX_API_SECRET": "s" * 40}


class BuildRequestTests(unittest.TestCase):
    def build(self, method, path, params=None, nonce=1784723456000):
        with patch.dict(os.environ, FAKE):
            return max_private._build_request(method, path, params, nonce=nonce)

    def test_get_sends_body_identical_to_decoded_payload(self):
        """MAX 逐位元組比對 body 與 base64 解碼後的 payload——GET 也不例外。"""
        for method, path, params in [
            ("GET", "/api/v3/wallet/spot/accounts", None),
            ("GET", "/api/v3/wallet/spot/accounts", {"currency": "eth"}),
            ("POST", "/api/v3/wallet/spot/order", {"market": "btctwd", "side": "buy"}),
        ]:
            with self.subTest(method=method, params=params):
                _, raw, headers = self.build(method, path, params)
                self.assertTrue(raw, "body 不能是空的，否則必定 2014")
                self.assertEqual(base64.b64decode(headers["X-MAX-PAYLOAD"]), raw)

    def test_payload_path_excludes_query_string(self):
        """payload 的 path 對應 Go SDK 的 req.URL.Path，帶了 ?query 會被判 wrong path。"""
        target, raw, _ = self.build("GET", "/api/v3/wallet/spot/accounts", {"currency": "eth"})
        self.assertEqual(json.loads(raw)["path"], "/api/v3/wallet/spot/accounts")
        self.assertEqual(target, "/api/v3/wallet/spot/accounts?currency=eth")

    def test_payload_carries_path_and_nonce_plus_params(self):
        _, raw, _ = self.build("POST", "/api/v3/wallet/spot/order", {"market": "btctwd"})
        self.assertEqual(
            json.loads(raw),
            {"market": "btctwd", "path": "/api/v3/wallet/spot/order", "nonce": 1784723456000},
        )

    def test_signature_is_hmac_sha256_hex_over_the_base64_payload(self):
        _, _, headers = self.build("GET", "/api/v3/info")
        expected = hmac.new(
            FAKE["MAX_API_SECRET"].encode(), headers["X-MAX-PAYLOAD"].encode(), hashlib.sha256
        ).hexdigest()
        self.assertEqual(headers["X-MAX-SIGNATURE"], expected)

    def test_missing_keys_raise_before_any_network_call(self):
        with patch.dict(os.environ, {"MAX_API_KEY": "", "MAX_API_SECRET": ""}):
            with self.assertRaises(RuntimeError):
                max_private._build_request("GET", "/api/v3/info")


BTC_RULES = {"market": "btctwd", "base_unit": "btc", "base_precision": 8,
             "min_base_amount": 0.0001, "min_quote_amount": 250.0, "status": "active"}


@patch("backend.integrations.max_public.market_rules", return_value=BTC_RULES)
class ResolveVolumeTests(unittest.TestCase):
    """確認卡存的是 volume_twd，MAX 的 /order 只吃 base currency 的 volume。"""

    def ticker(self, last):
        return patch("backend.integrations.max_public.fetch",
                     return_value={"data": {"last": str(last)}})

    def test_converts_twd_to_base_volume_at_market_price(self, _rules):
        with self.ticker(2_000_000):
            volume, detail = max_private.resolve_volume(
                {"market": "btctwd", "side": "buy", "volume_twd": 300, "ord_type": "market"})
        self.assertEqual(volume, "0.00015")
        self.assertEqual(detail["price_used"], 2_000_000)

    def test_rounds_down_so_spend_never_exceeds_the_confirmed_amount(self, _rules):
        # 300 / 2069554.8 = 0.000144959…；進位就會超過使用者確認的 NT$300
        with self.ticker(2_069_554.8):
            volume, _ = max_private.resolve_volume(
                {"market": "btctwd", "side": "buy", "volume_twd": 300, "ord_type": "market"})
        self.assertEqual(volume, "0.00014495")
        self.assertLessEqual(float(volume) * 2_069_554.8, 300)

    def test_limit_order_uses_the_confirmed_price_not_the_ticker(self, _rules):
        with patch("backend.integrations.max_public.fetch") as fake_fetch:
            volume, detail = max_private.resolve_volume(
                {"market": "btctwd", "side": "buy", "volume_twd": 300,
                 "ord_type": "limit", "price": 1_500_000})
        fake_fetch.assert_not_called()
        self.assertEqual(volume, "0.0002")
        self.assertEqual(detail["price_used"], 1_500_000)

    def test_rejects_amount_below_market_minimum(self, _rules):
        with self.ticker(2_000_000):
            with self.assertRaisesRegex(ValueError, r"單筆最低 NT\$250"):
                max_private.resolve_volume(
                    {"market": "btctwd", "side": "buy", "volume_twd": 100, "ord_type": "market"})

    def test_floor_is_the_larger_of_the_two_limits_not_just_min_quote(self, _rules):
        """幣價高到 NT$300 換不到 0.0001 顆：門檻是數量下限 NT$900，不是金額下限 NT$250。
        只報 min_quote 會害使用者照 250 改，改完照樣被退。"""
        with self.ticker(9_000_000):
            with self.assertRaisesRegex(ValueError, r"單筆最低 NT\$900"):
                max_private.resolve_volume(
                    {"market": "btctwd", "side": "buy", "volume_twd": 300, "ord_type": "market"})

    def test_missing_volume_twd_raises_instead_of_sending_empty_volume(self, _rules):
        with self.ticker(2_000_000):
            with self.assertRaisesRegex(ValueError, "volume_twd"):
                max_private.resolve_volume(
                    {"market": "btctwd", "side": "buy", "ord_type": "market"})

    def test_explicit_volume_wins(self, _rules):
        volume, detail = max_private.resolve_volume(
            {"market": "btctwd", "side": "sell", "volume": "0.5", "ord_type": "market"})
        self.assertEqual(volume, "0.5")
        self.assertIsNone(detail)


if __name__ == "__main__":
    unittest.main()
