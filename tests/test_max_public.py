import unittest
from unittest.mock import patch

from backend.integrations import max_public
from backend.integrations.max_public import _normalize_depth, _normalize_ticker


class NormalizeDepthTests(unittest.TestCase):
    def test_sorts_asks_ascending_bids_descending_and_calculates_spread(self):
        book = {
            "asks": [
                ["2165242.2", "0.1"],
                ["2163765.4", "0.2"],
                ["2165100.6", "0.3"],
            ],
            "bids": [
                ["2160730.8", "0.1"],
                ["2160866.5", "0.2"],
                ["2160702.8", "0.3"],
            ],
            "timestamp": 123,
        }

        result = _normalize_depth(book)

        self.assertEqual(
            [level[0] for level in result["asks"]],
            ["2163765.4", "2165100.6", "2165242.2"],
        )
        self.assertEqual(
            [level[0] for level in result["bids"]],
            ["2160866.5", "2160730.8", "2160702.8"],
        )
        self.assertEqual(result["best_ask"], 2163765.4)
        self.assertEqual(result["best_bid"], 2160866.5)
        self.assertAlmostEqual(result["spread_twd"], 2898.9)
        self.assertAlmostEqual(result["spread_pct"], 0.134155, places=6)
        self.assertEqual(result["timestamp"], 123)

    def test_empty_side_returns_no_spread(self):
        result = _normalize_depth({"asks": [], "bids": [["100", "1"]]})

        self.assertIsNone(result["best_ask"])
        self.assertIsNone(result["best_bid"])
        self.assertIsNone(result["spread_twd"])
        self.assertIsNone(result["spread_pct"])

    def test_rejects_malformed_level(self):
        with self.assertRaises(ValueError):
            _normalize_depth({"asks": [["100"]], "bids": [["99", "1"]]})


class MarketPeriodAndTimeTests(unittest.TestCase):
    def setUp(self):
        max_public._cache.clear()

    def test_ticker_includes_authoritative_times(self):
        result = _normalize_ticker({"at": 1784723456, "last": "1"})
        self.assertEqual(result["time_utc"], "2026-07-22T12:30:56Z")
        self.assertEqual(result["time_taipei"], "2026-07-22T20:30:56+08:00")

    @patch("backend.integrations.max_public._get")
    def test_kline_period_is_forwarded_and_reported(self, mock_get):
        mock_get.return_value = [[1784552400, 1, 2, 0.5, 1.5, 10]]
        result = max_public.fetch("btctwd", "kline", period=1)
        called_url = mock_get.call_args.args[0]
        self.assertIn("period=1", called_url)
        self.assertEqual(result["period_minutes"], 1)

    def test_rejects_period_for_non_kline(self):
        with self.assertRaises(ValueError):
            max_public.fetch("btctwd", "ticker", period=1)


if __name__ == "__main__":
    unittest.main()
