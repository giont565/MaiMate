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
- [ ] 記下 Outputs：**ApiUrl**、**FrontendUrl（CloudFront HTTPS）**、FrontendBucket、
      FrontendDistributionId。首次建立 CloudFront 通常要等 10–20 分鐘，賽前先部署好，
      不要在 Demo 開始前才建立

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
- 驗收用 `python3 scripts/verify_live.py --base <ApiUrl>`，22 項自動判定
- ⚠️ **最容易踩的坑不在指令，在工作目錄**：本次演練有兩次差點在舊的
  `~/Downloads/MaiMate-main` 快照裡執行（停在 7/28、缺全部修正）。
  每一行都先 `cd` 到正式 repo，或直接把舊快照改名
