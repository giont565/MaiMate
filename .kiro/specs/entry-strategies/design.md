# Design — entry-strategies

## Architecture

```
MAX 公開日線 /api/v3/k（period=1440，800 天）
        │  analysis/strategy_compare.py（離線回測，--offline 可吃快取）
        ▼
data/strategy_report.json ──► tools.compare_entry_strategies ──► Agent 轉述
                                                                    │
                                                        guardrails 檢查輸出
```

與 behavior-engine 同一個模式：**數字在離線階段算完，線上只做查表與解釋。**

## 輸出結構

```
generated_at / source / assumptions / markets / risk_tiers / data_notes
markets.<market>.scenarios.<uptrend|downtrend|sideways>
    period / price_move_pct / deepest_dip_pct
    strategies.<lump_sum|dca|grid>.{return_pct, max_drawdown_pct, end_cash_pct}
```

工具層再依 `amount_twd` 換算 TWD 金額，並附 `full_period_grid_vs_hold`、
`feasibility`、`key_findings`、`data_notes`。

## Key Decisions

1. **用 MAX 公開日線而不是命題 CSV**：命題 CSV 是模擬帳戶，價格路徑太平滑
   （全年最大回撤 0.6%~3.6%），任何策略跑起來都像穩賺，結論會是假的。
2. **三情境各自切期間**，不是把全年混在一起算——混在一起會讓「上漲時網格輸給一次買進」
   這種真正有資訊量的差異被平均掉。
3. **假設全部寫進輸出**（費率、10 份、網格 10 層 20% 深度、以日收盤成交、不計滑價）：
   被評審追問時，答案就在 JSON 裡。
4. **這條走護欄**，與「三方案不走護欄」的取捨相反：差別在 pattern 強制帶「你／您」，
   只攔祈使句。中性比較句與教育敘述必須放行，
   `tests/test_guardrails.py::EntryMethodAdviceTests` 有一半案例在守這條。

## Error Handling

| 情況 | 行為 |
|---|---|
| 市場代號不存在 | 誠實回報，不生成資料（`test_unknown_market_is_honest`） |
| 行情取不到 | `feasibility: unknown`，不猜門檻 |
| 金額切份後低於交易所下限 | 標記不可行＋給最低總額 |
