# 決賽表單繳交素材（Typeform）

> 官方表單題目與現成答案。**第 10 題送出後無法修改**，備齊再送。

## Q3 提案大綱（中文限 300 字內）

實際 297 字（不含空白），可直接貼：

```
MaiMate 麥麥是嵌在 MAX／MaiCoin App 內的投資陪跑 AI，讀使用者自己的交易紀錄，在按下買賣前把盲點攤開：2025 年 65% 的買入落在近 7 筆均價之上，賣出後續漲的機會成本達 NT$2,660 萬。

使用者說「幫我全部賣掉」，麥麥不照做也不勸阻，而是給三個帶真實數字的方案：保守、原意圖、暫停。金額、手續費、賣後集中度全由程式計算，LLM 只負責講成人話。

安全建在架構層而非提示詞：execute_order 不在 LLM 工具清單內；下單憑證 60 秒過期、單次有效，須由人按確認；六種事件留痕。

真錢驗證：MAX Private API 實際成交兩筆；使用者 1.7 秒內連按三次確認，只成交一次、其餘回 410。
```

## Q4 採用何種基礎模型

```
Amazon Bedrock：
・Anthropic Claude Haiku 4.5（us.anthropic.claude-haiku-4-5-20251001-v1:0）— 主要對話與工具呼叫
・Anthropic Claude Sonnet 4.5（us.anthropic.claude-sonnet-4-5-20250929-v1:0）— 深度分析意圖時自動路由
・Amazon Titan Text Embeddings V2（amazon.titan-embed-text-v2:0）— Knowledge Base 向量檢索
均使用 us. 開頭之 cross-region inference profile。
```

來源：`backend/agent/loop.py:9,14`、`scripts/setup_rag_kb.py:53`。

## Q5 GitHub 網站連結

`https://github.com/giont565/MaiMate`

✅ **已公開**（2026-08-02 確認 `visibility: public`）。掃過 git 歷史：沒有 CSV、沒有語料、
沒有明文金鑰；追蹤中的資料只有 `data/health_report.json`（聚合統計）。
AWS 帳號 ID 與資源名稱已移出版控（`docs/_internal/`，未進 git）。

## Q6 Demo 影片連結

✅ **已上傳並設為公開**（2026-08-02）：

```
https://drive.google.com/file/d/1YeRwUQPWU3RSVSO3cXk66HcBzBF4BTWJ/view?usp=drive_link
```

檔案 `F_MaiCoin：智慧理財_第五名.mp4`——780×1688 直式、**71.1 秒**、H.264 + AAC
（旁白已合成，非無聲版）、6.6 MB。內容即 `主片_v3_合成旁白_71秒.mp4`（雜湊相同）。
含 USDT NT$500 真單全程（確認 → 已成交 #20727214652 → 軌跡自動展開）。
結構與時間軸見 `docs/DEMO_SCRIPT.md`。

**已用匿名連線驗過**（模擬評審沒登入 Google）：range 請求回 `HTTP 206`、
`content-type: video/mp4`、檔頭 `ftypisom`。**不會出現「要求存取權」**。

⚠️ 兩件事別忘：
- 題目要求**留存至 2026/12/31**，這段期間不要改權限、不要搬動或改名（Drive 改名不影響
  連結，但移到別人的共用碟或刪除會斷）。
- 同一個資料夾裡有 `F_MaiCoin：智慧理財_第五名_勿用_佔比錯誤_87秒.mp4`，
  檔名開頭與正式檔相同。**只分享單一檔案，不要分享整個資料夾**。

重製流程（要重出時用）：`bash scripts/narrate_master.sh <無旁白.mp4> <輸出.mp4>` 燒合成旁白，
人聲配音則照 `docs/DEMO_SUBTITLES.srt` 的時間念。

## Q8 提案簡報 PDF

✅ **已產出**：`~/Documents/MaiMate_決賽交付/F_MaiCoin：智慧理財_第五名.pdf`
（20 頁、2.7MB、960×540pt 的 16:9 版面，與 `MaiMate_提案簡報_20260731.pptx` 同 20 頁同源）。
已掃過檔案內容確認**不含 Canva／Google 共編連結**（題目明訂禁止那條）。

這台 Mac **沒有 Keynote／PowerPoint／LibreOffice**，pptx 匯不出 PDF；改用同源的
`docs/MaiMate_提案簡報.html` 走 Chromium 列印：`node scripts/build_deck_pdf.js <輸出.pdf>`。
簡報改版後重跑 `build_deck.js` 再重跑這支即可。送出前自己開來翻一遍確認沒有跑版。
⚠️ 題目明訂**禁止在 PDF 內加 Canva／Google 等共編連結**——本專案自產，無此問題。

## Q9 MAX Lv.2 帳號 Email（加分項）

`giont565@gmail.com`——`/api/v3/info` 實測回 `level: 2`。

## Kiro 加分（+5）證據——**送出前要確認的三件事**

證據本身已齊：F Specs 面板／G task 執行／H MCP 設定／I steering 生效／J credit 用量，
2026-08-02 由 chaocongyang 拍齊並關掉 issue #42，存於 Drive。

**但證據存在 ≠ 拿得到分**，送出前逐項確認：

- [ ] **表單哪一題收 Kiro 證據？** 本文件記到 Q9（Lv2 Email）為止，Kiro 沒有對應欄位。
      表單有第 10 題且**送出後不可修改**——先看清楚題目再填。
- [ ] **Drive 權限**：目前只開給四位隊員。評審點開會是「要求存取」，等於沒交。
      要改成「知道連結的人可檢視」，或改附在簡報 PDF 附錄。
- [ ] **J 含完整 Gmail**，不可公開。要公開就先遮蔽或重拍一張只留 User ID 與日期的版本。

repo 這一側不需要額外動作，評審可自行覆核：`.kiro/` 有 8 份 spec（每份 requirements／
design／tasks 三件套）、5 份 steering、`settings/mcp.json`（金鑰走 `${env:...}` 佔位，
未含任何實際憑證）。

⚠️ **口頭別報 spec 份數**：F 是 08/02 10:30 拍的（7 個 spec、4 份 steering），
之後 repo 各多一份。講「每個功能一份 spec、三件套齊全」才和證據一致。
