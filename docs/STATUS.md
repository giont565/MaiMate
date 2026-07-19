# MaiMate 全功能狀態總表

> 2026-07-19 盤點｜分工討論用
> 狀態定義：✅ **完成並驗證過**｜🧪 **程式寫好但沒測過**（寫好≠能動，要有人測）｜🔨 **待做**｜🔬 **純測試項**

## 總覽

| 狀態 | 數量 |
|---|---|
| ✅ 完成並驗證 | 8 |
| 🧪 寫好待測 | 11 |
| 🔨 待做 | 14 |
| 🔬 純測試項 | 6 |

---

## 1. 資料與分析

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| 官方 CSV 解析＋行為指標預計算 | ✅ | 10,000 筆跑通，追高65%/機會成本2,660萬等真數字已驗證 | `analysis/precompute.py` |
| health_report.json 產出 | ✅ | 五組指標齊全 | `data/` |
| setup.sh 環境檢查 | ✅ | 已實測（工具/金鑰/資料/預計算四段） | `scripts/` |
| RAG 語料蒐集（防詐/教材/FAQ） | 🔨 | 公開資源＋工作坊資料（授權限制見 COMPLIANCE A） | #9 |
| Bedrock Knowledge Base + S3 Vectors 建置 | 🔨 | 賽前建好，決賽只上架 | #9 |
| `query_knowledge` 工具 | 🔨 | 回答附出處 | #9 |

## 2. Agent 核心

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| Converse tool-use 迴圈 | 🧪 | 程式完成，**從沒對真實 Bedrock 跑過** | `agent/loop.py` |
| 工具定義×4＋dispatch | 🧪 | 同上 | `agent/tools.py` |
| prepare/execute 下單分離 | 🧪 | 架構完成，待端到端驗證 | `tools.py`+`order.py` |
| 程式層護欄（明牌攔截/PII 清洗） | 🧪 | 正則可單元測試，未寫測試 | `agent/guardrails.py` |
| confirm 欄位帶出前端 | 🔨 | 迴圈要把 prepare_order 結果帶給 handler 回應 | #1 |
| Haiku/Sonnet 模型分工路由 | 🔨 | 含 prompt caching 設定 | #5 |
| Bedrock Guardrails 建立＋掛載 | 🔨 | 與程式層雙保險 | #6 |
| Profile Engine 簡版 | 🔨 | 免問卷，行為推斷三模式→提醒強度 | #10、spec:`profile-engine` |
| calculate_trade_scenarios 三方案 | 🔨 | Golden Path 核心，確定性計算 | #11、spec:`trade-scenarios` |
| Audit Log（工具+訂單留痕） | 🔨 | 含 GET /audit 與前端軌跡面板 | #12、spec:`audit-log` |

## 3. API 與整合

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| Lambda×4 handlers | 🧪 | 程式完成，未部署未打過 | `backend/handlers/` |
| MAX Public API 串接（快取+退避） | 🧪 | endpoint 路徑需對官方文件核對後實測 | #2 |
| MAX Private API（HMAC 簽章） | 🧪 | **簽章實作未驗證**——對照 max-mcp-server 源碼核對 | #4 |
| CoinMarketCap 延伸 | 🧪 | 無金鑰時自動略過，未測 | `thirdparty.py` |
| MAX Lv2 KYC＋API Key（每人） | 🔨 | 人工項，審核有等待期，**最急** | #3 |

## 4. 前端

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| 桌機三欄 SPA（健檢/對話/行情/確認卡） | 🧪 | 寫好，未在瀏覽器完整走過 | `frontend/` |
| 離線 mock 自動備援 | 🧪 | 機制寫好，未驗證 fallback 行為 | `frontend/app.js` |
| 手機版 RWD 改版（Golden Path 動線） | 🔨 | 對話為主畫面、確認卡放大、麥麥視覺 | #13 |
| 三方案卡片渲染 | 🔨 | 隨 trade-scenarios | #11 |
| 模式徽章＋Demo 切換 | 🔨 | 隨 profile-engine | #10 |
| 決策軌跡面板 | 🔨 | 隨 audit-log | #12 |

## 5. 基礎設施與部署

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| SAM 模板（API GW+Lambda×4+DDB+S3） | 🧪 | **從未實際 deploy 過** | `infra/template.yaml` |
| 自家 AWS 帳號＋Bedrock 開通 | 🔨 | 賽前基地；Claude 要填 use case 表單 | — |
| 從零部署演練＋DEPLOY.md | 🔨 | 目標 <1hr，7/31 前至少一次 | #14 |

## 6. 簡報與交付物

| 項目 | 狀態 | 說明 | 參照 |
|---|---|---|---|
| 提案簡報 16 頁（真數字版） | ✅ | 含評審兩題頁；視覺需本機過一次 | `docs/MaiMate_提案簡報.pptx` |
| 組員上手指南 9 頁 | ✅ | 連結全指向 MaiMate repo | `docs/開發環境上手指南.pptx` |
| ARCHITECTURE.md（含圖） | ✅ | P0/P1 標示、Golden Path 時序 | `docs/` |
| COMPLIANCE.md 法規檢討 | ✅ | 四紅線×四風險＋金管會 AI 指引對照 | `docs/` |
| 整合簡報修正（Skill 標示＋補兩頁） | 🔨 | 合版時處理 | #15 |
| Demo 預錄影片 | 🔨 | Phase 2 產出 v1、決賽出 final | #8 |
| Kiro 加分證據集（截圖） | 🔨 | credits 畫面已有；補 Specs 面板/task 執行/MCP 畫面 | — |

## 7. 測試清單（🔬 專門留給「測試負責人」的活）

| 測試項 | 前置 | 驗收 |
|---|---|---|
| Bedrock 迴圈首次實跑 | AWS 帳號＋模型開通 | loop.py 對真模型完成一次多工具對話 |
| Guardrails 雙層攔截 | #6 | 「推薦我買哪個幣」兩層各自單獨擋住 |
| 憑證安全 | #1 #4 | token 過期/重放回 410；60 秒邊界 |
| 離線備援切換 | 前端部署 | 拔網路，mock 自動接手且 UI 標示離線 |
| E2E Golden Path | 幾乎全部 | 「ETH 跌太多幫我全賣」→三方案→確認→最小額度成交→軌跡面板完整 |
| 從零部署計時 | #14 | 乾淨帳號 <1 小時上線（決賽日保險） |

---

## 分工討論的建議切法（四個工作包，未指派）

| 工作包 | 內容 | 涉及 |
|---|---|---|
| **A. Agent 核心** | #1 confirm、#5 路由、#11 三方案、#10 profile、Bedrock 首跑 | Python、Bedrock |
| **B. 資料與 RAG** | #9 語料+KB 建置、#12 audit log、#2 Public API 實測 | Python、AWS 資料服務 |
| **C. 前端與體驗** | #13 手機版、三方案卡/模式徽章/軌跡面板、離線備援驗證、麥麥視覺 | HTML/JS、設計 |
| **D. 整合與交付** | #14 部署演練+DEPLOY.md、#4 Private API E2E、#6 Guardrails、#8 錄影、#15 簡報、E2E 測試主導 | AWS、統籌 |

相依關係提醒：#3（全員 KYC）擋 #4；AWS 帳號擋 Bedrock 首跑與 #9；#11 擋三方案卡片；
Bedrock 首跑建議**最優先**——它是唯一還沒碰過真模型的核心風險。
