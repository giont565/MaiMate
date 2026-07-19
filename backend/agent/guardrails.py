"""應用層護欄（與 Bedrock Guardrails 疊加使用）。

紅線（product.md）：不報明牌、下單必經確認、不外洩個資。
Bedrock Guardrails 負責模型層；這裡是程式層的最後一道網。
"""
import re

# 輸出檢查：不得出現直接的買賣建議句式
_ADVICE_PATTERNS = [
    r"(建議|推薦)(你|您)?(現在)?(買進|買入|賣出|加倉|全倉|梭哈)",
    r"(一定|絕對)(會)?(漲|跌)",
    r"保證(獲利|賺)",
]

# 輸入清洗：不讓個資進到模型上下文
_PII_PATTERNS = [
    (re.compile(r"[A-Z][12]\d{8}"), "[身分證字號]"),
    (re.compile(r"09\d{2}[- ]?\d{3}[- ]?\d{3}"), "[手機號碼]"),
    (re.compile(r"\b\d{13,16}\b"), "[卡號/長數字]"),
]


def scrub_input(text):
    for pattern, repl in _PII_PATTERNS:
        text = pattern.sub(repl, text)
    return text


def check_output(text):
    """回傳 (ok, hits)。ok=False 時上層改走安全回覆，不直接輸出。"""
    hits = [p for p in _ADVICE_PATTERNS if re.search(p, text)]
    return (not hits, hits)


SAFE_FALLBACK = (
    "這個問題涉及具體的買賣決策——我可以給你市場數據和你自己的操作脈絡，"
    "但買不買，永遠由你決定。要我先把相關數據攤開來看嗎？"
)
