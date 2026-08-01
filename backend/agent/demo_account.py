"""示範帳戶：沒有 MAX 金鑰時的帳戶資料來源。

比賽環境的兩支 Lambda 沒有 MAX_API_KEY／MAX_API_SECRET（主辦撤銷），
`max_private.balances()` 必然拋錯 → calculate_trade_scenarios 回 error → 三方案卡與
確認卡整條發不出來，畫面只剩「系統目前無法連線到 MAX 帳戶」。

這個模組改用**命題方提供的一年份帳戶資料**（`data/health_report.json` 的
`holdings_snapshot`，也正是整個產品的資料來源）當示範帳戶，讓卡片照常發，
但畫面與回答都誠實標示。

## 三條紅線

1. **不在 max_private 內部造假。** 那會讓所有呼叫端（含 place_order 的下單路徑）
   拿到看不出來是假的資料，直接踩「絕不能把示範資料當成真實帳戶資料呈現」。
2. **只認「環境變數不存在」，不認「呼叫失敗」**（見 max_private.has_keys 的註解）。
3. **永遠不吐幣的「數量」。** 快照只有台幣市值；數量是用今天的價格回推的，量級不可信：
   DOGE 在命題資料的 2025-12-31 估值是 64.54（health_report 的 worst_single_sell.eoy_price
   可證），今天 MAX 實價 2.24 → 用今價回推得到 146,211 顆，命題世界裡其實只有約 5,073 顆，
   差 28.8 倍。所以數量只當中間量，絕不外顯。

## 為什麼換算誤差是 0（不是「近似」）

`scenarios.py` 要的是幣的數量，快照給的是台幣市值，所以要除以現價。但 scenarios.py
接著會用**同一張價表**把它乘回去（`cur_value = qty × price`、`total_value = twd + Σ qty×price`），
價格因此被完全消掉：`(V/P)×P ≡ V`。條件是兩邊必須用同一個價格——所以這裡取得的 ticker
會**一起注入**給 scenarios，非交易幣別則共用 `max_public.twd_prices()` 的 30 秒快取。
結果：卡片上的金額、手續費、執行後佔比相對這份快照是精確的，不是估的。

真正殘留的近似只有一個，而且是**時點**不是數字：快照的資產估值日是 2025-12-31，
不是今天。所以文案一律講「示範帳戶（估值日 2025-12-31）」，不講「你現在有…」。
行情、手續費、單筆下限走公開 API，不需金鑰，全部是今天的真值。
"""
import json

ACCOUNT_SOURCE = "demo_dataset"
AS_OF_FALLBACK = "2025-12-31"
# 「這個帳戶裡有什麼」類的錯誤，訊息主詞要改；行情／交易所規則類的不改（見 mark()）
_ACCOUNT_ERRORS = ("not_in_portfolio", "insufficient_twd")

# 三道標示的共用文案。改字只改這裡——後端回覆前綴、工具 data_notes、前端橫幅都讀這一份。
REPLY_PREFIX = ("（示範帳戶模式）這台環境沒有連上 MAX 帳戶，"
                "以下用命題方提供的一年份帳戶資料試算，資產估值日 {as_of}；"
                "行情與手續費是即時真實資料。\n\n")


def notice(as_of=None):
    return (f"🧪 示範帳戶 — 命題方提供的一年份帳戶資料（估值日 {as_of or AS_OF_FALLBACK}），"
            "非真實 MAX 帳戶餘額；行情、手續費、交易所下限仍是即時真實資料。")


def reply_prefix(as_of=None):
    return REPLY_PREFIX.format(as_of=as_of or AS_OF_FALLBACK)


def active():
    """要不要走示範帳戶。唯一條件：這個環境沒有配置金鑰。"""
    from ..integrations import max_private
    return not max_private.has_keys()


def in_use():
    """這次請求是不是**真的**在用示範帳戶＝沒金鑰、而且示範資料讀得到。

    比 active() 多一個條件，是為了不講一件沒發生的事：示範資料壞掉（檔案不在／
    holdings_snapshot 空）時 tools.py 會退回原本的錯誤路徑，老實說連不上帳戶、
    不編任何數字；此時若照樣加上「以下用命題方提供的一年份帳戶資料試算」的前綴與橫幅，
    等於宣稱做了一件根本沒做的試算。標示只在標的存在時才成立。

    給 chat.py（回覆前綴／payload 標示）與 loop.py（SYSTEM 追加規則）共用，
    兩邊的觸發條件必須一致，否則會出現「模型被要求講示範帳戶但畫面沒標示」之類的錯位。
    """
    return active() and snapshot() is not None


def as_of():
    """示範資料的資產估值日；讀不到就用 fallback（文案不會出現空白日期）。"""
    snap = snapshot()
    return snap["as_of"] if snap else AS_OF_FALLBACK


def snapshot():
    """讀 holdings_snapshot；讀不到或沒有持倉就回 None。

    回 None 時呼叫端一律退回原本的錯誤路徑（＝老實說連不上帳戶），**絕不臨時編數字**。
    """
    from . import tools
    try:
        report = json.loads(tools.HEALTH_REPORT.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 檔案不在／壞掉都只代表「沒有示範資料可用」
        return None
    snap = (report or {}).get("holdings_snapshot") or {}
    holdings = [h for h in (snap.get("holdings") or [])
                if h.get("currency") and h.get("value_twd") is not None]
    if not holdings:
        return None
    return {"as_of": snap.get("asOf") or AS_OF_FALLBACK,
            "method": snap.get("method") or "",
            "holdings": holdings}


def holdings_view():
    """給 get_account_balance 用的示範帳戶視圖：只有台幣市值與佔比，**沒有任何數量**。

    刻意與 max_private.balances() 的形狀不同（那邊是 currency/balance＝幣的數量）：
    形狀一樣才危險——模型與未來的呼叫端會分不出手上這份是不是真帳戶。
    本函式不連網，行情掛掉時餘額照樣答得出來。
    """
    snap = snapshot()
    if snap is None:
        return None
    rows = [{"currency": str(h["currency"]).upper(),
             "value_twd": float(h["value_twd"]),
             "pct_of_account": h.get("pct")} for h in snap["holdings"]]
    return {
        "account_source": ACCOUNT_SOURCE,
        "as_of": snap["as_of"],
        "valuation_method": snap["method"],
        "total_value_twd": round(sum(r["value_twd"] for r in rows)),
        "holdings": rows,
        "account_notice": notice(snap["as_of"]),
        "data_notes": _notes(snap["as_of"]),
    }


def resolve(market):
    """組出可注入 scenarios.calculate_trade_scenarios 的示範帳戶。

    回傳 {"balances", "ticker", "as_of", "skipped", ...}；示範資料不可用時回 None
    （呼叫端退回原本的路徑）。行情取不到時**例外照樣往上拋**——那是「行情掛了」，
    不是「沒有帳戶」，兩件事不可混為一談。
    """
    snap = snapshot()
    if snap is None:
        return None

    from ..integrations import max_public
    from . import scenarios

    currency = market.replace("twd", "")
    ticker = max_public.fetch(market, "ticker")["data"]
    price = float(ticker.get("last") or 0)
    # 用 scenarios 自己那張價表：它稍後會用同一張表把數量乘回市值，價格才消得掉。
    prices = scenarios._price_table(currency, price)  # noqa: SLF001 — 同一個 package，刻意共用

    balances, skipped = {}, []
    for row in snap["holdings"]:
        code = str(row["currency"]).lower()
        value = float(row["value_twd"])
        if code == "twd":
            balances["twd"] = value          # 本來就是台幣，不需要換算
            continue
        unit_price = float(prices.get(code) or 0)
        if unit_price <= 0:
            # 查不到 TWD 報價就跳過這一筆。分母略小、佔比略高（非台幣部位總共只有 1.4%），
            # 但寧可少算一筆，也不要用猜的價格算出一個看起來很正常的數字。
            skipped.append(code)
            continue
        balances[code] = value / unit_price
    balances.setdefault("twd", 0.0)

    return {"balances": balances, "ticker": ticker, "as_of": snap["as_of"],
            "skipped": skipped,
            "total_value_twd": round(sum(
                float(row["value_twd"]) for row in snap["holdings"]
                if str(row["currency"]).lower() not in skipped))}


def mark(result, ctx):
    """把示範標示蓋回 calculate_trade_scenarios 的結果。

    **每一張 scenario 都要蓋**：loop.py 只把 `result["scenarios"]` 這個 list 帶給
    handler，掛在外層的旗標到不了前端。外層另外附一份給模型看（data_notes）。
    """
    as_of = ctx["as_of"]
    if result.get("error") in _ACCOUNT_ERRORS:
        # 這兩種錯誤在講「帳戶裡有什麼」：scenarios.py 的原句是「**你的帳戶**目前沒有 XRP 持倉」
        # 「TWD 餘額 NT$116,530,466 不足」——在示範模式下講成使用者的帳戶就是不誠實。
        # 只改這兩種：no_price／below_min_order 講的是行情與交易所規則，跟帳戶無關，
        # 冠上「示範帳戶」反而會把行情故障誤導成示範資料造成的。
        message = str(result.get("message", "")).replace("你的帳戶", "示範帳戶")
        result["message"] = message if "示範帳戶" in message else f"（示範帳戶）{message}"
    for scenario in result.get("scenarios", []):
        scenario["account_source"] = ACCOUNT_SOURCE
        scenario["account_notice"] = notice(as_of)
    result["account_source"] = ACCOUNT_SOURCE
    result["account_notice"] = notice(as_of)
    result["account_as_of"] = as_of
    result["account_total_value_twd"] = ctx["total_value_twd"]
    result["account_skipped"] = ctx["skipped"]
    result["data_notes"] = _notes(as_of, ctx["skipped"])
    return result


def _notes(as_of, skipped=None):
    """給模型的硬規則。工具答不出來先怪工具再怪 prompt（開發紀律④）。"""
    notes = [
        f"本次數字來自**示範帳戶**：命題方提供的一年份帳戶資料，資產估值日 {as_of}，"
        "不是使用者的真實 MAX 帳戶（本環境未配置帳戶連線）。"
        "**回答的第一句必須先講明這件事**，一律用「示範帳戶」四個字。",
        "**不得**說「你的帳戶」「你目前持有」「你的餘額」，也不得宣稱這是即時餘額或真實用戶行為。",
        "**不得說出任何幣的持有數量（顆數）**——示範資料只有台幣市值，數量無法還原。"
        "只講金額與百分比。",
        "價格、手續費、交易所單筆下限走公開行情，是現在的真實數字，可正常引用；"
        "金額與佔比是照示範帳戶的台幣市值精確算出來的，不是估的、也不是編的。",
        "三方案照常對等呈現（不得推薦）；使用者選定後照常呼叫 prepare_order，"
        "但要提醒他：示範帳戶模式按下確認不會送出真實訂單。",
    ]
    if skipped:
        notes.append(f"以下幣別在 MAX 查不到 TWD 報價而未計入總資產：{', '.join(sorted(skipped))}；"
                     "總資產略低、佔比略高，被問到時如實說明。")
    return notes
