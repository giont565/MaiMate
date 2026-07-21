# Tasks — trade-scenarios

- [x] 1. `scenarios.py`：三方案計算實作（金額/手續費/集中度/behavior_note）
- [x] 2. 費率常數表：基礎 maker 0.08%/taker 0.16%（2026-07 已查證；上線前再對官網一次）
- [x] 3. 註冊 toolSpec 進 tools.py＋SYSTEM 規則更新（意圖必經本工具）
- [x] 4. 單元測試：用真實 health_report＋固定 ticker 驗證數字正確
- [ ] 5. 整合測試：「ETH 跌太多幫我全賣」→ 回應含三方案且數字可還原驗算
- [x] 6. 前端方案卡片渲染（三選一 → 接 prepare_order）
