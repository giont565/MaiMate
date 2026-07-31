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
    r"(不要|不可|切勿|勿|不應|不|避免|拒絕|警惕|警訊|紅旗|"
    # 否定句：「沒有任何商品可以保證獲利」講的是相反的意思，卻會命中「保證獲利」。
    # 少了這組，防詐回答被自己的護欄換成安全罐頭語——實測 F3 就是這樣掛的。
    r"沒有|沒|無法|不會|不存在|並非|絕無|哪有|"
    r"詐騙(?:集團|群組|話術)?(?:可能)?(?:會)?|"
    r"對方(?:可能)?(?:會)?|假冒|自稱|聲稱|宣稱|誘導|要求)"
    # 原本寫 [^。！？\\n]——raw string 裡的 \\n 是「反斜線＋字母 n」，不是換行，
    # 所以換行從來沒被當成句子邊界。
    r"[^。！？\n]{0,16}$"
)

# 出現在命中詞「之後」的防詐指認語。用途很窄：只用來判斷「這句是在指認詐騙話術」，
# 例如「『保證獲利』『穩賺不賠』都是典型詐騙話術」。承諾獲利的句子不會這樣寫。
_FRAUD_LABEL = re.compile(
    r"(詐騙|話術|騙局|警訊|紅旗|陷阱|假的|不可信|不實|吸金|龐氏|"
    r"都是|就是).{0,12}(詐騙|話術|騙局|警訊|紅旗|陷阱)|"
    r"(詐騙|話術|騙局|警訊|紅旗|陷阱|吸金|龐氏)"
)


def _is_safety_context(text, match):
    """Return True when an advice-like phrase is governed by safety language in the same sentence.

    只看命中詞「前面」不夠：模型最自然的寫法是把警告放在後面——
    「『保證獲利』『穩賺不賠』**都是典型詐騙話術**」。實測 F3 三次全被換成安全罐頭語，
    就是因為 詐騙／話術 出現在命中詞之後，前綴檢查看不到。
    """
    sentence_start = max(
        text.rfind("。", 0, match.start()),
        text.rfind("！", 0, match.start()),
        text.rfind("？", 0, match.start()),
        text.rfind("\n", 0, match.start()),
    )
    # 前綴要保留原本的錨定語意：_SAFETY_CONTEXT 結尾是 $，套在前綴上才等於
    # 「安全語詞出現在命中詞正前方 16 字內」。改套整句會讓 $ 錨到句尾，
    # 「定期定額**不**保證獲利，長期下跌時…」的那個「不」就不算數了——實測 F4 因此被誤攔。
    prefix = text[sentence_start + 1:match.start()]
    if _SAFETY_CONTEXT.search(prefix):
        return True
    # 後綴另外看：命中詞之後、同一句內出現防詐指認語，代表這是在指認話術而非做出承諾。
    sentence_end = min((p for p in (
        text.find("。", match.end()), text.find("！", match.end()),
        text.find("？", match.end()), text.find("\n", match.end()),
    ) if p != -1), default=len(text))
    return bool(_FRAUD_LABEL.search(text[match.end():sentence_end]))


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
