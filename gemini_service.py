import google.generativeai as genai
from typing import List, Tuple
import random
from datetime import datetime, timedelta
import asyncio
from dataclasses import dataclass
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ApiKeyStatus:
    key: str
    requests: List[datetime]
    is_active: bool = True
    max_requests_per_minute: int = 60

class GeminiService:
    def __init__(self, api_keys: List[str]):
        self.key_pool = [ApiKeyStatus(key=key, requests=[]) for key in api_keys]
        logger.info(f"初始化GeminiService，API密钥数量: {len(api_keys)}")
        
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
        
        logger.info(f"可用API密钥数量: {len(available_keys)}")
        
        if not available_keys:
            logger.warning("没有可用的API密钥，等待1秒后重试")
            # 如果没有可用的密钥，等待一段时间后重试
            await asyncio.sleep(1)
            return await self.get_available_key()
        
        # 随机选择一个可用的密钥
        selected_key = random.choice(available_keys)
        selected_key.requests.append(current_time)
        logger.info(f"选择API密钥: {selected_key.key[-8:]}, 当前请求数: {len(selected_key.requests)}")
        return selected_key.key, selected_key

    async def process_with_gemini(self, text: str) -> Tuple[str, str]:
        try:
            logger.info(f"处理文本: {text[:100]}...")
            api_key, key_status = await self.get_available_key()
            genai.configure(api_key=api_key)
            
            # 调用Gemini API
            model = genai.GenerativeModel('gemini-pro')
            logger.info("开始调用Gemini API...")
            
            try:
                response = await model.generate_content_async(text)
                if not response.text:
                    raise Exception("API返回空响应")
                    
                logger.info(f"API调用成功，响应长度: {len(response.text)}")
                return response.text, api_key
                
            except Exception as api_error:
                logger.error(f"API调用失败: {str(api_error)}")
                # 如果是API限制相关的错误，标记该密钥为不可用
                if "quota" in str(api_error).lower() or "rate" in str(api_error).lower():
                    key_status.is_active = False
                    logger.warning(f"API密钥已被标记为不可用: {api_key[-8:]}")
                raise
            
        except Exception as e:
            error_msg = f"Gemini服务错误: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
