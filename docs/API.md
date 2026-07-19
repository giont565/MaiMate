# API 介面契約（套件間交接的唯一依據）

> 改這份文件 = 改介面。要動介面先開 issue 讓受影響的包知道，不要直接改程式。

## POST /chat

Request：
```json
{ "messages": [ {"role":"user","content":[{"text":"..."}]} ], "mode": "growth", "session_id": "uuid" }
```
Response：
```json
{
  "reply": "AI 回覆文字",
  "messages": [ "...完整 Converse 歷史，前端原樣保存回傳..." ],
  "confirm": {                       // 僅在產生下單草稿時出現
    "confirm_token": "uuid",
    "confirmation_card": { "market":"ethtwd","side":"sell","volume_twd":35920,"ord_type":"market","price":null }
  },
  "scenarios": [                     // 僅在方案試算時出現
    { "key":"partial","label":"賣出 25%","amount_twd":35920,"fee_twd":54,"post_concentration_pct":44,"behavior_note":"..." }
  ],
  "tool_trail": [ {"seq":1,"tool":"get_portfolio","summary":"ETH 54%"} ]   // 前端工具鏈 chips 用
}
```

## GET /health?section=all|chase_index|...

Response＝`data/health_report.json` 的對應區塊（結構見 `.kiro/steering/data-schema.md`）。

## GET /market?market=btctwd&kind=ticker|kline|depth

Response：`{ "kind":"ticker","market":"btctwd","fetched_at":"YYYY-MM-DD HH:MM:SS","data":{...MAX 原始回應...} }`

## POST /order

Request：`{ "confirm_token":"uuid", "session_id":"uuid" }`
Response 成功：`{ "ok":true, "order":{...}, "exchange_response":{...} }`
Response 失敗：`{ "ok":false, "code":"token_expired", "message":"...", "retryable":false }`（HTTP 410）

## GET /audit?session_id=uuid

Response：`{ "trail":[ {"seq":1,"ts":"...","type":"tool_call|draft_created|user_confirmed|executed","payload":{...}} ] }`

## 共用檔案所有權（誰能改哪裡）

| 檔案/目錄 | Owner | 別包要改怎麼辦 |
|---|---|---|
| backend/agent/（含 tools.py、loop.py） | A 包 | 開 issue 給 A；B 的函式由 A 註冊進 tools |
| backend/integrations/、analysis/、KB 語料 | B 包 | 開 issue 給 B |
| frontend/、docs/mockups/、docs/brand/ | C 包 | 開 issue 給 C |
| infra/、docs/DEPLOY.md、docs/*.pptx | D 包 | 開 issue 給 D |
| 本文件（API.md）、.kiro/steering/ | 全隊 | 改前先在 #dev 說一聲 |
