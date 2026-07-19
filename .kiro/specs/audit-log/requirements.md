# Requirements — audit-log

## Introduction

全程留痕：每次工具呼叫與訂單完整生命週期寫入 append-only 紀錄。
法遵敘事的支柱（COMPLIANCE.md B2：可證明每筆交易皆經使用者確認），也是 Demo 的
「看得見的 AI」展示素材。

## Requirements

### R1 工具呼叫留痕

1. WHEN Agent 迴圈執行任一工具 THEN 系統 SHALL 寫入一筆紀錄：
   `{session_id, seq, ts, type: "tool_call", tool, input_summary, status}`
2. input_summary SHALL 為摘要（如 market=ethtwd），SHALL NOT 記錄使用者原文或 PII

### R2 訂單生命週期留痕

1. 訂單事件 SHALL 各寫一筆：`draft_created`（prepare）→ `user_confirmed` 或
   `expired` / `cancelled` → `executed`（含交易所回覆單號）
2. 每筆 SHALL 可依 session_id + 時間排序還原完整決策軌跡

### R3 可查詢與展示

1. 系統 SHALL 提供 `GET /audit?session_id=` 回傳該次對話的完整軌跡
2. Demo 前端 SHALL 有「決策軌跡」展開面板（Golden Path 跑完點開秀給評審）
3. 紀錄 SHALL 為 append-only：程式碼不提供更新/刪除路徑

## 非目標

不做保存年限管理、不做簽章防竄改（P2，上台被問到就答「正式版用 QLDB 或 S3 Object Lock」）。
