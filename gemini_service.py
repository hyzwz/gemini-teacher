import os
import json
import asyncio
import base64
import logging
import pyaudio
from dataclasses import dataclass
from typing import Optional, AsyncGenerator
import websockets
from dotenv import load_dotenv

load_dotenv()

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 音频配置
CHUNK_SIZE = 2048
FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000

@dataclass
class GeminiResponse:
    text: Optional[str] = None
    audio: Optional[bytes] = None

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")
            
        self.host = 'generativelanguage.googleapis.com'
        self.model = "gemini-2.0-flash-exp"
        self.ws_uri = f"wss://{self.host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
        self.ws = None
        self.audio_queue = asyncio.Queue()
        self.response_queue = asyncio.Queue()
        self.is_speaking = False
        
    async def setup_connection(self):
        """初始化WebSocket连接"""
        headers = {"Content-Type": "application/json"}
        self.ws = await websockets.connect(self.ws_uri, additional_headers=headers)
        setup_msg = {"setup": {"model": f"models/{self.model}"}}
        await self.ws.send(json.dumps(setup_msg))
        await self.ws.recv()
        
    async def process_audio_chunk(self, chunk: str):
        """处理单个音频块"""
        if self.ws and not self.is_speaking:
            try:
                # 将base64字符串转换为字节
                binary_data = base64.b64decode(chunk)
                
                msg = {
                    "realtime_input": {
                        "media_chunks": [
                            {
                                "data": base64.b64encode(binary_data).decode(),
                                "mime_type": "audio/pcm"
                            }
                        ]
                    }
                }
                await self.ws.send(json.dumps(msg))
            except Exception as e:
                logger.error(f"处理音频数据时出错: {str(e)}")
                raise
            
    async def receive_responses(self) -> AsyncGenerator[GeminiResponse, None]:
        """接收并处理响应"""
        accumulated_audio = b""
        try:
            async for msg in self.ws:
                response = json.loads(msg)
                
                if "serverContent" in response:
                    self.is_speaking = True
                    try:
                        # 获取文本响应
                        if "text" in response["serverContent"]:
                            text = response["serverContent"]["text"]
                            yield GeminiResponse(text=text)
                            
                        # 获取音频响应
                        if "modelTurn" in response["serverContent"]:
                            audio_data = response["serverContent"]["modelTurn"]["parts"][0]["inlineData"]["data"]
                            audio_chunk = base64.b64decode(audio_data)
                            accumulated_audio += audio_chunk
                            
                            if len(accumulated_audio) >= CHUNK_SIZE:
                                yield GeminiResponse(audio=accumulated_audio)
                                accumulated_audio = b""
                                
                    except KeyError as e:
                        logger.error(f"解析响应时出错: {str(e)}")
                        continue
                        
                    # 如果响应完成
                    if response["serverContent"].get("turnComplete"):
                        if accumulated_audio:  # 发送剩余的音频数据
                            yield GeminiResponse(audio=accumulated_audio)
                        self.is_speaking = False
                        break
                        
        except Exception as e:
            logger.error(f"接收响应时出错: {str(e)}")
            raise

    async def close(self):
        """关闭连接"""
        if self.ws:
            await self.ws.close()
