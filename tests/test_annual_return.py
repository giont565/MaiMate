import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.handlers import health as health_handler
from analysis.annual_return import (
    build_demo_annual_return,
    build_live_annual_return,
    external_twd_flows,
    reconstruct_start_balances,
)


def ts(iso):
    return int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp() * 1000)


def row(iso, currency, price, action, change, balance):
    return {"ts": ts(iso), "currency": currency, "price": price,
            "action": action, "change": change, "balance": balance}


class DemoAnnualReturnTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            row("2025-01-01", "btc", 100, "buy", 1, 1),
            row("2025-01-10", "twd", 1, "deposit", 100, 100),
            row("2025-01-15", "btc", 105, "deposit", 0.1, 1.1),
            row("2025-01-31", "btc", 110, "buy", 0, 1.1),
            row("2025-02-05", "twd", 1, "withdrawal", -20, 80),
            row("2025-02-28", "btc", 120, "buy", 0, 1.1),
        ]

    def test_external_flows_only_include_twd_deposit_and_withdrawal(self):
        self.assertEqual(external_twd_flows(self.rows), [
            {"date": "2025-01-31", "amount_twd": 100},
            {"date": "2025-02-28", "amount_twd": -20},
        ])

    def test_demo_contract_builds_monthly_periods_and_specific_missing_months(self):
        annual = build_demo_annual_return(
            self.rows, monthly_values={"2025-01": 221, "2025-02": 212})["2025"]
        self.assertEqual(annual["source"], "demo")
        self.assertFalse(annual["complete"])
        self.assertEqual(annual["start_value_twd"], 0.0)
        self.assertEqual(annual["end_value_twd"], 212.0)
        self.assertEqual(len(annual["periods"]), 2)
        self.assertEqual(annual["periods"][0]["start"], "2025-01-01")
        self.assertEqual(annual["periods"][0]["end"], "2025-02-01")
        self.assertEqual(annual["periods"][1]["start_value_twd"], 221.0)
        self.assertIn("missing_month_value:2025-12", annual["missing"])

    def test_checked_in_health_report_has_complete_2025_contract(self):
        report_path = Path(__file__).resolve().parents[1] / "data" / "health_report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        annual = report["annual_return"]["2025"]

        self.assertTrue(annual["complete"])
        self.assertEqual(annual["start"], "2025-01-01")
        self.assertEqual(annual["end"], "2025-12-31")
        self.assertEqual(len(annual["periods"]), 12)
        self.assertEqual(
            annual["end_value_twd"],
            report["concentration"]["monthly_top_holding"]["2025-12"]["portfolio_twd"],
        )
        flows = [flow for period in annual["periods"] for flow in period["flows"]]
        self.assertEqual(len(flows), 12)
        self.assertEqual(sum(flow["amount_twd"] for flow in flows), 24274547)
        self.assertTrue(all(flow["amount_twd"] != 0 for flow in flows))
        for period in annual["periods"]:
            self.assertTrue(all(
                period["start"] <= flow["date"] < period["end"]
                for flow in period["flows"]
            ))

    def test_health_section_exposes_annual_return_contract(self):
        response = health_handler.handler({
            "queryStringParameters": {"section": "annual_return"}
        }, None)
        payload = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["annual_return"]["2025"]["source"], "demo")


class LiveAnnualReturnTests(unittest.TestCase):
    def setUp(self):
        self.current = [
            {"currency": "btc", "balance": "1", "locked": "0"},
            {"currency": "twd", "balance": "1000", "locked": "0"},
        ]
        self.trades = [{
            "id": 1, "created_at": ts("2026-03-01"), "market": "btctwd",
            "side": "bid", "volume": "0.1", "funds": "200",
            "fee": None, "fee_currency": None,
        }]
        self.deposits = [{
            "uuid": "d", "created_at": ts("2026-02-01"), "currency": "twd",
            "amount": "500", "state": "done",
        }]
        self.withdrawals = [{
            "uuid": "w", "created_at": ts("2026-04-01"), "currency": "twd",
            "amount": "100", "state": "done", "fee": "0", "fee_currency": "twd",
        }]

    def test_reconstructs_year_start_without_treating_trade_as_cash_flow(self):
        opening = reconstruct_start_balances(
            self.current, self.trades, self.deposits, self.withdrawals)
        self.assertAlmostEqual(opening["btc"], 0.9)
        self.assertAlmostEqual(opening["twd"], 800.0)

    def test_live_contract_values_start_end_and_external_flows(self):
        result = build_live_annual_return(
            2026, datetime(2026, 8, 1, tzinfo=timezone.utc),
            self.current, self.trades, self.deposits, self.withdrawals,
            price_at=lambda currency, _timestamp: 100 if currency == "btc" else 1,
            current_prices={"btc": 120, "twd": 1},
        )
        self.assertEqual(result["start_value_twd"], 890.0)
        self.assertEqual(result["end_value_twd"], 1120.0)
        self.assertEqual(result["flows"], [
            {"date": "2026-02-28", "amount_twd": 500},
            {"date": "2026-04-30", "amount_twd": -100},
        ])
        self.assertFalse(result["complete"])
        self.assertEqual(result["event_counts"]["trades"], 1)

    def test_missing_historical_price_is_null_not_zero(self):
        current = [{"currency": "eth", "balance": "1", "locked": "0"}]
        result = build_live_annual_return(
            2026, datetime(2026, 8, 1, tzinfo=timezone.utc),
            current, [], [], [], price_at=lambda *_args: None,
            current_prices={"eth": 50},
        )
        self.assertIsNone(result["start_value_twd"])
        self.assertEqual(result["end_value_twd"], 50.0)
        self.assertIn("missing_start_price:eth", result["missing"])


if __name__ == "__main__":
    unittest.main()
