# Design — deploy-drill

## 執行環境二選一

| | 本機 | AWS CloudShell |
|---|---|---|
| 需安裝 | AWS CLI／SAM CLI／Python 3.12／Node | 無（瀏覽器即可，憑證自帶） |
| Kiro 整合 | ✅ Kiro 終端機直接跑，可逐項勾 task | ⚠️ Kiro 在本機、指令在瀏覽器，要手動對照 |
| 建議 | **走這條**（Kiro 證據才拍得到 task 執行畫面） | 沒有本機環境時的備援 |

`sam build` **不需要 Docker**：後端只用標準庫，`boto3` 由 Lambda 執行環境提供
（程式內延遲 import），沒有 `requirements.txt` 要 pip。

## 角色分工（tasks.md 用符號標注）

- 🤖 **Kiro 可執行**：終端機指令、檔案修改、grep 驗證 → 開 Autopilot 或逐項 Run
- 👤 **人必須做**：AWS 主控台點選（設環境變數、看 Outputs）、手機實測、截圖

Kiro 碰不到瀏覽器主控台，所以 👤 項目請人做完後手動勾選 task，維持進度一致。

## 資料流與依賴順序

```
CSV(Drive) ─→ precompute.py ─→ health_report.json ─┐
                                                    ├─→ sam build ─→ sam deploy ─→ ApiUrl
                                    backend/ infra/ ─┘                              │
                                                                                    ▼
                            frontend/*.html 改 API_BASE ─→ s3 sync ─→ FrontendUrl ──┴─→ 冒煙
```

順序不可調換的兩處：
1. **precompute 必須在 sam build 之前**（R1）
2. **ApiUrl 必須在改 API_BASE 之前**（deploy 完才知道網址）

## 版本判別（R4）

| 探針 | 舊版 | 新版 |
|---|---|---|
| `GET /audit?session_id=probe` | 404（第五支 Lambda 不存在） | `{"trail":[...]}` |
| `GET /market?...&kind=ticker` | 只有 `fetched_at` | 有 `fetched_at_taipei` |
| `GET /health` | 無 `realized_pnl` | 有（代表 R1 生效） |

## 環境變數現況（模板已處理的不要手動加）

| 變數 | 誰設 | 備註 |
|---|---|---|
| `TABLE_NAME` | 模板 Globals | 自動 |
| `KB_ID` | 模板參數 `KnowledgeBaseId` | ⚠ **預設值是早期那顆已不存在的 KB（在別人帳號裡）**，用到預設值＝RAG 靜默失效。每次部署都要明寫 `--parameter-overrides KnowledgeBaseId=<本帳號的 KB>` |
| `BEDROCK_REGION` | 模板 `!Ref AWS::Region` | 自動 |
| `MAX_API_KEY` / `MAX_API_SECRET` | 👤 主控台 | **ChatFunction 與 OrderFunction 都要** |
| `GUARDRAIL_ID` | 👤 主控台（#6 建好後） | 選配，設了才掛載 |
| `ENABLE_PROMPT_CACHE` | 👤 主控台 | 選配，開了要確認無 ValidationException |

## 失敗處理

任一 task 失敗時：先查 `docs/DEPLOY.md` §5 速查表 → 修正 → **把新發現的坑寫回 DEPLOY.md**
（R5-3），再重跑該 task。不要跳過失敗項往下走。
