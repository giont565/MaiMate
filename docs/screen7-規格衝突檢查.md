# Screen 7 初版規格 × 現有專案：衝突檢查

檢查於 2026-07-27，對照分支 `feat/frontend-screen6-home`。
每條都回查過程式碼或 README，附檔案:行號。**先看第一節，那條會影響決賽 demo 能不能跑。**

---

## 一、致命衝突：規格把 Golden Path 拿掉了

**規格 §11「禁止工具」＋「本次不要實作」明確排除 `place_order` 與任何下單流程；通篇也沒有提到三方案卡、下單確認卡、決策軌跡面板。**

但：

- README.md:189-193 的**決賽 90 秒 Golden Path 腳本**是：
  「ETH 跌太多幫我全賣」→ 查持倉/行情/歷史 → **三方案** → 使用者選 → **確認卡（60 秒時效）** → `POST /order` → 健檢更新 → **決策軌跡面板**
- 這條主線**就住在 Screen 7 這一頁**（`frontend/index.html` + `app.js`，功能已全部實作完成）。
- README.md:1-4 自陳是「唯一開發文件」，Golden Path 是評分主線。

**照規格做＝決賽 demo 的主線沒有舞台。**

### 好消息：兩者其實可以並存，是規格的措辭需要修

規格真正禁止的是「**AI 自行執行下單**」「**在聊天回答中直接執行**」「**自動呼叫下單 Skill**」——這與現有實作**並不衝突**，因為現況本來就是：

- `execute_order` 對 LLM 隔離（README.md:295-302，後端保證）
- AI 只能 `prepare_order` 產出確認卡
- **必須由使用者親手按下確認鈕**才會呼叫 `POST /order`

**建議措辭**：把 §11 改成「AI 不得自行執行交易；下單只能由使用者在確認卡上親自確認，且確認卡由後端 `prepare_order` 產生」，而不是「本次不要實作」。

**這是要跟隊友先拍板的第一件事。**

---

## 二、後端不存在的東西（規格假設有，實際沒有）

| 規格要求 | 實際現況 | 出處 |
|---|---|---|
| `POST /api/v1/maimate/conversations` 等 6 個新 endpoint | **不存在**。後端只有 5 個 Lambda：Chat／Health／Market／Order／Audit | `infra/template.yaml:54,62,70,82,92` |
| SSE 事件流（`message.accepted`／`tool.started`／`response.delta`…） | **`/chat` 是一次性 JSON**，沒有串流 | `backend/handlers/chat.py:42` |
| 「Context 必須由後端重新讀取，不可信任前端 payload」 | 後端**根本沒接** `navigation_context`（前端 `app.js:322` 已在送，`grep navigation_context backend/` 零命中） | — |
| 「Conversation 不可跨使用者讀取」 | Demo **沒有登入系統**，只有匿名 demo session，沒有 userId 可比對 | `onboarding-core.js` |
| 10 個 Agent 工具（`get_portfolio_summary` 等） | 後端 chat agent 用的是另一套命名（`query_user_history`／`query_knowledge`／`prepare_order`…） | README.md:295-302 |

**建議**：照 Screen 2–6 的一貫做法——**前端把這整套 mock 在 Service 層後面**（`MockMaiMateConversationService`），介面照規格定，正式 API 留 TODO。這樣不必等後端，也不會寫死。
但 **§32 的測試 #4「Context ID 會由後端驗證」與 #25「Conversation 不可跨使用者讀取」在 Demo 階段無法真的驗證**，規格要誠實標成「待後端」，不要寫成已完成。

Streaming 建議：**Mock 端可以模擬串流**（我們可以做），正式端在後端加 SSE 之前先用「整理中→整段出現」。**不要做假的打字動畫**——那是欺騙。

---

## 三、與既有天條/實作直接打架的三處

### 3-1. Analytics 參數（**需要你決定**）

- 規格 §29 允許 `conversationSource`／`intentCategory`／`toolType`／`communicationStyle`／`guardrailCategory`／`evidenceCount`／`followUpQuestionId` 等參數。
- 但現行約束是 **`mm_events` 只准 `{e}` 或 `{e,q}`**，而且**四支煙測硬鎖**：`smoke_onboarding.js:204`、`smoke_analysis.js:554`、`smoke_home.js:239,578`、`smoke_welcome.js:128`。

→ 二選一：(a) 放寬白名單欄位（只准列舉值，禁自由文字與金融數字），同步改四支煙測；(b) 只記事件名，把分類編進 `q`。**我建議 (a)**，但這是隱私約束的鬆綁，要你點頭。

### 3-2. 技術棧（形式轉譯，不影響意圖）

規格提到 React Component、`lint`／`type check`／`production build`、30 個 React 元件樹。我們是**零建置 vanilla SPA**（S3 直接託管，README.md:135；CI 只跑 Playwright smoke）。

→ 照 Screen 2/3 的先例處理：型別用 JSDoc typedef、元件用 render 函式模組（沿用 `home.js` 的 `moduleRenderers` 模式）、驗收用 `node --check` ＋ Playwright。**規格的意圖（結構化訊息區塊、不要把回覆塞成一坨 Markdown）完全保留。**

### 3-3. 對話紀錄的保存（**需要你決定**）

規格 §25 要對話歷史清單、§20 要 Conversation 持久化。但 Screen 6 現行原則是「**完整 response 只存 30 分鐘同分頁 sessionStorage，不長期寫 localStorage**」（因為回覆裡含個人化數字）。

→ 要決定：對話存哪、存多久、retention 怎麼設。**建議**：只長期保存「標題＋來源標籤＋時間」，訊息內容比照 Screen 6 用 session cache，重開瀏覽器不還原內容（清單仍在，點進去顯示「這段展示對話已過期」——規格 §28 本來就有這個狀態）。

---

## 四、Demo 數字衝突（照規格寫會自打嘴巴）

規格 §24 的固定工具結果與 §8 的範例回答，**有五個數字與我們唯一的資料來源 `frontend/mocks/onboarding.js` 對不上**：

| 規格寫的 | 實際 mock | 出處 |
|---|---|---|
| ETH 占比 26% | **20%** | `mocks/onboarding.js:16` |
| 其他資產合計 22% | **28%**（DOGE 17% ＋ USDT 11%） | `mocks/onboarding.js:17-18` |
| 前兩項資產合計 78% | **72%** | 同上 |
| 最近 30 天 **3 次**交易 | **1 筆** | Screen 6 實測 |
| 過去 12 個月平均每月 **4 次** | **約 0.7 筆** | 同上 |
| 「3 月那次」相似時刻／`moment_202603` | **不存在**，只有 2026/01/08–09 兩筆 DOGE | `mocks/onboarding.js:27-28` |

對得上的：BTC 52% ✓、4 項資產 ✓、歸因 BTC 68%／近期交易 7% ✓（`mocks/home.js` 的 68/21/7/4，「其他市場與配置」21+4=25% 也對得上規格的 25%）。

**這很重要**：Screen 6 會說「平均每月約 0.7 筆」，Screen 7 若照規格說「平均每月約 4 次」，**同一個 demo 帳戶在相鄰兩頁講不同的話**，評審一問就穿幫。規格的固定回答要改寫成 mock 的真數字，或改 mock（但改 mock 會連動 Screen 4/5/6 的所有數字與煙測）。**建議改規格文字，不要動 mock。**

---

## 五、視覺規則的兩處衝突

1. **「不使用紅綠表示好壞」（§31.10）**：但現有 Golden Path 用紅綠——已實現損益 `pos`/`neg`（`app.js:110`）、健檢卡 `--red`/`--green`（`app.js:144,147`）。→ 要決定是「Golden Path 區塊維持財務慣例、對話區塊不用紅綠」還是全面改。
2. **「不顯示 Tool Name」（§13）**：現況 `tool_trail` 直接以 chips 呈現工具鏈（`app.js:209-213`）。→ 要加一層「工具名稱 → 使用者語言」對照表（例：`query_user_history` →「正在查看你的持倉摘要」）。**這層對照要跟後端的工具命名對齊**，否則新工具一加前端就顯示不出來。
3. 小事：Composer 規格寫最多 1,000 字，現有首頁 chat input 是 160 字（`home.html:351`）——首頁那個只是入口，Screen 7 自己的 composer 照規格做即可。

---

## 六、規格與現況**相符**的部分（可以直接沿用，不必重做）

- **Context Banner 機制已備好**：`chat-context.js` 已實作來源卡＋預填問題，且**使用者確認後才送出**（規格 §6 的「不要自動送出」我們本來就是這樣做）。
- **路由白名單已備好**：`navigation-context.js:78-95` 已把 `/maimate/chat` 解析到本地檔案，含同源、路徑穿越、`javascript:` 防護。
- **三種語氣模式已實作**：規格 §9 的 guided／concise／analytical，我剛在 Screen 6 做完（跟著問卷 Q6，可在首頁切換）。Screen 7 可直接沿用同一個偏好。
- **禁語攔截器已存在**：`home-core.js:82-110` 有 runtime 禁語檢查（涵蓋規格 §19 的心理標籤與 FOMO 字眼）。但**它只檢查特定欄位名**，Screen 7 的新欄位要記得加進 walk 清單（審查已抓到這個漏洞）。
- **不顯示 Chain of Thought**、**不報明牌**、**不保證獲利**、**不索取金鑰** ✓ 與現有天條完全一致。

---

## 七、要跟隊友拍板的六件事（建議照這個順序談）

1. **Golden Path 怎麼共存**（第一節）——最緊急，會影響決賽腳本。
2. **`navigation_context` 要不要進後端契約**——決定來源卡是真有作用還是裝飾。
3. **要不要請後端加 SSE**——決定 streaming 是真的還是 mock 模擬。
4. **Analytics 白名單要不要放寬**（3-1）——影響四支既有煙測。
5. **對話紀錄保存策略**（3-3）——影響隱私原則的一致性。
6. **Demo 固定回答的數字改寫**（第四節）——不改就會前後頁互相打臉。

拍板後我把規格的形式轉譯成零建置版本（JSDoc typedef＋render 函式＋Service 層 mock），並照慣例先列「預計新增/修改檔案＋驗收條件」給你確認再動手。
