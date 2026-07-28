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


if __name__ == "__main__":
    unittest.main()
