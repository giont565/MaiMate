# Issue #34 RAG recovery verification

- 驗證日期：2026-07-29（Asia/Taipei）
- 驗證目標：確認帳號／API 遷移後，正式 `/chat` 路徑可重新使用 RAG，且防詐回答不會被輸出護欄誤判為買賣建議。
- 驗證腳本：`scripts/verify_rag_issue34.ps1`
- 驗證端點：`https://ri1zoohsxd.execute-api.us-east-1.amazonaws.com/chat`

## 驗證方式

腳本送出一則固定防詐問題，內容同時包含「保證獲利」「催促匯款」「詐騙話術」與「請查知識庫並附出處」，並檢查：

1. HTTP status 是 `200`。
2. `Content-Type` 是 `application/json; charset=utf-8`。
3. `tool_trail` 包含 `query_knowledge`。
4. 回答包含 165，並包含「出處」「金管會」或 `FSC`。
5. 回答沒有退化為輸出護欄的安全 fallback。

固定中文測試句與比對詞在腳本中以 UTF-8 Base64 儲存，避免 Windows PowerShell 5.1 將無 BOM 的 UTF-8 腳本誤讀。

## 重跑

一般 PowerShell：

```powershell
.\scripts\verify_rag_issue34.ps1
```

若本機停用 PowerShell 腳本執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_rag_issue34.ps1
```

驗證其他環境：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_rag_issue34.ps1 `
  -ApiBase "https://<api-id>.execute-api.<region>.amazonaws.com"
```

`ApiBase` 不應包含結尾 `/`；即使包含，腳本也會自動移除。

## 2026-07-29 實跑結果

| 檢查 | 結果 |
|---|---|
| HTTP status | `200` |
| Content-Type | `application/json; charset=utf-8` |
| `query_knowledge` | `True` |
| 165／來源證據 | `True` |
| Guardrail fallback | `False` |

結論：**通過**。RAG 已在遷移後的正式 API 恢復，防詐回答可附知識庫來源，且「保證獲利」作為詐騙警訊時不會觸發錯誤 fallback。

## 安全注意事項

- 腳本不需要 MAX API key、secret 或 AWS credential。
- 驗證紀錄不保存完整模型回答、RAG 原始語料或任何金鑰。
- RAG 語料仍只留在既有 S3／Knowledge Base，不加入 Git。
