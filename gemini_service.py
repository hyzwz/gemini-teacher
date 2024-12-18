import os
import json
import base64
import logging
import asyncio
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HOST = 'generativelanguage.googleapis.com'
MODEL = "gemini-2.0-flash-exp"

class GeminiService:
    def __init__(self):
        logger.info("初始化 GeminiService...")
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            logger.error("未设置GEMINI_API_KEY环境变量")
            raise ValueError("未设置GEMINI_API_KEY环境变量")
            
        self.uri = f"wss://{HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
        self.is_speaking = False
        self.websocket = None
        self.audio_in_queue = asyncio.Queue()
        self.out_queue = asyncio.Queue(maxsize=5)
        logger.info("GeminiService 初始化完成")

    async def setup_connection(self, websocket):
        """初始化与客户端的WebSocket连接"""
        try:
            self.websocket = websocket
            logger.info("客户端WebSocket连接初始化成功")
            return True
        except Exception as e:
            logger.error(f"客户端WebSocket连接初始化失败: {str(e)}")
            logger.exception(e)
            return False

    async def startup(self, ws):
        """初始化Gemini连接"""
        setup_msg = {"setup": {"model": f"models/{MODEL}"}}
        logger.info(f"发送初始化消息: {json.dumps(setup_msg)}")
        await ws.send(json.dumps(setup_msg))
        raw_response = await ws.recv()
        response = json.loads(raw_response)
        logger.info(f"收到初始化响应: {response}")
        return True

    async def handle_audio_stream(self, websocket):
        """处理音频流"""
        try:
            await self.handle_websocket(websocket)
        except Exception as e:
            logger.error(f"处理音频流时出错: {str(e)}")
            logger.exception(e)

    async def handle_audio_data(self, data, websocket):
        """处理单个音频数据包"""
        if not isinstance(data, bytes):
            logger.error(f"收到非字节类型的音频数据: {type(data)}")
            return

        # 保存websocket连接
        self.websocket = websocket

        try:
            async with await connect(
                self.uri,
                additional_headers={"Content-Type": "application/json"}
            ) as ws:
                # 初始化连接
                await self.startup(ws)
                
                # 发送音频数据
                msg = {
                    "realtime_input": {
                        "media_chunks": [{
                            "data": base64.b64encode(data).decode(),
                            "mime_type": "audio/pcm"
                        }]
                    }
                }
                
                logger.info("正在发送音频数据到Gemini...")
                await ws.send(json.dumps(msg))
                logger.info("音频数据已发送，等待响应...")
                
                # 设置超时时间
                try:
                    async with asyncio.timeout(5.0):  # 5秒超时
                        # 接收响应
                        try:
                            while True:
                                raw_response = await ws.recv()
                                logger.info("收到原始响应")
                                response = json.loads(raw_response)
                                logger.info(f"解析后的响应: {response}")
                                
                                if "serverContent" in response:
                                    content = response["serverContent"]
                                    if "modelTurn" in content:
                                        parts = content["modelTurn"]["parts"]
                                        for part in parts:
                                            if "inlineData" in part:
                                                audio_data = base64.b64decode(part["inlineData"]["data"])
                                                logger.info(f"收到音频响应，大小: {len(audio_data)} bytes")
                                                await self.websocket.send_bytes(audio_data)
                                                logger.info("已发送音频响应至客户端")
                                            elif "text" in part:
                                                logger.info(f"收到文本响应: {part['text']}")
                                                
                                    if content.get("turnComplete"):
                                        logger.info("Gemini响应完成")
                                        return True
                                        
                        except Exception as e:
                            logger.error(f"处理响应时出错: {str(e)}")
                            return False
                            
                except asyncio.TimeoutError:
                    logger.warning("等待Gemini响应超时")
                    return False
                    
        except Exception as e:
            logger.error(f"处理音频数据时出错: {str(e)}")
            logger.exception(e)
            
    async def handle_websocket(self, websocket):
        """处理WebSocket连接"""
        try:
            self.websocket = websocket
            while True:
                try:
                    data = await websocket.receive()
                    
                    # 处理开始/结束标记
                    if isinstance(data, dict):
                        if data.get("type") == "start":
                            logger.info("开始语音对话")
                        elif data.get("type") == "stop":
                            logger.info("结束语音对话")
                        continue
                    
                    # 处理音频数据
                    elif isinstance(data, bytes):
                        if not self.is_speaking:  # 只在AI不说话时处理音频输入
                            self.is_speaking = True
                            await self.handle_audio_data(data)
                            self.is_speaking = False
                    else:
                        logger.warning(f"收到未知类型的数据: {type(data)}")
                
                except ConnectionClosed:
                    logger.info("WebSocket连接已断开")
                    break
                except Exception as e:
                    logger.error(f"处理数据时出错: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"处理WebSocket连接时出错: {str(e)}")