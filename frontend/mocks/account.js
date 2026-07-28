/* 自動生成——請勿手改。
 * 來源：data/health_report.json（產出於 2026-07-19T15:08:24.939845+00:00）
 * 重生：npm run build:account
 * 這是隊友共用的同一個帳戶：2025-01-01 ～ 2025-12-31，
 * 共 10000 列紀錄、4674 筆買賣。
 * 注意：報告只有聚合值，沒有逐筆交易明細與各幣種持倉比例，
 *       前端不得為了畫面好看而補上不存在的數字。 */
"use strict";

window.MM_ACCOUNT = {
  "source": "data/health_report.json",
  "generatedAt": "2026-07-19T15:08:24.939845+00:00",
  "period": {
    "start": "2025-01-01",
    "end": "2025-12-31"
  },
  "rowCount": 10000,
  "trades": {
    "total": 4674,
    "buyTotal": 2357,
    "sellTotal": 2317,
    "perMonth": {
      "2025-01": 388,
      "2025-02": 348,
      "2025-03": 402,
      "2025-04": 385,
      "2025-05": 416,
      "2025-06": 358,
      "2025-07": 406,
      "2025-08": 416,
      "2025-09": 392,
      "2025-10": 393,
      "2025-11": 395,
      "2025-12": 375
    },
    "latestMonth": "2025-12",
    "previousMonth": "2025-11",
    "latestMonthCount": 375,
    "previousMonthCount": 395,
    "averagePerMonth": 389.5,
    "busiestMonth": {
      "month": "2025-05",
      "trades": 416
    },
    "byCurrency": {
      "sol": 812,
      "usdt": 779,
      "doge": 779,
      "btc": 775,
      "usdc": 769,
      "eth": 760
    },
    "detailAvailable": false
  },
  "holdings": {
    "asOfMonth": "2025-12",
    "topCurrency": "twd",
    "topPct": 98.6,
    "portfolioTwd": 118168980,
    "otherPct": 1.4,
    "previousMonth": "2025-11",
    "previousCurrency": "twd",
    "previousPct": 98.5,
    "breakdownAvailable": false,
    "peak": {
      "month": "2025-12",
      "top_currency": "twd",
      "top_pct": 98.6,
      "portfolio_twd": 118168980
    }
  },
  "chase": {
    "buy_above_ma_pct": 65,
    "sell_below_ma_pct": 34.1,
    "buy_total": 2350,
    "sell_total": 2304,
    "ma_window": 7
  },
  "cashFlow": {
    "twd_withdrawal_count": 417,
    "withdrawals_after_7d_btc_drop_pct": 14.2
  },
  "opportunityCost": {
    "totalMissedTwd": 26598877,
    "worstSell": {
      "date": "2025-01-08",
      "currency": "doge",
      "qty": 6216.214174,
      "sell_price": 14.2,
      "eoy_price": 64.54,
      "missed_twd": 312924
    }
  }
};
