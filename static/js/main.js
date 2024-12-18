class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
    }

    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
        } catch (error) {
            console.error('录音启动失败:', error);
            throw error;
        }
    }

    stop() {
        return new Promise((resolve) => {
            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                this.isRecording = false;
                resolve(audioBlob);
            };
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        });
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
        // 登录按钮处理
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.handleLogin();
        });

        // 注册按钮处理
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
        document.getElementById('startRecordBtn').addEventListener('click', () => {
            this.startRecording();
        });

        document.getElementById('stopRecordBtn').addEventListener('click', () => {
            this.stopRecording();
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
        try {
            await this.recorder.start();
            document.getElementById('startRecordBtn').classList.add('hidden');
            document.getElementById('stopRecordBtn').classList.remove('hidden');
            document.getElementById('recordingStatus').textContent = '正在录音...';
        } catch (error) {
            console.error('录音启动失败:', error);
            alert('无法启动录音，请检查麦克风权限');
        }
    }

    async stopRecording() {
        try {
            const audioBlob = await this.recorder.stop();
            document.getElementById('startRecordBtn').classList.remove('hidden');
            document.getElementById('stopRecordBtn').classList.add('hidden');
            document.getElementById('recordingStatus').textContent = '';
            
            this.chatUI.showLoading();
            await this.wsClient.sendAudio(audioBlob);
        } catch (error) {
            console.error('录音停止失败:', error);
            alert('录音处理过程中发生错误');
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

// 启动应用
const app = new App();
app.initialize();
