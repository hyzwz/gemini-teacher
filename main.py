from fastapi import FastAPI, WebSocket, Depends, HTTPException, status, Request, Form, File, UploadFile
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta
from jose import jwt, JWTError
import json
import os
import uuid
import logging
from dotenv import load_dotenv
from typing import List
from pydantic import BaseModel
import time

from database import get_db, init_db
from models import User, UserLog
from auth import (
    get_current_user,
    create_access_token,
    get_password_hash,
    verify_password,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    get_user,
    SECRET_KEY,
    ALGORITHM
)
from gemini_service import GeminiService
import speech_recognition as sr

# 加载环境变量
load_dotenv()
api_keys = json.loads(os.getenv("GEMINI_API_KEYS", "[]"))

app = FastAPI()

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",  # Live Server 地址
        "http://localhost:5500",   # 备用地址
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
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
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    user = await get_user(db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
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

@app.post("/speech-to-text")
async def speech_to_text(audio: UploadFile = File(...)):
    try:
        print("开始处理语音文件...")
        # 保存上传的音频文件
        audio_path = f"temp_{uuid.uuid4()}.wav"
        with open(audio_path, "wb") as buffer:
            content = await audio.read()
            buffer.write(content)
            
        print(f"音频文件已保存到: {audio_path}")

        try:
            # 使用Google Speech Recognition进行语音识别
            recognizer = sr.Recognizer()
            with sr.AudioFile(audio_path) as source:
                print("正在读取音频文件...")
                audio_data = recognizer.record(source)
                print("正在进行语音识别...")
                text = recognizer.recognize_google(audio_data, language="zh-CN")
                print(f"语音识别结果: {text}")
                return {"text": text}
        except sr.UnknownValueError:
            print("Google Speech Recognition无法理解音频")
            raise HTTPException(status_code=400, detail="无法识别语音内容")
        except sr.RequestError as e:
            print(f"无法从Google Speech Recognition服务获取结果; {e}")
            raise HTTPException(status_code=500, detail="语音识别服务暂时不可用")
        finally:
            # 清理临时文件
            if os.path.exists(audio_path):
                os.remove(audio_path)
                print("临时音频文件已删除")

    except Exception as e:
        print(f"语音识别错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# WebSocket连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}
        self.gemini_service = GeminiService(api_keys)
    
    async def connect(self, websocket: WebSocket, client_id: str):
        # 不需要再次accept，因为在endpoint中已经accept过了
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
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
    db: AsyncSession = Depends(get_db)
):
    print(f"收到WebSocket连接请求: client_id={client_id}")
    try:
        # 先接受连接
        await websocket.accept()
        print("WebSocket连接已接受")
        
        # 获取token
        token = None
        try:
            # 从查询参数中获取token
            token = websocket.query_params.get('token')
            print(f"从查询参数获取到token: {token[:20]}...")
            if not token:
                # 从headers中获取token
                auth_header = websocket.headers.get('authorization')
                if auth_header and auth_header.startswith('Bearer '):
                    token = auth_header.split(' ')[1]
                    print("从header获取到token")
        except Exception as e:
            print(f"获取token时出错: {e}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if not token:
            print("未提供token")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            # 验证token
            print("开始验证token...")
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            if not username:
                print("token中没有用户名")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            
            print(f"token验证成功，用户名: {username}")
            
            # 连接到manager
            await manager.connect(websocket, client_id)
            print(f"WebSocket连接已添加到manager: {client_id}")
            
            try:
                async for message in websocket.iter_text():
                    print(f"收到消息: {message[:100]}...")
                    await manager.process_message(message, client_id, username, db)
            except Exception as e:
                print(f"处理消息时出错: {e}")
                raise
                
        except JWTError as e:
            print(f"token验证失败: {e}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
    except WebSocketDisconnect:
        print(f"WebSocket断开连接: {client_id}")
        manager.disconnect(client_id)
    except Exception as e:
        print(f"WebSocket处理发生错误: {e}")
        if client_id in manager.active_connections:
            manager.disconnect(client_id)

# 启动事件
@app.on_event("startup")
async def startup_event():
    await init_db()
