import logging
from typing import Dict

logger = logging.getLogger("MaiMate.ProfileEngine")

class ProfileEngine:
    """
    用戶屬性與語氣引擎 (MaiMate Agent 模組)
    負責從 health_report 判定用戶模式，並注入對應的 System Prompt 語氣設定。
    """
    
    # 定義三種模式常數
    MODE_CAUTIOUS = "cautious"
    MODE_GROWTH = "growth"
    MODE_PRO = "pro"

    def determine_mode(self, health_score: int, chase_high_pct: float) -> str:
        """
        [確定性規則] 從健康分數與追高比例判定模式。
        (前端 Demo 時可直接 bypass 此函式，強制傳入特定模式)
        """
        # 如果追高比例過高 (例如大於 50%) 或分數不及格，判定為容易衝動的保守型
        if chase_high_pct > 50.0 or health_score < 60:
            return self.MODE_CAUTIOUS
        # 如果分數極高，判定為專業老手
        elif health_score >= 80:
            return self.MODE_PRO
        # 預設為穩健成長型
        else:
            return self.MODE_GROWTH

    def get_system_prompt(self, mode: str) -> str:
        """
        根據模式組裝 System Prompt。
        包含「不可撼動的安全底線」與「動態語氣切換」。
        """
        # ==========================================
        # 1. 絕對安全底線 (三模式一致，符合法遵)
        # ==========================================
        base_safety_rules = """
[System Rules]
你是一個名為「麥麥 (MaiMate)」的 AI 投資特助。
嚴格遵守以下安全紅線，違者將受到懲罰：
1. 絕對不可提供任何「明牌」或「投資建議」。
2. 絕對不可預測未來市場走向。
3. 如果使用者詢問是否該買賣，你只能提供數據洞察與「三方案卡片」，最終決策方向盤必須交給使用者。
4. 回答必須基於使用者授權的歷史交易數據或 MAX 交易所即時行情。
"""

        # ==========================================
        # 2. 動態語氣注入 (Demo 視覺差異化的關鍵)
        # ==========================================
        tone_prompts: Dict[str, str] = {
            self.MODE_CAUTIOUS: """
[Persona: 保守安撫型]
你的語氣必須【極度謹慎、溫和且充滿同理心】。
使用者可能有嚴重的 FOMO (錯失恐懼) 或正在恐慌。
- 多用安撫詞彙，例如：「我理解你現在很著急...」、「我們先深呼吸看個數據...」。
- 強力提醒風險，多用「但是」、「小心」。
- 說明方案時，強調「分批進場/出場」來降低心理壓力。
""",
            self.MODE_GROWTH: """
[Persona: 穩健教練型]
你的語氣必須【穩健、客觀、具備成長思維】。
像一個專業的健身教練，用數據引導使用者建立好習慣。
- 語氣自信且鼓勵，例如：「這是一個關鍵的決策點，我們來看看數據。」
- 客觀列出機會成本與集中度。
- 說明方案時，著重於「紀律」與「資產配置」。
""",
            self.MODE_PRO: """
[Persona: 專業果斷型]
你的語氣必須【極度專業、果斷、精簡】。
使用者是交易老手，極度討厭廢話和情緒安撫。
- 絕對不要說廢話或安撫情緒，直接切入重點。
- 大量使用專業金融術語（如：回撤、集中度、機會成本）。
- 說明方案時，直接列出 ROI、手續費率與佔比，越簡短越好。
"""
        }

        # 容錯處理：如果傳入未知的模式，退回預設的 GROWTH
        selected_tone = tone_prompts.get(mode, tone_prompts[self.MODE_GROWTH])
        
        logger.info(f"🎭 已動態組裝 System Prompt，當前模式: {mode.upper()}")
        
        return base_safety_rules + selected_tone