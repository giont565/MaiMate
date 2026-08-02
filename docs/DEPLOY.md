# DEPLOY.md — 從零部署 SOP（#14）

> 目標：乾淨 AWS 帳號 < 1 小時上線。決賽 8/1 官方環境照此表操課。
> 本版依 07/19 首次部署經驗＋官方文件整理；**7/31 前必須實際演練一次並計時**，
> 演練發現的坑直接改進本文件。

## 0. 前置（一次性，新帳號才需要）｜預估 15 分

- [ ] AWS 帳號可登入，IAM 使用者具 AdministratorAccess（黑客松簡化；正式環境再收斂）
- [ ] 本機裝好：AWS CLI、SAM CLI、Python 3.12、Node（`bash scripts/setup.sh` 檢查）
- [ ] `aws configure`（region 建議 us-east-1；若官方指定其他區，下面 BEDROCK_REGION 要跟著設）
- [ ] **Bedrock 模型開通**：主控台 → Bedrock → Model access → 申請
      Anthropic Claude Haiku 4.5 與 Claude Sonnet（填 use case 表單，通常數分鐘核准）
      ；modelId 用 `us.` 開頭 cross-region inference profile（`backend/agent/loop.py` 常數）
- [ ] 首次用 Claude 模型若要求 Marketplace 訂閱：template 已含
      `aws-marketplace:Subscribe` 權限，跟著主控台指引按完即可

## 1. 資料準備｜預估 5 分

```bash
# CSV 放 data/MaiCoin_transactions.csv（Drive 下載；不進 git）
python3 analysis/precompute.py     # 產出 data/health_report.json（會隨 Lambda 打包）
```

- [ ] 確認 `data/health_report.json` 存在且含 `realized_pnl` 區塊（虧損/少賺回答的數據源）

## 2. 後端部署｜預估 15 分

```bash
cd infra
sam build
sam deploy --stack-name maimate --region <region> \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --resolve-s3 \
  --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides KnowledgeBaseId=<本帳號的 KB> GuardrailId=off GuardrailVersion=1
```

🚨 **參數一定要明寫，兩個原因**（08-01 官方環境部署踩到）：

1. `samconfig.toml` 在 `.gitignore` 裡，新 clone 一定沒有 → 少了 `--stack-name` 會直接報
   `Missing option '--stack-name'`；`sam deploy --guided` 只是幫你把這些存進 samconfig。
2. **不寫 `--parameter-overrides` 會把 `KnowledgeBaseId` 洗回 template 預設值 `DSIYBVI1IX`**
   ——那是別的隊員帳號的 KB，洗掉後 RAG 靜默失效（畫面正常、只是不附出處）。
   要沿用現況就把**現值原封傳回去**；現值可以這樣讀（不含任何金鑰）：

```bash
aws lambda get-function-configuration --function-name <ChatFunction> --region <region> \
  --query 'Environment.Variables.{KB:KB_ID,GUARD:GUARDRAIL_ID,VER:GUARDRAIL_VERSION}'
```

> 參數原值傳回＝Environment 區塊不變＝手動設的 MAX 金鑰**不會**被清（見下方「部署後手動設定」）。

- guided 選項：stack 名 `maimate`、region 同上、其餘預設；確認 IAM 變更
- [ ] 記下 Outputs：**ApiUrl**、**FrontendUrl（CloudFront HTTPS）**、FrontendBucket、
      FrontendDistributionId。首次建立 CloudFront 通常要等 10–20 分鐘，賽前先部署好，
      不要在 Demo 開始前才建立

### RAG Knowledge Base：模板管不到，換帳號一定要重建

🚨 `infra/template.yaml` 只**引用** `KnowledgeBaseId`，不會建立 Bedrock KB、S3 Vectors
與語料 bucket。**KB 不存在時部署仍會顯示成功，RAG 靜默失效**——畫面不壞、回答還算像樣，
只是「附出處」這個賣點安靜消失，F3 失敗。已踩過兩次（#34：KB 其實在另一個隊員的帳號；
07/31：隊長帳號砍掉重建後同樣沒有）。KB ID 是帳號＋region 範圍資源，**別的帳號的 ID 不能沿用**。

```bash
python3 scripts/setup_rag_kb.py --check                      # 先看本帳號有沒有
python3 scripts/setup_rag_kb.py --corpus <repo外的語料檔路徑>   # 沒有就一鍵建完
```

腳本冪等（可重跑）、會印出新的 KB ID 與對應的 `sam deploy` 指令，並拒絕 repo 內的語料路徑（鐵則 1）。
完整說明看腳本開頭的 docstring。**語料 `chunks.jsonl` 只在 Drive／S3，不進 git**。

| | 隊長帳號 / us-east-1 | **官方環境 / us-west-2** |
|---|---|---|
| Knowledge Base | 見 `scripts/deploy.sh` 的環境對照表 | 同左 |
| 語料 bucket | `maimate-rag-corpus-<帳號 ID>` | `maimate-rag-corpus-<帳號 ID>` |
| 語料 | 13 篇（隊長 4 篇 md ＋隊友 chunks.jsonl 9 段） | **9 段**（`chunks.jsonl`，08-01 灌入，檢索煙測過） |
| F3 附出處 | 通過 | 通過 |

> **repo 是公開的**：帳號 ID 與資源名稱不寫進版控，實際值在
> `docs/_internal/ENVIRONMENTS.md`（已 gitignore，另存 Drive）。
> 帳號 ID 用 `aws sts get-caller-identity --query Account --output text` 現查即可。

兩邊都是 `maimate-rag-kb`／Titan Embed V2 1024 維／`maimate-rag-vectors`＋`maimate-kb-index`
（FLOAT32 cosine）／IAM role `MaiMateRagKbRole`。語料檔在 Drive「黑客松／MaiMate_RAG_語料」，
下載到 **repo 以外**的路徑再餵給腳本，灌完刪掉本機副本。

### 部署後手動設定（模板刻意不含，金鑰嚴禁進版控）

🚨 **每次 `sam deploy` 之後都要重做這一節**——CloudFormation 更新時會把函式設定收斂回
模板宣告的內容，手動加的 `MAX_API_KEY`／`MAX_API_SECRET` 不在模板裡（鐵則2），**會被移除**。
症狀：昨天還能查持倉，今天重部署後又變成「帳戶 API 未設定」。

🚨 **一律用主控台的「Add environment variable」新增**，不要用
`aws lambda update-function-configuration --environment`——該參數是**整組取代**，
會把模板設好的 `TABLE_NAME`／`KB_ID`／`BEDROCK_REGION` 全部清掉（RAG 會無聲失效）。

- [ ] Lambda 主控台 → **OrderFunction 與 ChatFunction 都要**設環境變數：
      `MAX_API_KEY`、`MAX_API_SECRET`（或 Secrets Manager；權限只開「讀取＋交易」，**不開提領**）
      —— ChatFunction 的 get_account_balance／三方案引擎查持倉需要（07/21 實測發現漏設會
      讓模型答「帳戶 API 未設定」、Golden Path 卡在查持倉）
- [ ] ~~（選配，先驗證再開）ChatFunction 環境變數：`ENABLE_PROMPT_CACHE=1`~~
      **已改為模板參數（#43），不要再手動設。** 手動設的會在下次 `sam deploy` 被
      CloudFormation 收斂掉，而且悄悄關閉、沒有任何訊號。要開請用：
      `sam deploy --parameter-overrides EnablePromptCache=1`
      —— 開啟後對話一次確認無 ValidationException 才留著
- [ ] ~~（#6 Guardrail 建好後）ChatFunction 環境變數：`GUARDRAIL_ID=<id>`~~
      **不要在主控台設。** `GUARDRAIL_ID` 是模板參數，`scripts/deploy.sh` 每次都帶
      `--parameter-overrides GuardrailId=<環境對照表的值>`，主控台手動設的值下一次部署就被改回去。
      而 `loop.py` 對 `off`／`none`／`disabled` 一律靜默停用——不掛 guardrailConfig、不 log、
      不報錯，模型層護欄整層消失而畫面完全正常。要開請改 `scripts/deploy.sh` 環境對照表裡的
      `GUARDRAIL=`（私人帳號已有 READY 的 `MaiMateRedLine`；比賽帳號沒建，`off` 是唯一正確值）。
      腳本每次部署都會把本次採用的值印出來，讓「不掛護欄」變成看得見的決定。

> **不用手動設的**（模板已自動帶入，PR #21 之後）：`KB_ID`（參數 `KnowledgeBaseId`）、
> `BEDROCK_REGION`（跟隨部署 region）、`TABLE_NAME`。
> ⚠ `KnowledgeBaseId` 的**模板預設值是早期那顆已不存在的 KB**——它在別的隊員帳號裡，
> 誰都不該沿用。每次 `sam deploy` 都要明寫 `--parameter-overrides KnowledgeBaseId=<本帳號的 KB>`，
> 漏寫就會靜默洗成預設值、RAG 無聲失效。

## 3. 前端部署｜預估 10 分

```bash
# ⚠ API_BASE 檢查項（workflow.md 可重部署鐵則）：多個進入頁各有一份，用 glob 一次改完，
#   不要逐檔列名——前端每加一頁就會多一處，寫死檔名遲早漏掉
sed -i 's#window.API_BASE = "[^"]*"#window.API_BASE = "<本次 ApiUrl>"#' frontend/*.html      # Linux
sed -i '' 's#window.API_BASE = "[^"]*"#window.API_BASE = "<本次 ApiUrl>"#' frontend/*.html   # macOS：多一組空引號
grep -oh 'window.API_BASE = "[^"]*"' frontend/*.html | sort -u   # 必須只剩「一行」＝全站一致
aws s3 sync frontend/ s3://<FrontendBucket>/
aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

> macOS 的 `sed -i` 把下一個參數當備份副檔名，不加 `''` 會報
> `invalid command code` 或吃掉檔案。隊上是 Mac，決賽當天別踩第二次。

- [ ] 上面那行 `sort -u` **只輸出一行**（全部進入頁指向同一個本次 ApiUrl）。最常忘的一步；
      漏改任何一頁不會報錯，只會讓該頁靜默掉回離線 mock，很難當場察覺
- [ ] 確認 `FrontendUrl` 是 `https://*.cloudfront.net`，不是 S3 的 `http://...WebsiteURL`
- [ ] 手機 Safari（含隱私瀏覽）開 FrontendUrl：根路徑直接載入 `index.html`，頂欄麥麥
      logo 有出現（assets 同步成功）

## 4. 冒煙測試（workflow.md 部署冒煙順序）｜預估 10 分

> 本節是「部署當下 10 分鐘快篩」。**完整全功能驗收看 `docs/TEST_CHECKLIST.md`**（A–G 段、約 45 分）。

```bash
curl <ApiUrl>/health                                    # 應回 health_report JSON
curl "<ApiUrl>/market?market=btctwd&kind=ticker"        # 應回 MAX 行情
```

- [ ] 前端行情面板四幣有數字、10 秒刷新只變數字不閃爍
- [ ] 對話「去年我虧最多的是哪一筆」→ 回答含**真實虧損**單筆（日期/幣別/金額，
      千分位），並區分機會成本「少賺」
- [ ] 對話「ETH 跌太多幫我全賣」→ 工具 chips → 三方案卡（數字非编造）→ 選一個
      → 確認卡 → （測試環境勿真按）
- [ ] 點頂欄模式徽章切到「安心白話」再問一次全賣——語氣明顯更保護
- [ ] `curl "<ApiUrl>/audit?session_id=<F12 看 request 的 session_id>"` 有軌跡
- [ ] 真實成交 E2E（#4，最小額度、本人帳戶）只在賽前驗證日執行一次

## 5. 決賽日速查

| 症狀 | 檢查 |
|---|---|
| FrontendUrl 開根路徑 403 | CloudFront `DefaultRootObject` 必須是 `index.html`；確認 Output 使用 CloudFront URL |
| S3 同步後仍看到舊前端 | 對 FrontendDistributionId 執行 `create-invalidation --paths "/*"` |
| 某一頁全走離線 mock（其他頁正常） | 那頁的 API_BASE 忘了改——回 §3 跑 `sort -u` 驗證 |
| RAG 問答退化成一般回答 | `KB_ID` 被 CLI `--environment` 洗掉了（見 §2 警告） |
| /chat 500 | Bedrock model access 未開通／region 不符 → 開通或設 BEDROCK_REGION |
| /chat 只有「為什麼／分析／歸因」類問題 500 | 那類問題會路由到 Sonnet（`loop.py` `pick_model`）。推論設定檔 ID **必須帶日期**：`us.anthropic.claude-sonnet-4-5-20250929-v1:0`。短別名 `...-sonnet-4-5-v1:0` 兩個 region 都是 ValidationException。08-01 決賽當天才抓到，因為 `verify_live.py` 沒有一項會觸發深度意圖 |
| 換 region 後不確定模型 ID | `aws bedrock list-inference-profiles --region <region>` 查 ACTIVE 的完整 ID，別用記憶中的別名 |
| /chat ValidationException | ENABLE_PROMPT_CACHE 先關掉再查 |
| /order 一直 410 | 憑證 60 秒過期＝正常；重新對話產生新確認卡 |
| /order 500 | MAX 金鑰未設或權限不足（要「讀取＋交易」） |
| 行情空白 | MAX API 連不到：確認 Lambda 有對外網路（HttpApi 預設可） |

全程目標 **< 60 分鐘**。演練實測時間：**07/31 實測 46 分鐘**（砍掉整套 stack 重建，含人工設金鑰）

演練實況與提醒（照這份走的人先看這段）：

- **刪除很快是特例**：本次 `delete-stack` 幾分鐘就完成，因為 PR #40 的 CloudFront
  當時還沒真的部署過，stack 裡沒有 distribution。**已經有 distribution 的環境，刪除要 15–90 分鐘**
- **CloudFront 第一次建立**約 5–15 分鐘，佔了這 46 分鐘的大宗
- 全新 stack 的 **ApiUrl 與前端網址都會換**：`API_BASE` 三個檔要改、對外連結要換。
  舊的 `*.s3-website-*.amazonaws.com` 在 PR #40 之後已永久失效（bucket 轉私有）
- 全新環境的金鑰**一定**是空的（模板不含金鑰），這步無法省
- 驗收用 `python3 scripts/verify_live.py --base <ApiUrl>`（判定項數以它印出的統計列為準）
- ⚠️ **最容易踩的坑不在指令，在工作目錄**：本次演練有兩次差點在舊的
  `~/Downloads/MaiMate-main` 快照裡執行（停在 7/28、缺全部修正）。
  每一行都先 `cd` 到正式 repo，或直接把舊快照改名
