/* Screen 8｜深入了解：Service 層（組裝 InsightDetail、護欄、最後保存結果）
 * 架構：UI → MaiMateInsightService →（資料層＝Screen 6 既有 Adapter／window.MM_ACCOUNT）→ InsightDetail
 * 天條：
 *   - 每一個顯示出來的數字都必須在 evidence 裡查得到來源；查不到就不出（走安全模板）
 *   - 報告沒有的資料一律 insufficientData，不畫圖表、不給估算值
 *   - 現金占比高＝資金主要停在現金，不得寫成持倉集中
 *   - 百分比與百分點分開：98.5% → 98.6% 是「提高 0.1 個百分點」
 *   - 名詞解釋沿用 window.MM_CHAT_MOCK.knowledgeBase，不複製第二份教材
 */
"use strict";

(function initInsightService() {
  const CORE = window.MM_INSIGHTS_CORE;
  const CHAT_MOCK = window.MM_CHAT_MOCK;
  const LAST_KNOWN_PREFIX = "mm_insight_last_";

  const adapters = () => window.MM_HOME_SERVICES.adapters;
  const readState = () => OnboardingStore.read();
  const account = () => window.MM_ACCOUNT;

  /* 占比一律一位小數（報告寫 98.6%，不得四捨五入成 99%）；整數不補 .0。 */
  function pct(ratio) {
    const value = Math.round(Number(ratio) * 1000) / 10;
    return (Number.isInteger(value) ? value : value.toFixed(1)) + "%";
  }
  /* 百分點：兩個百分比相減的單位是「個百分點」，不是「%」。 */
  function pointDelta(currentRatio, previousRatio) {
    return Math.round((Number(currentRatio) - Number(previousRatio)) * 1000) / 10;
  }
  const count = (value) => Number(value).toLocaleString("en-US") + " 筆";
  /* 金額一律取整數元並加千分位；報告給的就是整數，前端不做任何四捨五入以外的加工。 */
  const money = (value) => "NT$" + Math.round(Number(value)).toLocaleString("en-US");
  const section = (id, type, payload) => ({ id, type, payload });
  const ev = (id, label, value, sourceLabel, updatedAt) =>
    ({ id, label, value: String(value), sourceLabel, updatedAt });

  const generatedAt = () => (account() && account().generatedAt) || "";
  const periodLabel = () => {
    const period = account() && account().period;
    return period ? period.start + " ～ " + period.end : "";
  };

  /* ── 只用來對照「文字裡的數字有沒有來源」的取文字函式 ──
   * 圖表序列與指標列同樣納入檢查：畫面上出現的每個數字都要指得出來源。 */
  function collectProse(detail) {
    const parts = [];
    const push = (value) => { if (typeof value === "string" && value) parts.push(value); };
    push(detail.hero && detail.hero.conclusion);
    if (detail.hero && detail.hero.primaryMetric) {
      push(detail.hero.primaryMetric.value);
      push(detail.hero.primaryMetric.note);
    }
    (detail.whyItMatters && detail.whyItMatters.paragraphs || []).forEach(push);
    (detail.simpleExplanation && detail.simpleExplanation.paragraphs || []).forEach(push);
    (detail.limitations || []).forEach((item) => push(item.text));
    (detail.sections || []).forEach((item) => {
      const payload = item.payload || {};
      push(payload.summary);
      (payload.paragraphs || []).forEach(push);
      push(payload.reason);
      (payload.missing || []).forEach(push);
      (payload.items || []).forEach((row) => {
        if (typeof row === "string") return push(row);
        push(row.value);
        push(row.valueText);
        push(row.note);
      });
      push(payload.averageText);
      push(payload.example);
    });
    return parts.join("\n");
  }

  /* 護欄：禁語掃描（整個物件）＋數字一致性。任一不過就不回傳原內容。 */
  function guardDetail(detail) {
    const forbidden = CORE.scanForbidden(detail);
    if (!forbidden.ok) return { ok: false, guard: forbidden.category };
    const numbers = CORE.validateNumberConsistency(collectProse(detail), detail.evidence);
    if (!numbers.ok) return { ok: false, guard: "numberConsistency", missing: numbers.missing };
    return { ok: true };
  }

  function blockedDetail(id, guard) {
    return finalize({
      id,
      kind: CORE.insightKind(id) || "personal",
      title: "這一頁暫時沒辦法顯示",
      question: "這一頁暫時沒辦法顯示",
      source: ev("src_blocked", "資料來源", "內容檢查未通過", "MaiMate"),
      hero: { conclusion: "這份內容沒有通過麥麥的內容檢查，所以先不顯示它。" },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: ["麥麥寧可少說，也不會顯示對不上來源的數字。你可以先回到對話問麥麥，或看看其他洞察。"],
      },
      sections: [section("sec_blocked", "insufficientData", {
        title: "這一頁暫時沒辦法顯示",
        reason: "內容檢查沒有通過，麥麥不顯示未經核對的內容。",
        missing: ["通過核對的內容"],
        alternatives: [{ id: "chat", label: "回到對話問麥麥", type: "chat" }],
      })],
      simpleExplanation: { title: "用簡單一點的方式說", paragraphs: ["這一頁的內容沒有通過檢查，所以先不顯示。"] },
      evidence: [],
      limitations: [{ id: "lim_blocked", text: "內容檢查未通過的項目不會顯示。" }],
      relatedTerms: [],
      suggestedQuestions: [],
      dataStatus: "insufficient",
      guard,
    });
  }

  function finalize(detail) {
    const result = Object.assign({}, detail);
    result.sections = CORE.validateSections(detail.sections);
    result.actions = detail.actions || [
      { id: "back_to_chat", label: "回到對話繼續問", type: "chat" },
      { id: "back_to_home", label: "回首頁", type: "home" },
    ];
    return result;
  }

  /* ── 「用簡單一點的方式說」：依溝通風格調整深度，數字與結論完全不變 ──
   * 數字只放在 core 這一段，換風格時不會有任何數字被改寫或消失。 */
  function simpleParagraphs(simple, style) {
    const paragraphs = [simple.core];
    if (style === "concise") return paragraphs;
    if (style === "analytical") {
      if (simple.detail) paragraphs.push(simple.detail);
      return paragraphs;
    }
    if (simple.analogy) paragraphs.push(simple.analogy);
    return paragraphs;
  }

  function currentStyle() {
    try {
      const resolved = window.MM_HOME_SERVICES.currentStyle();
      const style = resolved && resolved.style;
      return ["guided", "concise", "analytical"].includes(style) ? style : "guided";
    } catch (_) { return "guided"; }
  }

  /* ── 最後保存結果（授權撤回後只顯示這份，並標示已停止更新）── */
  function saveLastKnown(id, detail) {
    try {
      sessionStorage.setItem(LAST_KNOWN_PREFIX + id, JSON.stringify({ savedAt: Date.now(), detail }));
    } catch (_) {}
  }
  function readLastKnown(id) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(LAST_KNOWN_PREFIX + id) || "null");
      return parsed && parsed.detail ? parsed.detail : null;
    } catch (_) { return null; }
  }

  /* ── 相關名詞（可互相跳）── */
  const TERM_TITLES = {
    "cash-concentration": ["你的資金目前放在哪裡？", "看目前資金分布在現金與其他資產的比例。"],
    "trading-rhythm": ["你的交易節奏是什麼樣子？", "用每月買賣筆數看整段期間的節奏。"],
    "notable-sell": ["2025 年 1 月那筆賣出，後來怎麼了？", "報告裡唯一有明細的一筆交易回顧。"],
    "plan-alignment": ["最近的我，還沿著原本方向嗎？", "把問卷寫的方向和可確認的行為擺在一起看。"],
    /* 兩則摘要依報告有沒有補上聚合值切換（issue #29）；沒有就照實說資料不足。 */
    "account-change": ["今天的帳戶變化從哪裡來？",
      account() && account().changeAttribution
        ? "把帳戶變化拆成市價波動與資金搬移兩個來源。"
        : "目前資料不足以拆解，麥麥說明缺什麼。"],
    "holding-pattern": ["你通常持有多久？",
      account() && account().holdingPeriodDistribution
        ? "把每一筆賣出配回買入，看持有天數落在哪些區間。"
        : "目前沒有逐筆紀錄可以配對，資料不足。"],
    "concentration-basics": ["什麼是資產集中", "資金偏向少數幾種資產時會怎麼樣。"],
    "market-depth": ["什麼是市場深度", "掛單多寡怎麼影響成交價格。"],
    "order-types": ["市價單和限價單的差別", "成交速度與成交價格之間的取捨。"],
    "weight-volatility": ["持倉比例為什麼影響帳戶波動", "加權計算的性質，和資產好壞無關。"],
    "fee-basics": ["掛單與吃單手續費", "maker 與 taker 的費率差別。"],
  };

  function relatedTerms(ids) {
    return ids.filter((id) => TERM_TITLES[id]).slice(0, 4).map((id) => ({
      id: "term_" + id,
      insightId: id,
      title: TERM_TITLES[id][0],
      summary: TERM_TITLES[id][1],
    }));
  }

  /* ── 資料不足的共用組裝（絕不附任何圖表區塊）── */
  function buildInsufficient(config) {
    return finalize({
      id: config.id,
      kind: "personal",
      title: config.title,
      question: config.title,
      source: config.source,
      hero: { conclusion: config.conclusion },
      whyItMatters: { title: "為什麼這和你有關", paragraphs: config.whyItMatters },
      sections: [
        section("sec_" + config.id + "_gap", "insufficientData", {
          title: config.title,
          reason: config.reason,
          missing: config.missing,
          requestNote: "已在 issue #29 向後端請求補齊這些聚合值，資料到位後這一頁會自動顯示，不需要改程式。",
          alternatives: config.alternatives,
        }),
        section("sec_" + config.id + "_have", "metricList", {
          title: "目前確定有的資料",
          items: config.have,
        }),
        section("sec_" + config.id + "_limit", "limitationList", {
          title: "這份分析有哪些限制",
          items: config.limitations,
        }),
      ],
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs(config.simple, currentStyle()),
      },
      evidence: config.evidence,
      limitations: config.limitations.map((text, index) => ({ id: "lim_" + index, text })),
      relatedTerms: relatedTerms(config.relatedTerms),
      suggestedQuestions: config.suggestedQuestions,
      dataStatus: "insufficient",
    });
  }

  /* ── 1. 你的資金目前放在哪裡？ ── */
  function buildCashConcentration() {
    const portfolio = adapters().portfolio.read(readState());
    if (!portfolio.available) return null;
    /* 報告補上各幣種快照（issue #29）後走 detailed：每一種都畫得出來；
     * 沒有快照時退回「最大持有＋其餘合計」兩塊，其餘那塊不得再往下拆。 */
    const detailed = Boolean(portfolio.breakdownAvailable) && portfolio.assets.length > 1;
    const rest = portfolio.assets.slice(1);
    const other = portfolio.assets[1] || null;
    const topLabel = portfolio.topAssetLabel;
    const topPct = pct(portfolio.topAssetRatio);
    const restRatio = detailed
      ? rest.reduce((sum, asset) => sum + asset.weight, 0)
      : other ? other.weight : 1 - portfolio.topAssetRatio;
    const otherPct = pct(restRatio);
    const otherLabel = detailed ? "其餘 " + rest.length + " 種資產合計" : other ? other.label : "其他資產（未細分）";
    const hasPrevious = Number.isFinite(Number(portfolio.previousTopAssetRatio)) &&
      Boolean(portfolio.previousAsOfMonth);
    const prevPct = hasPrevious ? pct(portfolio.previousTopAssetRatio) : null;
    const delta = hasPrevious ? pointDelta(portfolio.topAssetRatio, portfolio.previousTopAssetRatio) : null;
    const deltaText = !hasPrevious ? null
      : delta > 0 ? "提高 " + Math.abs(delta) + " 個百分點"
        : delta < 0 ? "下降 " + Math.abs(delta) + " 個百分點"
          : "沒有變化";

    const evidence = [
      ev("ev_top", topLabel + " 占比（" + portfolio.asOfMonth + "）", topPct, "持倉摘要", generatedAt()),
      ev("ev_other", otherLabel + " 占比（" + portfolio.asOfMonth + "）", otherPct, "持倉摘要", generatedAt()),
      ev("ev_period", "資料期間", periodLabel(), "帳戶健檢報告", generatedAt()),
    ];
    if (detailed) {
      /* 圖上每一條的占比都會出現在畫面文字裡，逐項列進 evidence，
       * 否則數字一致性護欄會判定「有數字沒來源」而整頁擋掉。 */
      evidence.splice(2, 0, ev("ev_count", "持有項數（" + portfolio.asOfMonth + "）",
        portfolio.assets.length + " 種（其餘 " + rest.length + " 種合計 " + otherPct + "）",
        "持倉摘要", generatedAt()));
      rest.forEach((asset, index) => {
        evidence.splice(3 + index, 0, ev("ev_asset_" + index, asset.label + " 占比（" + portfolio.asOfMonth + "）",
          pct(asset.weight), "持倉摘要", generatedAt()));
      });
    }
    if (hasPrevious) {
      evidence.splice(2, 0, ev("ev_prev", "前期快照（" + portfolio.previousAsOfMonth + "）最大持有占比",
        prevPct, "持倉摘要", generatedAt()));
    }

    const sections = [
      section("sec_cash_alloc", "allocationBar", {
        title: "你的資金分成哪幾塊？",
        summary: "以 " + portfolio.asOfMonth + " 的快照為準；橫條長度就是占比。",
        items: detailed
          ? portfolio.assets.map((asset) => ({
              label: asset.label,
              pct: Math.round(asset.weight * 1000) / 10,
              valueText: pct(asset.weight),
            }))
          : [
              { label: topLabel, pct: Math.round(portfolio.topAssetRatio * 1000) / 10, valueText: topPct },
              { label: otherLabel, pct: Math.round(restRatio * 1000) / 10, valueText: otherPct },
            ],
      }),
    ];
    if (hasPrevious) {
      sections.push(section("sec_cash_change", "comparison", {
        title: "和前期快照的對照",
        items: [
          { label: portfolio.previousAsOfMonth, value: prevPct },
          { label: portfolio.asOfMonth, value: topPct },
          { label: "變化", value: deltaText, note: "百分比之間的差距，單位是百分點。" },
        ],
      }));
    }
    const limitations = detailed
      ? [
          "占比以「" + (portfolio.snapshotMethod || "各幣最後成交價估值") + "」計算，是估值不是結算金額，和交易所頁面可能有小幅出入。",
          "這是 " + (portfolio.snapshotAsOf || portfolio.asOfMonth) + " 當下的快照，不代表整個期間都是這個分布。",
          "占比是資金分布的描述，不是投資能力、風險等級或健康分數。",
        ]
      : [
          "這份報告只有每月最大持有標的與占比，沒有各幣種持倉比例，所以其餘 " + otherPct + " 沒辦法再往下拆。",
          "已在 issue #29 向後端請求各幣種持倉比例，補齊後這一頁會自動顯示。",
          "占比是資金分布的描述，不是投資能力、風險等級或健康分數。",
        ];
    sections.push(section("sec_cash_limit", "limitationList", {
      title: "這份分析有哪些限制",
      items: limitations,
    }));

    return finalize({
      id: "cash-concentration",
      kind: "personal",
      title: "你的資金目前放在哪裡？",
      question: "你的資金目前放在哪裡？",
      source: ev("src_cash", "資料來源", "你的帳戶健檢報告（" + portfolio.asOfMonth + " 快照）", "持倉摘要", generatedAt()),
      hero: {
        conclusion: "你的資金主要停在" + topLabel + "，約占 " + topPct + "。",
        primaryMetric: {
          label: "最大持有（" + portfolio.asOfMonth + "）",
          value: topPct,
          note: topLabel,
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "帳戶整體的變化，是各項資產的漲跌依占比加權後的結果。資金多在" + topLabel +
            "時，加密資產的漲跌帶動整體帳戶的幅度就比較小。",
          "這是「資金停在哪裡」的描述，不是把資金押在某一種加密資產上，兩者的意思剛好相反。",
          "它也不代表這樣做比較好或比較差——重點是這個分布是不是你原本想要的。",
        ],
      },
      sections,
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: detailed
            ? "你手上的錢，大約 " + topPct + " 是" + topLabel + "，剩下 " + otherPct + " 分散在另外 " + rest.length + " 種資產。"
            : "你手上的錢，大約 " + topPct + " 是" + topLabel + "，剩下 " + otherPct + " 是其他資產（報告沒有再細分）。",
          analogy: "可以把帳戶想成一個籃子：現在籃子裡大部分是還沒放進市場的資金，所以市場搖晃時，整個籃子跟著搖的幅度比較小。",
          detail: detailed
            ? "計算方式是把每一種資產的市值除以帳戶總值；市值採「" + (portfolio.snapshotMethod || "各幣最後成交價估值") + "」，所以是估值而不是結算金額。"
            : "計算方式是把該月最大持有標的的市值除以帳戶總值；其餘部位在報告裡沒有再細分到各幣種，所以只能以合計呈現。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_cash_" + index, text })),
      relatedTerms: relatedTerms(["concentration-basics", "weight-volatility", "account-change"]),
      suggestedQuestions: [
        { id: "q_portfolio_impact", text: "目前的資金分布對我的帳戶有什麼影響？" },
        { id: "q_concentration_basics", text: "什麼是資產集中？" },
        { id: "q_allocation_change", text: "我的資金分布最近有變嗎？" },
      ],
      dataStatus: "available",
    });
  }

  /* ── 2. 你的交易節奏是什麼樣子？ ── */
  function buildTradingRhythm() {
    const market = adapters().market.read();
    const tx = adapters().transactions.read(readState(), market.observedAt);
    if (!tx.available || !tx.perMonth) return null;
    const months = Object.keys(tx.perMonth).sort();
    if (!months.length) return null;
    const average = Number(tx.averagePerMonth);
    const busiest = tx.busiestMonth || null;
    const recentText = count(tx.recent30Count);
    const previousText = count(tx.previous30Count);
    const averageText = average + " 筆";
    const totalText = count(tx.count);

    const seriesText = months.map((month) => month + " " + count(tx.perMonth[month])).join("、");
    const byCurrency = tx.byCurrency || {};
    const currencyRows = Object.keys(byCurrency)
      .sort((a, b) => Number(byCurrency[b]) - Number(byCurrency[a]))
      .map((key) => ({ label: key.toUpperCase(), value: count(byCurrency[key]) }));
    const currencyText = currencyRows.map((row) => row.label + " " + row.value).join("、");

    const evidence = [
      ev("ev_recent", "最近一個月（" + tx.recentPeriodLabel + "）買賣", recentText, "交易紀錄", generatedAt()),
      ev("ev_prev", "前一個月（" + tx.previousPeriodLabel + "）買賣", previousText, "交易紀錄", generatedAt()),
      ev("ev_avg", "期間平均每月", averageText, "交易紀錄", generatedAt()),
      ev("ev_total", "期間買賣總筆數", totalText, "交易紀錄", generatedAt()),
      ev("ev_buy_sell", "買入／賣出筆數", count(tx.buyTotal) + "／" + count(tx.sellTotal), "交易紀錄", generatedAt()),
      ev("ev_series", "每月買賣筆數（" + months[0] + " ～ " + months[months.length - 1] + "）", seriesText, "交易紀錄", generatedAt()),
    ];
    if (busiest) {
      evidence.push(ev("ev_busiest", "最忙的一個月（" + busiest.month + "）", count(busiest.trades), "交易紀錄", generatedAt()));
    }
    if (currencyText) {
      evidence.push(ev("ev_currency", "各幣種交易次數（不是持倉比例）", currencyText, "交易紀錄", generatedAt()));
    }

    const faster = Number(tx.recent30Count) > Number(tx.previous30Count);
    const sections = [
      section("sec_rhythm_timeline", "rhythmTimeline", {
        title: "最近的交易節奏有比平常快嗎？",
        summary: "每一根柱子是一個月的買賣筆數，橫線是期間平均 " + averageText + "。",
        unitLabel: "筆",
        averageValue: average,
        averageText,
        items: months.map((month) => ({
          label: month,
          value: Number(tx.perMonth[month]),
          valueText: count(tx.perMonth[month]),
          isLatest: month === tx.recentPeriodLabel,
          isBusiest: Boolean(busiest && month === busiest.month),
        })),
      }),
      section("sec_rhythm_compare", "comparison", {
        title: "最近兩個月和期間平均",
        items: [
          { label: "最近一個月（" + tx.recentPeriodLabel + "）", value: recentText },
          { label: "前一個月（" + tx.previousPeriodLabel + "）", value: previousText },
          { label: "期間平均每月", value: averageText },
        ],
      }),
      section("sec_rhythm_total", "metricList", {
        title: "整段期間的總覽",
        items: [
          { label: "買賣總筆數", value: totalText },
          { label: "買入", value: count(tx.buyTotal) },
          { label: "賣出", value: count(tx.sellTotal) },
        ].concat(busiest ? [{ label: "最忙的一個月（" + busiest.month + "）", value: count(busiest.trades) }] : []),
      }),
    ];
    if (currencyRows.length) {
      sections.push(section("sec_rhythm_currency", "metricList", {
        title: "各幣種的交易次數（這是交易次數，不是持倉比例）",
        items: currencyRows,
      }));
    }
    const limitations = [
      "這份報告只有每月買賣筆數，沒有逐筆交易時間，所以看不出交易日分布，也算不出單日次數。",
      "「各幣種交易次數」指的是在哪些幣種上下過幾次單，和你目前持有多少完全是兩回事。",
      "筆數多寡只描述行為頻率，不代表操作品質，也不是能力評分。",
    ];
    sections.push(section("sec_rhythm_limit", "limitationList", {
      title: "這份分析有哪些限制",
      items: limitations,
    }));

    return finalize({
      id: "trading-rhythm",
      kind: "personal",
      title: "你的交易節奏是什麼樣子？",
      question: "你的交易節奏是什麼樣子？",
      source: ev("src_rhythm", "資料來源", "你的帳戶健檢報告（" + periodLabel() + "）", "交易紀錄", generatedAt()),
      hero: {
        conclusion: "這段期間你平均每月約 " + averageText + "；最近一個月（" + tx.recentPeriodLabel + "）是 " +
          recentText + "，" + (faster ? "比" : "比") + "前一個月（" + tx.previousPeriodLabel + "）的 " +
          previousText + (faster ? " 多一些。" : " 少一些。"),
        primaryMetric: {
          label: "期間平均每月",
          value: averageText,
          note: periodLabel(),
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "節奏是少數幾個「只看你自己的紀錄就能確認」的東西，不需要預測市場也能看懂。",
          "把最近一個月放回整段期間裡看，比單看一個月更能判斷這是常態還是變化。",
          "麥麥只描述次數的多寡，不從次數推測你的心情、動機或個性。",
        ],
      },
      sections,
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: "整段期間你平均每月約 " + averageText + "，最近一個月是 " + recentText +
            "，前一個月是 " + previousText + "。",
          analogy: "可以把它當成走路的步頻：重點不是快或慢，而是最近這一段和你平常的步頻差多少。",
          detail: "平均值是用期間買賣總筆數除以月份數；因為報告只有每月聚合，所以比較單位一律是「月」，不能換算成每日或滾動區間。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_rhythm_" + index, text })),
      relatedTerms: relatedTerms(["order-types", "fee-basics", "plan-alignment", "holding-pattern"]),
      suggestedQuestions: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_plan_alignment", text: "我的實際做法和原本的方向一致嗎？" },
      ],
      dataStatus: "available",
    });
  }

  /* ── 3. 2025 年 1 月那筆賣出，後來怎麼了？ ── */
  function buildNotableSell() {
    const market = adapters().market.read();
    const tx = adapters().transactions.read(readState(), market.observedAt);
    const moment = adapters().similarMoment.read(tx);
    if (!moment || !moment.sourceEvent || !moment.sourceEvent.missedText) return null;
    const source = moment.sourceEvent;
    const worst = (account().opportunityCost && account().opportunityCost.worstSell) || {};
    const sellDate = String(worst.date || "");
    const quantity = Number.isFinite(Number(worst.qty)) ? Number(worst.qty).toLocaleString("en-US", { maximumFractionDigits: 6 }) : null;

    const evidence = [
      ev("ev_sell_date", "賣出日期", sellDate, "交易紀錄（報告明細）", generatedAt()),
      ev("ev_sell_price", "賣出價", String(source.sellPrice), "交易紀錄（報告明細）", generatedAt()),
      ev("ev_eoy_price", "年末價格", String(source.endOfYearPrice), "交易紀錄（報告明細）", generatedAt()),
      ev("ev_missed", "這筆賣出的機會成本", source.missedText, "帳戶健檢報告", generatedAt()),
    ];
    if (source.priceChangeText) {
      evidence.push(ev("ev_price_change", "賣出價到年末價格的變化", source.priceChangeText, "帳戶健檢報告", generatedAt()));
    }
    if (quantity) {
      evidence.push(ev("ev_qty", "賣出數量", quantity + " " + source.symbol, "交易紀錄（報告明細）", generatedAt()));
    }

    const compareItems = [
      { label: "賣出日期", value: sellDate },
      { label: "賣出價", value: String(source.sellPrice) },
      { label: "年末價格", value: String(source.endOfYearPrice) },
    ];
    if (source.priceChangeText) {
      compareItems.push({ label: "賣出價到年末價格的變化", value: source.priceChangeText });
    }
    compareItems.push({ label: "這筆賣出的機會成本", value: source.missedText, note: "以年末價格回推的差額" });

    const limitations = [
      "這是報告裡唯一附有明細的一筆交易；其他交易只有每月聚合筆數，沒辦法逐筆回顧。",
      "機會成本是拿年末價格回推的差額，不是實際虧損，也不代表其他時點的價格。",
      "年末價格是事後才知道的資訊，當時做決定時看不到。",
    ];

    return finalize({
      id: "notable-sell",
      kind: "personal",
      title: "2025 年 1 月那筆賣出，後來怎麼了？",
      question: "2025 年 1 月那筆賣出，後來怎麼了？",
      source: ev("src_sell", "資料來源", "你的帳戶健檢報告（唯一附明細的一筆交易）", "交易紀錄", generatedAt()),
      hero: {
        conclusion: source.periodLabel + "你賣出了 " + source.symbol + "，成交價 " + source.sellPrice +
          "；到年末價格為 " + source.endOfYearPrice + "，這筆賣出的機會成本約 " + source.missedText + "。",
        primaryMetric: {
          label: "這筆賣出的機會成本",
          value: source.missedText,
          note: "以年末價格回推",
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "這是整份報告裡唯一能看到日期、數量與價格的一筆交易，所以它是唯一能被具體回顧的紀錄。",
          "回顧的目的是讓你看到資料本身，而不是評價當時的決定。",
        ],
      },
      sections: [
        section("sec_sell_compare", "comparison", {
          title: "那一筆賣出，後來怎麼了",
          items: compareItems,
        }),
        section("sec_sell_note", "text", {
          title: "先把話說清楚",
          paragraphs: [
            "這是事後回顧。年末的價格是後來才知道的，當時做決定的你看不到它。",
            "麥麥列出這筆紀錄，不是說當時的決定有對錯，也不是任何買賣建議；麥麥不會告訴你未來要怎麼做。",
          ],
        }),
        section("sec_sell_limit", "limitationList", {
          title: "這份分析有哪些限制",
          items: limitations,
        }),
      ],
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: "你在 " + sellDate + " 用 " + source.sellPrice + " 賣出 " + source.symbol +
            "，年末的價格是 " + source.endOfYearPrice + "，差額大約是 " + source.missedText + "。",
          analogy: "這就像事後翻照片：看得到後來發生什麼，但拍照的當下並不知道。",
          detail: "機會成本＝（年末價格－賣出價）×賣出數量，換算為新臺幣。它衡量的是「若沒賣出會如何」，不是帳上實際發生的損益。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_sell_" + index, text })),
      relatedTerms: relatedTerms(["order-types", "market-depth", "trading-rhythm"]),
      suggestedQuestions: [
        { id: "q_notable_sell", text: "那筆賣出當時發生什麼事？" },
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
      ],
      dataStatus: "available",
    });
  }

  /* ── 4. 最近的我，還沿著原本方向嗎？ ──
   * 狀態只用四個字面值：大致一致／有部分不同／明顯不同／資料不足。
   * 不用分數，也不用「一致度 XX%」——那會變成能力評分。 */
  function buildPlanAlignment() {
    const profile = adapters().effectiveProfile.read(readState(), false);
    const market = adapters().market.read();
    const tx = adapters().transactions.read(readState(), market.observedAt);
    const portfolio = adapters().portfolio.read(readState());
    if (!profile) return null;
    const plans = (profile.originalPlanItems || [])
      .map((item) => (typeof item === "string" ? item : String((item && item.label) || "")))
      .filter(Boolean);
    const hasPlan = plans.length > 0;
    const hasTrades = Boolean(tx.available) && Number.isFinite(Number(tx.averagePerMonth)) &&
      Number(tx.averagePerMonth) > 0;

    const recentText = hasTrades ? count(tx.recent30Count) : null;
    const averageText = hasTrades ? tx.averagePerMonth + " 筆" : null;
    /* 唯一機械化的對照：最近一個月的筆數和期間平均差距在一成以內就算相近。 */
    const withinRange = hasTrades &&
      Math.abs(Number(tx.recent30Count) - Number(tx.averagePerMonth)) <= Number(tx.averagePerMonth) / 10;
    const comparableCount = (hasPlan && hasTrades) ? 1 : 0;
    const gaps = comparableCount === 0 ? 0 : (withinRange ? 0 : 1);
    const status = comparableCount === 0
      ? "資料不足"
      : gaps === 0 ? "大致一致" : gaps === 1 ? "有部分不同" : "明顯不同";

    const evidence = [
      ev("ev_plan", "你原本選的方向", hasPlan ? plans.join("、") : "尚未填寫", "你的問卷回答", generatedAt()),
    ];
    if (hasTrades) {
      evidence.push(ev("ev_recent", "最近一個月（" + tx.recentPeriodLabel + "）買賣", recentText, "交易紀錄", generatedAt()));
      evidence.push(ev("ev_avg", "期間平均每月", averageText, "交易紀錄", generatedAt()));
    }
    if (portfolio.available) {
      evidence.push(ev("ev_top", portfolio.topAssetLabel + " 占比（" + portfolio.asOfMonth + "）",
        pct(portfolio.topAssetRatio), "持倉摘要", generatedAt()));
    }

    const compareItems = [
      { label: "原本的方向（問卷）", value: hasPlan ? plans.join("、") : "尚未填寫" },
    ];
    if (hasTrades) {
      compareItems.push({ label: "最近一個月（" + tx.recentPeriodLabel + "）買賣", value: recentText });
      compareItems.push({ label: "期間平均每月", value: averageText });
    }
    if (portfolio.available) {
      compareItems.push({
        label: "資金主要位置（" + portfolio.asOfMonth + "）",
        value: portfolio.topAssetLabel + " " + pct(portfolio.topAssetRatio),
      });
    }
    compareItems.push({ label: "對照結果", value: status, note: "只涵蓋下面標示「可以對照」的項目。" });

    const checklist = [
      {
        label: "交易次數",
        value: hasTrades ? "可以對照" : "無法對照",
        note: hasTrades
          ? (withinRange ? "和期間平均相近" : "和期間平均有明顯差距")
          : "沒有交易紀錄",
      },
      {
        label: "持有期間",
        value: "無法對照",
        note: "報告沒有逐筆買賣紀錄，配不出持有期間。",
      },
      {
        label: "資金主要位置",
        value: "無法對照",
        note: "問卷沒有問資金要停在哪裡，沒有可以對照的原本設定。",
      },
    ];

    const limitations = [
      "目前只有「交易次數」這一項可以對照，所以結論只涵蓋這一項。",
      "這是方向上的對照，不是投資能力、風險等級、紀律分數或健康分數。",
      "問卷寫的是偏好，帳戶紀錄是已經發生的事；兩者不同不一定代表哪一邊有問題。",
    ];

    const coreText = comparableCount === 0
      ? "目前沒有足夠的資料可以做對照，所以麥麥先不下結論。"
      : "可以對照的部分只有交易次數：最近一個月是 " + recentText + "，期間平均每月約 " + averageText +
        "，兩者" + (withinRange ? "相近" : "有明顯差距") + "，所以對照結果是「" + status + "」。";

    return finalize({
      id: "plan-alignment",
      kind: "personal",
      title: "最近的我，還沿著原本方向嗎？",
      question: "最近的我，還沿著原本方向嗎？",
      source: ev("src_plan", "資料來源", "你的問卷回答 ＋ 帳戶健檢報告", "投資樣貌", generatedAt()),
      hero: {
        conclusion: comparableCount === 0
          ? "目前可以對照的項目不夠，麥麥先不下結論。"
          : "就目前能對照的部分來看：" + status + "。",
        primaryMetric: {
          label: "對照結果",
          value: status,
          note: "只涵蓋可以對照的項目",
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "你在問卷裡寫下的是「想怎麼做」，帳戶紀錄留下的是「實際做了什麼」；把兩邊擺在一起，比只看其中一邊清楚。",
          "麥麥只做對照，不打分數、不排名，也不會說哪一種做法比較好。",
          "對照不上的項目會直接寫「無法對照」，不會用估算值把表格填滿。",
        ],
      },
      sections: [
        section("sec_plan_compare", "comparison", {
          title: "原本的方向 vs 可確認的近期行為",
          items: compareItems,
        }),
        section("sec_plan_checklist", "metricList", {
          title: "這次哪些項目可以對照",
          items: checklist,
        }),
        section("sec_plan_rule", "text", {
          title: "對照方式",
          paragraphs: [
            hasTrades
              ? "交易次數的對照方式是：把最近一個月的買賣筆數和期間平均相比，差距在一成以內就算相近。目前最近一個月是 " +
                recentText + "，期間平均每月約 " + averageText + "。"
              : "目前沒有交易紀錄可以對照，所以這一項留空。",
            "狀態只有四種寫法：大致一致、有部分不同、明顯不同、資料不足。麥麥不用百分比或分數表示一致程度，因為那會變成對你的評分。",
          ],
        }),
        section("sec_plan_limit", "limitationList", {
          title: "這份分析有哪些限制",
          items: limitations,
        }),
      ],
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: coreText,
          analogy: "就像對照旅行計畫和實際走過的路線：能對得上的路段先確認，對不上的就先標起來，不用猜。",
          detail: "可對照的項目取決於問卷題目和報告欄位是否重疊。目前重疊的只有交易頻率一項，其餘欄位在報告裡沒有對應的聚合值。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_plan_" + index, text })),
      relatedTerms: relatedTerms(["trading-rhythm", "cash-concentration", "concentration-basics"]),
      suggestedQuestions: [
        { id: "q_plan_alignment", text: "我的實際做法和原本的方向一致嗎？" },
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
      ],
      dataStatus: comparableCount === 0 ? "insufficient" : "available",
    });
  }

  /* ── 5. 今天的帳戶變化從哪裡來？（資料不足）── */
  /* 帳戶變化歸因的分類名稱：報告只用英文 key，畫面要中文，但比重與金額一字不動。 */
  const ATTRIBUTION_LABELS = Object.freeze({
    marketPrice: "市價波動",
    netDeposit: "出入金淨額",
    realizedPnl: "已實現損益",
    fee: "手續費",
  });

  /* issue #29 補上 change_attribution 後走這條；沒有就退回下面的「資料不足」版本。
   * 報告標 type=estimated（殘差法），所以全篇一律講「估算」，不得寫成會計歸因。 */
  function buildAccountChangeDetailed(attribution) {
    const contributors = attribution.contributors
      .slice()
      .sort((a, b) => Number(b.pct) - Number(a.pct))
      .map((item) => ({
        label: ATTRIBUTION_LABELS[item.category] || item.category,
        pct: Number(item.pct),
        valueTwd: Number(item.value_twd),
      }));
    const lead = contributors[0];
    const deltaTwd = Number(attribution.delta_twd);
    const rising = deltaTwd >= 0;
    const deltaText = money(Math.abs(deltaTwd));
    const estimated = attribution.type === "estimated";

    const evidence = [
      ev("ev_delta", attribution.period + " 帳戶市值變化", (rising ? "增加 " : "減少 ") + deltaText,
        "帳戶變化歸因", generatedAt()),
      ...contributors.map((item, index) => ev("ev_attr_" + index, item.label + " 貢獻",
        item.pct + "%（" + money(item.valueTwd) + "）", "帳戶變化歸因", generatedAt())),
      ev("ev_period", "資料期間", periodLabel(), "帳戶健檢報告", generatedAt()),
    ];

    const limitations = [
      estimated
        ? "這是用殘差法做的估算：先算整體市值變化，扣掉出入金淨額，剩下的才歸給市價波動。它不是會計結算，和交易所對帳單可能有出入。"
        : "歸因比重來自報告的聚合值，不是交易所的正式結算。",
      "已實現損益是另一個視角，和這裡的歸因不相加——同一筆錢不會被算兩次。",
      "這一段講的是「錢從哪裡來」，不是賺賠，也不是投資能力評價。",
    ];

    const sections = [
      section("sec_change_split", "allocationBar", {
        title: attribution.period + " 的帳戶變化，是誰造成的？",
        summary: "橫條長度就是各來源占這次變化的比重；以報告的 " + attribution.period + " 聚合值為準。",
        items: contributors.map((item) => ({
          label: item.label,
          pct: item.pct,
          valueText: item.pct + "%（" + money(item.valueTwd) + "）",
        })),
      }),
      section("sec_change_have", "metricList", {
        title: "這次變化的組成",
        items: [
          { label: attribution.period + " 市值變化", value: (rising ? "增加 " : "減少 ") + deltaText },
          ...contributors.map((item) => ({ label: item.label, value: money(item.valueTwd) })),
        ],
      }),
      section("sec_change_limit", "limitationList", {
        title: "這份分析有哪些限制",
        items: limitations,
      }),
    ];

    return finalize({
      id: "account-change",
      kind: "personal",
      title: "今天的帳戶變化從哪裡來？",
      question: "今天的帳戶變化從哪裡來？",
      source: ev("src_change", "資料來源", "你的帳戶健檢報告（" + attribution.period + " 歸因）",
        "帳戶變化歸因", generatedAt()),
      hero: {
        conclusion: attribution.period + " 帳戶市值" + (rising ? "增加" : "減少") + "約 " + deltaText +
          "，其中約 " + lead.pct + "% 來自" + lead.label + "。",
        primaryMetric: {
          label: lead.label + "占比（" + attribution.period + "）",
          value: lead.pct + "%",
          note: money(lead.valueTwd),
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "帳戶變多變少，可能是市場漲跌，也可能只是你把錢搬進搬出。這兩件事的意義完全不同，混在一起看容易誤判。",
          lead.label === "出入金淨額"
            ? "這段期間的變化主要來自資金搬移，不是市場給你的報酬——帳戶數字變大不代表投資成果變好。"
            : "這段期間的變化主要來自市場價格的漲跌，而不是你搬動資金造成的。",
          "把來源拆開，你才看得出哪一部分是自己的決定、哪一部分只是市場。",
        ],
      },
      sections,
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: attribution.period + " 你的帳戶" + (rising ? "多了" : "少了") + "約 " + deltaText +
            "，其中約 " + lead.pct + "% 是" + lead.label + "造成的。",
          analogy: "就像水位上升，可能是下雨，也可能是你自己拿水桶倒進去——同樣是變高，原因不一樣。",
          detail: estimated
            ? "算法是殘差法：先取整段期間的市值變化，扣掉可確認的出入金淨額，剩下的差額才歸給市價波動，所以它是估算而不是逐筆結算。"
            : "算法是把各來源的貢獻金額除以整體變化金額。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_change_" + index, text })),
      relatedTerms: relatedTerms(["cash-concentration", "weight-volatility", "concentration-basics"]),
      suggestedQuestions: [
        { id: "q_portfolio_impact", text: "目前的資金分布對我的帳戶有什麼影響？" },
        { id: "q_attribution_split", text: "現在能確認哪些和帳戶變化有關的資料？" },
      ],
      dataStatus: "available",
    });
  }

  function buildAccountChange() {
    const attribution = account() && account().changeAttribution;
    if (attribution && Array.isArray(attribution.contributors) && attribution.contributors.length) {
      return buildAccountChangeDetailed(attribution);
    }
    const portfolio = adapters().portfolio.read(readState());
    const evidence = [];
    const have = [];
    if (portfolio.available) {
      evidence.push(ev("ev_top", portfolio.topAssetLabel + " 占比（" + portfolio.asOfMonth + "）",
        pct(portfolio.topAssetRatio), "持倉摘要", generatedAt()));
      have.push({ label: "每月最大持有標的與占比", value: portfolio.topAssetLabel + " " + pct(portfolio.topAssetRatio) });
    }
    evidence.push(ev("ev_period", "資料期間", periodLabel(), "帳戶健檢報告", generatedAt()));
    have.push({ label: "資料期間", value: periodLabel() });
    have.push({ label: "各幣種持倉比例", value: "報告未提供" });
    have.push({ label: "每日帳戶淨值", value: "報告未提供" });

    return buildInsufficient({
      id: "account-change",
      title: "今天的帳戶變化從哪裡來？",
      source: ev("src_change", "資料來源", "你的帳戶健檢報告（聚合值）", "持倉摘要", generatedAt()),
      conclusion: "這一題目前的資料不足以回答，所以麥麥不替你猜。",
      whyItMatters: [
        "「今天為什麼變多／變少」要拆成市場、配置與近期交易三個來源，才會是有意義的回答。",
        "要做這個拆解，需要每一種資產各占多少、以及對應的價格變動。這份報告只有每月最大持有標的與占比，缺少其餘部分。",
        "與其給一個看起來精確、實際上是猜的比例，麥麥選擇明確告訴你缺什麼。",
      ],
      reason: "拆解帳戶變化需要各幣種持倉比例與對應價格；這份報告只有每月最大持有標的與占比，缺少的部分無法用估算補上，" +
        "所以麥麥不顯示任何歸因比重，也不畫圖。",
      missing: [
        "各幣種持倉比例（每一種資產各占多少）",
        "逐筆交易明細與成交價",
        "每日帳戶淨值序列",
      ],
      have,
      alternatives: [
        { id: "cash-concentration", label: "先看資金分布在哪裡", type: "insight" },
        { id: "chat", label: "問麥麥現在能確認哪些部分", type: "chat" },
      ],
      limitations: [
        "沒有各幣種持倉比例，就算不出各項資產對帳戶變化的貢獻。",
        "任何用整體占比反推出來的歸因都是估算，麥麥不會把估算當成會計歸因顯示。",
        "已在 issue #29 向後端請求補齊，資料到位後這一頁會自動改成完整版本。",
      ],
      evidence,
      relatedTerms: ["cash-concentration", "weight-volatility", "concentration-basics"],
      suggestedQuestions: [
        { id: "q_portfolio_impact", text: "目前的資金分布對我的帳戶有什麼影響？" },
        { id: "q_attribution_split", text: "現在能確認哪些和帳戶變化有關的資料？" },
      ],
      simple: {
        core: "麥麥現在拿不到「每一種資產各占多少」，所以沒辦法說今天的變化是誰造成的。",
        analogy: "就像知道整袋水果有多重，卻不知道裡面各有幾顆蘋果和橘子，也就算不出哪一種讓袋子變重。",
        detail: "歸因需要逐項持倉權重乘上各自的價格變動，再與交易現金流分離；目前的報告只有月度最大持有一項，維度不足以求解。",
      },
    });
  }

  /* ── 6. 你通常持有多久？（資料不足）── */
  /* 區間名稱：報告用 "0-7" 這種天數字串，畫面要看得懂，但區間邊界一字不動。 */
  const BUCKET_LABELS = Object.freeze({
    "0-7": "7 天以內",
    "8-30": "8～30 天",
    "31-90": "31～90 天",
    "91-180": "91～180 天",
    "181+": "181 天以上",
  });

  /* issue #29 補上 holding_period_distribution 後走這條。
   * 報告是 FIFO 推估、且明說有 792 筆賣出不計入，這兩件事必須寫在畫面上。 */
  function buildHoldingPatternDetailed(distribution) {
    const buckets = distribution.buckets.map((item) => ({
      key: item.range,
      label: BUCKET_LABELS[item.range] || item.range + " 天",
      pct: Number(item.pct),
    }));
    const lead = buckets.slice().sort((a, b) => b.pct - a.pct)[0];
    const shortTerm = buckets.find((item) => item.key === "0-7") || lead;
    const method = distribution.method || "FIFO 配對推估";

    const evidence = [
      /* 每個區間都要列（含 0%）：圖上畫得出來的每個數字都必須查得到來源，
       * 只列非零的話 0% 那幾條會被數字一致性護欄判定沒有來源而整頁擋掉。 */
      ...buckets.map((item, index) => ev("ev_bucket_" + index, "持有 " + item.label + " 的比重",
        item.pct + "%", "持有期間分布", generatedAt())),
      ev("ev_method", "計算方式", method, "持有期間分布", generatedAt()),
      ev("ev_period", "資料期間", periodLabel(), "帳戶健檢報告", generatedAt()),
    ];
    if (distribution.note) {
      evidence.push(ev("ev_note", "不計入的部分", distribution.note, "持有期間分布", generatedAt()));
    }

    const limitations = [
      "這是用「" + method + "」推估的，不是交易所提供的持有期間，和逐筆對帳可能有出入。",
      distribution.note
        ? "期初就已經持有、報告裡找不到對應買入紀錄的賣出不計入（" + distribution.note + "）。"
        : "找不到對應買入紀錄的賣出不計入。",
      "持有期間長短沒有好壞之分，這裡只描述你實際的做法。",
    ];

    const sections = [
      section("sec_holding_dist", "allocationBar", {
        title: "你的賣出，大多在買進後多久發生？",
        summary: "橫條長度是該區間占所有可配對賣出的比重，以賣出市值加權；區間邊界依報告原樣呈現。",
        items: buckets.map((item) => ({
          label: item.label,
          pct: item.pct,
          valueText: item.pct + "%",
        })),
      }),
      section("sec_holding_limit", "limitationList", {
        title: "這份分析有哪些限制",
        items: limitations,
      }),
    ];

    return finalize({
      id: "holding-pattern",
      kind: "personal",
      title: "你通常持有多久？",
      question: "你通常持有多久？",
      source: ev("src_holding", "資料來源", "你的帳戶健檢報告（持有期間分布）", "持有期間分布", generatedAt()),
      hero: {
        conclusion: "你的賣出有約 " + shortTerm.pct + "% 發生在買進後 " + shortTerm.label + "。",
        primaryMetric: {
          label: "持有 " + shortTerm.label + "的比重",
          value: shortTerm.pct + "%",
          note: method,
        },
      },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "持有多久，決定了你實際上是在跟市場的哪一種波動打交道：幾天內的起伏，和幾個月的趨勢，是兩件不同的事。",
          "這張圖是把每一筆賣出配回買入後算出來的實際結果，不是你自認的習慣——兩者常常不一樣。",
          "它不代表哪一種比較好，重點是這個分布是不是你原本打算的做法。",
        ],
      },
      sections,
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs({
          core: "你賣掉的部位裡，大約 " + shortTerm.pct + "% 是在買進後 " + shortTerm.label + "就賣掉的。",
          analogy: "就像買了東西多久會轉手：大部分在很短的時間內就出手，很少放到後面。",
          detail: "算法是把買入與賣出用「" + method + "」配成一對，取中間相隔的天數落在哪個區間，再以賣出市值加權。",
        }, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_holding_" + index, text })),
      relatedTerms: relatedTerms(["trading-rhythm", "order-types", "plan-alignment"]),
      suggestedQuestions: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_holding_pattern", text: "現在能從我的交易紀錄看出什麼？" },
      ],
      dataStatus: "available",
    });
  }

  function buildHoldingPattern() {
    const distribution = account() && account().holdingPeriodDistribution;
    if (distribution && Array.isArray(distribution.buckets) && distribution.buckets.length) {
      return buildHoldingPatternDetailed(distribution);
    }
    const market = adapters().market.read();
    const tx = adapters().transactions.read(readState(), market.observedAt);
    const evidence = [ev("ev_period", "資料期間", periodLabel(), "帳戶健檢報告", generatedAt())];
    const have = [{ label: "資料期間", value: periodLabel() }];
    if (tx.available) {
      evidence.push(ev("ev_buy_sell", "買入／賣出筆數", count(tx.buyTotal) + "／" + count(tx.sellTotal), "交易紀錄", generatedAt()));
      evidence.push(ev("ev_total", "期間買賣總筆數", count(tx.count), "交易紀錄", generatedAt()));
      have.push({ label: "買入筆數", value: count(tx.buyTotal) });
      have.push({ label: "賣出筆數", value: count(tx.sellTotal) });
    }
    have.push({ label: "每一筆交易的時間", value: "報告未提供" });
    have.push({ label: "買賣配對關係", value: "報告未提供" });

    return buildInsufficient({
      id: "holding-pattern",
      title: "你通常持有多久？",
      source: ev("src_holding", "資料來源", "你的帳戶健檢報告（聚合值）", "交易紀錄", generatedAt()),
      conclusion: "算不出來：要知道持有多久，需要逐筆買賣紀錄，這份報告沒有。",
      whyItMatters: [
        "持有期間是把每一筆買入和後來的賣出配成一對，再算中間隔了多久。",
        "報告只給了每月買賣筆數，沒有每一筆的時間，也沒有哪一筆賣出對應哪一筆買入，所以配不出來。",
        "麥麥不會用「總筆數除以月份」這種算法假裝成持有期間——那個數字沒有意義。",
      ],
      reason: "持有期間需要逐筆買入與賣出的時間並完成配對；這份報告只有每月聚合筆數，缺少時間與配對關係，所以麥麥不估算，也不畫分布圖。",
      missing: [
        "每一筆買入與賣出的時間",
        "買賣配對關係（哪一筆賣出對應哪一筆買入）",
        "持有期間分布（平均、中位數、區間）",
      ],
      have,
      alternatives: [
        { id: "trading-rhythm", label: "先看每月的交易節奏", type: "insight" },
        { id: "chat", label: "問麥麥現在能看哪些行為資料", type: "chat" },
      ],
      limitations: [
        "沒有逐筆時間就無法配對買賣，也就算不出持有期間。",
        "買入與賣出筆數接近，不代表它們是一一對應的同一批資產。",
        "已在 issue #29 向後端請求持有期間分布，資料到位後這一頁會自動改成完整版本。",
      ],
      evidence,
      relatedTerms: ["trading-rhythm", "order-types", "plan-alignment"],
      suggestedQuestions: [
        { id: "q_trading_rhythm", text: "我最近的交易節奏有變快嗎？" },
        { id: "q_holding_pattern", text: "現在能從我的交易紀錄看出什麼？" },
      ],
      simple: {
        core: "報告只記了每個月買賣幾次，沒有記每一次是什麼時候，所以算不出你平均抱多久。",
        analogy: "就像知道一個月進出大樓幾次，卻沒有進出時間，也就算不出每次待了多久。",
        detail: "持有期間需要以先進先出或加權平均法把買入與賣出配對後求差；缺少交易時間戳記時，任何配對方式都無法成立。",
      },
    });
  }

  /* ── 7. 名詞解釋（沿用 chat 的知識庫，不複製第二份教材）── */
  const KNOWLEDGE_MAP = {
    "concentration-basics": {
      kbId: "kb_concentration",
      example: "帳戶總值 100,000 元，其中 60,000 元在同一項資產，這項資產就占 60%。這項資產變動 10% 時，整體帳戶就變動 6%。",
      exampleEvidence: "總值 100,000 元、其中 60,000 元在同一項資產（占 60%）；該資產變動 10% 時整體帳戶變動 6%",
      misconception: [
        "常見誤解一：集中一定是壞事。集中本身沒有好壞，它只是描述資金怎麼分布，重點是這個分布是不是你原本想要的。",
        "常見誤解二：分散就一定安全。分散只會降低單一資產的影響幅度，不會讓帳戶不再變動。",
      ],
      related: ["weight-volatility", "cash-concentration", "market-depth"],
      questions: [
        { id: "q_concentration_basics", text: "什麼是資產集中？" },
        { id: "q_portfolio_impact", text: "目前的資金分布對我的帳戶有什麼影響？" },
      ],
      simple: {
        core: "集中就是「錢很多都放在同一個地方」。放得越集中，那個地方一動，整個帳戶跟著動的幅度就越大。",
        analogy: "像把行李都放進同一個箱子：拿一個箱子就走得動，但那個箱子出事，影響也最大。",
        detail: "常見的量化方式是最大單一部位占比或前 N 大部位合計占比；兩者都只描述分布，不含任何對錯判斷。",
      },
    },
    "market-depth": {
      kbId: "kb_market_depth",
      example: "假設你要買 100,000 元的某項資產。如果 10 元附近累積了 300,000 元的賣單，這筆委託大多能在 10 元附近成交；如果 10 元附近只有 50,000 元的賣單，剩下的部分就得用更高的價格才買得到。",
      exampleEvidence: "以 100,000 元的委託為例：10 元附近有 300,000 元賣單時多半在該價位成交；只有 50,000 元賣單時剩餘部分需以更高價格成交",
      misconception: [
        "常見誤解一：價格會動就代表深度不足。價格變動有很多原因，深度只是其中一個。",
        "常見誤解二：深度越深越好。深度只描述掛單累積的多寡，它不預測價格會往哪裡走。",
      ],
      related: ["order-types", "fee-basics", "concentration-basics"],
      questions: [
        { id: "q_market_depth", text: "什麼是市場深度？" },
        { id: "q_order_types", text: "市價單和限價單差在哪？" },
      ],
      simple: {
        core: "市場深度就是「在各個價格上，別人一共掛了多少單」。掛得越多，你的委託越不容易一次把價格推開。",
        analogy: "像排隊買票：窗口前面備了很多票，你買一疊也不影響；備得少，後面的人就得用別的條件才買得到。",
        detail: "深度通常以掛單簿各價位的累積量呈現；同樣金額的委託在深度不足時造成的價格偏移（滑價）會比較大。",
      },
    },
    "order-types": {
      kbId: "kb_order_type",
      example: "你想買某項資產：市價單會用當下可以成交的價格立刻成交；限價單設在 10 元，價格沒有到 10 元就不會成交，可能一直掛著。",
      exampleEvidence: "限價單設在 10 元時，價格未到 10 元不會成交",
      misconception: [
        "常見誤解一：限價單一定比較划算。限價單價格明確，但不保證成交；沒成交也是一種代價。",
        "常見誤解二：市價單一定成交在螢幕上看到的價格。市價單只保證成交，不保證價格。",
      ],
      related: ["market-depth", "fee-basics", "trading-rhythm"],
      questions: [
        { id: "q_order_types", text: "市價單和限價單差在哪？" },
        { id: "q_fee_basics", text: "掛單和吃單的手續費差多少？" },
      ],
      simple: {
        core: "市價單換的是速度，限價單換的是價格。你只能挑一個當主要目標。",
        analogy: "像叫車：現在就上車，價格看當下；或指定價格再上車，可能要等。",
        detail: "限價單會留在掛單簿上等待成交（通常屬於 maker），市價單則直接吃掉簿上既有委託（通常屬於 taker），兩者的費率也因此不同。",
      },
    },
    "weight-volatility": {
      kbId: "kb_weight_volatility",
      example: "帳戶總值 100,000 元，其中 60,000 元在同一項資產（占 60%）。這項資產漲 10% 時，整體帳戶大約變動 6%；如果它只占 10%，同樣漲 10% 只會讓帳戶變動 1%。",
      exampleEvidence: "總值 100,000 元、某資產 60,000 元（占 60%）漲 10% 時帳戶變動 6%；占 10% 時同樣漲 10% 帳戶變動 1%",
      misconception: [
        "常見誤解一：占比高的資產一定比較危險。占比只決定它對帳戶的影響幅度，和這項資產本身好壞無關。",
        "常見誤解二：占比低就可以不用管。占比低的資產如果自己波動很大，仍然會被看見，只是幅度較小。",
      ],
      related: ["concentration-basics", "cash-concentration", "market-depth"],
      questions: [
        { id: "q_weight_volatility", text: "持倉比例為什麼會影響帳戶波動？" },
        { id: "q_portfolio_impact", text: "目前的資金分布對我的帳戶有什麼影響？" },
      ],
      simple: {
        core: "帳戶的變化＝每項資產的漲跌乘上它的占比再加總。占比越大的，講話聲音就越大。",
        analogy: "像合唱團：站在最前排的人唱走音，整首歌都聽得出來；站在最後排的就沒那麼明顯。",
        detail: "這是加權平均的性質：整體報酬為各部位報酬以權重加權後的和，權重本身不含任何品質判斷。",
      },
    },
    "fee-basics": {
      kbId: "kb_fee",
      example: "以 MAX 現貨為例，成交金額 100,000 元時，掛單（maker）0.08% 是 80 元，吃單（taker）0.16% 是 160 元。",
      exampleEvidence: "成交金額 100,000 元時，掛單費率 0.08% 為 80 元、吃單費率 0.16% 為 160 元",
      misconception: [
        "常見誤解一：掛單一定比較省。掛單費率較低，但等待成交的期間價格可能已經變動。",
        "常見誤解二：手續費小到可以忽略。次數多的時候，費用會隨次數累積。",
      ],
      related: ["order-types", "market-depth", "trading-rhythm"],
      questions: [
        { id: "q_fee_basics", text: "掛單和吃單的手續費差多少？" },
        { id: "q_order_types", text: "市價單和限價單差在哪？" },
      ],
      simple: {
        core: "掛單（maker）是把單子掛著等，費率較低；吃單（taker）是直接成交，費率較高。",
        analogy: "像預約和現場候補：預約便宜但要等，現場馬上有位但要多付一點。",
        detail: "費率以成交金額計算，因此同樣的費率在成交次數多時累積的絕對金額也會變多。",
      },
    },
  };

  /* 名詞頁「和你有什麼關係」：有授權才帶個人數字，沒有就明說用一般例子。 */
  function knowledgeRelation(insightId, mode) {
    if (mode !== "personal") {
      return {
        paragraphs: ["麥麥現在沒有使用你的帳戶資料，所以以下用一般例子說明，不會帶入你的數字。"],
        evidence: [],
      };
    }
    const portfolio = adapters().portfolio.read(readState());
    const market = adapters().market.read();
    const tx = adapters().transactions.read(readState(), market.observedAt);
    const evidence = [];
    const paragraphs = [];
    if ((insightId === "concentration-basics" || insightId === "weight-volatility") && portfolio.available) {
      const topPct = pct(portfolio.topAssetRatio);
      evidence.push(ev("ev_rel_top", portfolio.topAssetLabel + " 占比（" + portfolio.asOfMonth + "）",
        topPct, "持倉摘要", generatedAt()));
      paragraphs.push("以你的資料來說：" + portfolio.asOfMonth + " 的快照裡，最大的一筆是" +
        portfolio.topAssetLabel + "，約占 " + topPct +
        "。也就是說你的資金主要停在現金，而不是押在某一種加密資產上。");
      paragraphs.push("報告沒有各幣種持倉比例，所以麥麥沒辦法再往下說哪一種加密資產占多少。");
    } else if (insightId === "order-types" && tx.available) {
      evidence.push(ev("ev_rel_total", "期間買賣總筆數", count(tx.count), "交易紀錄", generatedAt()));
      paragraphs.push("以你的資料來說：整段期間共 " + count(tx.count) +
        "，但報告沒有記錄每一筆用的是市價單還是限價單，所以下面用一般例子說明。");
    } else if (insightId === "fee-basics" && tx.available) {
      evidence.push(ev("ev_rel_total", "期間買賣總筆數", count(tx.count), "交易紀錄", generatedAt()));
      paragraphs.push("以你的資料來說：整段期間共 " + count(tx.count) +
        "，次數越多，手續費累積的絕對金額也越多。報告沒有記錄實際費率與費用，所以下面用一般例子說明。");
    } else {
      paragraphs.push("這個名詞在你的報告裡沒有可以直接對照的數字，所以下面用一般例子說明。");
    }
    return { paragraphs, evidence };
  }

  function buildKnowledge(insightId, mode) {
    const config = KNOWLEDGE_MAP[insightId];
    if (!config) return null;
    const entry = (CHAT_MOCK.knowledgeBase || []).find((item) => item.id === config.kbId);
    if (!entry) return null;
    const relation = knowledgeRelation(insightId, mode);
    const oneLiner = entry.excerpt.split("。")[0] + "。";

    const evidence = [
      ev("ev_kb", entry.title, entry.sourceId + "・更新於 " + entry.updatedAt, "金融知識庫", entry.updatedAt),
      ev("ev_example", "一般例子（不是你的資料）", config.exampleEvidence, "MaiMate 投資名詞教材", entry.updatedAt),
    ].concat(relation.evidence);

    const limitations = [
      "這是一般性的名詞說明，例子裡的金額只是為了好懂，不是你的帳戶數字。",
      "名詞解釋不含任何買賣建議，也不會告訴你該調整成什麼比例。",
    ];

    return finalize({
      id: insightId,
      kind: "knowledge",
      title: entry.title,
      question: entry.title,
      source: ev("src_kb", "資料來源", entry.sourceId + "・更新於 " + entry.updatedAt, "金融知識庫", entry.updatedAt),
      hero: { conclusion: oneLiner },
      whyItMatters: {
        title: "和你有什麼關係",
        paragraphs: relation.paragraphs,
      },
      sections: [
        section("sec_kb_body", "knowledgeExplanation", {
          title: "完整說明",
          paragraphs: [entry.excerpt],
          example: config.example,
        }),
        section("sec_kb_example", "text", {
          title: "用一般例子看看",
          paragraphs: [config.example],
        }),
        section("sec_kb_myth", "text", {
          title: "常見的誤解",
          paragraphs: config.misconception,
        }),
        section("sec_kb_limit", "limitationList", {
          title: "這份說明有哪些限制",
          items: limitations,
        }),
      ],
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: simpleParagraphs(config.simple, currentStyle()),
      },
      evidence,
      limitations: limitations.map((text, index) => ({ id: "lim_kb_" + index, text })),
      relatedTerms: relatedTerms(config.related),
      suggestedQuestions: config.questions,
      dataStatus: "available",
    });
  }

  /* ── 個人化類但沒有授權：不顯示任何帳戶數字 ── */
  function buildLimited(insightId) {
    const titles = TERM_TITLES[insightId] || ["深入了解", ""];
    return finalize({
      id: insightId,
      kind: "personal",
      title: titles[0],
      question: titles[0],
      source: ev("src_limited", "資料來源", "目前沒有使用你的帳戶資料", "MaiMate"),
      hero: { conclusion: "這一頁要用到你的帳戶資料，目前還沒有取得授權，所以麥麥先不顯示任何數字。" },
      whyItMatters: {
        title: "為什麼這和你有關",
        paragraphs: [
          "這一頁的每一個數字都來自你的帳戶健檢報告；沒有授權時，麥麥不會用任何替代值把畫面填滿。",
          "你仍然可以看名詞解釋，那部分完全不需要你的帳戶資料。",
        ],
      },
      sections: [
        section("sec_limited", "insufficientData", {
          title: titles[0],
          reason: "這一頁需要你的帳戶資料才能顯示。你可以先看名詞解釋，或到「我的」調整資料授權。",
          missing: ["你的帳戶資料授權"],
          alternatives: [
            { id: "concentration-basics", label: "先看「什麼是資產集中」", type: "insight" },
            { id: "settings", label: "查看資料授權設定", type: "settings" },
          ],
        }),
      ],
      simpleExplanation: {
        title: "用簡單一點的方式說",
        paragraphs: ["沒有你的帳戶資料，麥麥就沒有東西可以算，所以這一頁先空著，不會用假數字填滿。"],
      },
      evidence: [],
      limitations: [{ id: "lim_limited", text: "未取得授權時，麥麥不顯示任何個人化數字。" }],
      relatedTerms: relatedTerms(["concentration-basics", "weight-volatility", "market-depth"]),
      suggestedQuestions: [{ id: "q_concentration_basics", text: "什麼是資產集中？" }],
      dataStatus: "insufficient",
    });
  }

  const PERSONAL_BUILDERS = {
    "cash-concentration": buildCashConcentration,
    "trading-rhythm": buildTradingRhythm,
    "notable-sell": buildNotableSell,
    "plan-alignment": buildPlanAlignment,
    "account-change": buildAccountChange,
    "holding-pattern": buildHoldingPattern,
  };

  /** 資料算不出來時的通用「資料不足」，不落到空白畫面 */
  function buildUnavailable(insightId) {
    const titles = TERM_TITLES[insightId] || ["深入了解", ""];
    return buildInsufficient({
      id: insightId,
      title: titles[0],
      source: ev("src_unavailable", "資料來源", "你的帳戶健檢報告", "MaiMate", generatedAt()),
      conclusion: "目前的資料算不出這一頁的內容，所以麥麥先不顯示。",
      whyItMatters: [
        "這一頁需要的欄位目前在報告裡找不到，麥麥不會用估算值代替。",
        "資料補齊後這一頁會自動顯示，不需要重新設定。",
      ],
      reason: "組裝這一頁需要的資料目前取不到，麥麥不顯示未經核對的內容。",
      missing: ["這一頁需要的帳戶聚合值"],
      have: [{ label: "資料期間", value: periodLabel() || "報告未提供" }],
      alternatives: [
        { id: "concentration-basics", label: "先看名詞解釋", type: "insight" },
        { id: "chat", label: "回到對話問麥麥", type: "chat" },
      ],
      limitations: ["資料不足時麥麥不畫圖，也不給估算值。"],
      evidence: [ev("ev_period", "資料期間", periodLabel() || "報告未提供", "帳戶健檢報告", generatedAt())],
      relatedTerms: ["concentration-basics", "weight-volatility"],
      suggestedQuestions: [{ id: "q_concentration_basics", text: "什麼是資產集中？" }],
      simple: {
        core: "這一頁需要的資料目前拿不到，所以先空著。",
        analogy: "就像少了一塊拼圖，硬補上去只會看起來像對的，其實是錯的。",
        detail: "缺少的是報告層級的聚合欄位，前端無法由既有欄位推導出來。",
      },
    });
  }

  /** @type {{getInsight:(id:string)=>Promise<Object|null>, listInsights:()=>Object[]}} */
  const MockMaiMateInsightService = {
    listInsights() {
      return CORE.ALL_INSIGHTS.map((id) => ({
        id,
        kind: CORE.insightKind(id),
        title: (TERM_TITLES[id] || ["深入了解", ""])[0],
        summary: (TERM_TITLES[id] || ["", ""])[1],
      }));
    },

    /** @param {string} id @returns {Promise<Object|null>} 組好且通過護欄的 InsightDetail */
    async getInsight(id) {
      if (!CORE.ALL_INSIGHTS.includes(id)) return null;
      const access = CORE.evaluateInsightAccess(readState(), id);
      if (access.status !== "ok") return null;

      if (access.mode === "lastKnown") {
        const cached = readLastKnown(id);
        const base = cached || buildLimited(id);
        return Object.assign({}, base, {
          mode: "lastKnown",
          stopped: true,
          notice: access.notice,
        });
      }
      if (access.mode === "limited") {
        return Object.assign(buildLimited(id), { mode: "limited", notice: access.notice });
      }

      let detail = null;
      if (access.kind === "knowledge") {
        detail = buildKnowledge(id, access.mode);
      } else {
        const builder = PERSONAL_BUILDERS[id];
        detail = builder ? builder() : null;
        if (!detail) detail = buildUnavailable(id);
      }
      if (!detail) return null;

      const guarded = guardDetail(detail);
      if (!guarded.ok) return Object.assign(blockedDetail(id, guarded.guard), { mode: access.mode });

      const result = Object.assign({}, detail, { mode: access.mode });
      if (access.mode === "personal" && access.kind === "personal") saveLastKnown(id, detail);
      if (access.notice) result.notice = access.notice;
      return result;
    },
  };

  /* ── 正式服務骨架 ──
   * TODO(正式 API)：後端目前沒有 /api/v1/maimate/insights/:id。
   *   等 issue #29 的三項聚合值（各幣種持倉比例／帳戶變化歸因／持有期間分布）到位後，
   *   在此改為呼叫後端；介面與 Mock 相同，UI 不需要改。 */
  const MaiMateInsightService = Object.assign({}, MockMaiMateInsightService, { _formal: true });

  window.MM_INSIGHT_SERVICES = Object.freeze({
    insight: window.MM_USE_FORMAL_INSIGHTS === true ? MaiMateInsightService : MockMaiMateInsightService,
    mock: MockMaiMateInsightService,
    formal: MaiMateInsightService,
    titles: Object.freeze(Object.assign({}, TERM_TITLES)),
    guardDetail,
    collectProse,
  });
})();
