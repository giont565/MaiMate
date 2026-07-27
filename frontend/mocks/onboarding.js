/* Onboarding／首頁／對話共用的帳戶資料——全部取自隊友共用的真實帳戶分析。
 * 唯一來源：frontend/mocks/account.js（由 data/health_report.json 生成，見 npm run build:account）
 *
 * 這份報告有的：期間、買賣總筆數、每月交易次數、每月最大持有標的與占比、
 *               追高指數、機會成本（含最痛一筆賣出）、出金行為。
 * 這份報告沒有的：逐筆交易明細、各幣種持倉比例（官方 CSV 不進 git）。
 * → 沒有的東西一律標成「資料不足」，不得為了畫面補數字。
 */
"use strict";

(function buildOnboardingMock() {
  const account = window.MM_ACCOUNT;
  const holdings = account.holdings;

  window.MM_ONBOARDING_MOCK = {
    consentVersion: "demo-1.0",
    questionnaireVersion: "demo-1.0",
    account,

    /* 持倉：報告只給「最大持有標的與占比」，其餘 1.4% 未細分。
     * 注意 top_currency 是 twd＝資金多在現金，不是加密資產過度集中。 */
    demoPortfolio: {
      currency: "TWD",
      asOfMonth: holdings.asOfMonth,
      portfolioTwd: holdings.portfolioTwd,
      breakdownAvailable: holdings.breakdownAvailable,
      assets: [
        {
          symbol: holdings.topCurrency.toUpperCase(),
          label: holdings.topCurrency === "twd" ? "現金（TWD）" : holdings.topCurrency.toUpperCase(),
          weight: holdings.topPct / 100,
          isCash: holdings.topCurrency === "twd",
        },
        {
          symbol: "OTHER",
          label: "其他資產（未細分）",
          weight: holdings.otherPct / 100,
          isCash: false,
        },
      ],
    },

    /* 交易：只有每月聚合，沒有逐筆明細 */
    tradeActivity: {
      total: account.trades.total,
      buyTotal: account.trades.buyTotal,
      sellTotal: account.trades.sellTotal,
      perMonth: account.trades.perMonth,
      latestMonth: account.trades.latestMonth,
      previousMonth: account.trades.previousMonth,
      latestMonthCount: account.trades.latestMonthCount,
      previousMonthCount: account.trades.previousMonthCount,
      averagePerMonth: account.trades.averagePerMonth,
      byCurrency: account.trades.byCurrency,
      busiestMonth: account.trades.busiestMonth,
      periodEnd: account.period.end,
      detailAvailable: false,
    },

    /* 行為指標（真值） */
    behavior: {
      chaseBuyAboveMaPct: account.chase.buy_above_ma_pct,
      chaseBuyTotal: account.chase.buy_total,
      withdrawalCount: account.cashFlow.twd_withdrawal_count,
      withdrawalsAfterDropPct: account.cashFlow.withdrawals_after_7d_btc_drop_pct,
    },

    /* 可回顧的具體事件：報告裡唯一有明細的一筆賣出 */
    notableSell: account.opportunityCost.worstSell,
    totalMissedTwd: account.opportunityCost.totalMissedTwd,
  };
})();
