# Requirements — order-flow

## Introduction

「提問 → AI 分析 → 確認卡 → 使用者授權 → 成交」的閉環，同時滿足命題的「對話式下單生態」
與紅線 2「下單必經確認」。

本規格的核心命題是：**安全不能只靠提示詞。**
LLM 再怎麼被說服、被越獄、被幻覺，它呼叫不到的函式就是呼叫不到。

## Requirements

### R1 下單意圖只產草稿

**User Story:** 作為使用者，我想用一句話發起下單，但成交前一定要經過我按下確認。

#### Acceptance Criteria

1. WHEN 使用者表達下單意圖 THEN LLM SHALL 只能呼叫 `prepare_order`，產生確認卡與 `confirm_token`
2. `execute_order` SHALL NOT 出現在 LLM 可見的工具清單，且 SHALL NOT 存在於 dispatch 表
   —— 即使模型幻覺出這個名字，也沒有東西會被執行
3. WHEN `/chat` 回應含 `prepare_order` 結果 THEN 回應 SHALL 以 `confirm` 欄位帶出確認卡供前端渲染
4. 確認卡 SHALL 顯示幣種／方向／金額／單型／預估手續費；數量標明「依成交價定」

### R2 憑證的時效與單次性

#### Acceptance Criteria

1. `confirm_token` SHALL 存 DynamoDB（pk = `order#<token>`），60 秒過期、單次有效
2. WHEN token 逾時或已被使用 THEN `POST /order` SHALL 回 HTTP 410
   且 `retryable:false`，SHALL NOT 重試
3. WHEN 使用者短時間連按確認鈕 THEN 系統 SHALL 只成交一次
   —— 實測 1.7 秒內連按三次：一次成交、其餘 410
4. 過期回 410 是**正確行為**，前端 SHALL 以「憑證過期，請重新產生」呈現，不得顯示成失敗紅字

### R3 真實成交的正確性

#### Acceptance Criteria

1. WHEN 送出訂單 THEN 系統 SHALL 以 TWD 金額換算為該幣別 base volume，
   並檢查交易所**最小下單量與精度**
2. IF 換算後低於交易所單筆下限 THEN 系統 SHALL 在產生方案階段就擋下並告知最低總額，
   SHALL NOT 送出必然失敗的單
3. 貼齊精度時 SHALL 無條件捨去而非四捨五入——四捨五入會把剛好貼齊門檻的量捨到門檻以下
4. 簽章 SHALL 通過 MAX Private API 驗證（payload 與 header 一致，避免 2014 簽章錯誤）

### R4 金鑰與權限

#### Acceptance Criteria

1. 金鑰 SHALL 只從環境變數／Secrets Manager 讀取，SHALL NOT 進 git、SHALL NOT 出現在日誌
2. API Key SHALL 只開「讀取＋交易」，**不開提領**（人工設定，Demo 前檢查）
3. IF 執行環境沒有 MAX 金鑰 THEN 系統 SHALL 走示範帳戶，且畫面 SHALL 有明確標示
   使其不可能被誤認為真實帳戶

### R5 留痕

#### Acceptance Criteria

1. 訂單生命週期 SHALL 全程留痕：`draft_created` → `user_confirmed`／`expired` → `executed`
2. 留痕 SHALL append-only，且摘要不含 PII
