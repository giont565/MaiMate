# Requirements — behavior-engine

## Introduction

離線讀取命題方提供的交易 CSV（10,000 筆、2025 全年、單一模擬帳戶），
產出 `data/health_report.json` 供 Agent 的 `query_user_history` 工具查詢。
**Demo 現場零重運算**——首屏與對話都只讀這份靜態 JSON。

這是「金融數字由確定性程式計算、LLM 只負責解釋」原則的資料源頭：
本引擎算錯，後面每一層都會跟著錯，而且錯得很有說服力。

## Requirements

### R1 追高殺低指數

**User Story:** 作為使用者，我想知道自己是不是總在高點買、低點賣。

#### Acceptance Criteria

1. WHEN 讀取 CSV THEN 系統 SHALL 將每筆 buy/sell 與**同幣別近 7 筆**價格均線比較
2. WHEN 買入價高於均線 THEN 該筆 SHALL 計入追高；賣出價低於均線 SHALL 計入殺低
3. 輸出 SHALL 含追高比例、殺低比例與各自筆數

### R2 機會成本

**User Story:** 作為使用者，我想知道「賣掉之後又漲上去」總共讓我少賺多少。

#### Acceptance Criteria

1. WHEN 計算每筆 sell THEN 系統 SHALL 以該幣別**年末價格**回推「若續抱」的價值差額
2. 輸出 SHALL 含總額與最痛單筆（日期／幣別／金額）
3. 文案層 SHALL 明確區分「少賺（機會成本）」與「真實虧損（已實現損益）」——
   兩者混用會讓使用者以為自己虧了兩千六百萬

### R3 已實現損益

**User Story:** 作為使用者，我想知道我去年到底是賺是賠，以及最痛的一筆真實虧損。

#### Acceptance Criteria

1. WHEN 計算已實現損益 THEN 系統 SHALL 使用移動平均成本法（`moving_average_cost`）並標注方法
2. 輸出 SHALL 含總額、獲利筆數、虧損筆數、最大單筆虧損（日期／幣別／數量／成本／賣價）
3. IF CSV 未提供 THEN 前端相關區塊 SHALL 自動隱藏而非顯示壞值

### R4 持倉集中度與出入金行為

#### Acceptance Criteria

1. 系統 SHALL 輸出每月月底各幣市值佔比與峰值月份
2. 系統 SHALL 輸出 TWD 提領筆數，以及其中發生於 BTC 七日下跌後的比例
3. WHEN 最大持有是現金（twd） THEN 文案 SHALL 明講那是現金，不得說成「持幣集中」

### R5 誠實原則（紅線 4 的具體化）

#### Acceptance Criteria

1. IF 資料不支持某個結論 THEN 系統與文案 SHALL NOT 給出該結論
   （例：本帳戶出金僅 14.2% 發生在下跌後 → 不得稱使用者「恐慌出金」）
2. 對外呈現 SHALL 標明這份資料是**命題方提供的示範帳戶**，不是使用者本人的帳戶
3. 每次輸出 SHALL 附 `generated_at` 與 `row_count`，讓下游可判斷資料新舊與完整性
