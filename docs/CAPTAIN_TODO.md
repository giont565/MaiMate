# CAPTAIN_TODO.md — 隊長待辦與交付證明清單

> **這份是「只有人能做的事」的總表**：程式面 AI 已經做完（main 即完整決賽版），
> 以下每一項都需要你本人的帳號、憑證、機器或決策，AI 無法代勞。
> 對應：README §4.10 決賽交付、評分表 `+Lv2 Private API 5%`＋`+Kiro 5%`。
> 更新：2026-08-02（決賽第二天）。**Part 1 的四件事都已完成**，現在只剩 Part 2 的 Kiro 截圖。

**評分表提醒**：創意25／可行20／商業20／AI設計15／切合10／完成10 ＝ 100，
**外加 Lv2 Private API +5、Kiro +5**——這 10 分是「有交證據就給、沒交就沒有」的分，
本表 Part 2 專講怎麼把這 10 分拿滿。

---

## Part 1｜已完成（保留當作重跑步驟）

### 1-1. 跑官方 CSV 重產 health_report　⏱ 5 分

```bash
# CSV 從 Drive 下載到 data/MaiCoin_transactions.csv（鐵則1：不進 git）
python3 analysis/precompute.py
git add data/health_report.json && git commit -m "data: 重跑 health_report（補 realized_pnl＋三聚合值）" && git push
```

- **一次解掉兩張單**：#27（realized_pnl）＋#29（持倉比例／變化歸因／持有期間分布）
- **驗收**：`grep -o '"realized_pnl"\|"holdings_snapshot"\|"change_attribution"\|"holding_period_distribution"' data/health_report.json` 應回 4 行
- **不做的後果**：健康分卡的「已實現損益」那行、Onboarding Screen 5/6/8 三張圖會顯示「資料不足」。不會壞，但 Demo 少講「真實虧損 vs 少賺」這個最強對比

### 1-2. 重部署　⏱ 30–40 分（照 `docs/DEPLOY.md`）

三個最容易漏、漏了不會報錯的地方：

| 漏掉什麼 | 症狀 | 為什麼難察覺 |
|---|---|---|
| 任何一頁的 `API_BASE`（頁數會一直長，別記數字） | 該頁靜默走離線 mock | 畫面正常、數字正常，只是全是假的。用 `frontend/*.html` glob 一次改完，別逐檔列名 |
| ChatFunction 的 MAX 金鑰 | 問持倉答「帳戶 API 未設定」 | 其他對話都正常 |
| OrderFunction 的 MAX 金鑰 | 下單 500 | 要走到最後一步才發現 |

### 1-3. 照 `docs/TEST_CHECKLIST.md` 驗收　⏱ 45 分

先用兩張試紙確認真的部署到新版：`/market` 有 `fetched_at_taipei` 欄位、`/audit` 不回 404。
測完把失敗項用 `D7 ✗ 原因` 格式貼給我，我直接修。

---

## Part 2｜加分項證明文件（+10 分，全靠截圖）

> 這兩項的共同規則：**截圖要能自證身分與時間**。建議每張都在畫面裡帶到
> 帳號名稱／日期，或截整個瀏覽器視窗（含網址列）。全部存 Drive 同一資料夾，
> 決賽交付時給連結。

### 2-1. Lv2 Private API　+5%

| # | 證明文件 | 截圖裡必須看得到 | 誰要交 |
|---|---|---|---|
| A | **MAX 帳號註冊來源** | 用官方連結 `max.maicoin.com/signup?r=dreambigbtc` 註冊的帳號 | 全員各自 |
| B | **Lv2 實名認證完成畫面** | 帳號名稱＋「Lv2／已完成」狀態＋日期 | **至少隊長必交**，全員最佳 |
| C | **API Key 權限設定畫面** | 權限只勾「**讀取＋交易**」、**「提領」未勾**（這是安全敘事的證據，評審會看） | 隊長 |
| D | **真實成交紀錄** | 訂單編號、幣別、最小額度金額、成交時間（對應 issue #4） | 隊長 |
| E | **成交當下的 App 畫面** | MaiMate 確認卡 → ✅ 已成交（單號）那一刻 | 隊長 |

✅ **D／E 已取得**：真實成交兩筆（`#20720919534`／`#20721028463`），
MAX App 推播與帳戶餘額變動可佐證。B／C 兩張請確認也在 Drive 同一資料夾。
⚠️ 金鑰本身**絕不截圖、絕不貼 Slack、絕不進 git**（鐵則2）——只截「權限勾選畫面」，Key 字串要遮掉。

### 2-2. Kiro　+5%

| # | 證明文件 | 截圖裡必須看得到 | 備註 |
|---|---|---|---|
| F | **Specs 面板** | `.kiro/specs/` 八份 spec 在 Kiro 介面中展開（每份都是 requirements／design／tasks 三件套） | repo 已有內容，缺的是「在 Kiro 裡的樣子」 |
| G | **Task 執行畫面** | 某個 task 被 Kiro 執行、勾選變綠的過程 | 建議錄一小段影片更有說服力 |
| H | **MCP 設定畫面** | MAX MCP server 接在 Kiro 裡（`.kiro/settings/mcp.json` 的介面呈現） | 對應簡報「開發工具鏈」那頁 |
| I | **Steering 檔生效** | `.kiro/steering/workflow.md` 被自動載入的畫面 | 這是「AI 協作紀律」的敘事素材 |
| J | **Credit 使用量** | 用量畫面（證明真的用了，不是裝樣子） | 紀律：練習≤300／開發~1000／**決賽保底≥700** |

⚠️ **credit 2000/人只發一次**——決賽當天要留 ≥700 才夠用，這幾天別把額度玩完。

---

## Part 3｜決賽交付清單（README §4.10）

八項，交出去才算數。建議做一份 Google Doc 當「交付總表」，每項一行連結：

| # | 交付物 | 現況 | 還缺什麼 |
|---|---|---|---|
| 1 | **提案簡報** | `docs/MaiMate_提案簡報.pptx`＋`docs/PITCH_DECK.html`＋逐字稿 `PITCH_6MIN.md` | 上台前最後對一次數字 |
| 2 | **Live Demo 網址** | 兩套環境都已上線（網址見 `docs/_internal/ENVIRONMENTS.md`） | **網址要在簡報和交付表都寫上** |
| 3 | **預錄影片連結** | 08-02 前端改版後鏡 1–5／7／8 已重錄（分支 `docs/demo-footage-20260802`） | 四項待決見 issue #75；剪好上傳並把連結填進交付表 |
| 4 | **GitHub repo 網址** | `github.com/giont565/MaiMate` | 確認評審看得到（若是 private 要開權限或轉 public） |
| 5 | **Lv2 證明** | 已有真實成交兩筆（`#20720919534`／`#20721028463`）與 App 畫面 | 確認 B／C 兩張（Lv2 狀態、API 權限勾選）也在 Drive |
| 6 | **Kiro 證據截圖** | **還沒有**（issue #42） | Part 2-2 的 F–J 五張，需要 Kiro IDE 介面存取，只能由人代截 |
| 7 | **技術文件** | README（唯一文件）＋DEPLOY／TEST_CHECKLIST／DEMO_SCRIPT | 現成，給 repo 連結即可 |
| 8 | **開發手冊簡報** | `docs/MaiMate_開發手冊.pptx` | 隊內用，評審問「怎麼分工」時可秀 |

---

## Part 4｜其他還開著的單子

| 單號 | 事項 | 誰 | 要多久 | 不做的後果 |
|---|---|---|---|---|
| #3 | 全員 Lv2 KYC＋API Key | 全員 | 已完成（隊長 Lv2 已核，07/29 實測 `level: 2`） | — |
| #6 | Bedrock Guardrails 主控台建立 | 隊長 | 20 分 | 目前是**兩層**護欄（SYSTEM 規則＋程式層正則）；第三層刻意未啟用，理由見 README §4.9 |
| #4 | 最小額度真實成交 E2E | 隊長 | **已完成**：真實成交兩筆 | — |
| #8 | 預錄影片 | 誰都行 | 素材已重錄，剩剪接與四項待決（#75） | 現場網路出事就沒有備援 |
| #14 | 從零部署計時演練 | 隊長 | **已完成**：實測 46 分鐘 | — |
| #15 | 簡報與 Kiro 證據彙整 | 隊長 | 簡報已定稿；Kiro 截圖仍缺（#42） | 少 5 分 |
| #27 #29 | health_report 重跑 | 隊長 | **已完成**：含 `realized_pnl` 與三組聚合 | — |

---

## Part 5｜決賽當天只剩這幾件

| 優先序 | 事項 | 為什麼 |
|---|---|---|
| 1 | **Kiro 證據截圖 F–J**（issue #42） | 這 5 分是「有交就給、沒交就沒有」，且只有人能截 |
| 2 | Demo 影片收尾（issue #75 的四項待決） | 現場網路出事時的唯一備援 |
| 3 | 上台前對一次簡報數字與線上站 | 數字對不上會在 Q&A 被追 |
| 4 | Kiro credit 留 ≥700 | 當天還要跑 task |

---

## 一句話總結

**現在只有一件事最急：Kiro 證據截圖（F–J）。**
程式、部署、真實成交、驗收都完成了，那 5 分卻是唯一 AI 代勞不了、
而且沒交就直接歸零的項目。
