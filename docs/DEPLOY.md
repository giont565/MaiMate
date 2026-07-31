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
sam deploy --guided     # 第一次；之後 sam deploy 即可
```

- guided 選項：stack 名 `maimate`、region 同上、其餘預設；確認 IAM 變更
- [ ] 記下 Outputs：**ApiUrl**、**FrontendUrl**、FrontendBucket 名稱

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
- [ ] （選配，先驗證再開）ChatFunction 環境變數：`ENABLE_PROMPT_CACHE=1`
      —— prompt caching 開關；開啟後對話一次確認無 ValidationException 才留著
- [ ] （#6 Guardrail 建好後）ChatFunction 環境變數：`GUARDRAIL_ID=<id>`（版本非 DRAFT
      再加 `GUARDRAIL_VERSION`）—— 設定後 converse 自動掛載，與程式層護欄疊加

> **不用手動設的**（模板已自動帶入，PR #21 之後）：`KB_ID`（參數 `KnowledgeBaseId`，
> 預設 `DSIYBVI1IX`，RAG 部署完即通）、`BEDROCK_REGION`（跟隨部署 region）、`TABLE_NAME`。

### 2.1 RAG Knowledge Base 是外部資源：新帳號必須先建立

🚨 `infra/template.yaml` **只引用** `KnowledgeBaseId`，不會建立或擁有 Bedrock Knowledge
Base、S3 Vectors、語料 S3 bucket。CloudFormation 因此可能在 KB 不存在時仍顯示部署成功。
目前驗證可用的 `DSIYBVI1IX` 位於帳號 `022289351970`／`us-east-1`；官方新帳號不能
假設可以沿用這個 ID。

語料遵守鐵則 1：原始檔只放授權的 Drive／S3，**不得加入 git、SAM build context 或 PR
附件**。目前可工作的參考規格如下：

| 資源 | 參考設定 |
|---|---|
| Knowledge Base | `maimate-rag-kb`，Amazon Titan Text Embeddings V2，1024 維 |
| Vector store | S3 Vectors，index `maimate-rag-index`，FLOAT32 |
| Data source | `maimate-rag-s3`，S3 prefix `corpus/` |
| Chunking | Fixed size：300 tokens，10% overlap |
| Drive 備份 | [`MaiMate_RAG_語料`](https://drive.google.com/drive/folders/1WbiNZfQxasbv2UIY2CSXiL7lqaOTMCv1) |
| 語料物件 | [`chunks.jsonl`](https://drive.google.com/file/d/1bGluoaSlYoGtPNkRN3i__zqrTHqWEF-5/view)，5,226 bytes、9 筆 JSONL |
| SHA-256 | `F79DEA561B09AF43B4445DC77DA8A1D5D3B1E654F864291FE622EF5B53E263A7` |

#### A. 先判斷是帳號／region 錯誤，還是真的不存在

```bash
aws sts get-caller-identity
aws bedrock-agent get-knowledge-base \
  --knowledge-base-id DSIYBVI1IX --region us-east-1
aws bedrock-agent list-knowledge-bases --region us-east-1
```

- `get-knowledge-base` 回 `ACTIVE`：不用重建，確認部署 region、`KnowledgeBaseId` 與 Lambda
  的 `KB_ID` 指向同一個 ID。
- 回 `ResourceNotFoundException`：先確認 `get-caller-identity` 的帳號及部署 region。KB ID
  是帳號＋region 範圍資源；不要看到 NotFound 就立刻建立第二套。
- 已確認是官方新帳號或所有預定 region 都不存在：執行下一節。

#### B. 在 Bedrock 主控台重建（一次性）

1. 開啟團隊 Drive 的 [`MaiMate_RAG_語料`](https://drive.google.com/drive/folders/1WbiNZfQxasbv2UIY2CSXiL7lqaOTMCv1)，
   下載 `chunks.jsonl` 到 **repo 外**的暫存目錄。不要放進專案資料夾、SAM build context、
   commit 或 PR。下載後先核對大小與 SHA-256：

   ```powershell
   # Windows PowerShell；改成實際下載檔案位置
   $RagCorpus = "$env:TEMP\maimate-rag\chunks.jsonl"
   (Get-Item -LiteralPath $RagCorpus).Length   # 應為 5226
   (Get-FileHash -LiteralPath $RagCorpus -Algorithm SHA256).Hash
   # 應為 F79DEA561B09AF43B4445DC77DA8A1D5D3B1E654F864291FE622EF5B53E263A7
   ```

   ```bash
   # Linux / macOS；改成實際下載檔案位置
   RAG_CORPUS=/tmp/maimate-rag/chunks.jsonl
   wc -c "$RAG_CORPUS"                         # 應為 5226
   shasum -a 256 "$RAG_CORPUS"                 # macOS
   sha256sum "$RAG_CORPUS"                     # Linux
   ```

2. 在與 SAM 部署相同的 region（預設 `us-east-1`）建立一般 S3 bucket，Block Public
   Access 全開，再上傳 Drive 下載的原檔：

   ```bash
   aws s3 cp "$RAG_CORPUS" s3://<corpus-bucket>/corpus/chunks.jsonl
   aws s3 ls s3://<corpus-bucket>/corpus/chunks.jsonl   # 大小應為 5226
   ```

   Windows PowerShell 使用相同指令時，把 `"$RAG_CORPUS"` 改成 `$RagCorpus`。

   上傳成功後刪除本機暫存副本；Drive 與 S3 保留為兩份授權來源。
3. 建立 S3 Vectors vector bucket 與 index；index 使用 1024 維、FLOAT32、cosine
   distance，名稱可用 `maimate-rag-index`。
4. Bedrock → Knowledge bases → Create，名稱 `maimate-rag-kb`：
   - embedding model：Amazon Titan Text Embeddings V2；
   - execution role：新建或指定只能讀取上述 corpus bucket、寫入上述 S3 Vectors index，
     並可呼叫 embedding model 的 role；
   - vector store：選擇剛建立的 S3 Vectors bucket／index。
5. 新增 S3 data source `maimate-rag-s3`，prefix 設 `corpus/`；chunking 選 fixed size，
   300 tokens、10% overlap。
6. 執行 Sync，等待 ingestion job `COMPLETE`；確認 scanned ≥ 1、indexed ≥ 1、
   failed = 0。記下新 KB ID。
7. 用 Retrieve 測試確認不是空索引：

```bash
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id <新KB_ID> --region <REGION> \
  --retrieval-query 'text=投資詐騙有哪些常見警訊？' \
  --retrieval-configuration 'vectorSearchConfiguration={numberOfResults=3}'
```

#### C. 交給部署者並做唯一驗收

```bash
cd infra
sam deploy --parameter-overrides KnowledgeBaseId=<新KB_ID>
cd ..
python3 scripts/verify_live.py --only F
```

Windows PowerShell 若 `✔` 因 CP950 報 `UnicodeEncodeError`，先執行
`$env:PYTHONUTF8='1'` 再跑同一條指令。Linux/macOS 也可用
`PYTHONUTF8=1 python3 scripts/verify_live.py --only F`。`F3` 必須為 `✔`；失敗訊息會
分辨工具未註冊、工具呼叫失敗或檢索回空。每次換 AWS 帳號／region 都要重做 A；若是
新帳號，必須完成 B 才能部署。

## 3. 前端部署｜預估 10 分

```bash
# ⚠ API_BASE 檢查項（workflow.md 可重部署鐵則）：多個進入頁各有一份，用 glob 一次改完，
#   不要逐檔列名——前端每加一頁就會多一處，寫死檔名遲早漏掉
sed -i 's#window.API_BASE = "[^"]*"#window.API_BASE = "<本次 ApiUrl>"#' frontend/*.html      # Linux
sed -i '' 's#window.API_BASE = "[^"]*"#window.API_BASE = "<本次 ApiUrl>"#' frontend/*.html   # macOS：多一組空引號
grep -oh 'window.API_BASE = "[^"]*"' frontend/*.html | sort -u   # 必須只剩「一行」＝全站一致
aws s3 sync frontend/ s3://<FrontendBucket>/
```

> macOS 的 `sed -i` 把下一個參數當備份副檔名，不加 `''` 會報
> `invalid command code` 或吃掉檔案。隊上是 Mac，決賽當天別踩第二次。

- [ ] 上面那行 `sort -u` **只輸出一行**（全部進入頁指向同一個本次 ApiUrl）。最常忘的一步；
      漏改任何一頁不會報錯，只會讓該頁靜默掉回離線 mock，很難當場察覺
- [ ] 瀏覽器開 FrontendUrl：頂欄麥麥 logo 有出現（assets 同步成功）

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
| 某一頁全走離線 mock（其他頁正常） | 那頁的 API_BASE 忘了改——回 §3 跑 `sort -u` 驗證 |
| RAG 問答退化成一般回答 | `KB_ID` 被 CLI `--environment` 洗掉了（見 §2 警告） |
| /chat 500 | Bedrock model access 未開通／region 不符 → 開通或設 BEDROCK_REGION |
| /chat ValidationException | ENABLE_PROMPT_CACHE 先關掉再查 |
| /order 一直 410 | 憑證 60 秒過期＝正常；重新對話產生新確認卡 |
| /order 500 | MAX 金鑰未設或權限不足（要「讀取＋交易」） |
| 行情空白 | MAX API 連不到：確認 Lambda 有對外網路（HttpApi 預設可） |

全程目標 **< 60 分鐘**。演練實測時間：＿＿＿（7/31 前填）
