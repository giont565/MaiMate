# Design — profile-engine

## 位置

`backend/agent/profile.py`（新檔）＋ `loop.py` 注入點。

## 資料流

health_report.json →（確定性規則）→ `{mode, evidence}` →
system prompt 追加模式段落 → 前端顯示目前模式徽章。

## 介面

```python
def infer_profile(report: dict) -> dict:
    """回傳 {"mode": "cautious|growth|pro",
             "evidence": {"monthly_trades": .., "chase_pct": ..},
             "prompt_addon": "<該模式的 system prompt 段落>"}"""
```

- `loop.run_agent(messages, profile=None)`：有傳 profile 就把 prompt_addon 接在 SYSTEM 後
- `/chat` handler 接受可選參數 `mode` 覆寫（Demo 切換用）；未傳則用 infer_profile
- 前端：header 加模式徽章＋隱藏式下拉（Demo 操作用）

## 分類閾值

以現有真實資料驗證合理性：此帳戶月均 389 筆、追高 65% → 依 R1 規則：頻率屬 pro 級但
追高 > 60% → 落在 growth（頻率高但行為有風險）。閾值寫成常數表，方便調整。

## 不做的事

問卷（P1）、模式的機器學習推斷（規則就夠）、三套 UI（只做語氣與提醒差異）。
