import os
import json
import base64
import logging
from websockets.exceptions import ConnectionClosed

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API配置
HOST = 'generativelanguage.googleapis.com'
MODEL = "gemini-2.0-flash-exp"

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("未设置GEMINI_API_KEY环境变量")
            
        self.ws_uri = f"wss://{HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
        self.is_speaking = False
        
    async def setup_connection(self, websocket):
        """初始化Gemini连接"""
        try:
            setup_msg = {
                "setup": {
                    "model": f"models/{MODEL}"
                }
            }
            logger.info(f"发送初始化消息: {json.dumps(setup_msg)}")
            await websocket.send(json.dumps(setup_msg))
            
            # 接收原始消息而不解码
            message = await websocket.receive()
            logger.info("Gemini连接初始化成功")
            return True
                
        except Exception as e:
            logger.error(f"Gemini连接初始化失败: {str(e)}")
            logger.error(f"错误详情: {type(e).__name__} - {str(e)}")
            return False
            
    async def handle_audio_stream(self, websocket):
        """处理实时音频流"""
        try:
            # 初始化连接
            if not await self.setup_connection(websocket):
                return
                
            while True:
                try:
                    # 接收音频数据
                    message = await websocket.receive()
                    if message.type == "bytes":
                        audio_chunk = message.data
                    else:
                        continue
                        
                    logger.info("收到音频数据")
                    
                    # 如果Gemini正在说话，不处理用户输入
                    if self.is_speaking:
                        logger.info("Gemini正在说话，跳过用户输入")
                        continue
                    
                    # 发送音频数据到Gemini
                    msg = {
                        "realtime_input": {
                            "media_chunks": [
                                {
                                    "data": base64.b64encode(audio_chunk).decode(),
                                    "mime_type": "audio/pcm"
                                }
                            ]
                        }
                    }
                    logger.info("发送音频数据到Gemini")
                    await websocket.send(json.dumps(msg))
                    
                    # 接收Gemini响应并解码为文本
                    response = await websocket.receive()
                    if response.type != "text":
                        continue
                        
                    try:
                        response_data = json.loads(response.data)
                        logger.info("收到Gemini响应")
                    except json.JSONDecodeError as e:
                        logger.error(f"JSON解析错误: {str(e)}")
                        continue
                    
                    if "serverContent" in response_data:
                        self.is_speaking = True
                        try:
                            # 获取模型回复中的音频数据
                            model_turn = response_data.get("serverContent", {}).get("modelTurn", {})
                            parts = model_turn.get("parts", [])
                            if parts and len(parts) > 0:
                                inline_data = parts[0].get("inlineData", {})
                                audio_data = inline_data.get("data")
                                if audio_data:
                                    decoded_audio = base64.b64decode(audio_data)
                                    logger.info("发送音频响应到客户端")
                                    await websocket.send(decoded_audio)
                                else:
                                    logger.warning("响应中没有音频数据")
                            else:
                                logger.warning("响应中没有parts数据")
                        except Exception as e:
                            logger.error(f"处理响应数据时出错: {str(e)}")
                            continue
                        
                        # 检查是否完成
                        if response_data.get("serverContent", {}).get("turnComplete"):
                            logger.info("Gemini响应完成")
                            self.is_speaking = False
                    
                except ConnectionClosed:
                    logger.info("WebSocket连接断开")
                    break
                except Exception as e:
                    logger.error(f"处理音频流时出错: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"处理WebSocket连接时出错: {str(e)}")
