import logging
from typing import Dict, Any

logger = logging.getLogger("MaiMate.StrategyCalculator")

class StrategyCalculator:
    """
    三方案計算引擎 (MaiMate Agent 核心模組)
    負責接收 LLM 解析出的基本意圖，並以絕對確定性 (Determinism) 計算出三張方案卡片。
    """
    # 依據 Master Spec：MAX 交易所現貨基礎費率 (吃單 Taker 0.16%)
    TAKER_FEE_RATE = 0.0016

    @classmethod
    def get_tool_definition(cls) -> Dict[str, Any]:
        """
        給 AWS Bedrock (Haiku/Sonnet) 看的工具定義。
        【防呆機制】極度限縮欄位，剝奪 LLM 自己組裝卡片與算數學的權力。
        """
        return {
            "toolSpec": {
                "name": "calculate_trade_scenarios",
                "description": "當使用者意圖包含買入、賣出、全賣、停損時，必須 (MUST) 呼叫此工具來計算交易方案。請勿自己計算金額與手續費，只需傳入基本參數。",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "market": {
                                "type": "string",
                                "description": "交易對標的，例如 'ethtwd', 'btctwd'"
                            },
                            "action": {
                                "type": "string",
                                "enum": ["buy", "sell", "sell_all"],
                                "description": "使用者的主要動作"
                            },
                            "intended_volume": {
                                "type": "number",
                                "description": "使用者想交易的數量。如果使用者說全賣，此欄位留空或帶入 0 即可。"
                            }
                        },
                        "required": ["market", "action"]
                    }
                }
            }
        }

    def calculate_scenarios(
        self, 
        market: str, 
        action: str, 
        intended_volume: float, 
        current_price: float, 
        current_holdings_vol: float, 
        total_portfolio_twd: float
    ) -> Dict[str, Any]:
        """
        產生絕對防彈的三方案卡片 Schema，直接供 C 包前端渲染。
        """
        # 容錯與預設值處理：如果說「全賣」或沒有給數量，預設帶入當前總持倉量
        if not intended_volume or "all" in action:
            intended_volume = current_holdings_vol

        # 防呆：如果庫存為 0，明確報錯，避免產生無效卡片
        if intended_volume <= 0 or current_holdings_vol <= 0:
            logger.warning(f"⚠️ {market} 持倉不足或數量無效，無法試算方案。")
            return {"error": f"你目前沒有 {market.replace('twd', '').upper()} 的持倉，無法執行賣出試算。"}

        # ---------------------------------------------------------
        # 情境一：保守 (賣出/買入 25%) - 降低單次波動風險
        # ---------------------------------------------------------
        partial_vol = intended_volume * 0.25
        partial_amount_twd = partial_vol * current_price
        partial_fee = partial_amount_twd * self.TAKER_FEE_RATE
        
        # 計算執行後的集中度 (試算該幣種佔總資產的剩餘比例)
        post_partial_holding_twd = (current_holdings_vol - partial_vol) * current_price
        partial_concentration = int((post_partial_holding_twd / total_portfolio_twd) * 100) if total_portfolio_twd else 0

        # ---------------------------------------------------------
        # 情境二：照原計畫 (全數執行)
        # ---------------------------------------------------------
        all_amount_twd = intended_volume * current_price
        all_fee = all_amount_twd * self.TAKER_FEE_RATE
        
        post_all_holding_twd = (current_holdings_vol - intended_volume) * current_price
        all_concentration = int((post_all_holding_twd / total_portfolio_twd) * 100) if total_portfolio_twd else 0

        # ---------------------------------------------------------
        # 情境三：暫停 (冷靜期，不產生訂單)
        # ---------------------------------------------------------
        pause_amount_twd = 0
        pause_fee = 0
        pause_concentration = int(((current_holdings_vol * current_price) / total_portfolio_twd) * 100) if total_portfolio_twd else 0

        logger.info(f"📊 已完成 {market} 三方案絕對確定性計算 (免 LLM 通靈)")

        # 回傳嚴格符合 Spec 定義的 JSON Schema，對接 C 包前端渲染
        return {
            "status": "SUCCESS",
            "disclaimer": "⚠️ 以當下價格估算，實際成交可能有滑價。麥麥不會替你按下確認按鈕。",
            "scenarios": [
                {
                    "key": "partial",
                    "label": f"{'賣出' if 'sell' in action else '買入'} 25%, 留 75% 觀察",
                    "amount_twd": round(partial_amount_twd, 0),
                    "fee_twd": round(partial_fee, 0),
                    "post_concentration_pct": partial_concentration,
                    "behavior_note": "麥麥陪你分批進出場，降低單次波動風險"
                },
                {
                    "key": "all",
                    "label": "照原計畫全部執行",
                    "amount_twd": round(all_amount_twd, 0),
                    "fee_twd": round(all_fee, 0),
                    "post_concentration_pct": all_concentration,
                    "behavior_note": "執行你的原意圖"
                },
                {
                    "key": "pause",
                    "label": "先不動，設 -10% 價格提醒",
                    "amount_twd": pause_amount_twd,
                    "fee_twd": pause_fee,
                    "post_concentration_pct": pause_concentration,
                    "behavior_note": "冷靜期：不產生訂單"
                }
            ]
        }