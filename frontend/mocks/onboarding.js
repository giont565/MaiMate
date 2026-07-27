/* MaiMate onboarding 集中 Mock Data（Screen 2/3 使用；Screen 4/5 分析沿用同一 demo 帳戶）
 * 規則：格式穩定、可被正式 API response 原樣替換；全部為虛構示範資料，
 *       不含真實姓名、真實帳號、真實 API Key、真實金融資料。
 * Screen 1 證據卡的「1/8 DOGE 提前賣出」事件對應 demoTransactions 裡 2026-01-08 那筆。 */
"use strict";

window.MM_ONBOARDING_MOCK = {
  consentVersion: "demo-1.0",
  questionnaireVersion: "demo-1.0",

  /* demo 帳戶：4 種資產、BTC 偏集中（52%）、含波動期間交易——供 Screen 4/5 分析 */
  demoPortfolio: {
    currency: "TWD",
    assets: [
      { symbol: "BTC",  amount: 0.18,  refValue: 372000, weight: 0.52 },
      { symbol: "ETH",  amount: 1.6,   refValue: 143000, weight: 0.20 },
      { symbol: "DOGE", amount: 52000, refValue: 121000, weight: 0.17 },
      { symbol: "USDT", amount: 2500,  refValue: 79000,  weight: 0.11 }
    ]
  },

  /* 最近 12 個月交易紀錄（時間/幣種/方向/價格/數量/手續費） */
  demoTransactions: [
    { time: "2025-08-14T09:12:00+08:00", symbol: "BTC",  side: "buy",  price: 1830000, amount: 0.05,  fee: 146 },
    { time: "2025-10-02T21:40:00+08:00", symbol: "DOGE", side: "buy",  price: 5.1,     amount: 30000, fee: 122 },
    { time: "2025-11-19T10:03:00+08:00", symbol: "ETH",  side: "buy",  price: 88000,   amount: 0.8,   fee: 56 },
    { time: "2026-01-08T22:55:00+08:00", symbol: "DOGE", side: "sell", price: 9.8,     amount: 30000, fee: 235 },
    { time: "2026-01-09T10:20:00+08:00", symbol: "DOGE", side: "buy",  price: 8.9,     amount: 22000, fee: 157 },
    { time: "2026-03-21T15:44:00+08:00", symbol: "BTC",  side: "buy",  price: 2010000, amount: 0.03,  fee: 96 },
    { time: "2026-05-30T09:30:00+08:00", symbol: "DOGE", side: "buy",  price: 6.4,     amount: 30000, fee: 154 },
    { time: "2026-07-11T20:15:00+08:00", symbol: "ETH",  side: "buy",  price: 91000,   amount: 0.8,   fee: 58 }
  ],

  /* 入出金紀錄（不含外部銀行帳戶其他交易明細） */
  demoFunding: [
    { time: "2025-08-10T12:00:00+08:00", type: "deposit",  amount: 120000 },
    { time: "2025-11-15T12:00:00+08:00", type: "deposit",  amount: 80000 },
    { time: "2026-01-10T12:00:00+08:00", type: "withdraw", amount: 30000 },
    { time: "2026-03-18T12:00:00+08:00", type: "deposit",  amount: 60000 }
  ]
};
