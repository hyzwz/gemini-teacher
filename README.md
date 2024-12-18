# Gemini 英语学习助手

这是一个基于 Google Gemini AI 的多用户英语学习系统，支持实时语音识别和AI辅导。


## 功能特点

- 👥 多用户系统
- 🔐 JWT身份验证
- 🎤 实时语音识别
- 🤖 AI 驱动的语言学习
- 📝 语法纠正和建议
- 🔄 实时对话练习
- 🎯 个性化学习指导
- 💡 WebSocket实时通信

## 系统要求

- Python 3.11+
- 现代浏览器（支持WebSocket）
- 麦克风设备
- 网络连接

## 前置依赖

1. Gemini API Key
   - 访问 [Google AI Studio](https://aistudio.google.com/app/apikey) 生成API Key
   - 每天免费提供400万次调用配额

2. 环境配置
   - 创建 `.env` 文件，添加以下配置：
   ```
   GEMINI_API_KEYS=["your-api-key-1", "your-api-key-2"]
   SECRET_KEY=your-jwt-secret-key
   ```

## 安装

1. 克隆仓库：
```bash
git clone https://github.com/nishuzumi/gemini-teacher.git
cd gemini-teacher
```

2. 创建并激活虚拟环境：
```bash
python -m venv .venv
source .venv/bin/activate  # Unix/macOS
# 或
.venv\Scripts\activate  # Windows
```

3. 安装系统依赖：
- Windows: 无需额外安装
- macOS: `brew install portaudio`
- Ubuntu/Debian: `sudo apt-get install portaudio19-dev python3-pyaudio`

4. 安装Python依赖：
```bash
pip install -r requirements.txt
```

## 使用方法

1. 启动后端服务：
```bash
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8081
```

2. 访问前端页面：
- 使用浏览器打开 `http://127.0.0.1:8081`
- 注册/登录账号
- 开始英语学习对话

## 系统架构

- 前端：HTML + JavaScript
  - 实时语音识别
  - WebSocket通信
  - JWT认证

- 后端：FastAPI + SQLite
  - RESTful API
  - WebSocket服务
  - 用户认证
  - Gemini AI集成

## 语音识别实现

系统使用 Web Speech API 实现实时语音识别：

1. 前端实现
   - 使用 webkitSpeechRecognition API
   - 支持实时语音识别（continuous 和 interimResults）
   - 支持中文识别（lang='zh-CN'）
   - 无需额外服务器或 API Key

2. 功能特点
   - 实时显示识别结果
   - 自动重连机制
   - 错误处理和状态显示
   - 支持临时结果和最终结果

注意：使用 Web Speech API 需要：
- 现代浏览器（推荐 Chrome）
- 麦克风权限
- 网络连接

## 交互说明

- 🟢 已连接：WebSocket连接正常
- 🔴 未连接：WebSocket连接断开
- 🎤 录音中：正在采集语音
- ⏳ 处理中：AI正在分析
- 💬 反馈：显示AI反馈

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### 2024-12-18
- 添加多用户支持
- 实现JWT身份验证
- 添加WebSocket实时通信
- 优化前端界面
- 改进错误处理

### 2024-03-xx 用户认证优化
- 实现了基于 JWT 的持久化登录
- 修复了登录端口配置问题
- 优化了 WebSocket 连接的认证流程

#### 具体改动
1. 登录系统优化
   - 将 token 有效期延长至 24 小时
   - 实现了 token 的本地存储和自动登录功能
   - 修复了登录 API 端点配置问题

2. WebSocket 连接优化
   - 添加了 token 认证到 WebSocket 连接
   - 改进了连接状态管理
   - 优化了重连机制

3. 配置管理改进
   - 统一使用 config.js 管理所有端点配置
   - 规范化 API 路径配置
   - 添加了配置文件防篡改保护

#### 技术细节
- JWT token 存储位置：localStorage
- Token 有效期：24小时
- WebSocket 认证方式：URL query parameter
- 配置文件：使用 Object.freeze 防止运行时修改

#### 如何使用
1. 首次登录后，系统会自动保存登录状态
2. Token 会在本地保存 24 小时
3. 刷新页面或重新打开浏览器，无需重新登录
4. Token 过期后会自动跳转到登录页面

### 2024-03-xx WebSocket连接优化
- 优化了 WebSocket 连接状态管理
- 改进了音频数据处理流程
- 修复了连接状态指示器问题

#### 具体改动
1. WebSocket 连接管理
   - 添加了完整的连接状态处理
   - 实现了连接超时机制
   - 优化了状态指示器的显示逻辑

2. 音频处理优化
   - 减少了不必要的日志输出
   - 优化了音频数据的发送和接收流程
   - 改进了 Gemini API 的集成方式

3. UI 交互改进
   - 添加了录音按钮状态切换
   - 优化了连接状态的视觉反馈
   - 改进了错误处理和提示

#### 技术细节
- WebSocket 状态监控：onopen, onclose, onerror, onmessage
- 连接超时设置：5000ms
- 状态指示：
  - 绿色：连接成功
  - 红色：连接断开或错误
  - 黄色：正在连接

#### 依赖更新
- 添加了 google-generativeai 包
- 更新了 Gemini API 集成方式

## 基本功能逻辑

### 语音对话流程
1. 用户点击录音按钮开始对话
2. 系统实时采集用户语音
3. 检测用户语音停顿（超过1秒无声）
4. 将累积的语音数据发送给 Gemini
5. Gemini 处理语音并返回回复
6. 系统播放 Gemini 的语音回复
7. 在 Gemini 回复期间，暂时屏蔽用户输入
8. Gemini 回复结束后，用户可继续对话

### 技术实现细节
1. 音频采集
   - 采样率：16000Hz
   - 声道数：单声道
   - 使用 AudioWorklet 处理音频流
   - 实时检测音量和停顿

2. 停顿检测
   - 音量阈值：0.01
   - 停顿时长：1000ms（1秒）
   - 超过停顿阈值时自动发送音频数据

3. 对话控制
   - 用户说话时：采集并缓存音频数据
   - 检测到停顿：发送累积的音频数据
   - Gemini回复时：暂停音频采集
   - 回复结束后：恢复音频采集

4. 音频处理
   - 前端：实时音频数据缓存和发送
   - 后端：音频数据处理和 Gemini API 调用
   - 响应：支持文本和语音双模态回复

### 使用流程
1. 点击录音按钮开始对话
2. 用英语向 Gemini 提问或对话
3. 停顿超过1秒后，系统自动处理
4. 等待 Gemini 的语音回复
5. 回复结束后可继续对话
6. 再次点击录音按钮结束对话

### 注意事项
- 确保麦克风权限已授权
- 保持网络连接稳定
- 说话时注意适当停顿
- 等待 Gemini 回复完成再继续
- 建议使用耳机避免回音
