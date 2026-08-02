# Tasks — trade-scenarios

- [x] 1. `scenarios.py`：三方案計算實作（金額/手續費/集中度/behavior_note）
- [x] 2. 費率常數表：基礎 maker 0.08%/taker 0.16%（2026-07 已查證；上線前再對官網一次）
- [x] 3. 註冊 toolSpec 進 tools.py＋SYSTEM 規則更新（意圖必經本工具）
- [x] 4. 單元測試：用真實 health_report＋固定 ticker 驗證數字正確
- [x] 5. 整合測試：「ETH 跌太多幫我全賣」→ 回應含三方案且數字可還原驗算
  - 線上實測（`TEST_CHECKLIST` D9–D11）：手續費 ≈ 金額×0.16%、全賣後集中度 0%、
    回覆引用真實歷史（1/8 DOGE NT$312,924）
  - ⚠ 07/29 觀察到偶發：同一句話 7 次中 1 次沒有直接出卡而是反問。
    因此 `DEMO_SCRIPT` 不把這句寫成必然結果
- [x] 6. 前端方案卡片渲染（三選一 → 接 prepare_order）
- [x] 7. 三方案對等呈現：SYSTEM 規則禁止模型自標「✓ 推薦」（08/01 修）
- [x] 8. 金額低於交易所單筆下限時擋下（`tests/test_scenarios_min_order.py`）
- [x] 9. 三方案回覆的 markdown 轉換（否則整排星號會露在畫面上）
