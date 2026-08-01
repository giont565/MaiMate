/* health-core.js —— 麥麥健康分的純函式層
 *
 * 規矩同 kline-core.js：不碰 DOM、不 fetch、不引用 mocks，可以在 node 下直接測。
 * 邏輯來源是 app.js 的 renderHero()／renderHealth()——那裡是把計算和 innerHTML 綁在
 * 一起的，沒有 core 層，所以 home 沒辦法共用。這支把「算」抽出來，`home.js` 與（賽後）
 * `app.js` 都吃同一顆，同一個健康分不會在兩頁算出兩個值。
 *
 * 目前刻意不改 app.js：那一頁正在被拍分鏡稿，這條線不碰它。等片子錄完再讓它改吃這裡，
 * 在那之前兩邊各有一份計算——這份重複是知情的，換來拍片那頁零改動。
 */
(function () {
  "use strict";

  function isNum(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /* 與 app.js fmt() 同語意：最多四位小數、不補零。同一個數字在兩頁必須長得一樣。 */
  function fmt(v, maxDec) {
    var n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: maxDec == null ? 4 : maxDec })
      : "—";
  }

  /* 健康分＝三個真實子項的透明加權。缺哪一項就把它的權重攤到其餘（不是補 0，補 0
     會讓缺資料看起來像「表現很差」）。權重與公式一起回傳，呼叫端要把公式印在卡上。 */
  function score(report) {
    if (!report || typeof report !== "object") return { ok: false, reason: "NO_REPORT" };

    var chase = report.chase_index && isNum(report.chase_index.buy_above_ma_pct);
    var flow = report.cash_flow_behavior
      && isNum(report.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct);
    var rp = report.realized_pnl;
    var wins = rp && isNum(rp.profit_trades);
    var losses = rp && isNum(rp.loss_trades);
    var winRate = wins != null && losses != null && wins + losses > 0
      ? (wins / (wins + losses)) * 100
      : null;

    var factors = [];
    if (chase != null) factors.push({ k: "追高控制", v: 100 - chase, w: 0.4 });
    if (winRate != null) factors.push({ k: "勝率", v: winRate, w: 0.3 });
    if (flow != null) factors.push({ k: "出金紀律", v: 100 - flow, w: 0.3 });

    /* 一個子項都沒有就不給分數。硬給一個數字比留白危險——使用者會拿它跟自己比。 */
    if (factors.length === 0) return { ok: false, reason: "NO_FACTORS" };

    var wsum = factors.reduce(function (a, f) { return a + f.w; }, 0);
    var value = Math.round(factors.reduce(function (a, f) { return a + f.v * f.w; }, 0) / wsum);
    var worst = factors.reduce(function (a, f) { return f.v < a.v ? f : a; });

    return {
      ok: true,
      score: Math.max(0, Math.min(100, value)),
      factors: factors,
      worst: worst,
      /* partial＝有子項缺席，權重被攤過。呼叫端要讓使用者看得出來。 */
      partial: factors.length < 3,
      formula: "＝" + factors.map(function (f) {
        return f.k + Math.round((f.w / wsum) * 100) + "%";
      }).join("＋") + "，皆依你 2025 真實紀錄",
      winRate: winRate,
    };
  }

  /* 已實現損益。沒有 realized_pnl 就回 ok:false，呼叫端整段不顯示——不要顯示 0，
     「已實現損益 0」和「沒有這筆資料」是兩件完全不同的事。 */
  function realized(report) {
    var rp = report && report.realized_pnl;
    if (!rp || typeof rp !== "object") return { ok: false, reason: "NO_REALIZED_PNL" };
    var total = isNum(rp.total_realized_twd);
    if (total == null) return { ok: false, reason: "NO_TOTAL" };
    var wins = isNum(rp.profit_trades);
    var losses = isNum(rp.loss_trades);
    var winRate = wins != null && losses != null && wins + losses > 0
      ? (wins / (wins + losses)) * 100
      : null;
    return {
      ok: true,
      totalTwd: total,
      positive: total >= 0,
      profitTrades: wins,
      lossTrades: losses,
      winRatePct: winRate,
    };
  }

  /* 健檢 2×2 卡。任一格算不出來就給「—」，那一格單獨啞掉，不影響其他三格。 */
  function cards(report) {
    if (!report || typeof report !== "object") return [];
    var chase = report.chase_index && isNum(report.chase_index.buy_above_ma_pct);
    var missed = report.opportunity_cost && isNum(report.opportunity_cost.total_missed_twd);
    var pc = (report.concentration && report.concentration.peak_concentration) || {};
    var topPct = isNum(pc.top_pct);
    var flow = report.cash_flow_behavior
      && isNum(report.cash_flow_behavior.withdrawals_after_7d_btc_drop_pct);

    /* top_currency=twd 代表「資金多在現金」＝保守，不是風險。標籤要講清楚幣別，
       否則 98.6% 會被讀成危險的加密資產過度集中，意思正好相反。 */
    var isCash = String(pc.top_currency || "").toLowerCase() === "twd";
    var month = String(pc.month || "").slice(0, 20);
    var concLabel = isCash
      ? "峰值現金佔比（TWD）" + (month ? "（" + month + "，資金多在觀望）" : "")
      : "峰值持倉集中度 " + String(pc.top_currency || "").toUpperCase().slice(0, 10)
        + (month ? "（" + month + "）" : "");

    return [
      /* 標籤刻意寫短：這張卡排在首頁最前面，四格標籤各多一行就會把第二張卡
         的開頭擠出第一屏。完整說法留給 insight 那兩句。 */
      { id: "chase", value: chase == null ? "—" : fmt(chase) + "%", label: "買在近 7 筆均價上方", tone: "risk" },
      { id: "missed", value: missed == null ? "—" : fmt(Math.round(missed / 1e4)) + "萬", label: "年度賣出機會成本（NT$）", tone: "warn" },
      { id: "concentration", value: topPct == null ? "—" : fmt(topPct) + "%", label: concLabel, tone: "neutral" },
      { id: "withdrawal", value: flow == null ? "—" : fmt(flow) + "%", label: "下跌後出金比例", tone: "good" },
    ];
  }

  /* 兩句 insight。缺欄位就少一句，不編。
   *
   * 措辭刻意描述「行為」而不是「你是哪種人」：home-core.js 的
   * MM_HOME_PROHIBITED_NARRATIVE 禁止「FOMO」「恐慌型」「衝動型」這類標籤，
   * 上游是 product.md 紅線 4——出金只有 14.2% 發生在下跌後，就不能說人家恐慌出金。
   * index.html 的舊措辭（「典型的 FOMO 模式」「不是恐慌型」）會被那份清單擋下來，
   * 這裡改成講數字本身，結論一樣強但不替使用者貼標籤。 */
  function insights(report) {
    var out = [];
    var ci = report && report.chase_index;
    var cf = report && report.cash_flow_behavior;
    var chase = ci && isNum(ci.buy_above_ma_pct);
    var total = ci && isNum(ci.buy_total);
    if (chase != null && total != null) {
      out.push({
        tone: "risk",
        text: "你 " + fmt(total) + " 筆買入中有 " + fmt(chase)
          + "% 買在近 7 筆均價上方。麥麥會在你下次買在相對高點前先提醒你。",
      });
    }
    var flow = cf && isNum(cf.withdrawals_after_7d_btc_drop_pct);
    var count = cf && isNum(cf.twd_withdrawal_count);
    if (flow != null && count != null) {
      out.push({
        tone: "good",
        text: "你 " + fmt(count) + " 筆提領只有 " + fmt(flow)
          + "% 發生在下跌之後——出金時機和市場下跌沒有明顯連動。",
      });
    }
    return out;
  }

  /* holdings_snapshot → 持倉權重。
   *
   * 權重用 value_twd 算而不是直接吃 pct：報告的 pct 只有一位小數，七個幣種各自
   * 進位之後總和不保證是 100（這份剛好是，換一份就未必），而 PortfolioAdapter 有
   * 「總和必須 ≈1」的斷言，踩到會讓整個首頁掉進錯誤畫面。用金額算就沒有這個問題，
   * pct 只在沒有金額時當後備。
   *
   * 回傳形狀刻意對齊 MM_ONBOARDING_MOCK.demoPortfolio，讓 Adapter 兩種來源共用同一段
   * 下游邏輯——不要為了真資料另開一條分支，那是 bug 的溫床。 */
  function holdings(report) {
    var snap = report && report.holdings_snapshot;
    var rows = snap && Array.isArray(snap.holdings) ? snap.holdings : null;
    if (!rows || rows.length === 0) return { ok: false, reason: "NO_HOLDINGS" };

    var parsed = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var code = r && typeof r.currency === "string" ? r.currency.toLowerCase() : "";
      if (!code) return { ok: false, reason: "BAD_HOLDING" };
      var value = isNum(r.value_twd);
      var pct = isNum(r.pct);
      if (value == null && pct == null) return { ok: false, reason: "BAD_HOLDING" };
      parsed.push({ code: code, value: value, pct: pct });
    }

    var totalValue = 0;
    var haveAllValues = true;
    for (var j = 0; j < parsed.length; j++) {
      if (parsed[j].value == null) { haveAllValues = false; break; }
      totalValue += parsed[j].value;
    }
    var useValue = haveAllValues && totalValue > 0;

    var assets = parsed.map(function (p) {
      var isCash = p.code === "twd";
      return {
        symbol: p.code.toUpperCase(),
        /* 「現金（TWD）」而不是光一個「TWD」——98.6% 是資金停在現金（保守），
           不標清楚會被讀成危險的加密資產過度集中，意思正好相反。 */
        label: isCash ? "現金（TWD）" : p.code.toUpperCase(),
        isCash: isCash,
        weight: useValue ? p.value / totalValue : (p.pct || 0) / 100,
        valueTwd: p.value,
      };
    }).sort(function (a, b) { return b.weight - a.weight; });

    return {
      ok: true,
      assets: assets,
      /* holdings_snapshot 本身就是各幣種明細，所以這份來源一定有細分。 */
      breakdownAvailable: true,
      snapshotAsOf: typeof snap.asOf === "string" ? snap.asOf : null,
      snapshotMethod: typeof snap.method === "string" ? snap.method : null,
      asOfMonth: typeof snap.asOf === "string" ? snap.asOf.slice(0, 7) : null,
    };
  }

  /* activity_profile ＋ chase_index → 交易節奏。
   * 形狀對齊 MM_ONBOARDING_MOCK.tradeActivity，Adapter 兩種來源共用下游。
   *
   * 月份一律用鍵值排序取最後兩個，不假設報告的鍵是照時間排的——JSON 物件的鍵序
   * 在規格上不保證，靠它取「最近一個月」是會突然壞掉而且很難查的那種錯。 */
  function activity(report) {
    var ap = report && report.activity_profile;
    var perMonth = ap && ap.trades_per_month;
    if (!perMonth || typeof perMonth !== "object") return { ok: false, reason: "NO_ACTIVITY" };
    var months = Object.keys(perMonth).filter(function (m) {
      return isNum(perMonth[m]) != null;
    }).sort();
    if (months.length === 0) return { ok: false, reason: "NO_MONTHS" };

    var counts = months.map(function (m) { return Number(perMonth[m]); });
    var sum = counts.reduce(function (a, b) { return a + b; }, 0);
    var ci = report.chase_index || {};
    var buy = isNum(ci.buy_total);
    var sell = isNum(ci.sell_total);
    var busiest = ap.busiest_month && typeof ap.busiest_month === "object"
      ? ap.busiest_month.month
      : null;

    return {
      ok: true,
      /* 總筆數用買＋賣，不用 action_counts 的總和——後者含 deposit／withdrawal，
         那是出入金不是交易，混進來會讓「你今年交易了幾筆」多算一倍。 */
      total: buy != null && sell != null ? buy + sell : sum,
      buyTotal: buy,
      sellTotal: sell,
      perMonth: Object.assign({}, perMonth),
      latestMonth: months[months.length - 1],
      previousMonth: months.length > 1 ? months[months.length - 2] : null,
      latestMonthCount: counts[counts.length - 1],
      previousMonthCount: months.length > 1 ? counts[counts.length - 2] : 0,
      averagePerMonth: Math.round(sum / months.length),
      byCurrency: Object.assign({}, ap.trades_by_currency || {}),
      busiestMonth: typeof busiest === "string" ? busiest : null,
      periodEnd: (report.period && report.period.end) || null,
      detailAvailable: false,   // 逐筆明細永遠不會有：官方 CSV 不進 git
    };
  }

  /* change_attribution → 帳戶變化歸因。contributors 的 pct 是百分數，下游要的是比例。 */
  function attribution(report) {
    var ca = report && report.change_attribution;
    var rows = ca && Array.isArray(ca.contributors) ? ca.contributors : null;
    if (!rows || rows.length === 0) return { ok: false, reason: "NO_ATTRIBUTION" };
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var pct = isNum(r && r.pct);
      if (!r || typeof r.category !== "string" || pct == null) {
        return { ok: false, reason: "BAD_CONTRIBUTOR" };
      }
      items.push({ category: r.category, ratio: pct / 100, valueTwd: isNum(r.value_twd) });
    }
    return {
      ok: true,
      period: typeof ca.period === "string" ? ca.period : null,
      /* estimated＝殘差法推估（Δ市值−出入金淨額→市價波動）。畫面要標示得出來，
         不能讓推估值看起來和實際結算一樣可靠。 */
      estimated: ca.type !== "calculated",
      deltaTwd: isNum(ca.delta_twd),
      note: typeof ca.note === "string" ? ca.note : "",
      contributors: items,
    };
  }

  /* concentration.monthly_top_holding → 逐月最大持有與組合市值（相似時刻／年度報酬都會用）。 */
  function monthlyConcentration(report) {
    var src = report && report.concentration && report.concentration.monthly_top_holding;
    if (!src || typeof src !== "object") return { ok: false, reason: "NO_MONTHLY" };
    var months = Object.keys(src).sort();
    if (months.length === 0) return { ok: false, reason: "NO_MONTHLY" };
    var rows = [];
    for (var i = 0; i < months.length; i++) {
      var v = src[months[i]] || {};
      rows.push({
        month: months[i],
        topCurrency: typeof v.top_currency === "string" ? v.top_currency.toLowerCase() : null,
        topRatio: isNum(v.top_pct) == null ? null : isNum(v.top_pct) / 100,
        portfolioTwd: isNum(v.portfolio_twd),
      });
    }
    return { ok: true, months: rows };
  }

  var api = {
    score: score, realized: realized, cards: cards, insights: insights,
    holdings: holdings, activity: activity, attribution: attribution,
    monthlyConcentration: monthlyConcentration, fmt: fmt,
  };
  if (typeof window !== "undefined") window.MM_HEALTH_CORE = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
