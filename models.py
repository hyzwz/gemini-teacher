from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    email = Column(String(100), unique=True, index=True)
    hashed_password = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserLog(Base):
    __tablename__ = "user_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    action = Column(String(50))  # login, logout, speech_input
    content = Column(Text, nullable=True)  # 存储语音输入的文本
    response = Column(Text, nullable=True)  # 存储Gemini的响应
    created_at = Column(DateTime, default=datetime.utcnow)
    api_key_used = Column(String(50), nullable=True)  # 记录使用的API密钥（可以只存储一部分）
    processing_time = Column(Integer, nullable=True)  # 处理时间（毫秒）
