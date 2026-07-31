# ONBOARDING.md — 30 分鐘上手

> 給三種人：接手開發的組員、想驗證我們沒吹牛的評審、以及三個月後忘光的自己。
> 每一步都實跑過（2026-07-31）。指令直接複製貼上就行。
>
> **不需要 AWS 帳號、不需要金鑰、不需要官方 CSV，也能把整個產品跑起來。**
> 這是刻意的設計，不是妥協——見 §3。

---

## 0. 五分鐘看懂這是什麼

散戶賠錢，多半不是因為不懂技術分析，是因為**恐慌時做了跟上次一樣的決定**。

MaiMate 做的事：使用者打「ETH 跌太多，幫我全部賣掉」，系統不照做，
而是先把他**自己去年的紀錄**攤開——「今年 1/8 你也這樣全賣過，到年底少賺了 NT$312,924」——
再給三個算好數字的選項，最後一步一定由人按。

技術上的核心不是模型多聰明，是**三件 AI 做不到的事**：
下單函式不在工具清單、下單憑證 60 秒過期、每一步都留 audit。
細節在 [ARCHITECTURE.md](ARCHITECTURE.md) §5。

---

## 1. 環境檢查（2 分）

```bash
git clone https://github.com/giont565/MaiMate.git && cd MaiMate
bash scripts/setup.sh
```

這支會逐項告訴你缺什麼。**只有前兩項是必須的**：

| 檢查項 | 必要性 |
|---|---|
| git、python3 | 必須 |
| node | 跑前端測試與簡報產生器才需要 |
| aws cli、sam cli | **只有部署才需要**，本機玩不用 |
| `MAX_API_KEY` / `MAX_API_SECRET` | 只有真實下單與查餘額才需要 |
| `data/MaiCoin_transactions.csv` | 只有重算行為報告才需要（見 §5） |

看到金鑰與 CSV 那兩項是黃色警告（不是紅色錯誤）＝**正常**。

---

## 2. 把前端跑起來（1 分）

零建置。沒有 `npm run build`，沒有打包器，沒有等待。

```bash
python3 -m http.server 8791 --directory frontend
```

開 <http://localhost:8791/welcome.html>。

**建議用手機尺寸看**（Chrome DevTools → 390×844）——這是為手機設計的，桌機寬螢幕會看起來很空。

### 走一遍完整動線

| 順序 | 網址 | 看什麼 |
|---|---|---|
| 1 | `/welcome.html` | 入口與問卷，選一種呈現風格 |
| 2 | `/onboarding.html` | 授權與分析，跑完會生出投資樣貌 |
| 3 | `/index.html` | **Golden Path 主程式**——健檢卡＋對話＋下單 |
| 4 | `/home.html?demo=STEADY_PLANNER` | 首頁（純前端 mock） |
| 5 | `/chat.html` | 問麥麥 |
| 6 | `/insights.html` | 深入了解（圖表） |

**最值得看的一段**（30 秒）：在 `/index.html` 輸入「**ETH 跌太多幫我全部賣掉**」，
會看到三方案卡 → 選一個 → 確認卡 → 按下去 → 決策軌跡面板。

### 沒有後端也能全部走完

前端連不到 API 時會自動切離線 mock，右上角亮「**離線展示**」標示，Golden Path 照樣走完。
所以你**現在就可以**體驗完整產品，不用先部署。

有一個例外是刻意的：**行情四格會顯示「—」，不會有假價格**。
斷網時給一個看起來很正常的假價格，使用者會拿它做決定——那比顯示「—」危險得多。

---

## 3. 跑測試（5 分）

```bash
npm install && npx playwright install chromium   # 只需第一次
npm test
```

`npm test` = 後端單元測試 + Python 測試 + 前端主煙測。預期輸出：

```
後端單元測試全部通過 ✅
Ran 35 tests ... OK
全部通過 ✅（截圖 smoke_mobile.png）
```

前端另外有 7 支分頁煙測：

```bash
npm run smoke:welcome && npm run smoke:onboarding && npm run smoke:analysis \
  && npm run smoke:home && npm run smoke:chat && npm run smoke:insights \
  && npm run smoke:regressions
```

全部不需要網路、不需要 AWS、不需要金鑰——**API 全被攔截並以 mock 回應**。
這也是為什麼 CI 跑得動（`.github/workflows/ci.yml` 只有測試，沒有任何 AWS 憑證）。

### 測試裡值得一看的兩種斷言

一般的斷言是「該出現的有出現」。這個 repo 還有兩種比較少見的：

**① 反向誠實斷言**——驗證系統在資料不足時**不會**假裝有資料：
- 斷網時行情必須是「—」，出現任何數字就是失敗（`smoke_frontend.js`）
- 報告缺某區塊時，對應圖表必須顯示「資料不足」而非畫一張空圖

**② 數字一致性守門**——文字裡出現的每個數字，都必須同時出現在那則回答的 `evidence` 裡，
否則整段換成安全模板（`frontend/chat-core.js`）。這是為了讓「AI 講的數字」永遠指得出來源。

---

## 4. 讀程式碼的順序

不要從頭讀。照這個順序，一小時內能有全貌：

| # | 檔案 | 為什麼先讀這個 |
|---|---|---|
| 1 | `backend/agent/tools.py` L21-105 | **LLM 能做的事全部在這**。看完就知道系統的能力邊界 |
| 2 | `backend/agent/tools.py` L241-259 | 對照上面——`execute_order` 在檔案裡，但不在清單也不在分派表。整個安全設計的核心 |
| 3 | `backend/agent/loop.py` L60-67, L117 | 模型路由與 Bedrock 呼叫，對話迴圈的本體 |
| 4 | `backend/agent/guardrails.py` L79-100 | 護欄怎麼擋；順便看 L24-29 怎麼避免擋掉反詐內容 |
| 5 | `analysis/precompute.py` L326-346 | 行為報告有哪些區塊——前端所有數字的源頭 |
| 6 | `frontend/app.js` | Golden Path 前端全程；離線 fallback 在 L170/203/366 |

前端分層規律（`<page>.html` / `.js` / `-core.js` / `-service.js` / `mocks/`）見
[ARCHITECTURE.md](ARCHITECTURE.md) §6。**UI 永遠不直接讀 mocks**，一律經 service 層。

---

## 5. 重算行為報告（需要官方 CSV）

```bash
# CSV 從 Drive 下載放到 data/MaiCoin_transactions.csv —— 鐵則：CSV 不進 git
python3 analysis/precompute.py            # 產出 data/health_report.json
npm run build:account                     # 把報告轉成前端可用的 mock
```

第二步很重要：`frontend/mocks/account.js` 是**產生的，不是手抄的**。
永遠不要手動改它——改了下次重跑就沒了，而且會讓前端數字跟報告對不上。

沒有 CSV 也沒關係：`data/health_report.json` 已在版控裡，前端讀得到。

---

## 6. 部署（需要 AWS）

完整步驟在 [DEPLOY.md](DEPLOY.md)（目標 < 1 小時）。部署完跑這兩支自動驗收：

```bash
python3 scripts/verify_live.py --base <ApiUrl>          # 後端 API 行為
npm run verify:ui -- --base <FrontendUrl>               # 前端與部署新鮮度
```

`verify:ui` 專門抓三種「不會報錯的部署災情」：
CloudFront 沒 invalidate（使用者拿到舊快取）、漏 sync 某幾個檔、某頁 `API_BASE` 忘了改。
這三種都是畫面看起來完全正常，但跑的不是你以為的那份程式。

---

## 7. 動手前必須知道的紅線

| # | 紅線 | 為什麼 |
|---|---|---|
| 1 | **官方 CSV 與 RAG 語料絕不進 git** | 授權限競賽用途 |
| 2 | **金鑰絕不進 git、不進簡報、不進 Slack**；截圖要遮 | 一旦進了版控歷史就洗不掉 |
| 3 | **AI 永不報明牌** | 見 [COMPLIANCE.md](COMPLIANCE.md) §2 |
| 4 | **`execute_order` 永不加進 LLM 工具清單** | 見 [COMPLIANCE.md](COMPLIANCE.md) §1。這條是整個安全敘事的地基 |
| 5 | **數字必須指得出來源**（檔案或使用者原話） | 推測值在金融產品裡會活很久並污染下游 |

第 5 條的實務意思：要在畫面或簡報上寫一個數字，你必須能回答「這個數字從哪個檔案的哪一格來的」。
答不出來就**留空並標示「資料不足」**，不要填一個合理的值。

---

## 8. 常見卡關

| 症狀 | 原因與解法 |
|---|---|
| `npx playwright install` 很慢 | 正常，在下載瀏覽器。只需一次 |
| 煙測報 `browserType.launch` 失敗 | 沒裝瀏覽器 → `npx playwright install chromium` |
| 前端一直顯示「離線展示」 | 本機沒後端＝正常。要接真後端就改各 HTML 的 `API_BASE` |
| `/home.html` 自動跳回 welcome | 正常：還沒完成 onboarding。先走完 welcome → onboarding，或加 `?demo=STEADY_PLANNER` |
| `precompute.py` 找不到 CSV | CSV 不在版控裡，要自己從 Drive 放進 `data/` |
| 改了前端但畫面沒變 | 瀏覽器快取 → 強制重整，或網址加 `?v=2` |

---

## 9. 其他文件

| 想知道什麼 | 看哪 |
|---|---|
| 系統怎麼組起來的 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 合規怎麼設計的、還缺什麼 | [COMPLIANCE.md](COMPLIANCE.md) |
| 怎麼部署 | [DEPLOY.md](DEPLOY.md) |
| 部署完怎麼驗 | [TEST_CHECKLIST.md](TEST_CHECKLIST.md) |
| Demo 怎麼演 | [DEMO_SCRIPT.md](DEMO_SCRIPT.md) |
| 分工、時程、API 契約 | [../README.md](../README.md) |
