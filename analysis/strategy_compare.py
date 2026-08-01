"""進場方式比較：離線預計算

回答的是一個具體問題：「我有 N 元想買某個幣，一次買完、分批買、還是開網格？」
用 MAX 公開日線（真實市價，非命題 CSV）把三種方式在上漲／下跌／橫盤三種情境下
各自的報酬與最大回撤跑出來，輸出 strategy_report.json。Demo 現場只讀 JSON。

為什麼不能用命題 CSV 跑：那份資料的價格路徑全年最大回撤只有 0.6%~3.6%（BTC 0.6%），
平滑到三種策略跑出來幾乎沒有差異——它是合成的報價序列，不帶真實市場的波動結構。
行為指標（health_report）用它沒問題，策略回測用它會得到假結論。

紅線對應（.kiro/steering/product.md）：
- 本模組**只輸出取捨**（報酬 vs 回撤），不輸出「建議用哪一種」。三種方式對等呈現。
- 風險等級（cautious/growth/pro，與 backend/agent/profile.py 同一套）只決定**先看哪個數字**，
  不決定推薦誰。cautious 先看回撤、pro 先看踏空成本。

用法：
    python3 analysis/strategy_compare.py              # 抓線上日線並重算
    python3 analysis/strategy_compare.py --offline    # 只用已存的 klines 快取（場地網路不穩時）
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
OUT = DATA_DIR / "strategy_report.json"
KLINE_CACHE = DATA_DIR / "klines_daily.json"

BASE = "https://max-api.maicoin.com"
MARKETS = ("btctwd", "ethtwd", "soltwd", "dogetwd")
DAYS = 800                 # MAX 單次上限內能拿到的最長日線，約兩年
WINDOW = 180               # 情境窗格長度（天）

FEE = 0.0008               # MAX 現貨基礎 maker 費率，雙邊各收一次（2026-07 查證，上線前再對官網）
CAPITAL = 100_000.0        # 回測基準本金；對外一律換算成百分比，呼叫端再按實際金額放大
DCA_TIMES = 10             # 分批買入次數
GRID_LEVELS = 10           # 網格格數（全部掛在進場價下方）
GRID_DEPTH = 0.20          # 網格深度：進場價往下 20%


# ── 取價 ──────────────────────────────────────────────────────────────────

def fetch_klines(offline=False):
    """回傳 {market: [(ts, close), ...]}。offline=True 時只讀快取。

    場地網路每 5 次連線掉 1 次（TLS reset），所以線上抓完一定寫快取，
    抓失敗就退回快取而不是讓整支腳本掛掉。
    """
    if offline:
        return _load_cache()
    out = {}
    for market in MARKETS:
        url = f"{BASE}/api/v3/k?market={market}&period=1440&limit={DAYS}"
        rows = _get_with_retry(url)
        if rows is None:
            # 場地網路每 5 次連線掉 1 次，重試完還是拿不到才退快取
            print(f"[warn] {market} 取線上日線失敗，改用快取", file=sys.stderr)
            cached = _load_cache().get(market)
            if not cached:
                raise SystemExit(f"{market} 既拿不到線上資料也沒有快取")
            out[market] = cached
        else:
            out[market] = [(int(r[0]), float(r[4])) for r in rows]
    KLINE_CACHE.write_text(json.dumps(out, ensure_ascii=False))
    return out


def _get_with_retry(url, retries=4):
    """指數退避重試；四次都失敗才回 None（與 max_public._get 同一套處理）。"""
    delay = 1.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                return json.loads(resp.read())
        except Exception as exc:  # noqa: BLE001 — 含 TLS reset，型別不固定
            if attempt == retries - 1:
                print(f"[warn] {url} 最後一次仍失敗：{exc}", file=sys.stderr)
                return None
            time.sleep(delay)
            delay *= 2


def _load_cache():
    if not KLINE_CACHE.exists():
        raise SystemExit(f"找不到日線快取 {KLINE_CACHE}，請先連線跑一次（不加 --offline）")
    return {m: [(int(t), float(p)) for t, p in rows]
            for m, rows in json.loads(KLINE_CACHE.read_text()).items()}


# ── 三種進場方式 ──────────────────────────────────────────────────────────

def lump_sum(path):
    """一次全買：t0 全額進場。"""
    qty = CAPITAL * (1 - FEE) / path[0][1]
    return {"curve": [qty * p for _, p in path], "cash": 0.0, "trades": 1,
            "fees": CAPITAL * FEE, "realized": 0.0}


def dca(path, times=DCA_TIMES):
    """分批買入：等時間切 N 次，只買不賣。"""
    marks = {round(i * (len(path) - 1) / (times - 1)) for i in range(times)}
    each = CAPITAL / times
    cash, qty, fees, curve = CAPITAL, 0.0, 0.0, []
    for i, (_, p) in enumerate(path):
        if i in marks and cash >= each - 1e-9:
            qty += each * (1 - FEE) / p
            cash -= each
            fees += each * FEE
        curve.append(qty * p + cash)
    return {"curve": curve, "cash": cash, "trades": times, "fees": fees, "realized": 0.0}


def grid(path, levels=GRID_LEVELS, depth=GRID_DEPTH, sell=True):
    """現貨網格（無底倉）：進場價下方等距掛 N 格買單，每格 CAPITAL/N。

    買到的那一格漲回上一格就賣掉、該格重新掛買（sell=False 則退化成「按價格分批買、買了不賣」）。
    這是網格與分批買入的**唯一結構差異**：多了一條「漲一格就賣」的腿——
    它同時是橫盤時的獲利來源，也是多頭時踏空的原因。
    """
    entry = path[0][1]
    step = entry * depth / levels
    buy_at = [entry - step * (i + 1) for i in range(levels)]
    per = CAPITAL / levels
    armed, held = set(range(levels)), {}
    cash, qty, fees, trades, realized, curve = CAPITAL, 0.0, 0.0, 0, 0.0, []
    for _, p in path:
        for i in sorted(armed):
            if p <= buy_at[i] and cash >= per - 1e-9:
                q = per * (1 - FEE) / p
                held[i] = q
                armed.discard(i)
                qty += q
                cash -= per
                fees += per * FEE
                trades += 1
        if sell:
            for i in sorted(held):
                if p >= buy_at[i] + step:
                    q = held.pop(i)
                    proceeds = q * p * (1 - FEE)
                    cash += proceeds
                    qty -= q
                    fees += q * p * FEE
                    trades += 1
                    realized += proceeds - per
                    armed.add(i)
        curve.append(qty * p + cash)
    return {"curve": curve, "cash": cash, "trades": trades, "fees": fees, "realized": realized}


STRATEGIES = {
    "lump_sum": ("一次全買", lump_sum),
    "dca": (f"分批買入 x{DCA_TIMES}", dca),
    "grid": (f"網格 {GRID_LEVELS} 格（深度 -{int(GRID_DEPTH * 100)}%）", grid),
}


# ── 指標與情境 ────────────────────────────────────────────────────────────

def max_drawdown(curve):
    peak, worst = -1e18, 0.0
    for v in curve:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1)
    return round(worst * 100, 1)


def pick_window(path, mode, days=WINDOW):
    """挑出報酬最高（up）／最低（down）／最接近零（flat）的窗格。

    這是**事後挑選**，用途是呈現「同一種方式在不同市況下的樣子」，
    不是宣稱能事前判斷市況——事前判斷的規則測過，不成立（見 report 的 data_notes）。
    """
    best = None
    for i in range(0, len(path) - days):
        seg = path[i:i + days]
        ret = seg[-1][1] / seg[0][1] - 1
        key = {"up": -ret, "down": ret, "flat": abs(ret)}[mode]
        if best is None or key < best[0]:
            best = (key, seg)
    return best[1]


def evaluate(path):
    """一段價格路徑上跑完三種方式，回傳可直接對外的百分比結果。"""
    out = {}
    for key, (label, fn) in STRATEGIES.items():
        r = fn(path)
        end = r["curve"][-1]
        out[key] = {
            "label": label,
            "return_pct": round((end / CAPITAL - 1) * 100, 1),
            "max_drawdown_pct": max_drawdown(r["curve"]),
            "end_cash_pct": round(r["cash"] / CAPITAL * 100, 1),  # 期末仍為現金（相對初始本金）；多頭時接近 100 = 整段沒買到
            "trades": r["trades"],
            "fee_pct": round(r["fees"] / CAPITAL * 100, 2),
        }
    return out


def scenario(path, mode):
    seg = pick_window(path, mode)
    lo = min(p for _, p in seg)
    return {
        "period": {
            "start": datetime.fromtimestamp(seg[0][0], tz=timezone.utc).strftime("%Y-%m-%d"),
            "end": datetime.fromtimestamp(seg[-1][0], tz=timezone.utc).strftime("%Y-%m-%d"),
            "days": len(seg),
        },
        "price_move_pct": round((seg[-1][1] / seg[0][1] - 1) * 100, 1),
        "deepest_dip_pct": round((lo / seg[0][1] - 1) * 100, 1),
        "strategies": evaluate(seg),
    }


def rolling_grid_vs_hold(path, recenter_days=30):
    """全期：每 30 天重新置中的網格 vs 單純買入持有。

    「四個幣的回撤都被砍掉一半」這條結論就是這裡來的。
    買入持有必須是**一次買進放到底**——若寫成每 30 天平掉再買回，等於白付 26 次手續費，
    比出來的差距有一大半是費用而不是策略差異。
    """
    hold_curve = lump_sum(path)["curve"]

    grid_curve, equity = [], CAPITAL
    for i in range(0, len(path), recenter_days):
        seg = path[i:i + recenter_days]
        if not seg:
            break
        scale = equity / CAPITAL                      # 用當下淨值重跑一段，段末結轉
        r = grid(seg)
        grid_curve += [v * scale for v in r["curve"]]
        equity = r["curve"][-1] * scale               # 段末一律換算成總值（含未平倉市值）

    return {
        "grid": {"return_pct": round((grid_curve[-1] / CAPITAL - 1) * 100, 1),
                 "max_drawdown_pct": max_drawdown(grid_curve),
                 "note": f"每 {recenter_days} 天以當時價格重新置中"},
        "buy_and_hold": {"return_pct": round((hold_curve[-1] / CAPITAL - 1) * 100, 1),
                         "max_drawdown_pct": max_drawdown(hold_curve),
                         "note": "t0 一次買進，全期持有"},
    }


# ── 風險等級對應（與 backend/agent/profile.py 同一套 mode）────────────────

RISK_TIERS = {
    "cautious": {
        "label": "安心型",
        "primary_metric": "max_drawdown_pct",
        "why": "最在意「會不會嚇到睡不著」，先看最大回撤（帳面最深跌幅），報酬其次。",
        "tradeoff_line": "回撤是這一級的主要決策依據；願意用多頭報酬換帳面平穩，就會偏向分批或網格。",
    },
    "growth": {
        "label": "成長型",
        "primary_metric": "return_pct",
        "why": "同時看報酬與回撤，重點是理解「這筆代價換到了什麼」。",
        "tradeoff_line": "三種方式的差異就是一句話：多頭賺多少 vs 空頭痛多少，兩者不可能同時最佳。",
    },
    "pro": {
        "label": "效率型",
        "primary_metric": "return_pct",
        "why": "在意踏空成本與資金效率，先看多頭情境下的報酬差與未投入現金比例。",
        "tradeoff_line": "網格在多頭的未投入現金比例就是踏空成本，直接看那個數字。",
    },
}


def main():
    offline = "--offline" in sys.argv
    klines = fetch_klines(offline=offline)
    markets = {}
    for market, path in klines.items():
        markets[market] = {
            "data_period": {
                "start": datetime.fromtimestamp(path[0][0], tz=timezone.utc).strftime("%Y-%m-%d"),
                "end": datetime.fromtimestamp(path[-1][0], tz=timezone.utc).strftime("%Y-%m-%d"),
                "days": len(path),
            },
            "scenarios": {
                "uptrend": scenario(path, "up"),
                "downtrend": scenario(path, "down"),
                "sideways": scenario(path, "flat"),
            },
            "full_period_grid_vs_hold": rolling_grid_vs_hold(path),
        }

    report = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "source": "MAX 公開日線 /api/v3/k（period=1440），非命題 CSV",
        "assumptions": {
            "fee_rate_each_side": FEE,
            "fee_note": "MAX 現貨基礎 maker 0.08%／taker 0.16%（2026-07 查證，上線前再對官網）",
            "capital_basis_twd": CAPITAL,
            "dca_times": DCA_TIMES,
            "grid_levels": GRID_LEVELS,
            "grid_depth_pct": GRID_DEPTH * 100,
            "fills_at": "日收盤價，不計滑價與掛單未成交",
        },
        "markets": markets,
        "risk_tiers": RISK_TIERS,
        "data_notes": [
            "三種方式對等呈現，本報告不含「建議用哪一種」——決策留給使用者（紅線 1）。",
            "情境窗格是事後挑出來的，用途是呈現同一種方式在不同市況的樣子。",
            "『事前判斷該不該開網格』的規則測過並且失敗：Kaufman 效率比門檻 0.15 時 "
            "BTC +18.9%，門檻挪到 0.20 就變 -3.0%，參數一動結論翻盤＝過度擬合。"
            "任何情況下都不得對外宣稱能事前判斷市況。",
            "回測期間（約 2024-08~2026-08）這幾個幣多為下跌，對網格有利；"
            "引用時必須連同期間一起講，不能單獨拿數字當通則。",
        ],
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"已寫入 {OUT}")
    for market, m in markets.items():
        s = m["scenarios"]
        print(f"\n{market}  {m['data_period']['start']}~{m['data_period']['end']}")
        for name, sc in (("上漲", s["uptrend"]), ("下跌", s["downtrend"]), ("橫盤", s["sideways"])):
            st = sc["strategies"]
            print(f"  {name}({sc['price_move_pct']:+.1f}%)  " + "　".join(
                f"{k}: {v['return_pct']:+.1f}%/回撤{v['max_drawdown_pct']:.1f}%" for k, v in st.items()))
        gh = m["full_period_grid_vs_hold"]
        print(f"  全期  網格 {gh['grid']['return_pct']:+.1f}%/回撤{gh['grid']['max_drawdown_pct']:.1f}%"
              f"　買入持有 {gh['buy_and_hold']['return_pct']:+.1f}%/回撤{gh['buy_and_hold']['max_drawdown_pct']:.1f}%")


if __name__ == "__main__":
    main()
