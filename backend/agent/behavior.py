"""從**真實 MAX 帳戶的成交紀錄**算行為健檢，取代命題方 CSV 那份。

為什麼要有這支：`data/health_report.json` 是命題方提供的一年份紀錄（追高 65%、機會成本
NT$2,660 萬）。使用者連上自己的帳戶後，那些數字講的仍是別人的帳戶——實測對話裡使用者
當場反問「你這是 2025 的資料，我現況帳號不是」。

能算什麼、不能算什麼（欄位決定的，不是偷懶）：
  · 只要成交紀錄 → 追高指數、機會成本、已實現損益、交易活躍度  ← 本支負責
  · 需要每列餘額 → 集中度、持倉快照                            ← 改用 GET /portfolio 的即時餘額
  · 需要出入金紀錄 → 出金習慣                                  ← 另一組端點，未接，如實標資料不足

`analysis/precompute.py` 的四支函式原樣重用（同一套算術，賽前驗過的那份），本支只負責
把 MAX 的成交列轉成它要的形狀：{ts, currency, price, action, change}。

⚠ 機會成本不重用 precompute 那支：它用「該幣最後一筆成交價」當年末價，那在一年份 CSV 上
成立，接到即時帳戶就變成「拿去年某天的成交價當現價」。這裡改用**當下市價**，語意是
「賣掉之後到現在少賺多少」，並在 data_notes 講明基準不同。
"""
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

_TAIPEI = timezone(timedelta(hours=8))
_ROOT = Path(__file__).resolve().parents[2]


def max_private_page():
    from ..integrations import max_private
    return max_private.TRADES_PAGE


def _precompute():
    """analysis/precompute.py 隨 CodeUri 一起打包，但不在 package 路徑上。"""
    if str(_ROOT) not in sys.path:
        sys.path.insert(0, str(_ROOT))
    from analysis import precompute
    return precompute


def rows_from_trades(raw, currency):
    """MAX 成交列 → precompute 要的形狀。

    side：bid=買進、ask=賣出。change 帶正負號（買入為正、賣出為負），
    opportunity_cost 與 realized_pnl 都靠它算數量。
    """
    rows = []
    for t in raw or []:
        side = str(t.get("side") or "").lower()
        action = "buy" if side in ("bid", "buy") else "sell" if side in ("ask", "sell") else None
        if action is None:
            continue
        try:
            price = float(t.get("price"))
            volume = float(t.get("volume"))
            ts = int(t.get("created_at_in_ms") or t.get("created_at") or 0)
        except (TypeError, ValueError):
            continue
        if ts <= 0 or price <= 0 or volume <= 0:
            continue
        # created_at 有秒與毫秒兩種欄位，10 位數的是秒
        if ts < 10_000_000_000:
            ts *= 1000
        rows.append({"ts": ts, "currency": currency, "price": price,
                     "action": action, "change": volume if action == "buy" else -volume})
    return rows


def collect_rows(only=None, max_pages=None, bounded=True):
    """把帳戶碰過的每個 TWD 市場的成交紀錄抓回來，合併後依時間排序。

    市場來自 balances()——MAX 會把餘額為 0 的幣別也列出來，所以已經全部賣光的幣仍抓得到。
    完全沒出現在 balances 的幣（例如轉出後從未再持有）抓不到，這一點寫進 data_notes。
    """
    from ..integrations import max_private, max_public

    prices = dict(max_public.twd_prices())
    currencies = []
    for account in max_private.balances() or []:
        cur = str(account.get("currency") or "").lower()
        if cur and cur != "twd" and cur in prices and (not only or cur in only):
            currencies.append(cur)

    # 並行抓。**這不是效能優化，是可行性問題**：API Gateway HTTP API 的整合上限是
    # 硬性 30 秒（不是 Lambda 的 60 秒），12 個市場循序打每個 2–3 秒就直接撞牆——
    # 實測 503 in 30.7s。並行之後總時間≈最慢的那一個市場。
    # 併發數壓在 6：MAX 有速率限制，開太大會換成一批 429。
    def _one(cur):
        raw = (max_private.trades(f"{cur}twd", newest=True) if bounded
               else max_private.trades(f"{cur}twd", max_pages=max_pages or None))
        return cur, rows_from_trades(raw, cur)

    rows, per_currency, failed = [], {}, []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_one, cur): cur for cur in currencies}
        for fut in as_completed(futures):
            cur = futures[fut]
            try:
                cur, got = fut.result()
            except Exception:  # noqa: BLE001 — 單一市場失敗不該讓整份報告掛掉，但要講出來
                failed.append(cur.upper())
                continue
            per_currency[cur] = len(got)
            rows.extend(got)
    rows.sort(key=lambda r: r["ts"])
    return rows, per_currency, failed, prices


def opportunity_cost_to_now(rows, prices):
    """賣出後若持有到**現在**的少賺總額。與 precompute 那支的差別見檔頭。"""
    total, worst = 0.0, None
    for r in rows:
        if r["action"] != "sell":
            continue
        now_price = prices.get(r["currency"])
        if not now_price:
            continue
        qty = -r["change"]
        diff = (now_price - r["price"]) * qty
        total += diff
        if worst is None or diff > worst["missed_twd"]:
            worst = {"date": datetime.fromtimestamp(r["ts"] / 1000, tz=_TAIPEI).strftime("%Y-%m-%d"),
                     "currency": r["currency"], "qty": round(qty, 8),
                     "sell_price": r["price"], "now_price": now_price,
                     "missed_twd": round(diff)}
    return {"total_missed_twd": round(total), "worst_single_sell": worst,
            "basis": "賣出價 vs 當下市價"}


def build_report(only=None, max_pages=None, bounded=True):
    pre = _precompute()
    rows, per_currency, failed, prices = collect_rows(only=only, max_pages=max_pages, bounded=bounded)
    if not rows:
        return {"account_source": "max_private", "available": False,
                "message": "這個帳戶沒有查到任何成交紀錄，無法做行為健檢。",
                "data_notes": ["行為健檢需要成交紀錄；持倉分布不受影響，仍可看 /portfolio。"]}

    notes = [
        "資料來源：你自己的 MAX 帳戶成交紀錄（Private API），不是命題方的示範資料集。",
        ("⚠ 這是**有界**報告：每個市場只取最近 " + str(max_private_page()) + " 筆成交，"
         "不是完整一年。期間欄位是這批資料的實際起訖，不代表帳戶的開戶到今天。"
         "已實現損益在有界模式下不計算——移動平均成本法要從第一筆買入算起，"
         "截斷歷史會算出看似具體、實則無意義的賺賠。追高指數與機會成本不受影響。"
         "完整重建需要分批抓取與快取，尚未實作。") if bounded else
        "涵蓋範圍：依 from_id 逐頁往前抓，上限 20 頁／市場。",
        "機會成本的基準是「賣出價 vs 當下市價」＝賣掉之後到現在少賺多少，"
        "與示範資料集用的「年末價」不同，兩者不可直接比較。",
        "集中度與持倉分布不在本報告裡——那兩項用即時餘額算（GET /portfolio）。",
        "出金習慣需要出入金紀錄，本報告未涵蓋。",
    ]
    if failed:
        notes.append("這些市場查詢失敗、未計入：" + "、".join(failed))

    span = (rows[0]["ts"], rows[-1]["ts"])
    return {
        "account_source": "max_private",
        "available": True,
        "period": {"start": datetime.fromtimestamp(span[0] / 1000, tz=_TAIPEI).strftime("%Y-%m-%d"),
                   "end": datetime.fromtimestamp(span[1] / 1000, tz=_TAIPEI).strftime("%Y-%m-%d")},
        "row_count": len(rows),
        "trades_per_currency": {k.upper(): v for k, v in sorted(per_currency.items(),
                                                                key=lambda kv: -kv[1]) if v},
        "chase_index": pre.chase_index(rows) if _enough_for_chase(rows, pre) else None,
        "opportunity_cost": opportunity_cost_to_now(rows, prices),
        # 有界模式**不出**已實現損益：移動平均成本法要從第一筆買入算起，
        # 截斷歷史等於拿不知道的成本基準算賺賠，數字會看起來很具體但沒有意義。
        # 追高指數不受影響（7 筆均線自己會暖機）；機會成本也不受影響（賣價 vs 現價，
        # 不需要成本基準）。
        "realized_pnl": None if bounded else pre.realized_pnl(rows),
        "activity_profile": pre.activity_profile(rows),
        "data_notes": notes,
    }


def _enough_for_chase(rows, pre):
    """任一幣別的成交數要超過均線視窗，否則 chase_index 會除以零。"""
    counts = defaultdict(int)
    for r in rows:
        counts[r["currency"]] += 1
    return any(n > pre.MA_WINDOW for n in counts.values())
