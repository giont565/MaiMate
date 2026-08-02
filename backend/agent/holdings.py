"""持倉估值：把 MAX 的原始餘額（幣別＋數量）換算成台幣市值與佔比。

為什麼要有這支：`max_private.balances()` 只回數量，於是任何拿它作答的地方都只能比數量。
2026-08-02 實測對話裡，模型看到「GRT 53,192 顆、BTC 0.072 顆」就回答
「GRT 是你最大的單一部位」——數量差 73 萬倍，市值卻是 BTC 五倍多。使用者當場糾正
「數量多不代表集中，他的金額沒有比較高」，模型才補打十次行情重算。

那十次往返本來不該發生：**工具就該回答得出「集中度」這個問題**。
（CLAUDE.md 開發紀律④：查詢回傳附 key_findings＋data_notes，模型答不出先怪工具。）

⚠ 佔比分母與三方案卡同一套基準（`scenarios.py`）：只算 `balance`，不含 `locked`／`staked`。
兩個畫面用不同基準就會給出兩個百分比，而使用者無從判斷哪個對。被排除的部位改列在
`excluded`，不靜默丟掉。
"""
from datetime import datetime, timedelta, timezone

_TAIPEI = timezone(timedelta(hours=8))


def valued_holdings():
    """真帳戶的即時持倉：{account_source, as_of, total_value_twd, holdings[], excluded[], data_notes[]}。

    holdings 依市值由大到小排序——「最大部位是誰」不該由呼叫端自己排。
    """
    from ..integrations import max_private, max_public

    accounts = max_private.balances()
    prices = dict(max_public.twd_prices())
    prices["twd"] = 1.0

    holdings, excluded, unpriced = [], [], []
    for account in accounts or []:
        currency = str(account.get("currency") or "").lower()
        if not currency:
            continue
        amount = _num(account.get("balance"))
        parked = _num(account.get("locked")) + _num(account.get("staked"))
        if parked > 0:
            excluded.append({"currency": currency.upper(), "amount": parked})
        if amount <= 0:
            continue
        price = prices.get(currency)
        if price is None:
            # 查無 TWD 報價（下市或只有 USDT 交易對）——列出來，不當 0 元吃掉。
            # 當 0 元會讓分母偏小、佔比全部偏高：08-01 那張卡顯示 8.6%、真值 0.106%
            # 就是這樣來的。
            unpriced.append(currency.upper())
            continue
        holdings.append({"currency": currency.upper(), "amount": amount,
                         "value_twd": amount * price})

    total = sum(h["value_twd"] for h in holdings)
    for h in holdings:
        h["pct_of_account"] = round(h["value_twd"] / total * 100, 1) if total > 0 else 0.0
        h["value_twd"] = round(h["value_twd"])
    holdings.sort(key=lambda h: h["value_twd"], reverse=True)

    notes = ["市值＝可動用餘額 × MAX 即時報價（/api/v2/tickers）；佔比分母與三方案卡同一套基準。",
             "**集中度看的是市值佔比，不是幣的數量**——幣價差好幾個數量級，比數量會得到相反的結論。"]
    if excluded:
        notes.append("鎖定或質押中的部位不計入佔比："
                     + "、".join(f"{e['currency']} {e['amount']:g}" for e in excluded))
    if unpriced:
        notes.append("查無 TWD 報價、未計入市值：" + "、".join(unpriced))

    return {
        "account_source": "max_private",
        "as_of": datetime.now(_TAIPEI).isoformat(timespec="seconds"),
        "valuation_method": "MAX 即時報價",
        "total_value_twd": round(total),
        "holdings": holdings,
        "excluded": excluded,
        "key_findings": _key_findings(holdings, total),
        "data_notes": notes,
    }


def _key_findings(holdings, total):
    """直接把「集中度」這個問題的答案算好，模型不必自己排序或加總。"""
    if not holdings or total <= 0:
        return ["帳戶目前沒有可估值的持倉。"]
    top = holdings[0]
    top_two = sum(h["value_twd"] for h in holdings[:2]) / total * 100
    cash = next((h for h in holdings if h["currency"] == "TWD"), None)
    findings = [
        f"最大部位是 {top['currency']}，市值 NT${top['value_twd']:,}，佔 {top['pct_of_account']}%",
        f"前兩大合計佔 {top_two:.1f}%（共 {len(holdings)} 種資產）",
        f"總資產約 NT${round(total):,}",
    ]
    findings.append(f"現金（TWD）佔 {cash['pct_of_account']}%" if cash else "帳戶內沒有台幣現金部位")
    return findings


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
