# ARCHITECTURE.md — MaiMate 系統架構

> 本文以**程式碼實際內容**為準，每個主張後面附 `檔案:行號`，可自行 `git grep` 覆核。
> 與其他文件牴觸時以本文為準；本文與程式碼牴觸時以程式碼為準（發現落差請開 issue）。
> 盤點日：2026-07-31。

---

## 1. 一句話

使用者把「想全部賣掉」這種**當下的衝動**打進對話框，MaiMate 用他**自己過去的交易紀錄**當鏡子，
把衝動換成三個**算好數字的選項**，最後一步一定由人按下去。

技術上這是一個 **Bedrock Converse 工具迴圈**，外圍包了三層「AI 碰不到的東西」：
真實下單函式不在工具清單、下單需要 60 秒有效的確認憑證、每一步都留 audit。

---

## 2. 全景圖

```
                      ┌──────────── 靜態前端（S3 + CloudFront）────────────┐
                      │  welcome → onboarding → index / home / chat        │
                      │  insights / settings                               │
                      │  零建置：純 HTML + vanilla JS，沒有打包器           │
                      └───────────────────────┬────────────────────────────┘
                                              │ HTTPS
                              ┌───────────────▼───────────────┐
                              │      API Gateway (HttpApi)     │
                              └───┬───────┬───────┬──────┬─────┘
                    POST /chat ───┘  GET   │  GET  │ POST │ GET
                                  /health  │/market│/order│/audit
                                           │       │      │
        ┌──────────────┬──────────────┬────┴───┬───┴──────┴────┐
        │ ChatFunction │HealthFunction│Market  │ OrderFunction │ AuditFunction
        │  (60s)       │              │Function│               │
        └──────┬───────┘              └───┬────┘      │        └──────┬───────┘
               │                          │           │               │
      ┌────────▼─────────┐                │           │        ┌──────▼──────┐
      │  backend/agent/  │                │           │        │  DynamoDB   │
      │  loop.py 工具迴圈 │                │           │        │ (append-only)│
      └───┬──────────┬───┘                │           │        └─────────────┘
          │          │                    │           │
   ┌──────▼─────┐ ┌──▼──────────────┐ ┌───▼──────────▼────┐
   │  Bedrock   │ │ Bedrock KB      │ │ backend/          │
   │  Converse  │ │ (RAG 防詐語料)   │ │ integrations/     │
   │ Haiku/Sonnet│ └─────────────────┘ │  max_public       │
   └────────────┘                      │  max_private ★    │
                                       └───────────────────┘
                                    ★ 只有 OrderFunction 走得到下單
```

**五支 Lambda**（`infra/template.yaml`）：

| 函式 | 路由 | 位置 | 特別之處 |
|---|---|---|---|
| `ChatFunction` | POST `/chat` | L31-54 | Timeout **60s**（覆寫全域 30s，因為要跑多輪工具迴圈） |
| `HealthFunction` | GET `/health` | L56-62 | 回行為健檢報告 |
| `MarketFunction` | GET `/market` | L64-70 | 代理 MAX 公開行情 |
| `OrderFunction` | POST `/order` | L72-82 | **唯一能真的送單的地方** |
| `AuditFunction` | GET `/audit` | L84-92 | 讀決策軌跡 |

全域設定 MemorySize 512 / Timeout 30。`MAX_API_KEY` / `MAX_API_SECRET`
**刻意不寫進模板**（L79-80 註解），部署後由主控台或 Secrets Manager 注入——金鑰不進版控。

---

## 3. 對話迴圈怎麼跑（`backend/agent/loop.py`）

```
使用者訊息
   │
   ├─ scrub_input()        去個資（身分證/手機/長數字）   guardrails.py:73-76 ← chat.py:19-22
   │
   ├─ pick_model()         選 Haiku 還是 Sonnet          loop.py:60-67
   │
   ├─ converse()           Bedrock 工具迴圈              loop.py:117
   │    └─ 模型要求呼叫工具 → _DISPATCH 執行 → 結果回餵 → 再問模型（多輪）
   │       每次工具呼叫寫一筆 audit                       loop.py:142
   │
   └─ check_output()       擋明牌，命中就整段換掉         guardrails.py:79-100 ← chat.py:32-34
```

### 模型分工

| 常數 | 值 | 何時用 |
|---|---|---|
| `MODEL_HAIKU` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | 預設（`loop.py:9`） |
| `MODEL_SONNET` | `us.anthropic.claude-sonnet-4-5-v1:0` | 命中深度意圖時（`loop.py:10`） |

路由邏輯 `pick_model()` 在 `loop.py:60-67`：看**最後一則使用者訊息**是否命中
`_DEEP_INTENT` 正則（`loop.py:12`）。`us.` 開頭是 cross-region inference profile，
換 region 部署時要一起確認。

Prompt caching：開關 `ENABLE_PROMPT_CACHE`（`loop.py:14`），開啟後在 `loop.py:98-100` 掛 `cachePoint`。

### 工具清單（LLM 實際能呼叫的全部）

定義在 `backend/agent/tools.py:21-105`，執行分派表在 `tools.py:250-259`：

| 工具 | 行號 | 做什麼 |
|---|---|---|
| `query_user_history` | 23 | 查行為健檢報告（使用者自己的交易史） |
| `get_market_data` | 45 | 查 MAX 即時行情 |
| `get_account_balance` | 66 | 查帳戶餘額（Private API，**只讀**） |
| `calculate_trade_scenarios` | 71 | 算三方案（金額／手續費／賣後集中度） |
| `prepare_order` | 91 | 產生**確認卡**（不下單） |
| `query_knowledge` | 109-121 | RAG 查防詐語料——**只有設了 `KB_ID` 才動態加入清單** |

**清單裡沒有下單函式。這是整個系統最重要的一行「不存在」。** 詳見 §5。

---

## 4. 資料從哪來

### 4.1 行為健檢（離線預算，不即時算）

```
data/MaiCoin_transactions.csv          ← 官方交易紀錄，鐵則：不進 git
   │  analysis/precompute.py  （輸入 L21 / 輸出 L22, L345）
   ▼
data/health_report.json                ← 隨 Lambda 打包，/health 直接回它
```

`main()`（`precompute.py:326-346`）組出的區塊：
`generated_at`、`row_count`、`period`、`chase_index`、`opportunity_cost`、`realized_pnl`、
`concentration`、`cash_flow_behavior`、`activity_profile`、`holdings_snapshot`、
`change_attribution`、`holding_period_distribution`。

**為什麼離線算**：一年上萬筆交易做配對與歸因，不可能在對話的 60 秒內算完；
而且分析結果一天內不會變，即時算是浪費。代價是換 CSV 要重跑一次。

### 4.2 外部整合（`backend/integrations/`）

| 模組 | 對外做什麼 | 關鍵函式 |
|---|---|---|
| `max_public.py` | MAX 公開行情（ticker/kline/depth） | `fetch()` L154、`market_rules()` L129；內含時間正規化與 depth 排序/spread 計算 L28-113 |
| `max_private.py` | 簽章私有 API | `_build_request()` L38-63（HMAC-SHA256）、`balances()` L86-88、`resolve_volume()` L91-136（TWD→幣量換算）、`place_order()` L146-160 |
| `thirdparty.py` | CoinMarketCap 延伸資料 | `quote()` L13；沒設 `CMC_API_KEY` 就回 `None`（L15-16），不會炸 |

RAG 檢索**不在** `integrations/`，在 `tools.py:124-139`（直接呼叫 `bedrock-agent-runtime`）。
Audit 也不在 `integrations/`，在 `backend/agent/audit.py`。

---

## 5. 三道「AI 碰不到」的設計（安全敘事的技術本體）

這三條不是寫在提示詞裡的請求，是**結構上做不到**。

### 5.1 下單函式不在工具清單

`execute_order` 確實存在（`tools.py:241-247`），但：

- **不在** `TOOLS` 清單（`tools.py:21-105`）→ 模型看不到這個工具的存在
- **不在** `_DISPATCH` 分派表（`tools.py:250-259`）→ 就算模型幻覺出這個名字，也沒有東西會執行它
- 唯一真正送單的路徑是 `backend/handlers/order.py:56`（`max_private.place_order`），
  那是一支獨立的 Lambda，由前端在使用者按下確認後直接呼叫

`order.py:12` 的註解把這條說得很清楚：「LLM 只能透過 `prepare_order` 產生確認卡，碰不到這裡」。

> **為什麼要這樣做**：靠提示詞說「不要下單」，是在賭模型每次都聽話；
> 把函式從清單裡拿掉，是讓「聽不聽話」這件事變得無關緊要。
> 提示詞攔的是意圖，架構攔的是能力。

### 5.2 下單要憑證，60 秒過期

- `CONFIRM_TTL_SEC = 60`（`tools.py:19`）
- `prepare_order()`（`tools.py:220-238`）產出 `confirm_token` 與 `ttl_seconds`
- 過期檢查 `order.py:25, 29`；過期回 **410**（`order.py:51-53`）

所以「AI 幫我下單」在這個系統裡不只是被拒絕，而是**沒有任何一條路徑存在**：
模型產不出憑證以外的東西，憑證要人按，而且 60 秒後自己失效。

### 5.3 全程留痕

`audit.py:27-41` 的 `log()` 用 DynamoDB `list_append` 寫入，**append-only**。實際記錄的事件：

| 事件 | 埋點 |
|---|---|
| `tool_call` | `loop.py:142` |
| `draft_created` | `tools.py:226` |
| `user_confirmed` | `order.py:54` |
| `user_cancelled` | `order.py:45` |
| `expired` | `order.py:52` |
| `executed` | `order.py:58` |

前端的決策軌跡面板讀 `GET /audit` 把這串畫出來——**使用者看得到 AI 做了什麼**，
不是黑箱。

### 5.4 護欄（三層，任一層可獨立擋住）

| 層 | 位置 | 擋法 |
|---|---|---|
| 提示詞 | `loop.py:20` | 系統提示明訂「永不主動建議買賣特定標的」 |
| 程式層 | `guardrails.py:8-13` `_ADVICE_PATTERNS` + `check_output()` L79-100 | 正則掃輸出，命中就整段換成 `SAFE_FALLBACK`（L103-106） |
| 前端 | `frontend/chat-core.js:26-31` | 另一份 FORBIDDEN 字典，後端萬一漏了前端再擋一次 |
| Bedrock Guardrails | `loop.py:109-115` | 設了 `GUARDRAIL_ID` 就自動掛上，與上面疊加 |

程式層特別做了 `_SAFETY_CONTEXT`（`guardrails.py:24-29`）排除誤判——
防詐教育內容裡本來就會出現「保證獲利」這種詞（是在教人辨識它），
不做這個排除，反詐騙功能會被自己的護欄擋掉。

---

## 6. 前端架構

**零建置**：純 HTML + vanilla JS，沒有打包器、沒有框架、沒有 `node_modules` 進 production。
決賽當天不會因為 build 掛掉而開天窗——這是刻意的保險，不是偷懶。

### 分層規律

```
<page>.html          畫面骨架與樣式
<page>.js            進入點與 DOM 操作
<page>-core.js       純邏輯與資料驗證（不碰 DOM，可單獨測）
<page>-service.js    取資料／呼叫 API／適配資料形狀
mocks/<page>.js      離線假資料
```

規則：**UI 永遠不直接讀 mocks**，一律經過 service 層。這樣把 mock 換成真 API 時，UI 一行都不用改。

### 七個頁面

| 頁 | 需要 API_BASE | 說明 |
|---|---|---|
| `welcome.html` | ✅ | 入口、問卷 |
| `onboarding.html` | ✅ | 授權與分析 |
| `index.html` | ✅ | Golden Path 主程式（健檢＋對話＋下單） |
| `chat.html` | ✅ | 問麥麥 |
| `home.html` | ❌ | 純前端 mock |
| `insights.html` | ❌ | 純前端 mock |
| `settings.html` | ❌ | 純前端 mock |

部署時**只有那四頁**要改 `API_BASE`；另外三頁沒有是正常的。
`scripts/verify_live_ui.js` 的 L3 會自動驗這件事（漏改任一頁不會報錯，只會靜默走假資料）。

### 離線備援

任一 API 掛掉，前端自動切 mock 並亮「離線展示」標示，Golden Path 全程照走完
（`app.js:170` `loadHealth` catch、`app.js:203` `loadMarket`、`app.js:366` 對話 catch）。

**刻意不做的**：行情**沒有**離線假價格。斷網時四格顯示「—」。
顯示一個看起來很正常的假價格，比顯示「—」危險得多——使用者會拿它做決定。
`scripts/smoke_frontend.js` 有一條反向斷言把這個行為釘死。

---

## 7. 已知的架構落差（誠實條款）

盤點時發現、尚未修的：

| # | 落差 | 影響 | 歸屬 |
|---|---|---|---|
| 1 | `infra/template.yaml` **未宣告** `GUARDRAIL_ID`、`ENABLE_PROMPT_CACHE`，但 `loop.py:14, 109-115` 依賴它們 | 每次 `sam deploy` 都會把主控台手動設的值清掉（同 `DEPLOY.md` §2 對 MAX 金鑰的警告）。症狀是 Guardrails 悄悄失效 | D／infra |
| 2 | `README.md:264` 的 API 範例寫 `"tool":"get_portfolio"`，但實際工具叫 `get_account_balance`（`tools.py:66`）。`get_portfolio` 在 `backend/` 全域搜尋不到 | §3 是套件間交接的唯一依據，照著接會接錯 | 文件 |
| 3 | 根目錄 `profile_engine.py` 未被 `backend/` 任何檔案 import | 疑似棄用或示範檔。**不要拿它當「上線中的合規邏輯」的證據** | 待確認 |

前兩項已知歸屬明確；第 3 項在確認前不刪（可能是別的包還在用）。

---

## 8. 相關文件

| 想知道什麼 | 看哪 |
|---|---|
| 怎麼把它跑起來 | [ONBOARDING.md](ONBOARDING.md) |
| 合規怎麼設計的 | [COMPLIANCE.md](COMPLIANCE.md) |
| 怎麼部署 | [DEPLOY.md](DEPLOY.md) |
| 部署完怎麼驗 | [TEST_CHECKLIST.md](TEST_CHECKLIST.md) + `npm run verify:ui -- --base <網址>` |
| API 介面契約 | [../README.md](../README.md) §3 |
