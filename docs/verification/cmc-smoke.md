# CoinMarketCap smoke verification

- 驗證日期：2026-07-29（Asia/Taipei）
- 驗證目標：確認第三方 CMC quote 整合可安全略過缺少金鑰的環境，並能以真實 API Key 取得 BTC/TWD 報價。
- 驗證腳本：`scripts/verify_cmc_smoke.py`

## 驗證方式

無金鑰環境：

```powershell
python scripts/verify_cmc_smoke.py
```

預期輸出：

```text
CMC_API_KEY_PRESENT=False
CMC_LIVE_SMOKE=SKIP
```

真實 API 驗證：

```powershell
$env:CMC_API_KEY = "<CoinMarketCap API Key>"
python scripts/verify_cmc_smoke.py --require-key
```

腳本只從 `CMC_API_KEY` 讀取金鑰，不會輸出金鑰。成功條件：

1. CMC `status.error_code` 是 `0`。
2. 回傳標的是 BTC。
3. 回傳包含 TWD quote。
4. 價格是正數。
5. 回傳包含 `last_updated`。

## 2026-07-29 實跑結果

| 檢查 | 結果 |
|---|---|
| CMC status | 通過 |
| Symbol | `BTC` |
| Quote currency | `TWD` |
| Positive price | 通過 |
| Last updated | 通過 |
| 最終結果 | `CMC_LIVE_SMOKE=PASS` |

以可重跑腳本實跑時取得的參考價格約為 NT$2,080,998.99，資料更新時間為
2026-07-29 22:18:05（Asia/Taipei）。價格只用於連線驗證，不應作為 MAX 下單價格。

## 定位與限制

- CMC 是全市場脈絡的選用資料源，不是 Golden Path 或 MAX 下單的必要依賴。
- MAX ticker/kline/depth 仍是交易流程的權威行情來源。
- 目前 `thirdparty.quote()` 尚未註冊為 Agent 工具；這項驗證只證明整合模組可用。
- 金鑰不得放進 Git、前端程式、驗證紀錄或對話。
