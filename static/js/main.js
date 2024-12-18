class VoiceChat {
    constructor() {
        this.state = {
            isRecording: false,
            isGeminiSpeaking: false,
            audioContext: null,
            audioWorklet: null,
            audioQueue: [], // 存储音频数据
            silenceTimer: null, // 用于检测停顿
            lastAudioTime: 0, // 上次接收到音频的时间
            websocket: null, // WebSocket连接
            hasSoundDetected: false, // 是否检测到声音
            reconnectAttempts: 0 // 重连次数
        };
        
        this.config = {
            sampleRate: 16000,
            channelCount: 1,
            silenceThreshold: 0.001, // 降低阈值到 0.001
            silenceTimeout: 2000 // 停顿超过2秒认为说话结束
        };

        // 设置事件监听器
        this.setupEventListeners();
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
        
        // 登录按钮事件
        loginButton.addEventListener('click', async (e) => {
            console.log('点击登录按钮');
            e.preventDefault();
            
            const formData = new FormData();
            formData.append('username', document.getElementById('username').value);
            formData.append('password', document.getElementById('password').value);
            
            try {
                const response = await fetch(`${config.endpoints.base}${config.endpoints.login}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams(formData)  // 转换为 URL 编码格式
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const tokenData = {
                        token: data.access_token,
                        expires: new Date().getTime() + (24 * 60 * 60 * 1000)
                    };
                    localStorage.setItem('userToken', JSON.stringify(tokenData));
                    
                    loginContainer.classList.add('hidden');
                    chatContainer.classList.remove('hidden');
                    
                    // 登录后建立WebSocket连接
                    try {
                        await this.setupWebSocket();
                    } catch (error) {
                        console.error('建立WebSocket连接失败:', error);
                    }
                } else {
                    const errorMsg = await response.text();
                    alert('登录失败: ' + errorMsg);
                }
            } catch (error) {
                console.error('登录请求失败:', error);
                alert('登录请求失败');
            }
        });

        // 录音按钮事件
        recordButton.addEventListener('click', async () => {
            try {
                if (!this.state.isRecording) {
                    await this.startListening();
                } else {
                    await this.stopListening();
                }
            } catch (error) {
                console.error('处理录音按钮点击事件时出错:', error);
            }
        });
    }

    updateUI(status) {
        const recordButton = document.getElementById('recordButton');
        const statusText = document.getElementById('statusText');
        
        if (!recordButton || !statusText) return;
        
        switch(status) {
            case 'user-speaking':
                recordButton.classList.add('recording');
                statusText.textContent = '正在录音...';
                break;
            case 'waiting':
                recordButton.classList.remove('recording');
                statusText.textContent = '正在处理...';
                break;
            case 'gemini-speaking':
                recordButton.classList.remove('recording');
                statusText.textContent = 'Gemini正在回复...';
                break;
            case 'ready':
                recordButton.classList.remove('recording');
                statusText.textContent = '点击开始对话';
                break;
            case 'error':
                recordButton.classList.remove('recording');
                statusText.textContent = '发生错误';
                break;
        }
    }

    async startListening() {
        if (this.state.isGeminiSpeaking) {
            console.log('请等待Gemini回复完成');
            return;
        }

        try {
            console.log('开始录音...');
            // 初始化音频上下文
            await this.initializeAudioContext();
            
            // 获取麦克风权限
            console.log('请求麦克风权限...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: this.config.channelCount,
                    sampleRate: this.config.sampleRate
                }
            });
            console.log('获取麦克风权限成功');
            
            const audioInput = this.state.audioContext.createMediaStreamSource(stream);
            
            // 创建音频处理节点
            console.log('加载音频处理器...');
            await this.state.audioContext.audioWorklet.addModule('/static/js/audio-processor.js');
            this.state.audioWorklet = new AudioWorkletNode(this.state.audioContext, 'audio-processor');
            console.log('音频处理器加载成功');
            
            // 处理音频数据
            this.state.audioWorklet.port.onmessage = (event) => {
                if (event.data.type === 'audio') {
                    console.log('收到音频处理器数据，大小:', event.data.buffer.byteLength, '音量:', event.data.volume);
                    this.handleAudioData(event.data.buffer, event.data.volume);
                }
            };
            
            audioInput.connect(this.state.audioWorklet);
            this.state.isRecording = true;
            
            // 发送开始命令
            if (this.state.websocket?.readyState === WebSocket.OPEN) {
                console.log('发送开始录音命令');
                this.state.websocket.send(JSON.stringify({ type: 'start' }));
            }
            
            this.updateUI('user-speaking');
            console.log('录音开始');
            
        } catch (error) {
            console.error('开始录音时出错:', error);
            this.updateUI('error');
        }
    }

    async stopListening() {
        try {
            this.state.isRecording = false;
            
            // 断开音频处理
            if (this.state.audioWorklet) {
                this.state.audioWorklet.disconnect();
                this.state.audioWorklet = null;
            }
            
            // 关闭音频上下文
            if (this.state.audioContext) {
                await this.state.audioContext.close();
                this.state.audioContext = null;
            }
            
            // 发送停止命令
            if (this.state.websocket?.readyState === WebSocket.OPEN) {
                this.state.websocket.send(JSON.stringify({ type: 'stop' }));
            }
            
            this.updateUI('ready');
            
        } catch (error) {
            console.error('停止录音时出错:', error);
            this.updateUI('error');
        }
    }

    handleAudioData(buffer, volume) {
        if (this.state.isGeminiSpeaking) return;
        
        console.log('处理音频数据，音量:', volume);
        
        if (volume > 0.01) {  // 使用与 cankao.py 相同的阈值
            console.log('检测到声音，添加到队列，音量:', volume);
            this.state.hasSoundDetected = true;
            this.state.lastAudioTime = Date.now();
            
            // 确保 buffer 是 ArrayBuffer
            if (buffer instanceof ArrayBuffer) {
                this.state.audioQueue.push(buffer);
            } else {
                console.error('收到非 ArrayBuffer 类型的数据:', typeof buffer);
                return;
            }
            
            if (this.state.silenceTimer) {
                clearTimeout(this.state.silenceTimer);
            }
            this.state.silenceTimer = setTimeout(() => this.handleSilence(), 3000); // 3秒静音
        } else {
            console.log('音量低于阈值:', volume);
        }
    }

    async handleSilence() {
        if (this.state.audioQueue.length > 0 && this.state.hasSoundDetected) {
            console.log('检测到停顿，发送累积的音频数据，队列长度:', this.state.audioQueue.length);
            // 将累积的音频发送给服务器
            const audioData = this.concatenateAudioBuffers(this.state.audioQueue);
            console.log('累积的音频数据大小:', audioData.byteLength);
            await this.sendAudioToServer(audioData);
            
            // 重置状态
            this.state.audioQueue = [];
            this.state.hasSoundDetected = false;
            if (this.state.silenceTimer) {
                clearTimeout(this.state.silenceTimer);
                this.state.silenceTimer = null;
            }
        } else {
            console.log('没有有效的音频数据需要发送，队列长度:', this.state.audioQueue.length);
        }
    }

    async checkAutoLogin() {
        try {
            const tokenData = JSON.parse(localStorage.getItem('userToken'));
            if (tokenData && tokenData.token) {
                // 检查 token 是否过期
                if (new Date().getTime() < tokenData.expires) {
                    console.log('发有效的登录状态，正在自动登录...');
                    
                    // 证 token 是否有效
                    const response = await fetch(`${config.endpoints.base}/verify_token`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${tokenData.token}`
                        }
                    });
                    
                    if (response.ok) {
                        // token 有效，切换到聊天界面
                        const loginContainer = document.getElementById('loginContainer');
                        const chatContainer = document.getElementById('chatContainer');
                        loginContainer.classList.add('hidden');
                        chatContainer.classList.remove('hidden');
                        
                        // 建立WebSocket连接
                        try {
                            await this.setupWebSocket();
                            console.log('自动登录成功');
                        } catch (error) {
                            console.error('建立WebSocket连接失败:', error);
                        }
                    } else {
                        // token 无效，清除并保持在登录界面
                        console.log('Token无效，需要重新登录');
                        localStorage.removeItem('userToken');
                    }
                } else {
                    // token 已过期，清除
                    console.log('Token已过期，需要重新登录');
                    localStorage.removeItem('userToken');
                }
            }
        } catch (error) {
            console.error('自动登录检查失败:', error);
            localStorage.removeItem('userToken');
        }
    }

    async setupWebSocket() {
        try {
            const tokenData = JSON.parse(localStorage.getItem('userToken'));
            if (!tokenData || !tokenData.token) {
                throw new Error('No authentication token found');
            }

            const wsUrl = `${config.endpoints.ws}/ws/audio?token=${tokenData.token}`;
            console.log('正在连接WebSocket...', wsUrl);
            
            // 关闭现有连接
            if (this.state.websocket) {
                this.state.websocket.close();
            }
            
            this.state.websocket = new WebSocket(wsUrl);
            this.state.reconnectAttempts = 0;
            
            this.state.websocket.onopen = () => {
                console.log('WebSocket连接建立成功');
                this.updateConnectionStatus('connected');
                this.updateUI('已连接');
                this.state.reconnectAttempts = 0;
            };
            
            this.state.websocket.onclose = async (event) => {
                console.log('WebSocket连接已关闭，代码:', event.code, '原因:', event.reason);
                this.updateConnectionStatus('disconnected');
                this.updateUI('未连接');
                
                // 如果不是主动关闭，尝试重连
                if (event.code !== 1000 && this.state.reconnectAttempts < 3) {
                    this.state.reconnectAttempts++;
                    console.log(`尝试重新连接 (${this.state.reconnectAttempts}/3)...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await this.setupWebSocket();
                }
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

    // 添加连接状态更新方法
    updateConnectionStatus(status) {
        const indicator = document.querySelector('.connection-status');
        if (indicator) {
            indicator.className = `connection-status status-${status}`;
        }
    }

    async initializeAudioContext() {
        console.log('初始化音频上下文...');
        if (this.state.audioContext) {
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
            
            console.log('音频上下文初始化成功');
        } catch (error) {
            console.error('初始化音频上下文时出错:', error);
            throw error;
        }
    }

    calculateVolume(buffer) {
        // 计算音频数据的音量
        const samples = new Float32Array(buffer);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }

    concatenateAudioBuffers(buffers) {
        try {
            console.log('开始合并音频缓冲区，队列长度:', buffers.length);
            
            // 首先计算总长度
            let totalLength = 0;
            for (const buffer of buffers) {
                // 确保每个buffer都是ArrayBuffer
                const view = new Float32Array(buffer);
                totalLength += view.length;
                console.log('缓冲区大小:', view.length);
            }
            
            console.log('合并后的总长度:', totalLength);
            const result = new Float32Array(totalLength);
            let offset = 0;
            
            // 合并所有缓冲区
            for (const buffer of buffers) {
                const view = new Float32Array(buffer);
                result.set(view, offset);
                offset += view.length;
                console.log('当前偏移量:', offset);
            }
            
            console.log('音频数据合并完成，最终大小:', result.length);
            return result.buffer;
        } catch (error) {
            console.error('合并音频缓冲区时出错:', error);
            console.error('错误详情:', {
                缓冲区数量: buffers.length,
                缓冲区类型: buffers.map(b => Object.prototype.toString.call(b)),
                第一个缓冲区示例: buffers[0] ? new Float32Array(buffers[0]).slice(0, 5) : null
            });
            throw error;
        }
    }

    async sendAudioToServer(audioData) {
        if (!this.state.websocket || this.state.websocket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接');
            return;
        }
        
        try {
            // 创建 Float32Array 视图来获取正确的长度
            const audioView = new Float32Array(audioData);
            console.log('原始音频��据大小:', audioView.length);
            
            // 将 Float32Array 转换为 16位 PCM
            const pcmData = new Int16Array(audioView.length);
            for (let i = 0; i < audioView.length; i++) {
                const s = Math.max(-1, Math.min(1, audioView[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            if (pcmData.length > 0) {
                console.log('发送音频数据，PCM大小:', pcmData.length, '字节');
                // 发送前检查数据
                const maxValue = Math.max(...Array.from(pcmData).map(Math.abs));
                console.log('PCM数据最大值:', maxValue);
                
                this.state.websocket.send(pcmData.buffer);
            } else {
                console.log('音频数据为空，不发送');
            }
        } catch (error) {
            console.error('发送音频数据时出错:', error);
            console.error('错误详情:', {
                数据类型: audioData.constructor.name,
                是否为ArrayBuffer: audioData instanceof ArrayBuffer,
                原始大小: audioData.byteLength
            });
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
            
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(audioData);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            source.onended = () => {
                console.log('Gemini响应播放完成');
                this.state.isGeminiSpeaking = false;
                audioContext.close();
            };
            
            await source.start();
            
        } catch (error) {
            console.error('播放音频响应失败:', error);
            this.state.isGeminiSpeaking = false;
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    window.voiceChat = new VoiceChat();
    await window.voiceChat.checkAutoLogin();
});
