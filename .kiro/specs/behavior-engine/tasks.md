# Tasks — behavior-engine

- [x] 1. CSV 解析（欄位名與值尾端空白 strip）＋期間/筆數驗證
  - 實測：10,000 筆全數解析，`period` 2025-01-01～2025-12-31
- [x] 2. 追高殺低指數（同幣別近 7 筆均線）
  - 實測：`buy_above_ma_pct` 65.0（2,350 筆買入）／`sell_below_ma_pct` 34.1（2,304 筆賣出）
- [x] 3. 機會成本（賣出後續抱至年末的差額）
  - 實測：`total_missed_twd` 26,598,877；`worst_single_sell` 2025-01-08 doge 312,924
- [x] 4. 持倉集中度（`monthly_top_holding`／`peak_concentration`）
  - 實測：峰值 2025-12 twd 98.6%——**最大持有是現金**，文案必須講明（見 R4.3）
- [x] 5. 出入金行為（`cash_flow_behavior`）
  - 實測：提領 417 筆，僅 14.2% 發生於 BTC 七日下跌後 → 不得稱「恐慌出金」
- [x] 6. 交易畫像（`activity_profile`：月頻率／幣別分布／動作統計）
- [x] 7. 已實現損益（#27）：移動平均成本法
  - 實測：+117,482（981 勝／493 負）；最痛真實虧損 2025-10-01 usdt −963
- [x] 8. 三組聚合（#29）：`holdings_snapshot`／`change_attribution`／`holding_period_distribution`
- [x] 9. 前端標示為「命題方示範資料」而非「你的帳戶」（commit 25c36cb）
- [x] 10. 回歸測試：`python3 scripts/test_backend.py`（47 項）＋`python3 -m unittest discover -s tests`（112 項）

## 未完成

- [ ] 11. 分年度投資報酬率所需資料：年初市值、出入金歷史、逐月淨流（issue #47）
  - 現況：CSV 沒有年初市值與完整出入金脈絡，硬算會得到誤導性的報酬率，因此**沒有先出數字**
