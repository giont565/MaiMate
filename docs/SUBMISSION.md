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

⚠️ **目前是 PRIVATE，題目要求公開。** 已掃過 git 歷史：沒有 CSV、沒有語料、沒有明文金鑰，
追蹤中的資料只有 `data/health_report.json`（聚合統計），可安全公開。

```bash
gh repo edit giont565/MaiMate --visibility public --accept-visibility-change-consequences
```

不可逆，由隊長自行執行。

## Q6 Demo 影片連結

🟡 **成片已剪好，只差旁白／字幕**：`~/Documents/MaiMate_決賽交付/主片_v2_真單版_無旁白_88秒.mp4`
（780×1688、88.1 秒）。結構與時間軸見 `docs/DEMO_SCRIPT.md` 文末〈v2 真單版成片〉。
含 15:40 那筆 USDT NT$500 真單全程（確認 → 已成交 #20727214652 → 軌跡自動展開）。

燒合成旁白：`bash scripts/narrate_master.sh <無旁白.mp4> <輸出.mp4>`；人聲配音則照
`docs/DEMO_SUBTITLES.srt` 的時間念。輸出後檔名改成 `F_MaiCoin：智慧理財_第五名.mp4`，
上傳雲端設公開、留存至 2026/12/31。

## Q8 提案簡報 PDF

✅ **已產出**：`~/Documents/MaiMate_決賽交付/F_MaiCoin：智慧理財_第五名.pdf`
（20 頁、2.7MB、1280×720pt，與 `MaiMate_提案簡報_20260731.pptx` 同 20 頁同源）。

這台 Mac **沒有 Keynote／PowerPoint／LibreOffice**，pptx 匯不出 PDF；改用同源的
`docs/MaiMate_提案簡報.html` 走 Chromium 列印：`node scripts/build_deck_pdf.js <輸出.pdf>`。
簡報改版後重跑 `build_deck.js` 再重跑這支即可。送出前自己開來翻一遍確認沒有跑版。
⚠️ 題目明訂**禁止在 PDF 內加 Canva／Google 等共編連結**——本專案自產，無此問題。

## Q9 MAX Lv.2 帳號 Email（加分項）

`giont565@gmail.com`——`/api/v3/info` 實測回 `level: 2`。
