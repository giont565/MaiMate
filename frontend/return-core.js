/* return-core.js —— 年度報酬率的純函式層
 *
 * 規矩同 kline-core.js／health-core.js：不碰 DOM、不 fetch、不引用 mocks，node 下可直接測。
 *
 * 為什麼不能用「(現值 − 投入) / 投入」：
 *   這個帳戶的淨入金是 NT$107,834,613，市值是 NT$324,477。天真 ROI 會算出 +1080.5%，
 *   而其中 99.7% 的變化來自「錢搬進來」，不是「錢變多」。報酬率的分母必須是
 *   「實際承擔風險的資本」，不是「總共匯進去多少」。
 *
 * 為什麼要分年：
 *   累積報酬會讓早年進場的一波紅利蓋掉今年的表現——2018 進場的人累積 +400%，
 *   完全看不出今年是賺是賠。分年之後，舊部位的未實現利得被切進「年初市值」這個
 *   分母裡，不會算成今年的獲利。這就是時間加權報酬（TWR）存在的理由。
 *
 * 兩種算法，看資料給到哪裡：
 *   - 有逐期市值（每月期末）→ 逐期串接＝真 TWR，完全不受出入金時點影響
 *   - 只有期初／期末市值＋有日期的出入金 → Modified Dietz（TWR 的近似）
 *   兩者都只吃「外部流」（入金／出金），不吃帳戶內的買賣——用 TWD 買 ETH 是資產
 *   重配置，不是資金流入，把它當流入會把報酬率算爛。
 */
(function () {
  "use strict";

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* 「2026-03-15」→ 天數序號。只吃 YYYY-MM-DD，不做時區換算（鐵則：不自行換算時間）。 */
  function dayNumber(iso) {
    if (typeof iso !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    var t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
  }

  function daysBetween(startIso, endIso) {
    var a = dayNumber(startIso);
    var b = dayNumber(endIso);
    if (a == null || b == null || b < a) return null;
    return b - a;
  }

  /* Modified Dietz：
   *     r = (V_end − V_start − F_net) / (V_start + Σ Fᵢ·wᵢ)
   *     wᵢ = (T − tᵢ) / T   ← 第 i 筆流入還剩多少時間在帳戶裡工作
   *
   * flows：[{ date: "YYYY-MM-DD", amountTwd: 入金為正、出金為負 }]，只放外部流。
   */
  function modifiedDietz(input) {
    var o = input || {};
    if (!isNum(o.startValueTwd)) return { ok: false, reason: "NO_START_VALUE" };
    if (!isNum(o.endValueTwd)) return { ok: false, reason: "NO_END_VALUE" };

    var total = daysBetween(o.start, o.end);
    if (total == null) return { ok: false, reason: "BAD_PERIOD" };
    if (total === 0) return { ok: false, reason: "EMPTY_PERIOD" };

    var flows = Array.isArray(o.flows) ? o.flows : [];
    var netFlow = 0;
    var weighted = 0;
    for (var i = 0; i < flows.length; i++) {
      var f = flows[i];
      if (!f || !isNum(f.amountTwd)) return { ok: false, reason: "BAD_FLOW" };
      var offset = daysBetween(o.start, f.date);
      /* 期間外的流量代表資料切錯年份，不要默默丟掉——那會讓報酬率悄悄失真。 */
      if (offset == null || offset > total) return { ok: false, reason: "FLOW_OUT_OF_RANGE" };
      netFlow += f.amountTwd;
      weighted += f.amountTwd * ((total - offset) / total);
    }

    var denominator = o.startValueTwd + weighted;
    /* 分母 ≤ 0：期初是空的而且當期又淨出金，此時「報酬率」沒有意義。
       硬給一個數字（甚至負無限大）比留白危險得多。 */
    if (denominator <= 0) return { ok: false, reason: "NO_CAPITAL_BASE" };

    return {
      ok: true,
      ratio: (o.endValueTwd - o.startValueTwd - netFlow) / denominator,
      method: "modified_dietz",
      days: total,
      netFlowTwd: netFlow,
      capitalBaseTwd: denominator,
    };
  }

  /* 逐期串接＝真 TWR：TWR = Π(1 + rᵢ) − 1。
   * 每期各自算 Modified Dietz，任一期算不出來就整條不給——串接少一期不是「近似」，
   * 是算錯，而使用者看不出差別。 */
  function chain(periods) {
    if (!Array.isArray(periods) || periods.length === 0) return { ok: false, reason: "NO_PERIODS" };
    var product = 1;
    var days = 0;
    for (var i = 0; i < periods.length; i++) {
      var r = modifiedDietz(periods[i]);
      if (!r.ok) return { ok: false, reason: r.reason, failedIndex: i };
      product *= 1 + r.ratio;
      days += r.days;
    }
    return { ok: true, ratio: product - 1, method: "twr", days: days, periods: periods.length };
  }

  /* 年化只能用在「已經超過一年」的區間。
   *
   * 未滿一年年化＝外推：把七個月的報酬乘 12/7，等於宣稱「照這速度全年會是 X%」。
   * 那是預測不是事實，而畫面上不會有人看出差別。所以這裡直接拒絕，
   * 呼叫端該顯示「年初至今」而不是「年化」。 */
  function annualize(ratio, days) {
    if (!isNum(ratio) || !isNum(days) || days <= 0) return { ok: false, reason: "BAD_INPUT" };
    if (days < 365) return { ok: false, reason: "PERIOD_TOO_SHORT", days: days };
    if (1 + ratio <= 0) return { ok: false, reason: "TOTAL_LOSS" };
    return { ok: true, ratio: Math.pow(1 + ratio, 365 / days) - 1 };
  }

  /* 一年份的輸入 → 一張卡要的所有欄位。
   *
   * year：{ year, source: "live"|"demo", complete, start, end,
   *         startValueTwd, endValueTwd, flows[], periods[]? }
   * 有 periods 就走 TWR，沒有就走 Modified Dietz。
   */
  function summarize(year) {
    var y = year || {};
    var base = {
      year: String(y.year || ""),
      source: y.source === "live" ? "live" : "demo",
      complete: Boolean(y.complete),
    };
    var result = Array.isArray(y.periods) && y.periods.length
      ? chain(y.periods)
      : modifiedDietz(y);
    if (!result.ok) {
      return Object.assign(base, { ok: false, reason: result.reason });
    }
    /* 只有完整年度才標年化；當年度一律標「年初至今」。 */
    var ann = base.complete ? annualize(result.ratio, result.days) : { ok: false, reason: "IN_PROGRESS" };
    return Object.assign(base, {
      ok: true,
      ratio: result.ratio,
      method: result.method,
      days: result.days,
      annualized: ann.ok ? ann.ratio : null,
      label: base.complete ? "年度報酬" : "年初至今",
      periodLabel: (y.start || "") + " – " + (y.end || ""),
    });
  }

  function fmtPct(ratio) {
    if (!isNum(ratio)) return "—";
    var pct = ratio * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  /* 缺什麼要講得出來。「資料不足」四個字對使用者沒有意義，對隊友更沒有。 */
  var REASONS = {
    NO_START_VALUE: "缺年初市值",
    NO_END_VALUE: "缺期末市值",
    BAD_PERIOD: "期間設定有誤",
    EMPTY_PERIOD: "期間長度為零",
    BAD_FLOW: "出入金紀錄格式有誤",
    FLOW_OUT_OF_RANGE: "有出入金落在期間之外",
    NO_CAPITAL_BASE: "期初無資本可計算報酬",
    NO_PERIODS: "缺逐期市值",
  };
  function reasonText(reason) { return REASONS[reason] || "資料不足"; }

  var api = {
    modifiedDietz: modifiedDietz,
    chain: chain,
    annualize: annualize,
    summarize: summarize,
    fmtPct: fmtPct,
    reasonText: reasonText,
    daysBetween: daysBetween,
  };
  if (typeof window !== "undefined") window.MM_RETURN_CORE = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
