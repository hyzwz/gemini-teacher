const config = {
    // API端点配置
    endpoints: {
        base: 'http://127.0.0.1:8081',
        ws: 'ws://127.0.0.1:8081',
        login: '/token',  // 修改为正确的登录端点
        register: '/register',
        ws_endpoint: '/ws'
    },

    // WebSocket配置
    websocket: {
        reconnectInterval: 5000, // 重连间隔(毫秒)
        maxReconnectAttempts: 5  // 最大重连次数
    }
};

// 防止配置被修改
Object.freeze(config);
