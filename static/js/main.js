class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.audioContext = null;
        this.audioProcessor = null;
        this.ws = null;
    }

    async start() {
        try {
            await this.setupAudioContext();
            
            // 使用配置文件中的WebSocket URL
            const wsUrl = `${config.endpoints.ws}${config.endpoints.ws_endpoint}`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onmessage = async function(event) {
                const response = JSON.parse(event.data);
                
                if (response.text) {
                    // 显示文本响应
                    displayResponse(response.text);
                }
                
                if (response.audio) {
                    // 播放音频响应
                    const audioData = base64ToFloat32Array(response.audio);
                    await playAudioResponse(audioData);
                }
            };
            
            // 设置音频处理回调
            this.audioProcessor.onaudioprocess = function(e) {
                if (!this.isRecording) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                const audioData = convertFloat32ToInt16(inputData);
                const base64Data = arrayBufferToBase64(audioData.buffer);
                
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        audio_data: base64Data,
                        is_binary: true
                    }));
                }
            }.bind(this);
            
            this.isRecording = true;
            updateRecordingStatus('正在录音...');
            animateRecordButton(true);
        } catch (error) {
            console.error('启动录音失败:', error);
            updateRecordingStatus('录音启动失败');
            this.isRecording = false;
        }
    }

    async stop() {
        try {
            this.isRecording = false;
            updateRecordingStatus('停止录音');
            animateRecordButton(false);
            
            if (this.ws) {
                this.ws.close();
            }
            
            if (this.audioProcessor) {
                this.audioProcessor.disconnect();
                this.audioProcessor = null;
            }
            
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
        } catch (error) {
            console.error('停止录音失败:', error);
            updateRecordingStatus('停止录音失败');
        }
    }

    async setupAudioContext() {
        try {
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioContext.createMediaStreamSource(stream);
            
            // 创建音频处理节点
            this.audioProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
            source.connect(this.audioProcessor);
            this.audioProcessor.connect(this.audioContext.destination);
            
            return true;
        } catch (error) {
            console.error('设置音频上下文失败:', error);
            return false;
        }
    }
}

class WebSocketClient {
    constructor(token) {
        this.socket = null;
        this.token = token;
        this.messageHandlers = new Set();
        this.connectionStatus = document.getElementById('connectionStatus');
        this.connectionText = document.getElementById('connectionText');
        this.reconnectAttempts = 0;
    }

    updateConnectionStatus(status) {
        this.connectionStatus.className = 'connection-status';
        switch (status) {
            case 'connected':
                this.connectionStatus.classList.add('status-connected');
                this.connectionText.textContent = '已连接';
                break;
            case 'disconnected':
                this.connectionStatus.classList.add('status-disconnected');
                this.connectionText.textContent = '未连接';
                break;
            case 'connecting':
                this.connectionStatus.classList.add('status-connecting');
                this.connectionText.textContent = '连接中...';
                break;
        }
    }

    connect() {
        const wsUrl = `${config.endpoints.ws}${config.endpoints.ws_endpoint}?token=${this.token}`;
        
        this.updateConnectionStatus('connecting');
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            console.log('WebSocket连接已建立');
            this.updateConnectionStatus('connected');
            this.notifyHandlers({ type: 'connection', status: 'connected' });
            this.reconnectAttempts = 0; // 重置重连计数
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.notifyHandlers({ type: 'message', data });
        };
        
        this.socket.onclose = () => {
            console.log('WebSocket连接已关闭');
            this.updateConnectionStatus('disconnected');
            this.notifyHandlers({ type: 'connection', status: 'disconnected' });
            
            // 检查是否应该重新连接
            if (this.reconnectAttempts < config.websocket.maxReconnectAttempts) {
                setTimeout(() => {
                    if (this.socket.readyState === WebSocket.CLOSED) {
                        this.reconnectAttempts++;
                        console.log(`尝试重新连接 (${this.reconnectAttempts}/${config.websocket.maxReconnectAttempts})`);
                        this.connect();
                    }
                }, config.websocket.reconnectInterval);
            } else {
                console.log('达到最大重连次数，停止重连');
            }
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket错误:', error);
            this.updateConnectionStatus('disconnected');
            this.notifyHandlers({ type: 'error', error });
        };
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.updateConnectionStatus('disconnected');
        }
    }

    sendAudio(audioBlob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Audio = reader.result.split(',')[1];
                const message = {
                    type: 'audio',
                    data: base64Audio
                };
                this.socket.send(JSON.stringify(message));
                resolve();
            };
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
        });
    }

    addMessageHandler(handler) {
        this.messageHandlers.add(handler);
    }

    removeMessageHandler(handler) {
        this.messageHandlers.delete(handler);
    }

    notifyHandlers(message) {
        this.messageHandlers.forEach(handler => handler(message));
    }
}

class ChatUI {
    constructor() {
        this.messageContainer = document.getElementById('messageContainer');
    }

    addMessage(text, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'gemini-message'}`;
        messageDiv.textContent = text;
        this.messageContainer.appendChild(messageDiv);
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message gemini-message loading-dots';
        loadingDiv.textContent = '正在思考';
        loadingDiv.id = 'loadingMessage';
        this.messageContainer.appendChild(loadingDiv);
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    removeLoading() {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.remove();
        }
    }

    playAudio(audioData) {
        const audio = new Audio(`data:audio/wav;base64,${audioData}`);
        audio.play();
    }
}

class App {
    constructor() {
        this.recorder = new AudioRecorder();
        this.wsClient = null;
        this.chatUI = new ChatUI();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 登录表单提交
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.handleLogin();
        });

        // 注册表单提交
        document.getElementById('registerBtn').addEventListener('click', () => {
            this.handleRegister();
        });

        // 显示注册表单
        document.getElementById('showRegisterBtn').addEventListener('click', () => {
            document.getElementById('loginForm').classList.add('hidden');
            document.getElementById('registerForm').classList.remove('hidden');
        });

        // 显示登录表单
        document.getElementById('showLoginBtn').addEventListener('click', () => {
            document.getElementById('registerForm').classList.add('hidden');
            document.getElementById('loginForm').classList.remove('hidden');
        });

        // 录音按钮处理
        const recordButton = document.getElementById('recordButton');
        recordButton.addEventListener('click', async () => {
            if (!this.recorder.isRecording) {
                try {
                    await this.startRecording();
                    recordButton.classList.add('recording');
                } catch (error) {
                    console.error('启动录音失败:', error);
                    alert('无法启动录音，请确保已授予麦克风权限。');
                }
            } else {
                await this.stopRecording();
                recordButton.classList.remove('recording');
            }
        });

        // 登出按钮处理
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });
    }

    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // 创建表单数据
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        try {
            const response = await fetch(`${config.endpoints.base}${config.endpoints.login}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('token', data.access_token);  // 注意这里使用 access_token
                this.showChatInterface();
                this.initializeWebSocket(data.access_token);
            } else {
                alert(data.detail || '登录失败');
            }
        } catch (error) {
            console.error('登录错误:', error);
            alert('登录过程中发生错误');
        }
    }

    async handleRegister() {
        const username = document.getElementById('regUsername').value;
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;

        try {
            const response = await fetch(`${config.endpoints.base}${config.endpoints.register}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, email, password }),
            });

            const data = await response.json();

            if (response.ok) {
                alert('注册成功！请登录');
                // 显示登录表单
                document.getElementById('registerForm').classList.add('hidden');
                document.getElementById('loginForm').classList.remove('hidden');
                // 预填充用户名
                document.getElementById('username').value = username;
            } else {
                alert(data.detail || '注册失败');
            }
        } catch (error) {
            console.error('注册错误:', error);
            alert('注册过程中发生错误');
        }
    }

    handleLogout() {
        localStorage.removeItem('token');
        if (this.wsClient) {
            this.wsClient.disconnect();
        }
        this.showLoginInterface();
    }

    showLoginInterface() {
        document.getElementById('loginContainer').classList.remove('hidden');
        document.getElementById('chatContainer').classList.add('hidden');
    }

    showChatInterface() {
        document.getElementById('loginContainer').classList.add('hidden');
        document.getElementById('chatContainer').classList.remove('hidden');
    }

    initializeWebSocket(token) {
        this.wsClient = new WebSocketClient(token);
        
        this.wsClient.addMessageHandler((message) => {
            if (message.type === 'message') {
                this.chatUI.removeLoading();
                
                if (message.data.text) {
                    this.chatUI.addMessage(message.data.text, false);
                }
                
                if (message.data.audio) {
                    this.chatUI.playAudio(message.data.audio);
                }
            }
        });
        
        this.wsClient.connect();
    }

    async startRecording() {
        const recordingStatus = document.getElementById('recordingStatus');
        try {
            await this.recorder.start();
            recordingStatus.textContent = '正在录音...';
        } catch (error) {
            console.error('录音启动失败:', error);
            recordingStatus.textContent = '无法启动录音，请确保已授予麦克风权限';
            throw error;
        }
    }

    async stopRecording() {
        const recordingStatus = document.getElementById('recordingStatus');
        try {
            await this.recorder.stop();
            recordingStatus.textContent = '';
            
            this.chatUI.showLoading();
            if (this.wsClient) {
                // await this.wsClient.sendAudio(audioBlob);
            }
            this.chatUI.removeLoading();
        } catch (error) {
            console.error('录音停止失败:', error);
            recordingStatus.textContent = '录音停止失败';
            throw error;
        }
    }

    initialize() {
        const token = localStorage.getItem('token');
        if (token) {
            this.showChatInterface();
            this.initializeWebSocket(token);
        } else {
            this.showLoginInterface();
        }
    }
}

// 辅助函数
function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToFloat32Array(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
}

async function playAudioResponse(audioData) {
    const buffer = new AudioContext().createBuffer(1, audioData.length, 16000);
    buffer.copyToChannel(audioData, 0);
    
    const source = new AudioContext().createBufferSource();
    source.buffer = buffer;
    source.connect(new AudioContext().destination);
    source.start();
}

// UI更新函数
function updateRecordingStatus(status) {
    const statusElement = document.getElementById('recordingStatus');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

function animateRecordButton(isRecording) {
    const button = document.querySelector('.record-button');
    if (button) {
        if (isRecording) {
            button.classList.add('recording');
        } else {
            button.classList.remove('recording');
        }
    }
}

function displayResponse(text) {
    const responseElement = document.getElementById('response');
    if (responseElement) {
        responseElement.textContent = text;
    }
}

// 启动应用
const app = new App();
app.initialize();
