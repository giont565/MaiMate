import json
import os
import unittest
from unittest.mock import patch

from backend.integrations import thirdparty


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(
            {
                "status": {"error_code": 0},
                "data": {"BTC": [{"quote": {"TWD": {"price": 2_000_000}}}]},
            }
        ).encode()


class CoinMarketCapIntegrationTests(unittest.TestCase):
    def test_missing_key_skips_without_network(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("urllib.request.urlopen") as urlopen:
                self.assertIsNone(thirdparty.quote("BTC"))
        urlopen.assert_not_called()

    def test_quote_sends_expected_request_and_parses_json(self):
        observed = {}

        def fake_urlopen(request, timeout):
            observed["url"] = request.full_url
            observed["headers"] = {key.lower(): value for key, value in request.header_items()}
            observed["timeout"] = timeout
            return _FakeResponse()

        with patch.dict(os.environ, {"CMC_API_KEY": "test-only-key"}, clear=False):
            with patch("urllib.request.urlopen", fake_urlopen):
                result = thirdparty.quote("btc")

        self.assertTrue(
            observed["url"].startswith(
                "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?"
            )
        )
        self.assertIn("symbol=BTC", observed["url"])
        self.assertIn("convert=TWD", observed["url"])
        self.assertEqual(observed["headers"]["x-cmc_pro_api_key"], "test-only-key")
        self.assertEqual(observed["timeout"], 8)
        self.assertEqual(result["status"]["error_code"], 0)


if __name__ == "__main__":
    unittest.main()
