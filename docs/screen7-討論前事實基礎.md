# Screen 7（對話頁）規格討論前的事實基礎

寫於 2026-07-27，供 C（前端）與隊友討論 Screen 7 用。
內容全部來自 repo 現況與實測，不是設想。每條都可回查。

---

## 一、最需要先跟隊友對齊的三件事

### 1. `navigation_context` 前端已在送，後端沒有接（**最該先談**）

- 前端 `frontend/app.js:322-325` 送 chat 請求時已附帶 `navigation_context`（Screen 6 的「帶著這張卡的問題去問麥麥」機制）。
- 但 README §3 的 `/chat` 契約**沒有這個欄位**，`backend/handlers/chat.py` 也**沒有讀它**（`grep navigation_context backend/` 零命中）。
- 也就是說：目前從首頁帶問題過去，後端收到的只有問題文字，來源脈絡（哪張卡、哪個洞察、哪筆交易）**整包被丟掉**。
- **要決定**：這個欄位要不要進正式契約？進的話欄位長怎樣、後端怎麼用（放進 system prompt？當作工具參數？只記 audit？）。這決定 Screen 7 的來源卡是「真的有作用」還是「只是畫面上好看」。

### 2. `/chat` 沒有串流（streaming/SSE）

- `backend/handlers/chat.py:42` 是一次性 JSON response。
- 所以 Screen 7 **不能寫「逐字輸出」的規格**，除非隊友願意改後端。要嘛接受「等待→整段出現」，要嘛前端做假的打字動畫（**但這會違反誠實原則，我不建議**），要嘛請後端加 SSE（成本要問 A 包）。

### 3. Screen 1–8 這套畫面編號**不在 source of truth 裡**

- README 與 `.kiro/specs/chat-agent/` 都沒有「Screen 7」字樣；八屏是本輪前端自訂的概念。
- README.md:1-4 明定它是「唯一開發文件」。**Screen 7 規格拍板後，要有人把它寫回 README**，否則隊友（尤其後端）不會知道前端在做什麼。

---

## 二、Screen 7 必須撐住的既有約束

### README 的 Golden Path 90 秒腳本（README.md:189-193）

這是決賽 demo 主線，Screen 7 是它的舞台：

> 「ETH 跌太多幫我全賣」→ 查持倉/行情/歷史 → 三方案 → 使用者選 → 確認卡（60 秒時效）→ `/order` → 健檢更新 → 決策軌跡面板

**任何 Screen 7 的重新設計都不能把這條路走斷。**

### 對話 Agent 的後端保證（README.md:295-302，§4.2）

這些是**後端已經保證的行為**，Screen 7 要做的是「把它們呈現出來」，不是自己重做一套：

| 後端保證 | Screen 7 該做的呈現 |
|---|---|
| 個人問題必查 `query_user_history` | 顯示「這個回答用了你的哪些紀錄」 |
| 行情問題必附時間 | 報價旁顯示時間戳，不可省略 |
| 下單只走 `prepare_order`＋確認卡 | 確認卡是唯一下單入口，且需人工按下 |
| `execute_order` 對 LLM 隔離 | 前端不得提供任何「叫 AI 直接下單」的入口 |
| PII 清洗、迴圈 ≤8 輪 | 迴圈上限到了要有可解釋的收尾訊息 |

### `/chat` 實際契約（README.md:247-265＋`backend/handlers/chat.py:11-42`）

- **Request**：`{messages, mode?, session_id?}`
- **Response**：`reply`（純文字）、`messages`（完整 Converse 歷史，**必須原樣存回**）、`confirm`（含 `confirm_token` 與 `confirmation_card`）、`scenarios`（陣列）、`tool_trail`（陣列）
- 後三個是**條件性欄位**（`chat.py:36-41` 有值才附加）→ Screen 7 的版面必須容忍它們不存在。
- **沒有** RAG 引用來源的獨立欄位；`query_knowledge` 的使用只反映在 `tool_trail` 裡（`chat.py:27-31`）。**Screen 8（名詞解釋）若要顯示「資料來源」，這是個缺口，要跟後端談。**

---

## 三、既有對話頁現況（Screen 7 的改造基礎）

`frontend/index.html` + `frontend/app.js`（346 行）**已經有的**：

訊息氣泡流｜工具鏈 chips（tool_trail）｜三方案卡｜下單確認卡（含滑價警語＋60 秒時效）｜決策軌跡面板（`GET /audit`）｜成交後麥麥轉 BULLISH 六秒｜模式徽章循環（鍵盤可及）｜健康分 hero 卡＋2×2 健檢卡｜行情膠囊列 10 秒輪詢｜**離線 mock 完整可走完 Golden Path**（標「（離線展示）」）

**但它有四個問題**（2026-07-27 三組獨立審查實測）：

1. **整頁脫離設計系統**：用舊色票（`--navy:#16224D`、`--gold`、紅色 #D64550 vs 全站 #E64A4D）、用 `maimate_bot_small.png` 而非 `maimate_hero.png`、圓角 999px。
2. **是死路**：頁面上只有一顆送出鈕，**沒有返回、沒有底部四分頁**——評審點進去就出不來，只能按瀏覽器上一頁。
3. **含自家禁用詞**：`app.js:119` 顯示「投資健康分」，而 `home-core.js:95,109` 自己把它列為禁語。
4. **文案與全站矛盾**：`index.html:130` 寫「依據你 2025 全年 10,000 筆真實交易紀錄」，但全站其他地方標的是「示範資料」，且 mock 只有 8 筆交易。

→ **建議 Screen 7 規格直接把這頁重做**，而不是補丁。功能全留，外殼換成 Screen 6 的設計系統與導覽。

---

## 四、Demo 數字衝突（規格 vs 實際 mock）

寫規格時**不要再引用左欄的數字**，否則畫面會對不上資料：

| 先前規格寫的 | 實際 mock 只有 | 出處 |
|---|---|---|
| 48 筆交易 | **8 筆** | `frontend/mocks/onboarding.js` |
| 前兩項合計 78% | **72%** | 同上 |
| 3 月的相似交易紀錄 | **不存在**（只有 2026/01/08–09 兩筆 DOGE） | 同上 |
| 持有中位數 96 天 | **算不出來**（僅 1 組可配對買賣，門檻 3）→ 顯示「還需要更多資料」 | `investment-analysis.js` |
| 高波動期間 1.6 倍 | **算不出來**（mock 無 `marketRegime` 標記）→ 同上 | 同上 |

**另有一處尚未修的實際矛盾**：`frontend/mocks/home.js:106` 說「DOGE 在兩天內約變動 -7.4%」，但 `mocks/onboarding.js:28-29` 的 DOGE 成交價 9.8→8.9 是 **-9.2%**。這個字串會實際渲染在首頁「那一次」欄位。**要嘛改 mock 對齊，要嘛拿掉這個數字。**

還有一個時效性問題：Screen 6 所有「16 天前」「最近 30 天」都以 `mocks/home.js` 的基準日 **2026-07-27T08:30** 計算。**決賽若不在當天，這些相對日期會與現場日期脫節**——上台前要嘛改基準日，要嘛改成不依賴當天的說法。

---

## 五、環境相容性稽核（寫規格時的硬邊界）

| 項目 | 現況 | 對 Screen 7 的意義 |
|---|---|---|
| 部署 | S3 + CloudFront 純靜態（README.md:135；`app.js:1` 註解） | **不能引入建置步驟**。規格若寫 React/Vue/TS/打包器＝與部署方式衝突 |
| CI | `.github/workflows/ci.yml` 跑 backend 測試＋python 測試＋SAM 驗證/build＋**前端 Golden Path smoke（Playwright）**，失敗會上傳截圖 | **改壞 `npm run smoke` 會擋住整條 CI**，Screen 7 改動必須同步更新該煙測 |
| 建置工具 | 完全沒有（無 webpack/vite/babel 設定） | 同上，零建置是硬約束 |
| package.json ↔ CI | 對得上，無落差 | 新增煙測要記得掛進 CI |
| 後端函式 | 5 個 Lambda：Chat／Health／Market／Order／Audit（`infra/template.yaml:54,62,70,82,92`） | Screen 7 只有這五個可用；要新 endpoint 得先跟後端談 |

---

## 六、Screen 7 規格建議包含的段落（給你們討論時當 checklist）

1. **與 Golden Path 的關係**：90 秒腳本的每一步在新版對話頁長什麼樣（尤其三方案卡與確認卡）。
2. **來源卡（從 Screen 6 帶問題過來）**：顯示什麼、`navigation_context` 要不要進後端契約、使用者確認後才送出的流程。
3. **`tool_trail` 的呈現**：要顯示到什麼程度？（現況是 chips）教育型回答（`query_knowledge`）要不要標「這是知識庫內容，不是針對你的建議」。
4. **不存在的欄位怎麼辦**：`scenarios`／`confirm`／`tool_trail` 缺席時的版面。
5. **等待狀態**：沒有串流的前提下，等待要怎麼呈現才不無聊也不欺騙。
6. **失敗與離線**：現況是整包切離線 mock 並標「（離線展示）」——要保留（決賽保險）還是改？
7. **導覽**：底部四分頁＋返回，與 Screen 6 一致（現況缺，是死路）。
8. **三種版面**：首頁已做（陪我慢慢看懂／先告訴我重點／給我更多數據，跟著問卷 Q6）。對話頁要不要跟著同一個偏好走？
9. **禁用詞與文案**：「投資健康分」在對話頁要換成什麼說法；「10,000 筆真實交易紀錄」要改成什麼。
10. **驗收條件**：照前幾屏慣例，寫成可客觀檢查的清單（會直接轉成 Playwright 煙測）。

---

## 七、目前程式碼已備好的銜接點（Screen 7 可以直接用）

| 檔案 | 提供什麼 |
|---|---|
| `frontend/navigation-context.js` | 產品路由 `/maimate/chat` → `index.html` 的安全解析＋白名單；Screen 7/8 context 的 sessionStorage envelope |
| `frontend/chat-context.js` | 來源卡顯示、問題預填，**使用者確認後才送出**（隱私設計） |
| `frontend/home.js` Sticky Chat | 四個快捷問題（今天變化／我的持倉／過去相似情況／金融名詞）已導向對話頁 |
| `frontend/onboarding-core.js` | `OnboardingStore`（唯一 localStorage 入口）、最小化 analytics（只准 `{e}` 或 `{e,q}`） |
| 設計 token | 色票／字級 44-28-17-14／圓角 16-12，見 `home.html` 與 `onboarding.html` 的 `:root` |
