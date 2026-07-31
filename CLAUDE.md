# CLAUDE.md — MaiMate 專案工作準則

## 專案是什麼

2026 雲湧智生黑客松（MaiCoin 智慧理財命題）參賽作品。隊伍「第五名」，隊長蔡元皓（giont565）。
決賽 8/1–8/2。**`README.md` 是唯一文件**——開發地圖、四工作包×31 工項、交棒地圖、架構、
API 契約、十組驗收清單、商業模式全在裡面；任何範圍/介面變更都改 README，不要另開文件。

## 鐵則（違反會影響參賽資格或評分）

1. **官方 CSV 與 RAG 語料絕不進 git**（`.gitignore` 已擋，不要繞過；原始檔在 Drive）
2. **金鑰絕不進 git、不出現在對話**：MAX_API_KEY/SECRET 只走環境變數或 Secrets Manager
3. **AI 永不報明牌**：所有生成內容遵守 `.kiro/steering/product.md` 四紅線
4. **execute_order 永不進 LLM 工具清單**（tools.py 的 prepare/execute 分離是安全架構，不可合併）
5. 費率等對外數字要可查證：MAX 現貨基礎 maker 0.08%/taker 0.16%（2026-07 查證，上線前再對官網）

## 開發紀律（人與 AI 一體適用）

全文在 `.kiro/steering/workflow.md`（Kiro 自動載入；用其他 AI 開發時把該檔連同任務餵給它）。
五大重點：①git 一律 clone＋每日 `pull --rebase`，禁止本地快照當 initial commit 硬併回 main
②環境值不硬編碼，`index.html` 的 API_BASE 是唯一例外——每次重部署必須更新（列入 DEPLOY.md 清單）
③前端輪詢就地更新不清空重建、失敗保留舊值、插 DOM 先 escape
④工具 description 寫明區塊對應問題、查詢回傳附 key_findings＋data_notes（模型答不出先怪工具再怪 prompt）
⑤寫好≠測過：後端 py_compile＋實跑、前端 `npm run smoke`、prompt 改動部署後用固定劇本句實測。

## 常用操作

```bash
bash scripts/setup.sh                # 環境檢查
npm run smoke                        # 前端煙測（改 frontend/ 必跑；首次先 npm i）
python3 analysis/precompute.py       # CSV → data/health_report.json（真實數據源頭）
cd docs && node build_deck.js        # 重出提案簡報（評審版，勿混入內部內容）
cd docs && node build_handbook.js    # 重出開發手冊（隊內版）
cd docs/mockups && node shot.js      # 重截三張 Demo 畫面（Playwright 390x844@2x）
cd docs/brand && python3 render_pixel_bot.py   # 重出麥麥像素吉祥物
```

簡報改版流程：改 build_*.js → node 重跑 → `python3 /root/.claude/skills/pptx/scripts/office/validate.py <檔>`
（本環境 LibreOffice 渲染壞的，視覺 QA 只能靠使用者本機開）。pptx 建完記得刪 node_modules 再 commit。

## 團隊與分工現況（2026-07-28 更新）

- **B 包：chaocongyang-oss**（#2/#9 關單；kline/depth 正規化、RAG KB=DSIYBVI1IX、護欄誤判修正兩輪）
- **C 包：haoting777**（#26 hero 卡＋#28 Onboarding 五屏已 merge；**PR #32 open**＝Screen 6–8＋
  全站改用真實帳戶，11k 行 42 檔，隊長尚未決定是否在 code freeze 前納入）
- **A 包核心＋部署除錯：Claude**（四引擎、新前端、離線劇本、CI、驗收清單、deploy-drill spec）
- Issues 15 張 open；PR #19/#25/#26/#28/#30/#31 皆已 merge，**PR #32/#33 open**
- 真實數據已驗證：追高 65%、機會成本 NT$26,598,877、最痛少賺 DOGE NT$312,924；
  **07/28 新增**：已實現損益 **+117,482**（981勝/493負）、最痛真實虧損僅 **963**（2025-10-01 USDT）
  —— 「你以為在虧錢，其實賺了十一萬；真正虧的只有 963，少賺卻有兩千六百萬」是最強敘事

## 線上環境（2026-07-28 部署完成）

| 項目 | 值 |
|---|---|
| AWS 帳號／區域 | `525237381533` / us-east-1 |
| Stack | `maimate`（**沿用此名，換名會開出第二套環境**） |
| ApiUrl | `https://ywm2d396r8.execute-api.us-east-1.amazonaws.com` |
| FrontendUrl | `http://maimate-frontendbucket-39yr2d3jy0yz.s3-website-us-east-1.amazonaws.com`（**只支援 http**） |
| ChatFunction | `maimate-ChatFunction-uyN5hgOddqPe`（5 個環境變數，含 MAX 金鑰） |
| OrderFunction | `maimate-OrderFunction-CorZvWA9xVI7`（3 個環境變數，含 MAX 金鑰） |

已驗證：`/health` 為 07-28 資料含 realized_pnl／`/market` 含 fetched_at_taipei／`/audit` 不回 404／
前端健康分卡圓環正常、顯示 +NT$117,482。**驗收清單 D1–D4 已過，D5–D18 未測。**

## 交接（2026-08-01 02:20，決賽當天）

### 線上環境（帳號 525237381533／us-east-1）

| 資源 | 值 |
|---|---|
| 前端 | https://d1ttogc25b56n5.cloudfront.net |
| ApiUrl | `https://hwgog76s3a.execute-api.us-east-1.amazonaws.com` |
| FrontendBucket / DistributionId | `maimate-frontendbucket-tdpftef0y2d6` / `ECJ9UVQF1D5O3` |
| Knowledge Base | `PDEGDAUUH9`（13 篇語料，metadata 掛出處） |
| Guardrail | `6v38f3jue77y` v1，**刻意停用**（`GuardrailId=off`） |
| ChatFunction / OrderFunction | `maimate-ChatFunction-gJoISvAx91RA` / `maimate-OrderFunction-OtPA9sr4MOWp` |

部署與驗收指令、金鑰補回步驟全在 `docs/DEPLOY.md`；RAG 重建用 `scripts/setup_rag_kb.py`。

### 已完成（都有線上實測證據）

- **#4 全線打通**：真實成交兩筆 `#20720919534`、`#20721028463`，MAX App 推播確認，
  帳戶 ETH 餘額 +0.0102 為證。共修掉六個各自足以讓下單失敗的問題（簽章 2014／volume
  讀錯 key／憑證沒進 DynamoDB／三方案低於交易所下限／貼齊門檻被四捨五入／確認鈕連按）
- **#9 RAG**：自建 KB（語料在 Drive「黑客松/MaiMate_RAG語料」＋隊友的 chunks.jsonl 已合併）
- **#14 G1 演練**：砍掉整套 stack 從零重建，實測 46 分鐘
- 驗收：後端 22 項通過 21、前端完整性 13/13、Python 50 項、九組煙測
- 手機實機：離線劇本、行情保留舊值、PWA 加到主畫面（standalone ＋ 斷網可開）

### 待辦

- [ ] **#8 Demo 錄影**（最重要，環境目前是好的；分鏡稿 `docs/DEMO_SCRIPT.md`）
- [ ] TEST_CHECKLIST D14（憑證 61 秒過期）、D16（語氣切換）、E5–E10
- [ ] 簡報「RAG 附出處尚未穩定」那條已不成立，可改寫（`docs/build_pitch.js` 誠實頁）
- [ ] #6 Guardrail 要正確啟用需對 input／output 套用不同政策——賽後做
- [ ] 根目錄有一批沒人引用的重複檔（`test_backend.py`／`navigation-context.js`／
      `bedrock_client.py`／`profile_engine.py`／`strategy_calculator.py`），賽後清掉

### 踩過的坑（會再犯，先讀）

1. **工作目錄**：`~/Downloads/MaiMate-main-舊版勿用` 是 7/28 的舊快照，從那裡部署會把線上
   覆蓋回舊版。每一行指令都先 `cd /Users/hao/Documents/MaiMate`
2. **金鑰何時會被清**：只有**模板 Environment 區塊變動**時（改 `KB_ID`／新增 `GUARDRAIL_ID`
   都算）。純程式碼部署不會。每次部署後用 DEPLOY.md 那行檢查，不要盲補
3. **AI 相關驗收一次通過不算通過**：連跑三次、且跑完整套。今晚三次誤判都源於此
   （F3 出處、D9 反問、D12 連按），細節見 `docs/TEST_CHECKLIST.md` 開頭那段
4. **不會報錯的失敗**：sync 漏檔／快取沒清／某頁 `API_BASE` 忘了改，畫面全都正常但資料是
   假的。用 `npm run verify:ui` 比對線上檔案 sha256
5. **新增頁面要同步兩處**：`frontend/*.html` 的 `API_BASE`（用 glob 改，別逐檔）與
   `scripts/verify_live_ui.js` 的 `PAGES` 清單

## 溝通慣例

回覆使用者用繁體中文。誠實區分「寫好」與「測過」。決賽相關死線：7/22 決賽名單、
7/31 code freeze、8/1 官方 AWS 環境公布（一切部署設計為可重部署因應此變數）。
