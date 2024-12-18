class VoiceChat {
    constructor() {
        console.log('VoiceChat 初始化...');
        this.state = {
            isGeminiSpeaking: false,
            isUserSpeaking: false,
            audioContext: null,
            mediaRecorder: null,
            websocket: null,
            audioWorklet: null,
            isAudioContextInitialized: false
        };
        
        // 音频配置
        this.config = {
            sampleRate: 16000,
            channelCount: 1,
            bitsPerSample: 16,
            WS_URL: `${config.endpoints.ws}${config.endpoints.ws_endpoint}`
        };
        console.log('配置信息:', this.config);
        
        this.setupEventListeners();
    }
    
    async initializeAudioContext() {
        console.log('初始化音频上下文...');
        if (this.state.isAudioContextInitialized) {
            console.log('音频上下文已经初始化');
            return;
        }
        
        try {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.config.sampleRate
            });
            
            // 确保 AudioContext 已经启动
            if (this.state.audioContext.state === 'suspended') {
                await this.state.audioContext.resume();
            }
            console.log('音频上下文创建成功，状态:', this.state.audioContext.state);
            
            // 加载音频处理工作线程
            console.log('加载音频处理工作线程...');
            await this.state.audioContext.audioWorklet.addModule('/static/js/audio-processor.js');
            console.log('音频处理工作线程加载成功');
            
            this.state.isAudioContextInitialized = true;
        } catch (error) {
            console.error('初始化音频上下文失败:', error);
            throw error;
        }
    }
    
    setupEventListeners() {
        console.log('设置事件监听器...');
        const loginButton = document.getElementById('loginButton');
        const loginForm = document.getElementById('loginForm');
        const chatContainer = document.getElementById('chatContainer');
        const loginContainer = document.getElementById('loginContainer');
        const recordButton = document.getElementById('recordButton');
        
        if (!recordButton) {
            console.error('找不到录音按钮');
            return;
        }
        
        console.log('找到所有必要的DOM元素');
        
        loginButton.addEventListener('click', async (e) => {
            console.log('点击登录按钮');
            e.preventDefault();
            
            const formData = new FormData();
            formData.append('username', document.getElementById('username').value);
            formData.append('password', document.getElementById('password').value);
            
            try {
                // 使用 config.js 中定义的端点
                const response = await fetch(`${config.endpoints.base}${config.endpoints.login}`, {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const data = await response.json();
                    // 将 token 保存到 localStorage
                    const tokenData = {
                        token: data.access_token,
                        expires: new Date().getTime() + (24 * 60 * 60 * 1000) // 1天后过期
                    };
                    localStorage.setItem('userToken', JSON.stringify(tokenData));
                    
                    // 切换到聊天界面
                    loginContainer.classList.add('hidden');
                    chatContainer.classList.remove('hidden');
                    console.log('切换到聊天界面');
                    
                    // 登录后建立WebSocket连接
                    try {
                        console.log('登录后建立WebSocket连接...');
                        await this.setupWebSocket();
                        console.log('WebSocket连接建立成功');
                    } catch (error) {
                        console.error('建立WebSocket连接失败:', error);
                    }
                } else {
                    console.error('登录失败');
                    // 显示错误信息
                    const errorMsg = await response.text();
                    alert('登录失败: ' + errorMsg);
                }
            } catch (error) {
                console.error('登录请求失败:', error);
                alert('登录请求失败');
            }
        });
        
        let isRecording = false;
        recordButton.addEventListener('click', async () => {
            try {
                if (!isRecording) {
                    // 开始录音
                    console.log('开始录音');
                    recordButton.classList.add('recording');
                    recordButton.querySelector('i').className = 'fas fa-stop'; // 改变图标
                    await this.startListening();
                    isRecording = true;
                } else {
                    // 停止录音
                    console.log('停止录音');
                    recordButton.classList.remove('recording');
                    recordButton.querySelector('i').className = 'fas fa-microphone'; // 恢复图标
                    await this.stopListening();
                    isRecording = false;
                }
            } catch (error) {
                console.error('处理录音按钮点击事件时出错:', error);
                recordButton.classList.remove('recording');
                recordButton.querySelector('i').className = 'fas fa-microphone';
                isRecording = false;
            }
        });
        
        console.log('事件监听器设置完成');
    }
    
    async startListening() {
        if (this.state.isGeminiSpeaking) {
            console.log('请等待Gemini回复完成');
            return;
        }
        
        try {
            // 初始化音频
            await this.initializeAudioContext();
            
            // 发送开始命令
            if (this.state.websocket && this.state.websocket.readyState === WebSocket.OPEN) {
                this.state.websocket.send(JSON.stringify({ type: 'start' }));
            }
            
            // 开始录音逻辑...
            this.state.isUserSpeaking = true;
            this.updateUI('user-speaking');
            
        } catch (error) {
            console.error('开始录音时出错:', error);
            this.updateUI('error');
        }
    }
    
    async setupWebSocket() {
        try {
            const tokenData = JSON.parse(localStorage.getItem('userToken'));
            if (!tokenData || !tokenData.token) {
                throw new Error('No authentication token found');
            }

            const wsUrl = `${config.endpoints.ws}${config.endpoints.ws_endpoint}?token=${tokenData.token}`;
            this.state.websocket = new WebSocket(wsUrl);
            
            // 添加连接状态处理
            this.state.websocket.onopen = () => {
                console.log('WebSocket连接建立成功');
                this.updateConnectionStatus('connected');
                this.updateUI('已连接');
            };
            
            this.state.websocket.onclose = () => {
                console.log('WebSocket连接已关闭');
                this.updateConnectionStatus('disconnected');
                this.updateUI('未连接');
            };
            
            this.state.websocket.onerror = (error) => {
                console.error('WebSocket连接错误:', error);
                this.updateConnectionStatus('disconnected');
                this.updateUI('连接错误');
            };
            
            // 消息处理
            this.state.websocket.onmessage = async (event) => {
                try {
                    if (event.data instanceof Blob) {
                        // 处理音频响应
                        const audioData = await event.data.arrayBuffer();
                        await this.handleGeminiResponse(audioData);
                    } else {
                        // 处理文本响应
                        const response = JSON.parse(event.data);
                        if (response.text) {
                            console.log('Gemini:', response.text);
                        }
                    }
                } catch (error) {
                    console.error('处理WebSocket消息时出错:', error);
                }
            };
            
            // 等待连接建立
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket连接超时'));
                }, 5000);
                
                this.state.websocket.addEventListener('open', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });
                
                this.state.websocket.addEventListener('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('WebSocket连接失败'));
                }, { once: true });
            });
            
        } catch (error) {
            console.error('设置WebSocket连接时出错:', error);
            this.updateConnectionStatus('disconnected');
            this.updateUI('连接错误');
            throw error;
        }
    }
    
    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        const textElement = document.getElementById('connectionText');
        
        // 移除所有状态类
        statusElement.classList.remove('status-connected', 'status-disconnected', 'status-connecting');
        
        // 添加新状态类
        statusElement.classList.add(`status-${status}`);
        
        // 更新状态文本
        const statusTexts = {
            connected: '已连接',
            disconnected: '未连接',
            connecting: '连接中'
        };
        textElement.textContent = statusTexts[status];
    }
    
    async sendAudioChunk(buffer) {
        if (!this.state.websocket || this.state.websocket.readyState !== WebSocket.OPEN || this.state.isGeminiSpeaking) {
            console.log('无法发送音频数据');
            return;
        }
        
        try {
            // 将 Int16Array 转换为 Uint8Array
            const uint8Array = new Uint8Array(buffer);
            const blob = new Blob([uint8Array], { type: 'audio/pcm' });
            
            // 创建 FileReader 来读取 blob
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const arrayBuffer = reader.result;
                    await this.state.websocket.send(arrayBuffer);
                    console.log('发送音频数据成功');
                } catch (error) {
                    console.error('发送音频数据失败:', error);
                }
            };
            reader.readAsArrayBuffer(blob);
        } catch (error) {
            console.error('处理音频数据失败:', error);
        }
    }
    
    async handleGeminiResponse(audioData) {
        if (!audioData) {
            console.error('收到空的音频响应');
            return;
        }
        
        try {
            this.state.isGeminiSpeaking = true;
            console.log('开始播放Gemini响应');
            
            // 解码音频数据
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(audioData);
            
            // 创建音频源
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            // 监听播放完成
            source.onended = () => {
                console.log('Gemini响应播放完成');
                this.state.isGeminiSpeaking = false;
                audioContext.close();
            };
            
            // 开始播放
            await source.start();
            console.log('开始播放音频响应');
            
        } catch (error) {
            console.error('播放音频响应失败:', error);
            this.state.isGeminiSpeaking = false;
        }
    }
    
    async stopListening() {
        try {
            // 发送停止命令
            if (this.state.websocket && this.state.websocket.readyState === WebSocket.OPEN) {
                this.state.websocket.send(JSON.stringify({ type: 'stop' }));
            }
            
            // 停止录音逻辑...
            this.state.isUserSpeaking = false;
            this.updateUI('waiting');
            
        } catch (error) {
            console.error('停止录音时出错:', error);
            this.updateUI('error');
        }
    }
    
    updateUI(status) {
        const indicator = document.getElementById('speakingIndicator');
        const statusText = document.getElementById('statusText');
        
        switch(status) {
            case 'gemini-speaking':
                indicator.className = 'indicator gemini';
                statusText.textContent = 'Gemini正在说话...';
                break;
            case 'ready-to-speak':
                indicator.className = 'indicator ready';
                statusText.textContent = '请开始说话';
                break;
            case 'user-speaking':
                indicator.className = 'indicator user';
                statusText.textContent = '正在收听...';
                break;
            case 'waiting':
                indicator.className = 'indicator';
                statusText.textContent = '正在处理...';
                break;
            case 'error':
                indicator.className = 'indicator error';
                statusText.textContent = '发生错误';
                break;
            case '已连接':
                indicator.className = 'indicator connected';
                statusText.textContent = '已连接';
                break;
            case '连接错误':
                indicator.className = 'indicator error';
                statusText.textContent = '连接错误';
                break;
            case '未连接':
                indicator.className = 'indicator disconnected';
                statusText.textContent = '未连接';
                break;
        }
    }
    
    // 添加页面加载时的自动登录检查
    async checkAutoLogin() {
        const tokenData = JSON.parse(localStorage.getItem('userToken'));
        if (tokenData && tokenData.token) {
            // 检查 token 是否过期
            if (new Date().getTime() < tokenData.expires) {
                // token 未过期，直接显示聊天界面
                const loginContainer = document.getElementById('loginContainer');
                const chatContainer = document.getElementById('chatContainer');
                loginContainer.classList.add('hidden');
                chatContainer.classList.remove('hidden');
                
                // 自动建立WebSocket连接
                try {
                    console.log('自动建立WebSocket连接...');
                    await this.setupWebSocket();
                    console.log('WebSocket连接建立成功');
                } catch (error) {
                    console.error('建立WebSocket连接失败:', error);
                }
            } else {
                // token 已过期，清除并保持在登录界面
                localStorage.removeItem('userToken');
            }
        }
    }
}

// 修改初始化代码
document.addEventListener('DOMContentLoaded', async () => {
    window.voiceChat = new VoiceChat();
    // 检查动登录
    await window.voiceChat.checkAutoLogin();
});
