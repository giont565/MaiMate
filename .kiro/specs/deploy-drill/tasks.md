# Tasks — deploy-drill

> 🤖 ＝ Kiro 可直接執行｜👤 ＝ 人在主控台／手機做完再回來勾
> 開始前記下時間：＿＿:＿＿（目標 60 分鐘內走完 1–14）

## 準備

- [ ] 1. 🤖 確認在最新 main：`git checkout main && git pull --rebase origin main && git log -1 --oneline`
  - 預期看到最新的 merge commit；**若本地有舊 `main` 分支會靜默帶你回舊版**，一定要看 log 確認
- [ ] 2. 🤖 環境自檢：`bash scripts/setup.sh`
  - 檢查 AWS CLI／SAM CLI／Python 版本；缺什麼它會講

## 資料（R1）

- [ ] 3. 👤 把官方 CSV 放到 `data/MaiCoin_transactions.csv`（Drive 下載，**不要 commit**）
- [ ] 4. 🤖 產生報告：`python3 analysis/precompute.py`
- [ ] 5. 🤖 驗證四區塊齊全：
  ```bash
  grep -o '"realized_pnl"\|"holdings_snapshot"\|"change_attribution"\|"holding_period_distribution"' data/health_report.json
  ```
  - 必須回 **4 行**；少了就是 CSV 沒讀到或欄位不符（看 `.kiro/steering/data-schema.md`）
- [ ] 6. 🤖 提交產物（解 #27／#29）：
  ```bash
  git add data/health_report.json && git commit -m "data: 重跑 health_report（補 realized_pnl＋三聚合值）" && git push origin main
  ```

## 後端（R2）

- [ ] 7. 🤖 建置與部署：`cd infra && sam build && sam deploy`
  - 首次在此機器上跑要 `sam deploy --guided`；**stack 名沿用 `maimate`**，換名字會開出第二套環境
- [ ] 8. 👤 抄下 Outputs 的 **ApiUrl** 與 **FrontendUrl**（後面兩步都要用；FrontendUrl 同時是隊友要的測試網址）
- [ ] 9. 👤 主控台設 MAX 金鑰——**ChatFunction 與 OrderFunction 兩支都要**
  - Lambda → 函式 → Configuration → Environment variables → **Edit → Add**（新增，不是取代）
  - 🚨 不要用 CLI `--environment`（整組取代，會清掉 `TABLE_NAME`／`KB_ID`／`BEDROCK_REGION`）
  - 🚨 金鑰不進檔案、不貼進 Kiro 對話、截圖不入鏡（鐵則2）
  - `KB_ID`／`BEDROCK_REGION` 模板已自動帶入，**不用手動加**

## 前端（R3）

- [ ] 10. 🤖 改 API_BASE（把 `<ApiUrl>` 換成第 8 步的值）：
  ```bash
  sed -i 's#window.API_BASE = "[^"]*"#window.API_BASE = "<ApiUrl>"#' frontend/*.html
  grep -oh 'window.API_BASE = "[^"]*"' frontend/*.html | sort -u
  ```
  - 第二行必須**只輸出一行**；多行代表有頁沒改到（漏改不會報錯，只會靜默走離線 mock）
- [ ] 11. 🤖 上傳：`aws s3 sync frontend/ s3://<FrontendBucket>/`

## 驗證（R4）

- [ ] 12. 🤖 三支探針：
  ```bash
  curl -s "<ApiUrl>/audit?session_id=probe"
  curl -s "<ApiUrl>/market?market=btctwd&kind=ticker" | head -c 300
  curl -s "<ApiUrl>/health" | head -c 200
  ```
  - `/audit` 不回 404、`/market` 有 `fetched_at_taipei`、`/health` 有 `realized_pnl`
  - **任一不符就停下來回查，不要繼續往下測**
- [ ] 13. 👤 手機開 FrontendUrl，走 `docs/TEST_CHECKLIST.md` **D 段 18 項**
  - 最關鍵五項：健康分圓環是圓的／「去年我虧最多的是哪一筆」分清虧損與少賺／
    三方案數字可驗算／確認卡按取消／關 Wi-Fi 走離線劇本
- [ ] 14. 👤 記錄結束時間，把總耗時填回 `docs/DEPLOY.md` 末行「演練實測時間」

## 收尾（R5／R6）

- [ ] 15. 🤖 把演練發現的坑改進 `docs/DEPLOY.md`，commit 推上去（不另開文件）
- [ ] 16. 👤 Kiro 證據截圖存 Drive（不含金鑰／CSV／個資）：
  - Specs 面板展開 `.kiro/specs/`（六份 spec 三件套）
  - **本 spec 的 task 逐項勾選過程**（最有說服力的一張）
  - MCP 設定（`.kiro/settings/mcp.json` 在 Kiro 介面中的樣子）
  - steering 自動載入（`workflow.md` 生效）
  - credit 用量（決賽當天要留 ≥700）
