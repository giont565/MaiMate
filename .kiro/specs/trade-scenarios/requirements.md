# Requirements — trade-scenarios

## Introduction

Golden Path 的核心工具：使用者表達交易意圖時，由確定性程式產生三個帶數字的方案
（含損益試算、手續費、持倉集中度變化），LLM 只負責把方案講成人話。
這是「金融數字由規則計算、AI 只解釋」原則的具體實作。

## Requirements

### R1 方案生成

**User Story:** 作為使用者，我說「幫我全賣 ETH」時，想看到不只一個選項，且每個選項有真實數字。

#### Acceptance Criteria

1. WHEN 收到交易意圖（標的/方向/幅度） THEN 系統 SHALL 產生三方案：
   a. 保守版（如：賣出 25%）
   b. 原意圖版（如：全賣）
   c. 暫停版（不動作＋設定價格提醒）
2. 每方案 SHALL 附確定性計算欄位：預估成交金額（TWD）、預估手續費、執行後該幣持倉佔比、
   對照個人歷史的行為註記（如「類似情境你過去 N 次，機會成本共 NT$X」）
3. 所有數字 SHALL 來自程式計算（餘額×現價×費率），SHALL NOT 由 LLM 生成
4. IF 意圖標的不在使用者持倉 THEN 回傳明確錯誤而非硬編方案

### R2 與確認流銜接

1. WHEN 使用者選定方案 THEN 該方案 SHALL 可直接餵入 prepare_order（欄位相容）
2. 暫停版被選擇時 SHALL NOT 產生任何訂單

### R3 誠實原則

1. 手續費率 SHALL 引用 MAX 公告費率（常數＋來源註記），非猜測
2. 損益試算 SHALL 標注「以當下價格估算，實際成交可能滑價」
