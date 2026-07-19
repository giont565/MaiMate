# MaiMate — 2026 雲湧智生黑客松（MaiCoin 智慧理財命題）

「懂你操作史」的 AI 投資特助：AI 讀取使用者一年 10,000 筆交易紀錄找出行為盲點，
結合 MAX 即時行情給個人化洞察，並在使用者授權下執行交易——洞察 → 對話 → 行動的閉環。

## 目錄結構

```
.kiro/                    Kiro steering 與 specs（加分項 +5% 的開發流程證據）
├── steering/             product / data-schema / tech 三份紅線與約定
└── specs/                behavior-engine / chat-agent / order-flow
analysis/precompute.py    行為分析引擎（離線預計算 → data/health_report.json）
backend/
├── agent/                loop.py（Converse tool-use 迴圈）、tools.py、guardrails.py
├── handlers/             Lambda × 4：chat / health / market / order
└── integrations/         max_public（快取+退避）、max_private（HMAC 簽章）、thirdparty
frontend/                 靜態 SPA（index.html + app.js，S3 直接託管、內建離線 mock）
infra/template.yaml       AWS SAM 一鍵部署（API GW + Lambda + DynamoDB + S3）
data/                     官方 CSV（不進版控）與 health_report.json
docs/                     提案簡報（build_deck.js 產生器＋pptx 成品）
```

## 快速開始

```bash
python3 analysis/precompute.py           # CSV → data/health_report.json
cd infra && sam build && sam deploy --guided   # 部署後端
# 前端：把 frontend/ 上傳至 FrontendBucket，index.html 前注入 window.API_BASE
# MAX 金鑰：部署後在 Lambda 環境變數/Secrets Manager 設 MAX_API_KEY、MAX_API_SECRET（不進版控）
```

## 已驗證的真實洞察（2025 全年、10,000 筆）

| 指標 | 數字 |
|---|---|
| 追高比例（買在 7 筆均價上方） | 65.0%（2,350 筆買入） |
| 殺低比例（賣在均價下方） | 34.1% —— 非恐慌型賣家 |
| 年度賣出機會成本 | NT$26,598,877 |
| 最痛單筆 | 2025-01-08 賣 6,216 DOGE @14.2，年末 64.54，少賺 NT$312,924 |
| 峰值持倉集中 | 2025-12 TWD 98.6%（年末全數出清） |
| TWD 提領 417 筆 | 僅 14.2% 發生於 BTC 七日下跌後 |

## 評分對應

創意25（行為分析差異化）/ 可行20（serverless+限制揭露）/ 商業20 / AI設計15（Agent 工具迴圈）
/ 切合10（CSV+MAX Public/Private+第三方）/ 完成10（離線備援）＋ Lv2 Private API +5 ＋ Kiro +5。

## 待辦

- [ ] MAX Lv2 KYC（全隊盡快辦，Private API 加分項依賴）
- [ ] max_public.py / max_private.py 串接
- [ ] 前端 Dashboard + Chat + 下單確認卡
- [ ] Guardrails、離線 mock、Demo 預錄影片
