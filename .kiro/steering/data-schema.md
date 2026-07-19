# Data Steering — 資料源與格式定義

## 1. 官方 CSV（data/MaiCoin_transactions.csv）

10,000 筆、單一模擬帳戶、期間 2025-01-01 ～ 2025-12-31（UTC）。
注意：原始檔每行尾端有多餘空白，讀取時 fieldnames 與值都要 strip。

| 欄位 | 型別 | 說明 |
|---|---|---|
| timestamp | int | 毫秒級 Unix 時戳 |
| currency | str | btc / eth / sol / doge / usdt / usdc / twd（共 7 種） |
| price | float | 該資產台幣（TWD）計價單價；twd 恆為 1.0 |
| action | str | buy / sell / deposit / withdrawal |
| change | float | 資產變動數量，正增負減 |
| balance | float | 該筆交易後之最新帳戶餘額（該幣別） |

分布：deposit 2679 / withdrawal 2647 / buy 2357 / sell 2317。
buy+sell 各幣筆數：sol 812, usdt 779, doge 779, btc 775, usdc 769, eth 760。

## 2. 預計算輸出（data/health_report.json）

由 analysis/precompute.py 離線產出，Agent 的 query_user_history 工具直接讀取，
Demo 現場不做重運算。包含：chase_index、opportunity_cost、concentration、
cash_flow_behavior、activity_profile 五組指標。

## 3. MAX API

- 註冊：https://max.maicoin.com/signup?r=dreambigbtc（官方提供之連結）
- RESTful 文件：https://campaign.maicoin.com/api-document
- WebSocket 文件：https://maicoin.github.io/max-websocket-docs
- 社群 MCP Server：https://github.com/bistin/max-mcp-server
- 社群 Skill：https://github.com/bistin/max-api-skill

| 分類 | Public | Private |
|---|---|---|
| Read | 市場資訊（免帳號） | 帳號資訊（需 KYC + API Key） |
| Write | 無 | 下單、提領（需勾選對應權限） |

安全規則：API Key 僅開「交易」權限、不開「提領」；Key 一律走環境變數/Secrets Manager，
嚴禁進 git。

## 4. 第三方（延伸，非必要）

CoinMarketCap / Etherscan / Coinbase / Blockchain.com 擇一即可，用於市場脈絡補充。
使用時必須在簡報「技術限制」頁揭露免費額度與 rate limit。
