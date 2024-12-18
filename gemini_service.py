import google.generativeai as genai
from typing import List, Tuple
import random
from datetime import datetime, timedelta
import asyncio
from dataclasses import dataclass

@dataclass
class ApiKeyStatus:
    key: str
    requests: List[datetime]
    is_active: bool = True
    max_requests_per_minute: int = 60

class GeminiService:
    def __init__(self, api_keys: List[str]):
        self.key_pool = [ApiKeyStatus(key=key, requests=[]) for key in api_keys]
        
    async def get_available_key(self) -> Tuple[str, ApiKeyStatus]:
        current_time = datetime.now()
        minute_ago = current_time - timedelta(minutes=1)
        
        # 随机打乱密钥顺序，实现负载均衡
        available_keys = []
        
        for key_status in self.key_pool:
            # 清理旧的请求记录
            key_status.requests = [req_time for req_time in key_status.requests 
                                 if req_time > minute_ago]
            
            # 检查是否可用
            if (key_status.is_active and 
                len(key_status.requests) < key_status.max_requests_per_minute):
                available_keys.append(key_status)
        
        if not available_keys:
            # 如果没有可用的密钥，等待一段时间后重试
            await asyncio.sleep(1)
            return await self.get_available_key()
        
        # 随机选择一个可用的密钥
        selected_key = random.choice(available_keys)
        selected_key.requests.append(current_time)
        return selected_key.key, selected_key

    async def process_with_gemini(self, text: str) -> Tuple[str, str]:
        try:
            api_key, key_status = await self.get_available_key()
            genai.configure(api_key=api_key)
            
            # 调用Gemini API
            model = genai.GenerativeModel('gemini-pro')
            response = await model.generate_content_async(text)
            return response.text, api_key
            
        except Exception as e:
            # 如果API调用失败，标记该密钥为不可用
            key_status.is_active = False
            raise Exception(f"Gemini API error: {str(e)}")
