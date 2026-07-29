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

## 待辦交接（2026-07-28 session 結束時）

- [ ] **#4 MAX Private API 回 2014 未解**——詳細除錯紀錄見 issue #4 留言，接手先讀那則
- [ ] **驗收未跑完**：`docs/TEST_CHECKLIST.md` D5–D18、E（Onboarding 五屏）、F（AI 安全六項）
- [ ] **PR #32 決策**（haoting 的 Screen 6–8，11k 行）——距 code freeze 剩 3 天，要不要納入
- [ ] PR #33（macOS sed 文件修正）待 merge；分支上另有 MAX 除錯的多個 commit 未開 PR
- [ ] 全員 Lv2 KYC（#3）；#6 Bedrock Guardrails 主控台待建（設 `GUARDRAIL_ID` 即生效）
- [ ] #8 影片（分鏡稿已備）、#14 部署計時演練、#15 Drive 整合簡報修正
- [ ] 加分證據截圖：Lv2 五張 A–E、Kiro 五張 F–J（清單見 `docs/CAPTAIN_TODO.md` Part 2）
- [ ] Claude Design 三張卡仍是舊版（DesignSync 權限流在非互動環境失敗）

## 溝通慣例

回覆使用者用繁體中文。誠實區分「寫好」與「測過」。決賽相關死線：7/22 決賽名單、
7/31 code freeze、8/1 官方 AWS 環境公布（一切部署設計為可重部署因應此變數）。
