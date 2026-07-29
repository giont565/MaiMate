import logging
from typing import List, Dict, Any

logger = logging.getLogger("MaiMate.BedrockClient")

class BedrockClient:
    """
    AWS Bedrock 通訊模組 (MaiMate Agent 核心模組)
    負責管理 LLM 連線、動態模型路由 (Haiku/Sonnet) 以及 Prompt Caching。
    """
    
    # 定義模型 ARN 或 ID
    MODEL_HAIKU = "anthropic.claude-3-haiku-20240307-v1:0"
    MODEL_SONNET = "anthropic.claude-3-5-sonnet-20240620-v1:0"

    def __init__(self, boto3_client):
        """
        初始化 Bedrock Client
        :param boto3_client: 從外部傳入已設定好 credential 的 boto3.client('bedrock-runtime')
        """
        self.client = boto3_client

    def _determine_model(self, messages: List[Dict[str, Any]]) -> str:
        """
        [動態路由機制] 掃描最後一則使用者訊息，決定要派哪一個模型出馬。
        """
        if not messages:
            return self.MODEL_HAIKU

        last_message = messages[-1]
        if last_message["role"] == "user":
            content_text = ""
            # 取出最後一句話的文字內容
            for block in last_message.get("content", []):
                if "text" in block:
                    content_text += block["text"]
            
            # 關鍵字攔截：如果涉及交易決策、方案試算，強制啟動高智商的 Sonnet
            trigger_keywords = ["賣", "買", "停損", "方案", "全出", "結清", "清倉"]
            if any(keyword in content_text for keyword in trigger_keywords):
                logger.info("🔀 [路由] 偵測到交易決策意圖，切換至高智商模型: Claude 3.5 Sonnet")
                return self.MODEL_SONNET

        # 預設使用 Haiku 處理日常對話，節省成本
        logger.info("🔀 [路由] 日常對話，使用極速模型: Claude 3 Haiku")
        return self.MODEL_HAIKU

    def invoke_converse(
        self, 
        system_prompt: str, 
        messages: List[Dict[str, Any]], 
        tools: List[Dict[str, Any]] = None,
        guardrail_id: str = None,
        guardrail_version: str = None
    ) -> Dict[str, Any]:
        """
        發送 Converse API 請求至 AWS Bedrock。
        包含動態路由、Prompt Caching 以及預留的 Guardrails 掛載點。
        """
        # 1. 決定模型
        model_id = self._determine_model(messages)

        # 2. 準備 Converse API 參數
        # 將 System Prompt 轉為 AWS Bedrock 要求的 List 格式，並嘗試注入 Cache Point
        # 注意：Prompt Caching 目前主要支援 Sonnet 與 Haiku，我們統一加上設定
        converse_kwargs = {
            "modelId": model_id,
            "messages": messages,
            "system": [
                {
                    "text": system_prompt
                    # 💡 【成本黑客技】如果 boto3 版本夠新支援，可以在此區塊加入 caching 標記
                    # "cachePoint": {"type": "default"}  
                }
            ],
            "inferenceConfig": {
                "maxTokens": 1500,
                "temperature": 0.1 # 保持極低的隨機性，金融產品不可胡說八道
            }
        }

        # 3. 註冊 Tools (如果有的話)
        if tools:
            converse_kwargs["toolConfig"] = {
                "tools": tools,
                "toolChoice": {"auto": {}}
            }

        # 4. 預留 Guardrails 掛載點 (#6 待辦事項的伏筆)
        if guardrail_id and guardrail_version:
            converse_kwargs["guardrailConfig"] = {
                "guardrailIdentifier": guardrail_id,
                "guardrailVersion": guardrail_version,
                "trace": "ENABLED"
            }
            logger.info(f"🛡️ [護欄] 已掛載 AWS Guardrail (ID: {guardrail_id})")

        # 5. 發送請求
        logger.info(f"🚀 發送 Converse API 請求至 {model_id}...")
        try:
            # 實際執行 boto3 呼叫 (Demo 或測試時，若無連線可依賴上層的 mock 處理)
            response = self.client.converse(**converse_kwargs)
            logger.info("✅ Bedrock Converse 請求成功！")
            return response
        except Exception as e:
            logger.error(f"❌ Bedrock Converse 請求失敗: {str(e)}")
            raise e