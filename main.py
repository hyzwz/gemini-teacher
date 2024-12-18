from fastapi import FastAPI, WebSocket, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta
import json
import os
from dotenv import load_dotenv
from typing import List
import time

from database import get_db, init_db
from models import User, UserLog
from auth import (
    get_current_user,
    create_access_token,
    get_password_hash,
    verify_password,
    ACCESS_TOKEN_EXPIRE_MINUTES
)

# 加载环境变量
load_dotenv()
api_keys = json.loads(os.getenv("GEMINI_API_KEYS", "[]"))

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# API路由
@app.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    user = await get_user(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 记录登录日志
    log = UserLog(
        user_id=user.id,
        action="login",
        content=f"User logged in from {form_data.client_id if hasattr(form_data, 'client_id') else 'unknown'}"
    )
    db.add(log)
    await db.commit()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/register")
async def register(
    username: str,
    email: str,
    password: str,
    db: AsyncSession = Depends(get_db)
):
    # 检查用户名是否已存在
    existing_user = await get_user(db, username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # 创建新用户
    hashed_password = get_password_hash(password)
    user = User(
        username=username,
        email=email,
        hashed_password=hashed_password
    )
    db.add(user)
    await db.commit()
    
    return {"message": "User created successfully"}

# WebSocket连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}
        self.gemini_service = GeminiService(api_keys)
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    async def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
    
    async def process_message(self, message: str, client_id: str, user_id: int, db: AsyncSession):
        start_time = time.time()
        try:
            response, api_key = await self.gemini_service.process_with_gemini(message)
            
            # 记录用户操作日志
            processing_time = int((time.time() - start_time) * 1000)  # 转换为毫秒
            log = UserLog(
                user_id=user_id,
                action="speech_input",
                content=message,
                response=response,
                api_key_used=api_key[-8:],  # 只存储API密钥的最后8位
                processing_time=processing_time
            )
            db.add(log)
            await db.commit()
            
            if client_id in self.active_connections:
                await self.active_connections[client_id].send_text(response)
        
        except Exception as e:
            error_message = f"Error processing message: {str(e)}"
            if client_id in self.active_connections:
                await self.active_connections[client_id].send_text(error_message)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    client_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.process_message(data, client_id, user.id, db)
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
    finally:
        await manager.disconnect(client_id)

# 启动事件
@app.on_event("startup")
async def startup_event():
    await init_db()
