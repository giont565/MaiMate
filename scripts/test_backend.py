#!/usr/bin/env python3
"""後端單元測試（workflow.md 驗證紀律 #2）：python3 scripts/test_backend.py

覆蓋純邏輯層（不需 AWS/金鑰/CSV）：
  guardrails 明牌攔截與 PII 清洗｜scenarios 三方案數字驗算與錯誤路徑
  profile 三模式分類｜audit append-only 軌跡｜loop 模型路由
Bedrock 迴圈本體與 E2E 需部署環境，不在此測。
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
FAILED = []


def load(name, rel):
    # 獨立載入模組並串起 package 相對引用（backend.agent.*）
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def check(label, cond, detail=""):
    if cond:
        print(f"  ✔ {label}")
    else:
        print(f"  ✘ {label} {detail}")
        FAILED.append(label)


# 以 package 形式載入 backend（相對 import 需要）
sys.path.insert(0, str(ROOT))
import importlib
guardrails = importlib.import_module("backend.agent.guardrails")
scenarios = importlib.import_module("backend.agent.scenarios")
profile = importlib.import_module("backend.agent.profile")
audit = importlib.import_module("backend.agent.audit")

print("== guardrails（明牌攔截／PII 清洗）==")
ok, hits = guardrails.check_output("建議你現在買入 BTC，一定會漲")
check("明牌句被攔截", not ok and hits)
ok, _ = guardrails.check_output("BTC 現價 NT$2,091,464，你 65% 的買入在均價上方。")
check("數據陳述句放行", ok)
ok, _ = guardrails.check_output("保證獲利的方法")
check("「保證獲利」被攔截", not ok)
scrubbed = guardrails.scrub_input("我的身分證 A123456789 手機 0912-345-678 卡號 4000123412341234")
check("PII 全部清洗", all(t in scrubbed for t in ("[身分證字號]", "[手機號碼]", "[卡號/長數字]"))
      and "A123456789" not in scrubbed, scrubbed)

print("== scenarios（三方案數字驗算）==")
BAL = {"eth": 2.0, "twd": 100000.0}
TICKER = {"last": "60000"}
REPORT = json.loads((ROOT / "data/health_report.json").read_text())
r = scenarios.calculate_trade_scenarios("ethtwd", "sell", fraction=1.0,
                                        balances=BAL, ticker=TICKER, report=REPORT)
s = {x["key"]: x for x in r["scenarios"]}
check("三方案齊全", set(s) == {"partial", "full", "pause"})
check("保守版金額＝持倉 25%", s["partial"]["amount_twd"] == 30000, s["partial"])
check("保守版手續費 taker 0.16%", s["partial"]["fee_twd"] == round(30000 * 0.0016))
check("全賣金額＝全持倉市值", s["full"]["amount_twd"] == 120000)
check("全賣後集中度 0%", s["full"]["post_concentration_pct"] == 0.0)
check("保守版賣後集中度", s["partial"]["post_concentration_pct"] == round(100 * 90000 / 220000, 1))
check("暫停版不產生訂單", s["pause"]["amount_twd"] is None and s["pause"]["fee_twd"] is None)
check("暫停版 -10% 提醒價", s["pause"]["alert_price"] == 54000)
check("行為註記引用真實數據", "312,924" in s["full"]["behavior_note"])
check("滑價聲明存在", "滑價" in r["disclaimer"])
check("費率來源註記", "0.16%" in r["fee_source"])
e = scenarios.calculate_trade_scenarios("dogetwd", "sell", balances=BAL, ticker=TICKER, report=REPORT)
check("標的不在持倉 → 明確錯誤", e.get("error") == "not_in_portfolio", e)
e = scenarios.calculate_trade_scenarios("ethtwd", "buy", amount_twd=999999,
                                        balances=BAL, ticker=TICKER, report=REPORT)
check("TWD 不足 → 明確錯誤", e.get("error") == "insufficient_twd")
b = scenarios.calculate_trade_scenarios("ethtwd", "buy", amount_twd=40000,
                                        balances=BAL, ticker=TICKER, report=REPORT)
check("買入方案含追高提醒", "追高" in {x["key"]: x for x in b["scenarios"]}["full"]["behavior_note"])

print("== profile（三模式分類；design.md 驗證案例）==")
def fake_report(monthly_avg, chase):
    return {"activity_profile": {"trades_per_month": {"m": monthly_avg}},
            "chase_index": {"buy_above_ma_pct": chase}}
check("月均 389＋追高 65 → growth（真實帳戶案例）",
      profile.infer_profile(REPORT)["mode"] == "growth", profile.infer_profile(REPORT))
check("月均 10 → cautious", profile.infer_profile(fake_report(10, 30))["mode"] == "cautious")
check("月均 50＋追高 70 → cautious", profile.infer_profile(fake_report(50, 70))["mode"] == "cautious")
check("月均 389＋追高 30 → pro", profile.infer_profile(fake_report(389, 30))["mode"] == "pro")
check("Demo 覆寫 mode", profile.profile_for(mode="pro")["mode"] == "pro")
check("三模式 prompt 各異", len({profile.profile_for(mode=m)["prompt_addon"] for m in profile.MODES}) == 3)

print("== audit（append-only 軌跡）==")
audit.set_session("test-session")
audit.log("tool_call", tool="get_market_data", input_summary="查行情（ethtwd）", status="success")
audit.log("draft_created", market="ethtwd", side="sell", volume_twd=30000)
audit.log("user_confirmed", confirm_token="t1")
t = audit.trail("test-session")
check("三筆事件依序留痕", [e["type"] for e in t] == ["tool_call", "draft_created", "user_confirmed"])
check("seq 遞增", [e["seq"] for e in t] == [1, 2, 3])
check("append-only（模組無更新/刪除介面）",
      not any(hasattr(audit, f) for f in ("delete", "update", "remove", "clear")))
check("查無此 session 回空", audit.trail("nope") == [])

print("== 條件式接點（#9 KB／#6 Guardrails）==")
import os
tools_mod = importlib.import_module("backend.agent.tools")
tool_names = [t["toolSpec"]["name"] for t in tools_mod.TOOLS]
check("KB_ID 未設 → query_knowledge 不註冊",
      "query_knowledge" not in tool_names and "query_knowledge" not in tools_mod._DISPATCH)
os.environ["KB_ID"] = "kb-test"
importlib.reload(tools_mod)
check("KB_ID 設定後 → query_knowledge 自動註冊",
      "query_knowledge" in [t["toolSpec"]["name"] for t in tools_mod.TOOLS]
      and "query_knowledge" in tools_mod._DISPATCH)
del os.environ["KB_ID"]
importlib.reload(tools_mod)  # 還原，避免影響後續測試

print("== market data（Kline 時間與 OHLCV 正規化）==")
max_public = importlib.import_module("backend.integrations.max_public")
sample_rows = [
    [1784638800, "2153000.0", "2161809.8", "2147471.3", "2161809.8", "1.7552"],
    [1784642400, "2161809.8", "2167034.7", "2157718.1", "2157718.1", "0.9123"],
    [1784646000, "2157718.1", "2160000.0", "2155000.0", "2159000.0", "0.5000"],
]
candles = max_public._normalize_kline(sample_rows)
check("Kline 固定回傳三根具名資料", len(candles) == 3
      and set(candles[0]) == {"timestamp", "time_utc", "time_taipei", "open", "high", "low", "close", "volume"})
check("Unix 秒數轉 UTC 正確", candles[0]["time_utc"] == "2026-07-21T13:00:00Z", candles[0])
check("Unix 秒數轉台北時間正確",
      candles[0]["time_taipei"] == "2026-07-21T21:00:00+08:00", candles[0])
check("Kline 依時間由舊到新", [c["timestamp"] for c in candles] == sorted(c["timestamp"] for c in candles))
check("OHLCV 欄位不錯位", candles[0]["open"] == "2153000.0"
      and candles[0]["high"] == "2161809.8" and candles[0]["volume"] == "1.7552")

print("== loop（模型路由 #5）==")
import backend.agent.loop as loop
def msg(text):
    return [{"role": "user", "content": [{"text": text}]}]
check("日常問題 → Haiku", loop.pick_model(msg("BTC 現在多少錢")) == loop.MODEL_HAIKU)
check("深度意圖 → Sonnet", loop.pick_model(msg("幫我分析為什麼去年一直虧")) == loop.MODEL_SONNET)
check("歸因意圖 → Sonnet", loop.pick_model(msg("做個年度檢討")) == loop.MODEL_SONNET)

print()
if FAILED:
    print(f"✘ {len(FAILED)} 項失敗：{FAILED}")
    sys.exit(1)
print("後端單元測試全部通過 ✅")
