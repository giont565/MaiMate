# Structure Steering — 目錄結構與擺放約定

新增檔案前先看這裡：**東西放錯目錄，比寫錯還難發現。**

## 目錄地圖

```
analysis/       離線分析（無外部依賴，本機跑，產出進 data/）
  precompute.py         官方 CSV → data/health_report.json
  strategy_compare.py   MAX 公開日線 → data/strategy_report.json
backend/
  agent/        Agent 核心：loop（Converse 迴圈）／tools（工具定義與 dispatch）／
                guardrails（PII＋明牌攔截）／scenarios／profile／holdings／audit／demo_account
  handlers/     五支 Lambda 入口，各自單一職責：chat／health／market／order／audit
                （portfolio.py 由 health 路徑共用）
  integrations/ 對外 API：max_public（免金鑰行情）／max_private（簽章、下單）／thirdparty
data/           預計算產物（JSON，可進 git）；原始 CSV 與語料不進 git
frontend/       零建置多頁 vanilla JS；mocks/ 是離線劇本
infra/          SAM 模板與部署參數（template.yaml 唯一真相）
scripts/        一次性工具：setup／deploy／smoke_*／verify_*／record_*／shot_*
tests/          Python 單元測試（unittest，離線可跑）
docs/           對外文件、簡報產生器、Demo 素材
  _internal/    隊內文件（已 gitignore，不進公開 repo）
.kiro/          steering（本層）＋ specs（功能規格三件套）
```

## 擺放規則

1. **金融數字的計算一律放 `backend/agent/` 或 `analysis/`**，不放 handler、不放前端、
   更不交給 LLM 生成。handler 只做 I/O 與驗證。
2. **對外 API 呼叫只出現在 `backend/integrations/`**；agent 層透過工具介面取用，
   不直接 `urlopen`。
3. **前端每頁三件套**：`X.html`（結構）／`X-core.js`（純函式，可被 node 煙測直接 require）／
   `X.js`（DOM 綁定）。純函式與 DOM 操作分開，才有得測。
4. **新增前端頁面必須同步兩處**：`frontend/*.html` 的 `API_BASE`（用 glob 一起改，別逐檔）
   與 `scripts/verify_live_ui.js` 的 `PAGES` 清單。漏改不會報錯，只會拿到假資料。
5. **新增 Lambda 必須同步三處**：`backend/handlers/`、`infra/template.yaml`、
   `docs/TEST_CHECKLIST.md` 的 C 段。

## 命名約定

| 類型 | 樣式 | 例 |
|---|---|---|
| 煙測腳本 | `scripts/smoke_<頁面>.js` | `smoke_chat.js` |
| 線上驗證 | `scripts/verify_<對象>.py\|js` | `verify_live.py` |
| 前端純函式 | `frontend/<頁面>-core.js` | `home-core.js` |
| 離線劇本 | `frontend/mocks/<頁面>.js` | `mocks/chat.js` |
| Kiro 規格 | `.kiro/specs/<kebab-case>/{requirements,design,tasks}.md` | `order-flow/` |

## 永不進 git

官方 CSV（`data/MaiCoin_transactions.csv`）、RAG 語料、任何金鑰或兌換碼、
`docs/_internal/`、`node_modules/`、`.aws-sam/` 建置產物。
規則寫在 `.gitignore`，**不要用 `git add -f` 繞過**。
