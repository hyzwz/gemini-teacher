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
