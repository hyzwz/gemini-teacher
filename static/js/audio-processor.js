class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048; // 每个音频块的大小
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        this.isRunning = true;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                this.isRunning = false;
            }
        };
    }
    
    process(inputs, outputs, parameters) {
        if (!this.isRunning) return false;
        
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const inputData = input[0];
        
        // 将输入数据添加到缓冲区
        for (let i = 0; i < inputData.length; i++) {
            this.buffer[this.bufferIndex++] = inputData[i];
            
            // 当缓冲区满时，发送数据
            if (this.bufferIndex >= this.bufferSize) {
                // 转换为16位PCM
                const pcmData = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    // 确保值在 [-1, 1] 范围内
                    const s = Math.max(-1, Math.min(1, this.buffer[j]));
                    // 转换为16位整数
                    pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // 发送音频数据
                this.port.postMessage({
                    type: 'audio',
                    buffer: pcmData.buffer
                }, [pcmData.buffer]);
                
                // 重置缓冲区
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
