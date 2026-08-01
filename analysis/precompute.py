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

try:
    # ``python -m analysis.precompute`` / unit-test imports.
    from analysis.annual_return import build_demo_annual_return
except ModuleNotFoundError:
    # The documented invocation is ``python analysis/precompute.py``; in that
    # mode Python places ``analysis/`` (not the repository root) on sys.path.
    from annual_return import build_demo_annual_return

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


def holdings_snapshot(rows):
    """持倉快照（#29 前端 Screen 5/6/8）：資料最後時點各幣持倉市值與佔比。

    估值採各幣最後一筆成交價（離線資料無外部即時報價，method 如實標注）。
    """
    last = {}
    for r in rows:
        last[r["currency"]] = (r["balance"], r["price"])
    values = {c: b * p for c, (b, p) in last.items() if b > 0}
    tot = sum(values.values())
    holdings = [
        {"currency": c, "pct": round(100 * v / tot, 1), "value_twd": round(v, 0)}
        for c, v in sorted(values.items(), key=lambda kv: -kv[1])
    ] if tot > 0 else []
    return {
        "asOf": datetime.fromtimestamp(rows[-1]["ts"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
        "method": "各幣最後成交價估值",
        "holdings": holdings,
    }


def change_attribution(rows):
    """帳戶變化歸因（#29 前端 Screen 6/8）：最後一個自然月的組合價值變化拆解。

    殘差法：Δ組合市值 = 出入金淨額 + 市價波動（殘差）。pct 以絕對值權重計，
    value_twd 帶正負。已實現損益是另一會計視角（見 realized_pnl），不與此相加，
    避免重複計算——type=estimated 如實標注。
    """
    last_month = month_of(rows[-1]["ts"])
    last = {}
    start_val = None
    net_flow = 0.0
    for r in rows:
        if month_of(r["ts"]) == last_month:
            if start_val is None:
                vals = {c: b * p for c, (b, p) in last.items() if b > 0}
                start_val = sum(vals.values())
            if r["action"] in ("deposit", "withdrawal"):
                net_flow += r["change"] * r["price"]
        last[r["currency"]] = (r["balance"], r["price"])
    if start_val is None:  # 最後一個月無任何交易列（理論上不會發生）
        start_val = 0.0
    end_vals = {c: b * p for c, (b, p) in last.items() if b > 0}
    delta = sum(end_vals.values()) - start_val
    market = delta - net_flow
    base = abs(net_flow) + abs(market)
    contributors = [
        {"category": "marketPrice", "pct": round(100 * abs(market) / base, 1) if base else 0.0,
         "value_twd": round(market, 0)},
        {"category": "netDeposit", "pct": round(100 * abs(net_flow) / base, 1) if base else 0.0,
         "value_twd": round(net_flow, 0)},
    ]
    return {
        "period": last_month,
        "type": "estimated",
        "delta_twd": round(delta, 0),
        "contributors": contributors,
        "note": "殘差法（Δ市值−出入金淨額→市價波動）；已實現損益為另一視角見 realized_pnl，不相加",
    }


def holding_period_distribution(rows):
    """持有期間分布（#29 前端 Screen 5/8）：FIFO 配對每筆賣出的買入來源，算持有天數。

    以配對市值（數量×賣價）加權分桶；期初無買入紀錄的賣出不計（note 標注）。
    """
    edges = [7, 30, 90, 180]  # (0,7], (7,30], (30,90], (90,180], (180,∞)
    labels = ["0-7", "8-30", "31-90", "91-180", "181+"]
    fifo = defaultdict(list)  # currency -> [[buy_ts, qty], ...]
    weights = [0.0] * len(labels)
    skipped = 0
    for r in rows:
        cur = r["currency"]
        if cur == "twd" or r["action"] not in ("buy", "sell"):
            continue
        if r["action"] == "buy":
            if r["change"] > 0:
                fifo[cur].append([r["ts"], r["change"]])
            continue
        sell_qty = -r["change"]
        q = fifo[cur]
        if not q:
            skipped += 1
            continue
        while sell_qty > 1e-12 and q:
            buy_ts, qty0 = q[0]
            m = min(sell_qty, qty0)
            days = (r["ts"] - buy_ts) / 86400_000
            idx = next((i for i, e in enumerate(edges) if days <= e), len(edges))
            weights[idx] += m * r["price"]
            sell_qty -= m
            if qty0 - m <= 1e-12:
                q.pop(0)
            else:
                q[0][1] = qty0 - m
    tot = sum(weights)
    return {
        "method": "FIFO 配對推估、賣出市值加權",
        "buckets": [{"range": lab, "pct": round(100 * w / tot, 1) if tot else 0.0}
                    for lab, w in zip(labels, weights)],
        "note": f"期初持倉無買入紀錄之賣出不計（{skipped} 筆）",
    }


def main():
    rows = load_rows()
    concentration_data = concentration(rows)
    annual_return = build_demo_annual_return(
        rows,
        monthly_values={
            month: value["portfolio_twd"]
            for month, value in concentration_data["monthly_top_holding"].items()
        },
    )
    # live 區塊由 refresh_annual_return.py 以 read-only MAX API 產生；重跑官方 CSV 時保留。
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8")).get("annual_return", {})
            annual_return.update({
                year: value for year, value in previous.items()
                if value.get("source") == "live"
            })
        except (OSError, ValueError, TypeError):
            pass
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
        "concentration": concentration_data,
        "cash_flow_behavior": cash_flow_behavior(rows),
        "activity_profile": activity_profile(rows),
        "holdings_snapshot": holdings_snapshot(rows),
        "change_attribution": change_attribution(rows),
        "holding_period_distribution": holding_period_distribution(rows),
        "annual_return": annual_return,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
