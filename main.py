from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, Request, Form
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

# 加载环境变量
load_dotenv()
api_keys = json.loads(os.getenv("GEMINI_API_KEYS", "[]"))

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
        self.active_connections: dict = {}
        self.gemini_service = GeminiService(api_keys)

    async def connect(self, websocket: WebSocket, client_id: str):
        self.active_connections[client_id] = websocket
        logger.info(f"客户端 {client_id} 已连接")

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            logger.info(f"客户端 {client_id} 已断开连接")

    async def process_message(self, message: str, client_id: str, user_id: int, db: AsyncSession):
        try:
            websocket = self.active_connections[client_id]
            logger.info(f"处理来自客户端 {client_id} 的消息: {message}")

            # 处理消息
            response_text, api_key = await self.gemini_service.process_with_gemini(message)
            
            # 发送JSON格式的响应
            response_data = {
                "text": response_text,
                "type": "gemini_response"
            }
            await websocket.send_json(response_data)
            
            # 记录用户对话
            log = UserLog(
                user_id=user_id,
                action="chat",
                content=f"User: {message}\nGemini: {response_text}",
                api_key_used=api_key[-8:] if api_key else None,
                processing_time=None
            )
            db.add(log)
            await db.commit()

        except Exception as e:
            logger.error(f"处理消息时出错: {str(e)}")
            error_response = {
                "text": f"处理消息时出错: {str(e)}",
                "type": "error"
            }
            try:
                await websocket.send_json(error_response)
            except Exception as ws_error:
                logger.error(f"发送错误消息失败: {str(ws_error)}")

manager = ConnectionManager()

@app.websocket("/ws/{token}")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_db)
):
    client_id = None
    try:
        # 验证token
        logger.info("开始验证token: %s", token[:10] if token else None)
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            logger.error("Token中没有用户名")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        
        logger.info("Token验证成功，用户名: %s", username)
        
        # 获取用户信息
        user = await get_user(db, username)
        if not user:
            logger.error("找不到用户: %s", username)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        
        logger.info("获取到用户ID: %s", user.id)
        
        # 生成唯一的客户端ID
        client_id = str(uuid.uuid4())
        logger.info("生成客户端ID: %s", client_id)
        
        # 接受WebSocket连接
        try:
            await websocket.accept()
            logger.info("WebSocket连接已接受")
        except Exception as accept_error:
            logger.error("接受WebSocket连接失败: %s", str(accept_error))
            return
            
        await manager.connect(websocket, client_id)
        
        try:
            while True:
                message = await websocket.receive_text()
                logger.info("收到消息: %s", message[:100])
                await manager.process_message(message, client_id, user.id, db)
        except WebSocketDisconnect:
            logger.info("WebSocket连接断开")
            if client_id:
                manager.disconnect(client_id)
        except Exception as e:
            logger.error("WebSocket处理发生错误: %s", str(e))
            if client_id:
                manager.disconnect(client_id)
            
    except JWTError as jwt_error:
        logger.error("Token验证失败: %s", str(jwt_error))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    except Exception as e:
        logger.error("WebSocket endpoint错误: %s", str(e))
        if client_id:
            manager.disconnect(client_id)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except:
            pass

# 启动事件
@app.on_event("startup")
async def startup_event():
    await init_db()
