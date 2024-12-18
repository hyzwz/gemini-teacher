class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 1024;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        this.lastProcessTime = 0;
        console.log('音频处理器初始化完成');
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) {
            console.log('没有输入数据');
            return true;
        }
        
        const currentTime = (currentFrame / sampleRate) * 1000;
        
        if (currentTime - this.lastProcessTime < 100) {
            return true;
        }
        
        this.lastProcessTime = currentTime;
        
        const samples = input[0];
        
        const volume = samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length;
        
        for (let i = 0; i < samples.length; i++) {
            this.buffer[this.bufferIndex++] = samples[i];
            
            if (this.bufferIndex >= this.bufferSize) {
                console.log('音频数据统计:', {
                    时间戳: currentTime,
                    平均音量: volume,
                    样本数: this.bufferSize,
                    高于阈值: volume > 0.01
                });
                
                this.port.postMessage({
                    type: 'audio',
                    buffer: this.buffer.slice().buffer,
                    volume: volume
                }, [this.buffer.slice().buffer]);
                
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
