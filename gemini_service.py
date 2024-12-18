import os
import json
import base64
import logging
from websockets.exceptions import ConnectionClosed
import google.generativeai as genai

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
            
        # 配置 Gemini API
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel('gemini-pro')  # 使用适当的模型
        self.config = {
            "generation_config": {
                "response_modalities": ["AUDIO"]
            }
        }
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
            await websocket.send_text(json.dumps(setup_msg))
            
            # 接收消息
            try:
                message = await websocket.receive()
                message_type = message.get("type")
                
                if message_type == "websocket.disconnect":
                    logger.error("WebSocket连接已断开")
                    return False
                    
                if message_type == "websocket.receive":
                    data = message.get("bytes") or message.get("text")
                    logger.info("Gemini连接初始化成功")
                    return True
                    
                logger.warning(f"收到未预期的消息类型: {message_type}")
                return False
                
            except RuntimeError as e:
                if "disconnect message has been received" in str(e):
                    logger.error("WebSocket连接已断开")
                    return False
                raise
                
        except Exception as e:
            logger.error(f"Gemini连接初始化失败: {str(e)}")
            logger.error(f"错误详情: {type(e).__name__} - {str(e)}")
            return False
            
    async def handle_audio_stream(self, websocket):
        """处理音频流"""
        try:
            while True:
                try:
                    data = await websocket.receive()
                    # 只记录状态变化
                    if isinstance(data, dict):
                        if data.get("type") == "start":
                            logger.info("开始语音对话")
                        elif data.get("type") == "stop":
                            logger.info("结束语音对话")
                        continue
                    
                    # 处理音频数据时不记录日志
                    if "serverContent" in data:
                        if data.get("serverContent", {}).get("turnComplete"):
                            logger.info("Gemini响应完成")
                            self.is_speaking = False
                
                except ConnectionClosed:
                    logger.info("WebSocket连接已断开")
                    break
                except Exception as e:
                    logger.error(f"处理音频流时出错: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"处理WebSocket连接时出错: {str(e)}")

    async def process_audio_chunk(self, data):
        """处理音频数据块"""
        try:
            # 将音频数据转换为Gemini期望的格式
            msg = {
                "realtime_input": {
                    "media_chunks": [{
                        "data": base64.b64encode(data).decode(),
                        "mime_type": "audio/pcm"
                    }]
                }
            }
            
            # 发送到Gemini
            async with self.model.connect(
                config=self.config
            ) as session:
                await session.send(msg)
                
                # 处理响应
                async for response in session:
                    if response.text:
                        print(response.text)
                    elif response.inline_data:
                        # 发送音频响应到客户端
                        audio_data = base64.b64decode(response.inline_data.data)
                        await self.websocket.send_bytes(audio_data)
                        
                    if response.turn_complete:
                        break
                        
        except Exception as e:
            logger.error(f"处理音频数据块时出错: {str(e)}")

    async def handle_audio_data(self, data):
        """处理音频数据"""
        try:
            if isinstance(data, dict):
                # 只记录控制命令的日志
                if data.get("type") == "start":
                    logger.info("开始接收音频数据")
                elif data.get("type") == "stop":
                    logger.info("停止接收音频数据")
            else:
                # 音频数据处理时不记录日志
                await self.process_audio_chunk(data)
        except Exception as e:
            logger.error(f"处理音频数据时出错: {str(e)}")
