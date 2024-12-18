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
        logger.info("初始化 GeminiService...")
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            logger.error("未设置GEMINI_API_KEY环境变量")
            raise ValueError("未设置GEMINI_API_KEY环境变量")
            
        # 配置 Gemini API
        logger.info("配置 Gemini API...")
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel('gemini-pro')
        self.config = {
            "generation_config": {
                "response_modalities": ["AUDIO"]
            }
        }
        self.is_speaking = False
        self.websocket = None  # 初始化 websocket 属性
        logger.info("GeminiService 初始化完成")
        
    async def setup_connection(self, websocket):
        """初始化Gemini连接"""
        try:
            self.websocket = websocket  # 保存 websocket 连接
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
                    logger.error(f"处理音���流时出错: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"处理WebSocket连接时出错: {str(e)}")

    async def handle_audio_data(self, data, websocket):
        """处理音频数据"""
        try:
            if isinstance(data, dict):
                if data.get("type") == "start":
                    logger.info("开始接收音频数据")
                    self.websocket = websocket  # 更新 websocket 连接
                elif data.get("type") == "stop":
                    logger.info("停止接收音频数据")
            elif isinstance(data, bytes):
                # 音频数据处理
                logger.info(f"处理音频数据，大小: {len(data)} bytes")
                if not self.websocket:
                    logger.error("WebSocket连接未初始化")
                    self.websocket = websocket  # 尝试重新设置连接
                
                response = await self.process_audio_chunk(data)
                if response:
                    logger.info("收到 Gemini 响应，准备发送")
                    self.is_speaking = True
                    await self.send_response(response)
                    self.is_speaking = False
                else:
                    logger.warning("Gemini 未返回响应")
            else:
                logger.warning(f"收到未知类型的数据: {type(data)}")
                
        except Exception as e:
            logger.error(f"处理音频数据时出错: {str(e)}")
            logger.exception(e)

    async def process_audio_chunk(self, data):
        """处理音频数据"""
        try:
            if not hasattr(self, 'websocket'):
                logger.error("WebSocket连接未初始化")
                return

            # 检查音频数据
            if not isinstance(data, bytes):
                logger.error(f"收到非字节类型的音频数据: {type(data)}")
                return

            logger.info(f"接收到音频数据，大小: {len(data)} bytes")

            # 将音频数据转换为Gemini期望的格式
            try:
                msg = {
                    "realtime_input": {
                        "media_chunks": [{
                            "data": base64.b64encode(data).decode(),
                            "mime_type": "audio/pcm"
                        }]
                    }
                }
                
                logger.info("正在调用Gemini API...")
                
                # 使用 Gemini API 处理音频
                async with self.model.connect(
                    config=self.config
                ) as session:
                    await session.send(msg)
                    
                    # 处理响应
                    async for response in session:
                        if response.text:
                            logger.info(f"收到Gemini文本响应: {response.text}")
                            await self.websocket.send_json({
                                "type": "text",
                                "content": response.text
                            })
                        elif response.inline_data:
                            logger.info("收到Gemini音频响应")
                            # 发送音频响应到客户端
                            audio_data = base64.b64decode(response.inline_data.data)
                            await self.websocket.send_bytes(audio_data)
                            
                        if response.turn_complete:
                            logger.info("Gemini响应完成")
                            break
                            
            except Exception as e:
                logger.error(f"Gemini API调用失败: {str(e)}")
                logger.exception(e)
                return None
                
        except Exception as e:
            logger.error(f"处理音频数据块时出错: {str(e)}")
            logger.exception(e)
            return None

    async def send_response(self, response):
        """发送响应到客户端"""
        try:
            if response.text:
                await self.websocket.send_json({
                    "type": "text",
                    "content": response.text
                })
            
            if hasattr(response, 'audio'):
                await self.websocket.send_bytes(response.audio)
                
        except Exception as e:
            logger.error(f"发送响应时出错: {str(e)}")
            logger.exception(e)
