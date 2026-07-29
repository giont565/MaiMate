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

# 教育型回答仍不得推薦具體標的。這份清單只用於判斷「直接買賣建議」，
# 不會攔截單純解釋定期定額中「固定金額買入」之類的中性描述。
_SPECIFIC_ASSET = re.compile(
    r"\b(?:BTC|ETH|SOL|DOGE|[A-Z]{2,10}/(?:TWD|USDT|USD))\b|"
    r"(?:比特幣|以太幣|虛擬貨幣|加密貨幣|股票|個股|基金|ETF|標的)",
    re.IGNORECASE,
)

# 防詐、風險教育與否定句可能引用同一組買賣字詞；這些不是對使用者下指令。
_SAFETY_CONTEXT = re.compile(
    r"(不要|不可|切勿|勿|不應|不|避免|拒絕|警惕|警訊|"
    r"詐騙(?:集團|群組|話術)?(?:可能)?(?:會)?|"
    r"對方(?:可能)?(?:會)?|假冒|自稱|聲稱|宣稱|誘導|要求)"
    r"[^。！？\\n]{0,16}$"
)


# 安全分類可能出現在敏感詞之後，例如：
# 「保證獲利」本身就是重大警訊／應視為詐騙話術。
_SAFETY_CLASSIFICATION_AFTER = re.compile(
    r"[^。！？\n]{0,48}(?:應視為|視為|屬於|通常是|可能是|就是|是|=|＝|:|：)"
    r"[^。！？\n]{0,12}(?:詐騙|話術|警訊|警示|風險)"
)

def _is_safety_context(text, match):
    """Return True when an advice-like phrase is governed by nearby safety language."""
    sentence_start = max(
        text.rfind("。", 0, match.start()),
        text.rfind("！", 0, match.start()),
        text.rfind("？", 0, match.start()),
        text.rfind("\\n", 0, match.start()),
    )
    prefix = text[sentence_start + 1:match.start()]
    if _SAFETY_CONTEXT.search(prefix):
        return True

    ends = [
        pos for pos in (
            text.find("。", match.end()),
            text.find("！", match.end()),
            text.find("？", match.end()),
            text.find("\n", match.end()),
        )
        if pos >= 0
    ]
    sentence_end = min(ends) if ends else len(text)
    suffix = text[match.end():sentence_end]
    return bool(_SAFETY_CLASSIFICATION_AFTER.search(suffix))


def _sentence_containing(text, match):
    """Return the sentence containing a regex match."""
    start = max(
        text.rfind("。", 0, match.start()),
        text.rfind("！", 0, match.start()),
        text.rfind("？", 0, match.start()),
        text.rfind("\n", 0, match.start()),
    )
    ends = [
        pos for pos in (
            text.find("。", match.end()),
            text.find("！", match.end()),
            text.find("？", match.end()),
            text.find("\n", match.end()),
        )
        if pos >= 0
    ]
    end = min(ends) if ends else len(text)
    return text[start + 1:end]


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


def check_output(text, educational=False):
    """回傳 (ok, hits)。

    educational=True 只放行未指定標的的教育型敘述；保證獲利、必漲必跌，
    以及任何帶具體標的的直接買賣建議仍會被攔截。
    """
    hits = []
    for index, pattern in enumerate(_ADVICE_PATTERNS):
        unsafe_matches = []
        for match in re.finditer(pattern, text):
            if _is_safety_context(text, match):
                continue
            if (
                educational
                and index == 0
                and not _SPECIFIC_ASSET.search(_sentence_containing(text, match))
            ):
                continue
            unsafe_matches.append(match)
        if unsafe_matches:
            hits.append(pattern)
    return (not hits, hits)


SAFE_FALLBACK = (
    "這個問題涉及具體的買賣決策——我可以給你市場數據和你自己的操作脈絡，"
    "但買不買，永遠由你決定。要我先把相關數據攤開來看嗎？"
)
