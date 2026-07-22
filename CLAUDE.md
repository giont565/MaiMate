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

## 團隊與分工現況（2026-07-19）

- 四工作包 A/B/C/D 未指派，隊員選包中（chaocongyang-oss、jack79112、haoting777 邀請已送）
- GitHub Issues #1–#15 對應工項；選包定案後要按包指派
- 真實數據已驗證：追高 65%、機會成本 NT$26,598,877、最痛單筆 DOGE NT$312,924（P6 級素材，別改壞）

## 待辦交接（上一個 session 留下的）

- [ ] Claude Design「MaiMate」專案的三張卡還是舊版（🐣 頂欄）——DesignSync 權限流在非互動環境失敗，
      互動 session 可重試 finalize_plan+write_files（來源 `docs/mockups/ds/`）
- [ ] ai-assistant repo 的 PR #13 是個人備份存檔（內容已被本 repo 取代），使用者決定合併或關閉
- [ ] 全員 Lv2 KYC 與 AWS 帳號歸屬尚未定案（交棒地圖的最上游）

## 溝通慣例

回覆使用者用繁體中文。誠實區分「寫好」與「測過」。決賽相關死線：7/22 決賽名單、
7/31 code freeze、8/1 官方 AWS 環境公布（一切部署設計為可重部署因應此變數）。
