# Requirements — entry-strategies（進場方式比較）

## Introduction

使用者問「我該一次買進還是分批？」時，回答不能是「建議你定期定額」——那是報明牌。
本功能用 MAX 公開日線回測三種進場方式（一次買進 / 定期定額 / 網格）在三種行情
（上漲 / 下跌 / 盤整）下的實際結果，**對等呈現**，讓使用者自己選。

對應 LLM 工具 `compare_entry_strategies`（無獨立 HTTP 端點，經 `/chat` 觸發）。

## Requirements

### R1 對等呈現（紅線 1 的具體化）

**User Story:** 作為使用者，我想知道各種進場方式的實際差別，而不是被推薦一種。

#### Acceptance Criteria

1. WHEN 回傳結果 THEN 系統 SHALL 對 `uptrend`／`downtrend`／`sideways` 三情境
   各自給出 `lump_sum`／`dca`／`grid` 三種方式的數字
2. 輸出 SHALL NOT 含任何推薦字樣或排名
3. `risk_mode` SHALL 只決定 `risk_tier.primary_metric`（先看哪個數字），
   SHALL NOT 決定推薦誰
4. WHEN 模型轉述結果 THEN 護欄 SHALL 攔截「你應該用定期定額」這類祈使句，
   並 SHALL 放行中性比較與教育性敘述（誤攔的代價是整段回覆被換成安全罐頭語）

### R2 數字要能對帳

#### Acceptance Criteria

1. 回測資料源 SHALL 是 MAX 公開日線（`/api/v3/k`），**SHALL NOT 使用命題 CSV**
   —— 命題 CSV 的價格路徑全年最大回撤僅 0.6%~3.6%，跑策略回測會得到假結論
2. 每種方式 SHALL 輸出 `return_pct`／`max_drawdown_pct`／`end_cash_pct`，
   並按 `amount_twd` 換算成 TWD 金額
3. 假設 SHALL 明列於輸出（費率、資金基準、分幾份、網格層數與深度、成交價假設）
4. WHEN 網格在單邊上漲行情中留有現金 THEN 輸出 SHALL 呈現其**現金拖累**，
   不得包裝成獲利

### R3 可行性檢查

#### Acceptance Criteria

1. WHEN 金額切成 N 份後低於交易所單筆下限 THEN 系統 SHALL 標記不可行並給出最低總額
2. IF 行情取不到 THEN `feasibility` SHALL 回 `unknown`，SHALL NOT 猜測門檻
3. IF 市場代號不存在 THEN 系統 SHALL 誠實回報，SHALL NOT 生成資料

### R4 模型必須真的呼叫這個工具

#### Acceptance Criteria

1. WHEN 使用者問及進場方式（含「為什麼…」「那 X 呢」這類追問句型）
   THEN SYSTEM 規則 SHALL 要求模型**立刻**呼叫本工具
2. IF 規則寫得不夠明確 THEN 模型會改用 `query_knowledge` 硬答——
   那會給出沒有回測根據的說法，是本規格最主要的失敗模式
