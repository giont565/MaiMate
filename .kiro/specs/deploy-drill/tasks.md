# Tasks — deploy-drill

> 🤖 ＝ Kiro 可直接執行｜👤 ＝ 人在主控台／手機做完再回來勾
> 開始前記下時間：＿＿:＿＿（目標 60 分鐘內走完 1–14）

## 準備

- [ ] 0. 🤖 **盤點現有環境**（唯讀，不改動任何東西——之前部署過就從這步開始）：
  ```bash
  aws sts get-caller-identity --query Account --output text          # 確認是哪個帳號
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
    --query 'StackSummaries[].{Name:StackName,Time:LastUpdatedTime}' --output table
  aws cloudformation describe-stacks --stack-name maimate \
    --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' --output json
  ```
  - 先看清楚有幾套環境、叫什麼、狀態是否健康，再決定要更新哪一套
  - 狀態若是 `*_IN_PROGRESS` 或 `ROLLBACK_FAILED`，**先處理完再部署**，不要疊上去
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

- [ ] 7. 🤖 建置與部署（repo 沒有 `samconfig.toml`，所以參數要寫明；裸跑 `sam deploy` 會卡在互動提問）：
  ```bash
  npm run build:sam
  sam deploy --template-file .aws-sam/build/template.yaml --stack-name maimate \
    --region us-east-1 --capabilities CAPABILITY_IAM --resolve-s3 \
    --parameter-overrides KnowledgeBaseId=<你這個帳號的 KB ID> \
    --no-confirm-changeset --no-fail-on-empty-changeset
  ```
  - **stack 名沿用 `maimate`**，換名字會開出第二套環境
  - 🚨 `KnowledgeBaseId` 的模板預設值 `DSIYBVI1IX` 是 **B 包隊員自己帳號**裡的 KB，
    在別的帳號（含決賽官方新環境）**不存在**。不覆寫的話 RAG 會靜默失效——
    畫面看不出異狀，只是回答沒有出處。沒有自己的 KB 就先不要設 `KB_ID`，
    工具會自動不註冊，至少不會假裝有 RAG
  - 想先看會改什麼再決定：把 `--no-confirm-changeset` 換成 `--no-execute-changeset`，
    它會印出變更清單但不執行。看 `Replacement` 欄——全是 `False` 代表 API ID 不變、
    `API_BASE` 不用改
- [ ] 8. 👤 抄下 Outputs 的 **ApiUrl**、**FrontendUrl**、**FrontendDistributionId**（第 10–12 步都要用）
  - FrontendUrl 現在是 **CloudFront HTTPS 網址**（PR #40 之後），不再是 s3-website 網址
- [ ] 9. 👤 主控台設 MAX 金鑰——**ChatFunction 與 OrderFunction 兩支都要**
  - ⚠️ **模板的 Environment 區塊有變動時**，CloudFormation 會把函式設定收斂回模板，
    手動加的金鑰不在模板裡（鐵則2）就會被移除。純程式碼部署（沒動 template.yaml）
    則不會被清掉——07/28 連續兩次部署實測金鑰都存活
  - 所以規則是：**每次部署後都用下面這行確認一次**，被清掉才重設，不必每次盲補
    ```bash
    for f in ChatFunction OrderFunction; do
      printf "%s: " "$f"
      aws lambda get-function-configuration --function-name "$(aws cloudformation describe-stack-resources \
        --stack-name maimate --logical-resource-id $f --query 'StackResources[0].PhysicalResourceId' --output text)" \
        --query 'Environment.Variables' --output json | python3 -c "import json,sys;print(', '.join(sorted((json.load(sys.stdin) or {}).keys())))"
    done
    ```
    看到 `MAX_API_KEY, MAX_API_SECRET` 就是還在（**只印 key 名稱不印值**）
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
- [ ] 11b. 🤖 **清 CloudFront 快取**（PR #40 之後新增的必要步驟，漏掉會讓使用者拿到舊檔）：
  ```bash
  aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
  ```
  - 症狀：檔案明明 sync 上去了，開網頁卻還是舊版，且**不會有任何錯誤訊息**
  - S3 bucket 現在是私有的（OAC），**舊的 `*.s3-website-*.amazonaws.com` 網址會失效**，
    對外只給 FrontendUrl 那個 HTTPS 網址

## 驗證（R4）

- [ ] 12. 🤖 自動驗收（取代原本手打三支 curl，涵蓋 21 項）：
  ```bash
  python3 scripts/verify_live.py --base <ApiUrl>
  ```
  - 它**永遠不會送出真實訂單**（對 `/order` 只送 `action=cancel`，且有硬性擋條）
  - 失敗項會直接印出原因，貼回對話就能修
  - ⚠️ 模型有不確定性：同一句買賣意圖偶爾會反問而不直接出三方案，
    D9／D12／D13／D15 若整組失敗，**先重跑一次**再判定為真的壞掉
  - **任一項失敗就停下來回查，不要繼續往下測**
- [ ] 13. 👤 手機開 FrontendUrl，走 `docs/TEST_CHECKLIST.md` **D 段 18 項**
  - 最關鍵五項：健康分圓環是圓的／「去年我虧最多的是哪一筆」分清虧損與少賺／
    三方案數字可驗算／確認卡按取消／關 Wi-Fi 走離線劇本
- [ ] 14. 👤 記錄結束時間，把總耗時填回 `docs/DEPLOY.md` 末行「演練實測時間」

## 收尾（R5／R6）

- [ ] 15. 🤖 把演練發現的坑改進 `docs/DEPLOY.md`，commit 推上去（不另開文件）
- [ ] 16. 👤 Kiro 證據截圖存 Drive（不含金鑰／CSV／個資）：
  - Specs 面板展開 `.kiro/specs/`（八份 spec，每份三件套）
  - **本 spec 的 task 逐項勾選過程**（最有說服力的一張）
  - MCP 設定（`.kiro/settings/mcp.json` 在 Kiro 介面中的樣子）
  - steering 自動載入（`workflow.md` 生效）
  - credit 用量（決賽當天要留 ≥700）
