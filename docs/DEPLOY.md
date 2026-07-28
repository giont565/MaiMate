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

- [ ] Lambda 主控台 → **OrderFunction 與 ChatFunction 都要**設環境變數：
      `MAX_API_KEY`、`MAX_API_SECRET`（或 Secrets Manager；權限只開「讀取＋交易」，**不開提領**）
      —— ChatFunction 的 get_account_balance／三方案引擎查持倉需要（07/21 實測發現漏設會
      讓模型答「帳戶 API 未設定」、Golden Path 卡在查持倉）
- [ ] （選配）ChatFunction 環境變數：`BEDROCK_REGION`（不設預設 us-east-1）
- [ ] （選配，先驗證再開）ChatFunction 環境變數：`ENABLE_PROMPT_CACHE=1`
      —— prompt caching 開關；開啟後對話一次確認無 ValidationException 才留著
- [ ] （#9 KB 建好後）ChatFunction 環境變數：`KB_ID=<Bedrock KB ID>`
      —— 設定後 query_knowledge 工具自動註冊，RAG 問答即通（ChatFunction 需補
      `bedrock:Retrieve` IAM 權限）
- [ ] （#6 Guardrail 建好後）ChatFunction 環境變數：`GUARDRAIL_ID=<id>`（版本非 DRAFT
      再加 `GUARDRAIL_VERSION`）—— 設定後 converse 自動掛載，與程式層護欄疊加

## 3. 前端部署｜預估 10 分

```bash
# ⚠ API_BASE 檢查項（workflow.md 可重部署鐵則）：三個進入頁各有一份，全都要改！
#   frontend/index.html／frontend/welcome.html／frontend/onboarding.html
sed -i 's#window.API_BASE = "[^"]*"#window.API_BASE = "<本次 ApiUrl>"#' \
  frontend/index.html frontend/welcome.html frontend/onboarding.html
grep -c "<本次 ApiUrl>" frontend/index.html frontend/welcome.html frontend/onboarding.html  # 應各回 1
aws s3 sync frontend/ s3://<FrontendBucket>/
```

- [ ] **三個** HTML 的 `window.API_BASE` 都改成**本次**部署的 ApiUrl（最常忘的一步；
      漏改 welcome/onboarding 不會報錯，只會靜默掉回離線 mock，很難當場察覺）
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
| 前端載入但全部離線 mock | index.html 的 API_BASE 忘了改（本表 §3） |
| /chat 500 | Bedrock model access 未開通／region 不符 → 開通或設 BEDROCK_REGION |
| /chat ValidationException | ENABLE_PROMPT_CACHE 先關掉再查 |
| /order 一直 410 | 憑證 60 秒過期＝正常；重新對話產生新確認卡 |
| /order 500 | MAX 金鑰未設或權限不足（要「讀取＋交易」） |
| 行情空白 | MAX API 連不到：確認 Lambda 有對外網路（HttpApi 預設可） |

全程目標 **< 60 分鐘**。演練實測時間：＿＿＿（7/31 前填）
