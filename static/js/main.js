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
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            console.log('用户名:', username);
            
            loginContainer.classList.add('hidden');
            chatContainer.classList.remove('hidden');
            console.log('切换到聊天界面');
            
            // 登录后立即建立WebSocket连接
            try {
                console.log('登录后建立WebSocket连接...');
                await this.setupWebSocket();
                console.log('WebSocket连接建立成功');
            } catch (error) {
                console.error('建立WebSocket连接失败:', error);
            }
        });
        
        let isRecording = false;
        recordButton.addEventListener('click', async () => {
            console.log('点击录音按钮');
            try {
                // 确保音频上下文已初始化
                if (!this.state.isAudioContextInitialized) {
                    await this.initializeAudioContext();
                }
                
                // 确保WebSocket连接已建立
                if (!this.state.websocket || this.state.websocket.readyState !== WebSocket.OPEN) {
                    console.log('重新建立WebSocket连接...');
                    await this.setupWebSocket();
                }
                
                if (!isRecording) {
                    console.log('开始录音');
                    recordButton.classList.add('recording');
                    await this.startListening();
                    isRecording = true;
                } else {
                    console.log('停止录音');
                    recordButton.classList.remove('recording');
                    await this.stopListening();
                    isRecording = false;
                }
            } catch (error) {
                console.error('处理录音按钮点击事件时出错:', error);
                recordButton.classList.remove('recording');
                isRecording = false;
            }
        });
        
        console.log('事件监听器设置完成');
    }
    
    async startListening() {
        console.log('开始录音...');
        if (this.state.isGeminiSpeaking) {
            console.log('请等待Gemini回复完成');
            return;
        }
        
        try {
            // 获取麦克风权限
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: this.config.channelCount,
                    sampleRate: this.config.sampleRate
                }
            });
            console.log('获取到麦克风权限');
            
            this.state.isUserSpeaking = true;
            this.updateUI('user-speaking');
            
            // 设置音频处理节点
            const source = this.state.audioContext.createMediaStreamSource(stream);
            this.state.audioWorklet = new AudioWorkletNode(
                this.state.audioContext,
                'audio-processor',
                {
                    channelCount: this.config.channelCount,
                    processorOptions: {
                        sampleRate: this.config.sampleRate,
                        bitsPerSample: this.config.bitsPerSample
                    }
                }
            );
            console.log('音频处理节点创建成功');
            
            // 连接音频节点
            source.connect(this.state.audioWorklet);
            console.log('音频节点连接成功');
            
            // 处理音频数据
            this.state.audioWorklet.port.onmessage = (event) => {
                if (event.data.type === 'audio') {
                    console.log('收到音频数据');
                    this.sendAudioChunk(event.data.buffer);
                }
            };
            
            // 更新UI
            document.getElementById('recordButton').disabled = true;
            console.log('开始录音');
            
        } catch (error) {
            console.error('开始录音时出错:', error);
            this.updateUI('error');
        }
    }
    
    async setupWebSocket() {
        console.log('建立WebSocket连接...');
        this.updateConnectionStatus('connecting');
        
        try {
            this.state.websocket = new WebSocket(this.config.WS_URL);
            
            this.state.websocket.onopen = () => {
                console.log('WebSocket连接建立成功');
                this.updateConnectionStatus('connected');
            };
            
            this.state.websocket.onclose = () => {
                console.log('WebSocket连接已关闭');
                this.updateConnectionStatus('disconnected');
            };
            
            this.state.websocket.onerror = (error) => {
                console.error('WebSocket连接错误:', error);
                this.updateConnectionStatus('disconnected');
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
            console.error('建立WebSocket连接失败:', error);
            this.updateConnectionStatus('disconnected');
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
        console.log('停止录音...');
        if (this.state.isUserSpeaking) {
            this.state.isUserSpeaking = false;
            this.updateUI('waiting');
            
            if (this.state.websocket && this.state.websocket.readyState === WebSocket.OPEN) {
                this.state.websocket.send(JSON.stringify({ type: 'stop' }));
                console.log('发送停止命令');
            }
        }
        
        if (this.state.audioWorklet) {
            this.state.audioWorklet.port.postMessage({ type: 'stop' });
            this.state.audioWorklet.disconnect();
            this.state.audioWorklet = null;
            console.log('停止音频处理');
        }
        
        // 更新UI
        document.getElementById('recordButton').disabled = false;
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.voiceChat = new VoiceChat();
});
