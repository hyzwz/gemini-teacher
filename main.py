from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, Request, Form, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from jose import jwt, JWTError
import json
import os
import uuid
import logging
from dotenv import load_dotenv
from typing import List, Optional
from pydantic import BaseModel
import time
from sqlalchemy import select
from database import get_db, init_db
from models import User, UserLog
from auth import (
    get_current_user,
    create_access_token,
    authenticate_user,
    get_password_hash,
    get_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    SECRET_KEY,
    ALGORITHM
)
from gemini_service import GeminiService
from fastapi.templating import Jinja2Templates
import base64

# 加载环境变量
load_dotenv()

app = FastAPI()

# 配置日志记录
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 配置CORS
origins = [
    "http://localhost:8081",
    "http://0.0.0.0:8081",
    "http://127.0.0.1:8081",
    "http://localhost:5500",   # Live Server 地址
    "http://127.0.0.1:5500",  # Live Server 备用地址
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# 定义请求模型
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# API路由
@app.post("/token")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 记录登录日志
    log = UserLog(
        user_id=user.id,
        action="login",
        content="User logged in successfully",
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
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    try:
        # 检查用户名是否已存在
        existing_user = await get_user(db, username)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="用户名已被注册"
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
        await db.refresh(user)
        
        return {"message": "用户创建成功"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# WebSocket连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections = {}
        self.gemini_service = GeminiService()
        
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            
    async def process_message(self, message: str, client_id: str, user_id: int, db: AsyncSession):
        """处理来自客户端的消息"""
        try:
            # 记录用户输入
            log = UserLog(
                user_id=user_id,
                action="user_input",
                content=message[:100]  # 只记录前100个字符
            )
            db.add(log)
            await db.commit()
            
            # 调用Gemini处理消息
            response = await self.gemini_service.process_audio(message)
            
            if response:
                # 发送响应给客户端
                if client_id in self.active_connections:
                    await self.active_connections[client_id].send_json({
                        "text": response.text,
                        "audio": response.audio
                    })
                    
                # 记录响应日志
                log = UserLog(
                    user_id=user_id,
                    action="gemini_response",
                    content=response.text[:100] if response.text else "Audio response"
                )
                db.add(log)
                await db.commit()
                
        except Exception as e:
            logger.error(f"处理消息时出错: {str(e)}")
            if client_id in self.active_connections:
                await self.active_connections[client_id].send_json({
                    "error": str(e)
                })

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    try:
        # 验证token
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        user = await get_user(db, username)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept()
        client_id = str(uuid.uuid4())
        manager.active_connections[client_id] = websocket
        
        try:
            while True:
                data = await websocket.receive_json()
                
                if data.get("type") == "audio":
                    # 处理音频数据
                    audio_data = base64.b64decode(data["data"])
                    
                    # 记录用户输入日志
                    log = UserLog(
                        user_id=user.id,
                        action="audio_input",
                        content=f"Audio input received: {len(audio_data)} bytes"
                    )
                    db.add(log)
                    await db.commit()
                    
                    try:
                        # 发送音频到Gemini并获取响应
                        response = await manager.gemini_service.process_audio(audio_data)
                        
                        if response:
                            # 发送响应给客户端
                            await websocket.send_json({
                                "type": "response",
                                "audio": base64.b64encode(response.audio).decode() if response.audio else None,
                                "text": response.text if response.text else None
                            })
                            
                            # 记录响应日志
                            log = UserLog(
                                user_id=user.id,
                                action="gemini_response",
                                content=f"Response sent: {response.text[:100] if response.text else 'Audio only'}..."
                            )
                            db.add(log)
                            await db.commit()
                            
                    except Exception as e:
                        logger.error(f"处理Gemini响应时出错: {str(e)}")
                        await websocket.send_json({
                            "error": "处理响应时出错"
                        })
                        
        except WebSocketDisconnect:
            manager.disconnect(client_id)
            logger.info(f"WebSocket connection closed for user: {username}")
        except Exception as e:
            logger.error(f"WebSocket error: {str(e)}")
            manager.disconnect(client_id)
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    except Exception as e:
        logger.error(f"WebSocket endpoint error: {str(e)}")
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    await websocket.accept()
    gemini = GeminiService()
    
    try:
        # 初始化Gemini服务连接
        await gemini.setup_connection()
        
        while True:
            try:
                # 接收音频数据
                data = await websocket.receive_json()
                if not data or 'audio_data' not in data:
                    continue
                    
                audio_data = data['audio_data']
                
                # 处理音频数据
                await gemini.process_audio_chunk(audio_data)
                
                # 接收并转发Gemini的响应
                async for response in gemini.receive_responses():
                    response_data = {}
                    if response.text:
                        response_data['text'] = response.text
                    if response.audio:
                        response_data['audio'] = base64.b64encode(response.audio).decode()
                    
                    if response_data:
                        await websocket.send_json(response_data)
                    
            except json.JSONDecodeError:
                logger.error("无效的JSON数据")
                continue
                
    except WebSocketDisconnect:
        logger.info("WebSocket连接断开")
        await gemini.close()
    except Exception as e:
        logger.error(f"WebSocket处理错误: {str(e)}")
        await gemini.close()
        raise

# 启动事件
@app.on_event("startup")
async def startup_event():
    await init_db()
