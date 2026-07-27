/* 由 data/health_report.json（隊友共用的真實帳戶分析）生成 frontend/mocks/account.js。
 * 目的：前端所有帳戶數字都必須指得出來源，不再由人手抄或編造。
 * 用法：npm run build:account（改動 health_report.json 後重跑，產出檔要一起 commit）
 */
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "data", "health_report.json");
const TARGET = path.join(__dirname, "..", "frontend", "mocks", "account.js");

const report = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const round = (n, d) => Number(Number(n).toFixed(d == null ? 1 : d));

const monthly = report.activity_profile.trades_per_month;
const months = Object.keys(monthly).sort();
const latestMonth = months[months.length - 1];
const previousMonth = months[months.length - 2];
const tradeTotal = report.activity_profile.action_counts.buy + report.activity_profile.action_counts.sell;
const holdings = report.concentration.monthly_top_holding[latestMonth];
const worst = report.opportunity_cost.worst_single_sell;

const account = {
  source: "data/health_report.json",
  generatedAt: report.generated_at,
  period: report.period,
  rowCount: report.row_count,
  /* 交易：只有「每月聚合」，沒有逐筆明細（明細在 gitignore 的官方 CSV 裡） */
  trades: {
    total: tradeTotal,
    buyTotal: report.activity_profile.action_counts.buy,
    sellTotal: report.activity_profile.action_counts.sell,
    perMonth: monthly,
    latestMonth,
    previousMonth,
    latestMonthCount: monthly[latestMonth],
    previousMonthCount: monthly[previousMonth],
    averagePerMonth: round(tradeTotal / months.length),
    busiestMonth: report.activity_profile.busiest_month,
    byCurrency: report.activity_profile.trades_by_currency,
    detailAvailable: false,
  },
  /* 持倉：報告只提供每月最大持有標的與占比，其餘未細分 */
  holdings: {
    asOfMonth: latestMonth,
    topCurrency: holdings.top_currency,
    topPct: holdings.top_pct,
    portfolioTwd: holdings.portfolio_twd,
    otherPct: round(100 - holdings.top_pct, 1),
    breakdownAvailable: false,
    peak: report.concentration.peak_concentration,
  },
  chase: report.chase_index,
  cashFlow: report.cash_flow_behavior,
  opportunityCost: {
    totalMissedTwd: report.opportunity_cost.total_missed_twd,
    worstSell: worst,
  },
};

const banner = `/* 自動生成——請勿手改。
 * 來源：${account.source}（產出於 ${account.generatedAt}）
 * 重生：npm run build:account
 * 這是隊友共用的同一個帳戶：${account.period.start} ～ ${account.period.end}，
 * 共 ${account.rowCount} 列紀錄、${account.trades.total} 筆買賣。
 * 注意：報告只有聚合值，沒有逐筆交易明細與各幣種持倉比例，
 *       前端不得為了畫面好看而補上不存在的數字。 */
"use strict";

window.MM_ACCOUNT = ${JSON.stringify(account, null, 2)};
`;

fs.writeFileSync(TARGET, banner);
console.log("已生成", path.relative(path.join(__dirname, ".."), TARGET));
console.log(`  期間 ${account.period.start}～${account.period.end}｜買賣 ${account.trades.total} 筆｜` +
  `平均每月 ${account.trades.averagePerMonth} 筆｜${account.trades.latestMonth} ${account.trades.latestMonthCount} 筆 vs ` +
  `${account.trades.previousMonth} ${account.trades.previousMonthCount} 筆`);
console.log(`  最大持有 ${account.holdings.topCurrency.toUpperCase()} ${account.holdings.topPct}%（${account.holdings.asOfMonth}）｜` +
  `其餘 ${account.holdings.otherPct}% 未細分`);
console.log(`  最痛一筆：${worst.date} 賣出 ${worst.currency.toUpperCase()} @${worst.sell_price}，年末 ${worst.eoy_price}，少賺 NT$${worst.missed_twd.toLocaleString("en-US")}`);
