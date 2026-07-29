/* Onboarding／首頁／對話共用的帳戶資料——全部取自隊友共用的真實帳戶分析。
 * 唯一來源：frontend/mocks/account.js（由 data/health_report.json 生成，見 npm run build:account）
 *
 * 這份報告有的：期間、買賣總筆數、每月交易次數、每月最大持有標的與占比、
 *               追高指數、機會成本（含最痛一筆賣出）、出金行為，
 *               以及 2026-07-28 重跑後補上的各幣種持倉快照（issue #29）。
 * 這份報告沒有的：逐筆交易明細（官方 CSV 不進 git）。
 * → 沒有的東西一律標成「資料不足」，不得為了畫面補數字。
 */
"use strict";

(function buildOnboardingMock() {
  const account = window.MM_ACCOUNT;
  const holdings = account.holdings;
  const snapshot = account.holdingsSnapshot;

  const labelFor = (currency) =>
    currency === "twd" ? "現金（TWD）" : String(currency).toUpperCase();

  /* 有 holdings_snapshot（issue #29 重跑後才有）就用真實的逐幣種比例；
   * 沒有就退回「最大持有＋其餘未細分」兩筆，並讓 breakdownAvailable 維持 false，
   * 畫面走「資料不足」。兩條路的數字都指得出來源，不得自行推估中間值。 */
  const assets = snapshot
    ? snapshot.holdings.map((h) => ({
        symbol: String(h.currency).toUpperCase(),
        label: labelFor(h.currency),
        weight: h.pct / 100,
        valueTwd: h.value_twd,
        isCash: h.currency === "twd",
      }))
    : [
        {
          symbol: holdings.topCurrency.toUpperCase(),
          label: labelFor(holdings.topCurrency),
          weight: holdings.topPct / 100,
          isCash: holdings.topCurrency === "twd",
        },
        { symbol: "OTHER", label: "其他資產（未細分）", weight: holdings.otherPct / 100, isCash: false },
      ];

  window.MM_ONBOARDING_MOCK = {
    consentVersion: "demo-1.0",
    questionnaireVersion: "demo-1.0",
    account,

    /* 持倉：注意 top_currency 是 twd＝資金多在現金，不是加密資產過度集中。 */
    demoPortfolio: {
      currency: "TWD",
      asOfMonth: holdings.asOfMonth,
      portfolioTwd: holdings.portfolioTwd,
      breakdownAvailable: holdings.breakdownAvailable,
      snapshotAsOf: snapshot ? snapshot.asOf : null,
      snapshotMethod: snapshot ? snapshot.method : null,
      /* 前期快照（Screen 8 期間對照用）。報告沒有前一個月時為 null，畫面就不做對照。 */
      previousAsOfMonth: holdings.previousMonth || null,
      previousTopWeight: Number.isFinite(Number(holdings.previousPct))
        ? Number(holdings.previousPct) / 100
        : null,
      assets,
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
