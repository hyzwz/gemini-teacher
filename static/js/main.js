class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
    }

    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.start();
            return true;
        } catch (error) {
            console.error('录音错误:', error);
            throw error;
        }
    }

    stop() {
        return new Promise((resolve) => {
            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                // 将音频转换为文本
                const text = await this.convertSpeechToText(audioBlob);
                resolve(text);
            };
            this.mediaRecorder.stop();
            this.stream.getTracks().forEach(track => track.stop());
        });
    }

    async convertSpeechToText(audioBlob) {
        try {
            const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            recognition.lang = 'en-US'; // 设置为英语
            recognition.continuous = false;
            recognition.interimResults = false;

            return new Promise((resolve, reject) => {
                recognition.onresult = (event) => {
                    const text = event.results[0][0].transcript;
                    resolve(text);
                };

                recognition.onerror = (error) => {
                    reject(error);
                };

                recognition.start();
            });
        } catch (error) {
            console.error('语音识别错误:', error);
            // 如果语音识别失败，返回一个测试文本
            return "This is a test message. Speech recognition failed.";
        }
    }
}

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    connect() {
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('No token available');
            return;
        }

        const clientId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.ws = new WebSocket(`ws://127.0.0.1:8081/ws/${clientId}?token=${token}`);
        
        this.ws.onopen = () => {
            console.log('WebSocket连接成功');
            this.reconnectAttempts = 0;
            document.getElementById('connectionStatus').textContent = '已连接';
            document.getElementById('connectionStatus').style.color = 'green';
        };

        this.ws.onmessage = (event) => {
            const feedback = document.getElementById('feedback');
            feedback.textContent = 'Gemini反馈：' + event.data;
            feedback.classList.add('new-message');
            setTimeout(() => feedback.classList.remove('new-message'), 300);
        };

        this.ws.onclose = () => {
            document.getElementById('connectionStatus').textContent = '未连接';
            document.getElementById('connectionStatus').style.color = 'red';
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => this.reconnect(), 3000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };
    }

    reconnect() {
        this.reconnectAttempts++;
        console.log(`尝试重新连接... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect();
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        } else {
            console.error('WebSocket未连接');
        }
    }

    close() {
        if (this.ws) {
            this.ws.close();
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
        document.getElementById('loginForm').onsubmit = async (e) => {
            e.preventDefault();
            await this.handleLogin();
        };

        // 注册表单处理
        document.getElementById('registerForm').onsubmit = async (e) => {
            e.preventDefault();
            await this.handleRegister();
        };

        // 录音控制
        document.getElementById('startRecord').onclick = async () => {
            try {
                await this.startRecording();
            } catch (error) {
                alert('无法访问麦克风：' + error);
            }
        };

        document.getElementById('stopRecord').onclick = async () => {
            await this.stopRecording();
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
            await this.audioRecorder.start();
            document.getElementById('startRecord').disabled = true;
            document.getElementById('stopRecord').disabled = false;
            document.getElementById('recordStatus').textContent = '录音中...';
        } catch (error) {
            alert('录音失败：' + error);
        }
    }

    async stopRecording() {
        try {
            document.getElementById('startRecord').disabled = false;
            document.getElementById('stopRecord').disabled = true;
            document.getElementById('recordStatus').textContent = '处理中...';

            const text = await this.audioRecorder.stop();
            document.getElementById('userInput').textContent = '您说：' + text;
            this.wsClient.send(text);
            document.getElementById('recordStatus').textContent = '就绪';
        } catch (error) {
            alert('处理录音失败：' + error);
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
