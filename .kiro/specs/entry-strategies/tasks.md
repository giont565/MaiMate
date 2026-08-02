# Tasks — entry-strategies

- [x] 1. `analysis/strategy_compare.py`：三方式×三情境回測，輸出 `data/strategy_report.json`
- [x] 2. 假設與資料源寫進輸出（費率、資金基準、份數、網格參數、成交價假設）
- [x] 3. 註冊 `compare_entry_strategies` toolSpec，回傳附 `key_findings`／`data_notes`
- [x] 4. SYSTEM 規則 10：問及進場方式時**立刻**呼叫本工具
  - 規則需涵蓋「為什麼…」「那 X 呢」句型，否則模型會改用 `query_knowledge` 硬答
- [x] 5. 護欄 `_ADVICE_PATTERNS`／`_REDLINE_INDEXES`：攔祈使式建議、放行中性比較
- [x] 6. 單元測試（`tests/test_strategy_compare.py`，7 項）
  - 三情境皆三方式對等、輸出不含推薦、低於下限被標記、
    網格上漲行情呈現現金拖累、未知市場誠實、行情掛掉時 `feasibility` 降級
- [x] 7. 誤攔迴歸測試（`tests/test_guardrails.py::EntryMethodAdviceTests`）
- [x] 8. 對話劇本實測：`npm run verify:strategy`
  - 08/01 私人環境 S1–S5 各跑 3 次，15/15 全過

## 未完成

- [ ] 9. 官方環境部署後重跑劇本驗證
  - 規則 10 與護欄補丁目前**只在 repo，未重部署**；未重部署前不要在 Demo 主線示範此功能
- [ ] 10. `risk_mode` 未帶時由 profile engine 推斷值填入（目前預設 growth）
