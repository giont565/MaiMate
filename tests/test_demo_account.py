"""沒有 MAX 金鑰時改用「示範帳戶」（命題方提供的一年份帳戶資料）。

比賽環境的兩支 Lambda 沒有 MAX_API_KEY／MAX_API_SECRET，max_private.balances() 一定拋錯，
於是 calculate_trade_scenarios 回 error、三方案卡與確認卡整條發不出來。此時改用
data/health_report.json 的 holdings_snapshot 當示範帳戶，卡片照常發，但每一層都標示清楚。

這一份測試守的是三條紅線：
1. **有金鑰的環境行為一字不變**（錄影用 us-east-1 正在用那條路）。
2. **「呼叫失敗」不得被當成「沒金鑰」**——場地網路每 5 次掉 1 次 TLS，
   若把失敗也當降級，有金鑰的環境會有兩成機率靜默換成示範資料而畫面完全正常，
   那正是本專案最忌諱的「看不出來的失效」。
3. **示範資料看得出來是示範資料**，而且**永遠不吐幣的數量**——快照只有台幣市值，
   數量是用今天的價格回推的，量級不可信（DOGE 差到 28 倍）。
"""
import contextlib
import json
import os
import unittest
from unittest.mock import patch

from backend.agent import demo_account, loop, scenarios, tools
from backend.handlers import chat as chat_handler
from backend.handlers import order as order_handler
from backend.integrations import max_private

# 2026-08-02 的實際 MAX 報價量級（測試不連網，這裡只是「今天的價格」的代表值）
TODAY_PRICES = {"btc": 2_023_928.1, "eth": 59_559.3, "doge": 2.2395,
                "sol": 2_307.3, "usdt": 32.425, "usdc": 32.443}
# ticker 與全市場報價表是兩支端點、相差數秒，**故意給不同的值**：
# 換算與回乘必須用同一個價格才會完全抵銷，兩者相同的話這個 bug 測不出來。
TICKER_PRICE = 59_600.0
ETH_RULES = {"market": "ethtwd", "base_unit": "eth", "base_precision": 6,
             "min_base_amount": 0.005, "min_quote_amount": 250.0, "status": "active"}

# holdings_snapshot 七筆 value_twd 的合計（快照自身的 pct 也對得上：116,530,466/118,168,978＝98.61%）
SNAPSHOT_TOTAL = 118_168_978
LIVE_BALANCES = [{"currency": "twd", "balance": "1000"}, {"currency": "eth", "balance": "0.5"}]


@contextlib.contextmanager
def no_keys():
    """比賽環境：兩個環境變數都不存在。只操作變數名稱，不碰任何金鑰的值。"""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("MAX_API_KEY", None)
        os.environ.pop("MAX_API_SECRET", None)
        yield


@contextlib.contextmanager
def with_keys():
    """錄影環境：金鑰在。值是測試用的假字串，不是任何真實金鑰。"""
    with patch.dict(os.environ, {"MAX_API_KEY": "test-key", "MAX_API_SECRET": "test-secret"}):
        yield


@contextlib.contextmanager
def market(price=TICKER_PRICE, prices=None, rules=ETH_RULES):
    """把行情端點換成固定值。示範帳戶不需要金鑰，但仍然要用即時行情。"""
    from backend.integrations import max_public
    with patch.object(max_public, "fetch", return_value={"data": {"last": str(price)}}) as fetch, \
         patch.object(max_public, "twd_prices", return_value=dict(TODAY_PRICES if prices is None else prices)), \
         patch.object(max_public, "market_rules", return_value=rules):
        yield fetch


class KeyGateTests(unittest.TestCase):
    """降級的唯一觸發條件是『環境變數不存在』。"""

    def test_has_keys_reads_only_presence(self):
        with with_keys():
            self.assertTrue(max_private.has_keys())
        with no_keys():
            self.assertFalse(max_private.has_keys())

    def test_empty_string_counts_as_missing(self):
        """SAM 模板 Environment 區塊變動時金鑰會被清成空字串，那也算沒有——
        與 _keys() 的 `if not key or not secret` 同一套判斷。"""
        with patch.dict(os.environ, {"MAX_API_KEY": "", "MAX_API_SECRET": ""}):
            self.assertFalse(max_private.has_keys())

    def test_demo_mode_is_off_when_keys_exist(self):
        with with_keys():
            self.assertFalse(demo_account.active())
        with no_keys():
            self.assertTrue(demo_account.active())

    def test_network_failure_with_keys_never_becomes_demo(self):
        """有金鑰但 balances() 拋錯（TLS reset／MAX 5xx／簽章錯）＝維持現狀往上拋。
        這一條若壞掉，錄影環境會在場地爛網路下靜默換成示範帳戶。"""
        boom = RuntimeError("MAX API 500 /api/v3/wallet/spot/accounts：(無回應內容)")
        with with_keys(), market(), patch.object(max_private, "balances", side_effect=boom) as bal:
            with self.assertRaises(RuntimeError) as caught:
                tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=5000)
            self.assertIn("MAX API 500", str(caught.exception))
            bal.assert_called_once()

    def test_auth_failure_with_keys_never_becomes_demo(self):
        """401／簽章 2014／權限不足同理：金鑰壞了要修金鑰，不是拿示範資料蓋掉。"""
        with with_keys(), patch.object(max_private, "balances",
                                       side_effect=RuntimeError("MAX API 401")):
            with self.assertRaises(RuntimeError):
                tools.get_account_balance()


class LiveAccountUntouchedTests(unittest.TestCase):
    """有金鑰時，這兩支工具必須跟修改前逐字相同。"""

    def test_scenarios_still_gets_balances_none(self):
        """有金鑰＝一律 balances=None，讓 scenarios.py 自己去抓真帳戶。
        注入任何東西都代表示範資料漏進了真環境。"""
        with with_keys(), market(), patch.object(scenarios, "calculate_trade_scenarios",
                                                 return_value={"scenarios": []}) as calc:
            tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=5000)
        calc.assert_called_once_with("ethtwd", "buy", fraction=1.0, amount_twd=5000)
        self.assertIsNone(calc.call_args.kwargs.get("balances"))
        self.assertIsNone(calc.call_args.kwargs.get("ticker"))

    def test_live_result_carries_no_demo_marking(self):
        with with_keys(), market(), patch.object(max_private, "balances",
                                                 return_value=LIVE_BALANCES):
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500)
        self.assertNotIn("account_source", result)
        for scenario in result["scenarios"]:
            self.assertNotIn("account_source", scenario)

    def test_live_balance_tool_is_valued_and_carries_no_demo_marking(self):
        """2026-08-02 起這支回的是估值後的持倉（市值＋佔比），不再是 MAX 的原始回應。

        原因：只回數量的話模型只能比數量，實測答出「GRT 53,192 顆是你最大的單一部位」
        （市值其實不到 BTC 的五分之一）。本項要守的仍是同一件事——**有金鑰時示範資料
        不得漏進來**——所以改成驗「沒有任何示範標記，且數量原封不動來自 MAX」。
        """
        with with_keys(), market(), patch.object(max_private, "balances",
                                                 return_value=LIVE_BALANCES):
            out = tools.get_account_balance()
        self.assertEqual(out["account_source"], "max_private")
        self.assertNotIn("account_notice", out)
        amounts = {h["currency"].lower(): h["amount"] for h in out["holdings"]}
        for row in LIVE_BALANCES:
            self.assertEqual(amounts[row["currency"]], float(row["balance"]))


class DemoConversionTests(unittest.TestCase):
    """換算誤差＝0：快照給的是台幣市值，scenarios.py 要的是幣的數量，
    但它馬上會用同一張價表乘回去（cur_value = qty × price），所以價格會被消掉。"""

    def test_every_holding_multiplies_back_to_its_snapshot_value(self):
        """核心不變式：注入的數量 × scenarios.py 會用的那個價格 ≡ 快照的 value_twd。
        這一條成立，卡片上的 total_value 與 cur_value 就是精確的，換算誤差為 0。"""
        with no_keys(), market():
            demo = demo_account.resolve("ethtwd")
            prices = scenarios._price_table("eth", TICKER_PRICE)
        expected = {str(h["currency"]).lower(): float(h["value_twd"])
                    for h in demo_account.snapshot()["holdings"]}
        self.assertEqual(demo["balances"]["twd"], expected["twd"])   # 台幣不換算
        for code, qty in demo["balances"].items():
            if code == "twd":
                continue
            self.assertAlmostEqual(qty * prices[code], expected[code], places=6,
                                   msg=f"{code} 乘回去對不上快照市值")
        self.assertEqual(round(sum(expected.values())), SNAPSHOT_TOTAL)

    def test_total_value_equals_the_snapshot_sum(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500_000)
        self.assertEqual(result["account_total_value_twd"], SNAPSHOT_TOTAL)

    def test_card_numbers_are_price_independent(self):
        """幣價整體翻倍，三張卡的金額／手續費／執行後佔比必須一模一樣。
        會變的只有 pause 的提醒價（那本來就該跟著現價走）。"""
        doubled = {c: p * 2 for c, p in TODAY_PRICES.items()}
        with no_keys(), market():
            base = tools.calculate_trade_scenarios("ethtwd", "sell", fraction=1.0)
        with no_keys(), market(price=TICKER_PRICE * 2, prices=doubled):
            risen = tools.calculate_trade_scenarios("ethtwd", "sell", fraction=1.0)
        for a, b in zip(base["scenarios"], risen["scenarios"]):
            self.assertEqual(a["amount_twd"], b["amount_twd"])
            self.assertEqual(a["fee_twd"], b["fee_twd"])
            self.assertEqual(a["post_concentration_pct"], b["post_concentration_pct"])

    def test_buy_scenarios_match_hand_calculated_snapshot_numbers(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500_000)
        cards = {s["key"]: s for s in result["scenarios"]}
        self.assertEqual(cards["partial"]["amount_twd"], 125_000)
        self.assertEqual(cards["full"]["amount_twd"], 500_000)
        self.assertEqual(cards["partial"]["post_concentration_pct"], 0.4)   # 530,305/118,168,978
        self.assertEqual(cards["full"]["post_concentration_pct"], 0.8)      # 905,305/118,168,978
        self.assertEqual(cards["pause"]["post_concentration_pct"], 0.3)     # 405,305/118,168,978

    def test_sell_scenarios_match_hand_calculated_snapshot_numbers(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "sell", fraction=1.0)
        cards = {s["key"]: s for s in result["scenarios"]}
        self.assertEqual(cards["full"]["amount_twd"], 405_305)              # 快照的 ETH 市值
        self.assertEqual(cards["partial"]["amount_twd"], 101_326)           # 25%
        self.assertEqual(cards["full"]["post_concentration_pct"], 0.0)
        self.assertEqual(cards["partial"]["post_concentration_pct"], 0.3)

    def test_twd_balance_gates_oversized_buys(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=200_000_000)
        self.assertEqual(result["error"], "insufficient_twd")
        self.assertIn("示範帳戶", result["message"],
                      "『TWD 餘額 NT$116,530,466 不足』講成使用者的帳戶就是不誠實")

    def test_selling_something_the_demo_account_lacks_says_demo_account(self):
        """原句是「**你的帳戶**目前沒有 XRP 持倉」——示範模式下必須換掉主詞。"""
        xrp_rules = {"market": "xrptwd", "base_unit": "xrp", "base_precision": 6,
                     "min_base_amount": 1, "min_quote_amount": 250.0, "status": "active"}
        with no_keys(), market(price=20.5, rules=xrp_rules):
            result = tools.calculate_trade_scenarios("xrptwd", "sell", fraction=1.0)
        self.assertEqual(result["error"], "not_in_portfolio")
        self.assertNotIn("你的帳戶", result["message"])
        self.assertIn("示範帳戶目前沒有 XRP 持倉", result["message"])

    def test_market_data_failures_are_not_blamed_on_the_demo_account(self):
        """行情取不到跟帳戶無關。冠上「示範帳戶」會把行情故障誤導成示範資料造成的。"""
        with no_keys(), market(price=0):
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=5000)
        self.assertEqual(result["error"], "no_price")
        self.assertNotIn("示範帳戶", result["message"])

    def test_currency_without_a_twd_quote_is_skipped_not_guessed(self):
        """查不到報價的幣寧可不算（分母略小、佔比略高），也不要用猜的價格。"""
        partial_prices = {k: v for k, v in TODAY_PRICES.items() if k not in ("sol", "usdc")}
        with no_keys(), market(prices=partial_prices):
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500_000)
        self.assertEqual(sorted(result["account_skipped"]), ["sol", "usdc"])
        self.assertLess(result["account_total_value_twd"], SNAPSHOT_TOTAL)


class DemoMarkingTests(unittest.TestCase):
    """三道標示的第一道：工具輸出本身。loop.py 只把 result['scenarios'] 這個 list
    帶出去，所以標示**必須蓋在每一張卡上**，掛在外層的旗標到不了前端。"""

    def test_every_scenario_card_carries_the_marking(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500_000)
        self.assertEqual(len(result["scenarios"]), 3)
        for scenario in result["scenarios"]:
            self.assertEqual(scenario["account_source"], "demo_dataset")
            self.assertIn("示範帳戶", scenario["account_notice"])
            self.assertIn("2025-12-31", scenario["account_notice"])

    def test_wrapper_tells_the_model_to_say_it_first(self):
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=500_000)
        notes = " ".join(result["data_notes"])
        self.assertIn("示範帳戶", notes)
        self.assertIn("第一句", notes)
        self.assertIn("數量", notes)          # 明令不得講顆數
        self.assertEqual(result["account_as_of"], "2025-12-31")

    def test_no_quantity_reaches_the_cards_or_the_model(self):
        """回推的數量量級不可信（DOGE 差 28 倍），任何路徑都不得外顯。
        卡片（會進畫面）與 wrapper（會進模型的 context）都掃一遍；
        data_notes 例外——那一條正是在**禁止**模型講數量。"""
        with no_keys(), market():
            result = tools.calculate_trade_scenarios("ethtwd", "sell", fraction=1.0)
        visible = {k: v for k, v in result.items() if k != "data_notes"}
        blob = json.dumps(visible, ensure_ascii=False)
        for banned in ("volume", "qty", "顆", "balance"):
            self.assertNotIn(banned, blob)
        for scenario in result["scenarios"]:
            self.assertNotIn("qty", scenario)
            self.assertNotIn("volume", scenario)

    def test_falls_back_to_the_real_error_when_the_snapshot_is_unusable(self):
        """示範資料本身取不到時一律回退原本的錯誤路徑，絕不臨時編數字。"""
        with no_keys(), market(), patch.object(demo_account, "snapshot", return_value=None):
            with self.assertRaises(RuntimeError):
                tools.calculate_trade_scenarios("ethtwd", "buy", amount_twd=5000)


class DemoBalanceToolTests(unittest.TestCase):
    """模型常先呼叫 get_account_balance；那支不一起降級，模型看到 tool error
    就會直接吐「無法連線」而根本走不到三方案——漏了這一刀等於沒修。"""

    def test_demo_balance_is_market_value_not_quantity(self):
        with no_keys():
            result = tools.get_account_balance()
        self.assertEqual(result["account_source"], "demo_dataset")
        self.assertEqual(result["as_of"], "2025-12-31")
        self.assertEqual(result["total_value_twd"], SNAPSHOT_TOTAL)
        for row in result["holdings"]:
            self.assertIn("value_twd", row)
            self.assertNotIn("balance", row)
            self.assertNotIn("qty", row)
        self.assertIn("示範帳戶", " ".join(result["data_notes"]))

    def test_demo_balance_needs_no_network(self):
        """快照是本機檔案。行情掛掉時餘額仍答得出來（只是不換算成幣的數量）。"""
        from backend.integrations import max_public
        with no_keys(), patch.object(max_public, "twd_prices", side_effect=RuntimeError("boom")):
            self.assertEqual(tools.get_account_balance()["total_value_twd"], SNAPSHOT_TOTAL)


class ChatHandlerTests(unittest.TestCase):
    """第二道標示：回覆首句由程式強制，不靠模型自律。"""

    @staticmethod
    def _run(reply, trail, history=()):
        """history＝這一輪之前就存在於 Converse 歷史裡的訊息（前幾輪的 toolUse 留在裡面）。"""
        out = {"role": "assistant", "content": [{"text": reply}]}
        messages = list(history) + [{"role": "user", "content": [{"text": "幫我全部賣掉 ETH"}]}]
        with patch.object(chat_handler.loop, "run_agent", return_value=(out, None, trail, None)):
            resp = chat_handler.handler({"body": json.dumps({"messages": messages})}, None)
        return json.loads(resp["body"])

    @staticmethod
    def _tool_use_history(name):
        """模擬 loop.py 留在歷史裡的上一輪工具呼叫（Converse 的 toolUse 區塊）。"""
        return [
            {"role": "user", "content": [{"text": "我帳戶裡有哪些幣？"}]},
            {"role": "assistant", "content": [
                {"toolUse": {"toolUseId": "t1", "name": name, "input": {}}}]},
            {"role": "user", "content": [
                {"toolResult": {"toolUseId": "t1", "content": [{"json": {"result": {}}}],
                                "status": "success"}}]},
            {"role": "assistant", "content": [{"text": "示範帳戶的 TWD 佔 98.6%。"}]},
        ]

    def test_prefix_is_forced_when_the_model_forgets(self):
        with no_keys():
            payload = self._run("你的帳戶目前有 NT$116,530,466 現金。",
                                [{"seq": 1, "tool": "calculate_trade_scenarios"}])
        self.assertTrue(payload["reply"].startswith("（示範帳戶模式）"))
        self.assertEqual(payload["account_source"], "demo_dataset")

    def test_prefix_is_not_doubled_when_the_model_said_it(self):
        with no_keys():
            payload = self._run("這是示範帳戶的試算：…", [{"seq": 1, "tool": "get_account_balance"}])
        self.assertFalse(payload["reply"].startswith("（示範帳戶模式）"))
        self.assertEqual(payload["account_source"], "demo_dataset")

    def test_unrelated_questions_are_not_labelled(self):
        """沒有查帳戶的問題（例如「什麼是手續費」）不該被貼上示範帳戶前綴。"""
        with no_keys():
            payload = self._run("手續費是交易所收的費用。", [{"seq": 1, "tool": "query_knowledge"}])
        self.assertNotIn("示範帳戶", payload["reply"])
        self.assertNotIn("account_source", payload)

    def test_live_environment_reply_is_untouched(self):
        with with_keys():
            payload = self._run("你的帳戶目前有 NT$1,000。",
                                [{"seq": 1, "tool": "calculate_trade_scenarios"}])
        self.assertEqual(payload["reply"], "你的帳戶目前有 NT$1,000。")
        self.assertNotIn("account_source", payload)

    def test_follow_up_turn_with_empty_trail_is_still_marked(self):
        """追問輪：模型直接引用歷史裡上一輪的工具結果，本輪 tool_trail 是空的。

        只看本輪 trail 的話這裡三道標示會同時歸零，只剩模型自律——實測那種輪次會回
        「TWD 佔**你帳戶**的 98.6%」，把示範資料講成使用者的真帳戶。
        """
        with no_keys():
            payload = self._run("TWD 佔你帳戶的 98.6%，金額 NT$116,530,466。", [],
                                history=self._tool_use_history("get_account_balance"))
        self.assertEqual(payload["account_source"], "demo_dataset")
        self.assertTrue(payload["reply"].startswith("（示範帳戶模式）"))

    def test_confirm_card_turn_is_marked(self):
        """確認卡那一輪只跑 prepare_order。漏了它，台上最關鍵那張卡是零程式標示的裸卡。

        歷史刻意放**不相關**的工具：這樣唯一能觸發標示的就是本輪的 prepare_order，
        才驗得到它真的在 _ACCOUNT_TOOLS 裡。放 calculate_trade_scenarios 的話，
        標示會由歷史那條路徑觸發，把 prepare_order 拿掉也照樣通過。
        """
        with no_keys():
            payload = self._run("確認卡片已產生，請按下確認按鈕。",
                                [{"seq": 1, "tool": "prepare_order"}],
                                history=self._tool_use_history("query_knowledge"))
        self.assertEqual(payload["account_source"], "demo_dataset")
        self.assertIn("account_notice", payload)

    def test_confirm_card_turn_is_marked_in_the_real_golden_path(self):
        """實際流程：第一輪三方案留在歷史，第二輪只跑 prepare_order。兩條路徑都要蓋得到。"""
        with no_keys():
            payload = self._run("確認卡片已產生，請按下確認按鈕。",
                                [{"seq": 1, "tool": "prepare_order"}],
                                history=self._tool_use_history("calculate_trade_scenarios"))
        self.assertEqual(payload["account_source"], "demo_dataset")

    def test_history_of_unrelated_tools_still_not_labelled(self):
        """歷史裡只有知識庫查詢 → 仍然不貼標。過度標示優於漏標示，但不是無差別貼。"""
        with no_keys():
            payload = self._run("手續費是交易所收的費用。",
                                [{"seq": 1, "tool": "query_knowledge"}],
                                history=self._tool_use_history("query_knowledge"))
        self.assertNotIn("account_source", payload)
        self.assertNotIn("示範帳戶", payload["reply"])

    def test_no_prefix_when_the_demo_snapshot_is_unusable(self):
        """示範資料壞掉時 tools.py 退回原本的錯誤路徑、不編數字；此時就不該宣稱
        「以下用命題方提供的一年份帳戶資料試算」——那是一句沒發生過的事。"""
        with no_keys(), patch.object(demo_account, "snapshot", return_value=None):
            payload = self._run("目前無法連線到帳戶。",
                                [{"seq": 1, "tool": "calculate_trade_scenarios"}])
        self.assertNotIn("account_source", payload)
        self.assertNotIn("示範帳戶", payload["reply"])

    def test_malformed_history_does_not_crash_the_handler(self):
        """歷史來自前端，形狀不保證。掃歷史的那段不得因為一個怪 block 就讓整支 500。"""
        broken = [{"role": "assistant", "content": [None, "text", {"toolUse": "not-a-dict"}]},
                  "not-a-message", {"role": "user"}]
        with no_keys():
            payload = self._run("示範帳戶的 TWD 佔 98.6%。",
                                [{"seq": 1, "tool": "get_account_balance"}], history=broken)
        self.assertEqual(payload["account_source"], "demo_dataset")


class SystemPromptTests(unittest.TestCase):
    """第四道標示：SYSTEM 規則。工具的 data_notes 只在那一輪的工具結果裡，追問輪早就被
    推到上下文深處；SYSTEM 每一輪都在，是唯一守得住追問輪措辭的位置。
    代價必須為零——有金鑰時 system 要**逐字**與改動前相同（prompt cache 的 cache key）。"""

    @staticmethod
    def _system(profile=None):
        """跑一次 run_agent，把實際送進 Bedrock 的 system 攔下來。"""
        captured = {}

        class _FakeClient:
            @staticmethod
            def converse(**kwargs):
                captured["system"] = kwargs["system"]
                return {"output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
                        "stopReason": "end_turn"}

        with patch.object(loop, "_client", return_value=_FakeClient()):
            loop.run_agent([{"role": "user", "content": [{"text": "幫我全部賣掉 ETH"}]}],
                           profile=profile)
        return captured["system"]

    def test_live_environment_system_is_byte_identical(self):
        with with_keys():
            self.assertEqual(self._system(), list(loop.SYSTEM))

    def test_demo_environment_appends_the_wording_rule(self):
        with no_keys():
            system = self._system()
        self.assertEqual(system[:-1], list(loop.SYSTEM))
        self.assertEqual(system[-1], loop.DEMO_SYSTEM_RULE)

    def test_the_rule_bans_second_person_possessive_and_quantities(self):
        text = loop.DEMO_SYSTEM_RULE["text"]
        for banned in ("你的帳戶", "你目前持有", "你的餘額"):
            self.assertIn(banned, text, f"規則必須明文點名要禁止的寫法：{banned}")
        self.assertIn("追問", text, "規則必須講明追問輪同樣適用——那正是實測破功的地方")
        self.assertIn("數量", text)

    def test_unusable_snapshot_adds_nothing(self):
        """沒有示範資料就不要叫模型講示範帳戶——那會變成憑空宣稱有一份試算。"""
        with no_keys(), patch.object(demo_account, "snapshot", return_value=None):
            self.assertEqual(self._system(), list(loop.SYSTEM))


class OrderHandlerTests(unittest.TestCase):
    """確認鈕按下去必須有人話。沒金鑰時 place_order 一定拋 RuntimeError，
    而 order.py 只 catch ValueError → Lambda 500 →「⚠️ Internal Server Error」上台當眾出現。"""

    def _confirm(self):
        token = "demo-token"
        tools._pending_orders[token] = {"market": "ethtwd", "side": "sell", "volume_twd": 101326,
                                        "ord_type": "market", "price": None,
                                        "expires_at": 9_999_999_999}
        try:
            resp = order_handler.handler({"body": json.dumps({"confirm_token": token})}, None)
        finally:
            tools._pending_orders.pop(token, None)
        return resp

    def test_demo_mode_returns_a_human_message_and_never_places_an_order(self):
        with no_keys(), patch.object(max_private, "place_order") as place:
            resp = self._confirm()
        place.assert_not_called()
        body = json.loads(resp["body"])
        self.assertEqual(resp["statusCode"], 200)
        self.assertFalse(body["ok"])
        self.assertTrue(body["demo_account"])
        self.assertIn("沒有送出", body["message"])
        self.assertNotIn("成交", body["message"])   # 絕不偽造成交

    def test_live_environment_still_places_the_order(self):
        with with_keys(), patch.object(max_private, "place_order",
                                       return_value={"id": 123}) as place:
            resp = self._confirm()
        place.assert_called_once()
        self.assertTrue(json.loads(resp["body"])["ok"])


if __name__ == "__main__":
    unittest.main()
