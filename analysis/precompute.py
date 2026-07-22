"""行為分析引擎：離線預計算

讀取官方提供的一年份出入金及交易紀錄 CSV，計算行為指標並輸出 health_report.json。
Demo 現場只讀 JSON，不做重運算。

欄位（官方定義）：
  timestamp  毫秒級 Unix 時戳（2025 年）
  currency   資產幣種（7 種，含 twd）
  price      該資產以台幣計價的單價
  action     buy / sell / deposit / withdrawal
  change     資產變動數量（正增負減）
  balance    該筆交易後的最新帳戶餘額
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).parent.parent / "data" / "MaiCoin_transactions.csv"
OUT = Path(__file__).parent.parent / "data" / "health_report.json"

MA_WINDOW = 7  # 追高殺低對照用的移動平均筆數（同幣別前 N 筆價格）


def load_rows():
    with open(DATA, newline="") as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [n.strip() for n in reader.fieldnames]
        rows = []
        for r in reader:
            rows.append({
                "ts": int(r["timestamp"].strip()),
                "currency": r["currency"].strip(),
                "price": float(r["price"].strip()),
                "action": r["action"].strip(),
                "change": float(r["change"].strip()),
                "balance": float(r["balance"].strip()),
            })
    rows.sort(key=lambda r: r["ts"])
    return rows


def month_of(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m")


def chase_index(rows):
    """追高殺低指數：買在同幣別近 N 筆均價之上 / 賣在均價之下的比例。"""
    hist = defaultdict(list)
    stats = {"buy_above_ma": 0, "buy_total": 0, "sell_below_ma": 0, "sell_total": 0}
    for r in rows:
        cur, act = r["currency"], r["action"]
        if cur == "twd":
            continue
        prices = hist[cur]
        if len(prices) >= MA_WINDOW and act in ("buy", "sell"):
            ma = sum(prices[-MA_WINDOW:]) / MA_WINDOW
            if act == "buy":
                stats["buy_total"] += 1
                if r["price"] > ma:
                    stats["buy_above_ma"] += 1
            else:
                stats["sell_total"] += 1
                if r["price"] < ma:
                    stats["sell_below_ma"] += 1
        prices.append(r["price"])
    return {
        "buy_above_ma_pct": round(100 * stats["buy_above_ma"] / stats["buy_total"], 1),
        "sell_below_ma_pct": round(100 * stats["sell_below_ma"] / stats["sell_total"], 1),
        "buy_total": stats["buy_total"],
        "sell_total": stats["sell_total"],
        "ma_window": MA_WINDOW,
    }


def opportunity_cost(rows):
    """機會成本：每筆賣出若持有至該幣年末最後價格，價值差額（TWD）。"""
    last_price = {}
    for r in rows:
        if r["currency"] != "twd":
            last_price[r["currency"]] = r["price"]
    total = 0.0
    worst = None
    for r in rows:
        if r["action"] == "sell" and r["currency"] != "twd":
            qty = -r["change"]
            diff = (last_price[r["currency"]] - r["price"]) * qty
            total += diff
            if worst is None or diff > worst["missed_twd"]:
                worst = {
                    "date": datetime.fromtimestamp(r["ts"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
                    "currency": r["currency"],
                    "qty": round(qty, 6),
                    "sell_price": r["price"],
                    "eoy_price": last_price[r["currency"]],
                    "missed_twd": round(diff, 0),
                }
    return {"total_missed_twd": round(total, 0), "worst_single_sell": worst}


def realized_pnl(rows):
    """已實現損益（移動平均成本法）：每筆賣出以「賣價 − 當時平均買入成本」計實際賺賠。

    與 opportunity_cost 的分工（回答用語要分清楚）：
      realized_pnl     = 真實虧損/獲利——錢包實際發生的賺賠
      opportunity_cost = 少賺（機會成本）——賣後價格續漲的假設差額，不是虧損
    期初已持有、無買入成本紀錄的部位，其賣出不計入（如實標注在 note）。
    """
    pos = {}  # currency -> [qty, avg_cost]
    total = 0.0
    worst_loss = None
    best_gain = None
    loss_trades = profit_trades = skipped_no_cost = 0
    for r in rows:
        cur = r["currency"]
        if cur == "twd" or r["action"] not in ("buy", "sell"):
            continue
        qty0, cost0 = pos.get(cur, (0.0, 0.0))
        if r["action"] == "buy":
            add = r["change"]  # buy 的 change 為正
            if add <= 0:
                continue
            qty1 = qty0 + add
            pos[cur] = (qty1, (qty0 * cost0 + add * r["price"]) / qty1)
            continue
        sell_qty = -r["change"]  # sell 的 change 為負
        if qty0 <= 0:
            skipped_no_cost += 1
            continue
        matched = min(sell_qty, qty0)
        pnl = (r["price"] - cost0) * matched
        total += pnl
        detail = {
            "date": datetime.fromtimestamp(r["ts"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
            "currency": cur,
            "qty": round(matched, 6),
            "sell_price": r["price"],
            "avg_cost": round(cost0, 6),
            "pnl_twd": round(pnl, 0),
        }
        if pnl < 0:
            loss_trades += 1
            if worst_loss is None or pnl < worst_loss["pnl_twd"]:
                worst_loss = detail
        elif pnl > 0:
            profit_trades += 1
            if best_gain is None or pnl > best_gain["pnl_twd"]:
                best_gain = detail
        pos[cur] = (qty0 - matched, cost0)
    return {
        "method": "moving_average_cost",
        "total_realized_twd": round(total, 0),
        "loss_trades": loss_trades,
        "profit_trades": profit_trades,
        "worst_single_loss": worst_loss,
        "best_single_gain": best_gain,
        "note": f"期初持倉無成本紀錄之賣出不計入（{skipped_no_cost} 筆）；成本採移動平均法",
    }


def concentration(rows):
    """持倉集中度：每月月底各幣市值佔比，找最高集中月份。"""
    balances = {}
    monthly = {}
    for r in rows:
        balances[r["currency"]] = (r["balance"], r["price"])
        values = {c: b * p for c, (b, p) in balances.items() if b > 0}
        tot = sum(values.values())
        if tot > 0:
            top_cur = max(values, key=values.get)
            monthly[month_of(r["ts"])] = {
                "top_currency": top_cur,
                "top_pct": round(100 * values[top_cur] / tot, 1),
                "portfolio_twd": round(tot, 0),
            }
    peak_month = max(monthly, key=lambda m: monthly[m]["top_pct"])
    return {"monthly_top_holding": monthly, "peak_concentration": {"month": peak_month, **monthly[peak_month]}}


def cash_flow_behavior(rows):
    """出入金行為：TWD 提領是否集中在市場下跌後（恐慌訊號）。以 BTC 價格作市場代理。"""
    btc_prices = [(r["ts"], r["price"]) for r in rows if r["currency"] == "btc"]
    def btc_before(ts):
        prior = [p for t, p in btc_prices if t <= ts]
        return prior[-1] if prior else None
    withdrawals = [r for r in rows if r["currency"] == "twd" and r["action"] == "withdrawal"]
    after_drop = 0
    counted = 0
    for w in withdrawals:
        recent = [p for t, p in btc_prices if w["ts"] - 7 * 86400_000 <= t <= w["ts"]]
        if len(recent) >= 2:
            counted += 1
            if recent[-1] < recent[0]:
                after_drop += 1
    return {
        "twd_withdrawal_count": len(withdrawals),
        "withdrawals_after_7d_btc_drop_pct": round(100 * after_drop / counted, 1) if counted else None,
    }


def activity_profile(rows):
    """交易畫像：月頻率、各幣交易量、動作分布。"""
    per_month = defaultdict(int)
    per_currency = defaultdict(int)
    actions = defaultdict(int)
    for r in rows:
        if r["action"] in ("buy", "sell"):
            per_month[month_of(r["ts"])] += 1
            per_currency[r["currency"]] += 1
        actions[r["action"]] += 1
    busiest = max(per_month, key=per_month.get)
    return {
        "trades_per_month": dict(sorted(per_month.items())),
        "busiest_month": {"month": busiest, "trades": per_month[busiest]},
        "trades_by_currency": dict(sorted(per_currency.items(), key=lambda kv: -kv[1])),
        "action_counts": dict(actions),
    }


def main():
    rows = load_rows()
    report = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "row_count": len(rows),
        "period": {
            "start": datetime.fromtimestamp(rows[0]["ts"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
            "end": datetime.fromtimestamp(rows[-1]["ts"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
        },
        "chase_index": chase_index(rows),
        "opportunity_cost": opportunity_cost(rows),
        "realized_pnl": realized_pnl(rows),
        "concentration": concentration(rows),
        "cash_flow_behavior": cash_flow_behavior(rows),
        "activity_profile": activity_profile(rows),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
