const config = {
    // API端点配置
    endpoints: {
        base: 'http://localhost:8081',
        ws: 'ws://localhost:8081',
        login: '/token',
        register: '/register',
        ws_endpoint: '/ws/audio'
    },

    // WebSocket配置
    websocket: {
        reconnectInterval: 5000, // 重连间隔(毫秒)
        maxReconnectAttempts: 5  // 最大重连次数
    }
};

// 防止配置被修改
Object.freeze(config);
