class AudioRecorder {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.initSpeechRecognition();
    }

    initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window) {
            this.recognition = new webkitSpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'zh-CN';

            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                        // 发送最终结果到WebSocket
                        if (this.onFinalResult) {
                            this.onFinalResult(finalTranscript);
                        }
                    } else {
                        interimTranscript += transcript;
                        // 更新临时结果显示
                        if (this.onInterimResult) {
                            this.onInterimResult(interimTranscript);
                        }
                    }
                }
            };

            this.recognition.onerror = (event) => {
                console.error('语音识别错误:', event.error);
                this.stop();
            };

            this.recognition.onend = () => {
                if (this.isRecording) {
                    this.recognition.start();
                }
            };
        } else {
            console.error('浏览器不支持语音识别');
        }
    }

    async start() {
        try {
            if (!this.recognition) {
                throw new Error('语音识别未初始化');
            }
            this.isRecording = true;
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('开始录音错误:', error);
            throw error;
        }
    }

    stop() {
        this.isRecording = false;
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    setFinalResultCallback(callback) {
        this.onFinalResult = callback;
    }

    setInterimResultCallback(callback) {
        this.onInterimResult = callback;
    }
}

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.speechSynthesis = window.speechSynthesis;
        this.speaking = false;
    }

    connect() {
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('No token available');
            return;
        }

        // 强制使用8081端口
        const wsUrl = `ws://127.0.0.1:8081/ws/${token}`;
        console.log('尝试连接WebSocket:', wsUrl);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.onopen();
            this.ws.onmessage = (event) => this.onmessage(event);
            this.ws.onclose = (event) => this.onclose(event);
            this.ws.onerror = (error) => this.onerror(error);
        } catch (error) {
            console.error('创建WebSocket连接失败:', error);
            document.getElementById('connectionStatus').textContent = '连接失败';
        }
    }

    onopen() {
        console.log('WebSocket连接已建立');
        document.getElementById('connectionStatus').textContent = '已连接';
        this.reconnectAttempts = 0;
    }

    async onmessage(event) {
        try {
            const response = JSON.parse(event.data);
            console.log('收到消息:', response);
            
            if (response.text) {
                document.getElementById('feedback').textContent = 'Gemini反馈：' + response.text;
                
                // 如果当前没有在播放，则开始语音合成
                if (!this.speaking) {
                    await this.speakText(response.text);
                }
            }
        } catch (error) {
            console.error('处理消息时出错:', error);
        }
    }

    onerror(error) {
        console.error('WebSocket错误:', error);
        document.getElementById('connectionStatus').textContent = '连接错误';
    }

    onclose(event) {
        console.log('WebSocket连接已关闭, code:', event.code, '原因:', event.reason);
        document.getElementById('connectionStatus').textContent = '未连接';
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log('准备重新连接...');
            this.reconnect();
        } else {
            console.log('达到最大重连次数，停止重连');
        }
    }

    reconnect() {
        this.reconnectAttempts++;
        console.log(`尝试重新连接... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), 2000);
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('发送消息到WebSocket:', message);
            this.ws.send(message);
        } else {
            console.error('WebSocket未连接，无法发送消息');
            document.getElementById('connectionStatus').textContent = '未连接';
            document.getElementById('connectionStatus').style.color = 'red';
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                console.log('尝试重新连接并发送消息...');
                this.connect();
                setTimeout(() => this.send(message), 1000);
            }
        }
    }

    close() {
        if (this.ws) {
            console.log('关闭WebSocket连接');
            this.ws.close();
        }
    }

    async speakText(text) {
        // 如果浏览器支持语音合成
        if (this.speechSynthesis) {
            // 如果正在播放，先停止
            if (this.speaking) {
                this.speechSynthesis.cancel();
            }

            this.speaking = true;
            const utterance = new SpeechSynthesisUtterance(text);
            
            // 设置语音参数
            utterance.lang = 'zh-CN'; // 设置语言为中文
            utterance.rate = 1.0;     // 语速
            utterance.pitch = 1.0;    // 音高
            utterance.volume = 1.0;   // 音量

            // 监听语音结束事件
            utterance.onend = () => {
                this.speaking = false;
            };

            // 监听错误事件
            utterance.onerror = (error) => {
                console.error('语音合成错误:', error);
                this.speaking = false;
            };

            // 开始播放
            this.speechSynthesis.speak(utterance);
        }
    }
}

// 主应用类
class App {
    constructor() {
        this.audioRecorder = new AudioRecorder();
        this.wsClient = new WebSocketClient();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 登录表单处理
        document.getElementById('loginForm').onsubmit = (e) => {
            e.preventDefault();
            this.handleLogin();
        };

        // 注册表单处理
        document.getElementById('registerForm').onsubmit = (e) => {
            e.preventDefault();
            this.handleRegister();
        };

        // 录音控制
        const recordButton = document.getElementById('recordButton');
        recordButton.onclick = () => {
            if (!recordButton.classList.contains('recording')) {
                this.startRecording();
                recordButton.classList.add('recording');
            } else {
                this.stopRecording();
                recordButton.classList.remove('recording');
            }
        };

        // 登出处理
        document.getElementById('logout').onclick = () => {
            this.handleLogout();
        };
    }

    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            console.log('开始登录请求...');
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const response = await axios.post('/token', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            console.log('登录响应:', response.data);
            if (response.data.access_token) {
                console.log('获取到token，正在存储...');
                localStorage.setItem('token', response.data.access_token);
                console.log('token已存储，准备显示主界面...');
                this.showMainSection();
                console.log('正在连接WebSocket...');
                this.wsClient.connect();
            } else {
                console.error('登录响应中没有token');
                alert('登录失败：服务器响应格式错误');
            }
        } catch (error) {
            console.error('登录错误:', error);
            console.error('错误详情:', error.response?.data);
            alert('登录失败：' + (error.response?.data?.detail || error.message));
        }
    }

    async handleRegister() {
        const username = document.getElementById('regUsername').value;
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;

        try {
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('email', email);
            formData.append('password', password);

            const response = await axios.post('/register', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            alert('注册成功！请登录');
            this.showLoginSection();
        } catch (error) {
            alert('注册失败：' + (error.response?.data?.detail || error.message));
        }
    }

    async startRecording() {
        try {
            document.getElementById('recordStatus').textContent = '录音中...';

            this.audioRecorder.setFinalResultCallback((text) => {
                console.log('录音转文本结果:', text);
                document.getElementById('userInput').textContent = '您说：' + text;
                console.log('发送文本到WebSocket:', text);
                this.wsClient.send(text);
            });

            this.audioRecorder.setInterimResultCallback((text) => {
                document.getElementById('userInput').textContent = '您说：' + text;
            });

            await this.audioRecorder.start();
        } catch (error) {
            console.error('录音失败：', error);
            document.getElementById('recordStatus').textContent = '错误';
            const recordButton = document.getElementById('recordButton');
            recordButton.classList.remove('recording');
        }
    }

    async stopRecording() {
        try {
            document.getElementById('recordStatus').textContent = '就绪';
            this.audioRecorder.stop();
        } catch (error) {
            console.error('停止录音时出错:', error);
            document.getElementById('recordStatus').textContent = '错误';
        }
    }

    handleLogout() {
        localStorage.removeItem('token');
        this.wsClient.close();
        this.showLoginSection();
    }

    showLoginSection() {
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('registerSection').style.display = 'none';
        document.getElementById('mainSection').style.display = 'none';
    }

    showRegisterSection() {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('registerSection').style.display = 'block';
        document.getElementById('mainSection').style.display = 'none';
    }

    showMainSection() {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('registerSection').style.display = 'none';
        document.getElementById('mainSection').style.display = 'block';
    }
}

// 添加axios请求拦截器
axios.interceptors.request.use(function (config) {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, function (error) {
    return Promise.reject(error);
});

// 添加axios响应拦截器
axios.interceptors.response.use(function (response) {
    return response;
}, function (error) {
    if (error.response && error.response.status === 401) {
        // token过期或无效，清除token并返回登录页面
        localStorage.removeItem('token');
        window.app.showLoginSection();
    }
    return Promise.reject(error);
});

// 初始化应用
window.onload = () => {
    // 设置 axios 默认配置
    axios.defaults.baseURL = 'http://127.0.0.1:8081';  // 修改为实际使用的地址
    axios.defaults.withCredentials = true;  // 允许跨域请求携带凭证
    
    const app = new App();
    window.app = app;  // 保存app实例到全局，方便拦截器使用

    // 添加注册和登录切换的事件监听
    document.getElementById('showRegister').addEventListener('click', (e) => {
        e.preventDefault();
        app.showRegisterSection();
    });
    
    document.getElementById('showLogin').addEventListener('click', (e) => {
        e.preventDefault();
        app.showLoginSection();
    });

    // 检查是否已登录
    const token = localStorage.getItem('token');
    if (token) {
        app.showMainSection();
        app.wsClient.connect();
    }
};
