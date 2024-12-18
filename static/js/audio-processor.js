class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const samples = input[0];
        
        // 将样本添加到缓冲区
        for (let i = 0; i < samples.length; i++) {
            this.buffer[this.bufferIndex++] = samples[i];
            
            // 当缓冲区满时，发送数据
            if (this.bufferIndex >= this.bufferSize) {
                this.port.postMessage({
                    type: 'audio',
                    buffer: this.buffer.slice()
                });
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
