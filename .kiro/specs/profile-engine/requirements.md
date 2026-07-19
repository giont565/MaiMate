# Requirements — profile-engine

## Introduction

從使用者交易行為推斷「使用者模式」，輸出提醒強度參數，讓同一筆交易意圖在不同
使用者身上得到不同強度的介入。P0 不做問卷（放 P1），直接用行為數據推斷。

## Requirements

### R1 模式推斷

**User Story:** 作為系統，我要從交易紀錄自動判斷使用者屬於哪種模式，不用使用者自己選。

#### Acceptance Criteria

1. WHEN 載入 health_report THEN 系統 SHALL 依規則輸出三模式之一：
   - `cautious`（安心白話）：交易頻率低（月均 < 20 筆）或追高指數 > 60%
   - `growth`（成長陪跑）：介於兩者之間
   - `pro`（專業效率）：交易頻率高（月均 > 100 筆）且追高指數 < 40%
2. 分類規則 SHALL 為確定性程式（可單元測試），不由 LLM 判斷
3. 分類 SHALL 附帶依據欄位（用了哪些指標、數值），供 Demo 展示「為什麼把你分在這」

### R2 提醒強度注入

1. WHEN Agent 迴圈啟動 THEN system prompt SHALL 依模式注入對應指令：
   - cautious：大字白話比喻、每步確認、防詐提醒優先、下單前多一層「你確定嗎」文字勸導
   - growth：附教育脈絡與健康分數連動、正常確認流
   - pro：資訊密度高、直接給數字、正常確認流
2. 三種模式 SHALL 共用同一套工具與確認機制——差異只在語氣與提醒強度，不在安全性

### R3 Demo 可展示性

1. Demo 介面 SHALL 可切換模式（下拉選單即可），展示「同一句『幫我全賣』，三種模式的回應差異」
2. 回應差異 SHALL 肉眼可辨（cautious 明顯更保護、pro 明顯更精簡）
