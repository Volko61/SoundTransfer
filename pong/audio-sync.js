/**
 * Audio Synchronization Module for Pong
 * Uses FSK (Frequency Shift Keying) for cross-device sync
 * Uses BroadcastChannel for same-browser testing
 */

// ===================== CONSTANTS =====================

const SYNC_FREQ = 1200;
const DATA_FREQ_BASE = 1400;
const DATA_FREQ_STEP = 200;
const SYMBOL_DURATION = 0.020;
const SYNC_DURATION = 0.030;
const PACKET_PAUSE = 0.015;

const DEBUG = true;

// ===================== BROADCAST CHANNEL (LOCAL MODE) =====================

class LocalChannel {
    constructor(onMessage) {
        this.channel = new BroadcastChannel('pong-game');
        this.onMessage = onMessage;
        this.txCount = 0;
        this.rxCount = 0;

        this.channel.onmessage = (event) => {
            this.rxCount++;
            if (this.onMessage) {
                this.onMessage(event.data);
            }
        };
    }

    send(state) {
        this.channel.postMessage(state);
        this.txCount++;
    }

    close() {
        this.channel.close();
    }

    getTxCount() { return this.txCount; }
    getRxCount() { return this.rxCount; }
}

// ===================== AUDIO TRANSMITTER =====================

class AudioTransmitter {
    constructor() {
        this.audioCtx = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isTransmitting = false;
        this.txCount = 0;
    }

    async start() {
        if (this.audioCtx) return;

        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await this.audioCtx.resume();

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 0;
        this.gainNode.connect(this.audioCtx.destination);

        this.oscillator = this.audioCtx.createOscillator();
        this.oscillator.type = 'sine';
        this.oscillator.frequency.value = SYNC_FREQ;
        this.oscillator.connect(this.gainNode);
        this.oscillator.start();

        this.isTransmitting = true;
        console.log('Audio transmitter started');
    }

    stop() {
        if (this.oscillator) {
            this.oscillator.stop();
            this.oscillator = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
        }
        this.isTransmitting = false;
    }

    async transmitGameState(state) {
        if (!this.isTransmitting || !this.audioCtx) return;

        const packet = this.encodePacket(state);
        await this.transmitPacket(packet);
        this.txCount++;
    }

    encodePacket(state) {
        const symbols = [];
        symbols.push(state.playerId & 0x03);

        const paddleY = Math.floor(Math.max(0, Math.min(255, state.paddleY)));
        symbols.push((paddleY >> 6) & 0x03);
        symbols.push((paddleY >> 4) & 0x03);
        symbols.push((paddleY >> 2) & 0x03);
        symbols.push(paddleY & 0x03);

        const ballX = Math.floor(Math.max(0, Math.min(255, state.ballX)));
        symbols.push((ballX >> 6) & 0x03);
        symbols.push((ballX >> 4) & 0x03);
        symbols.push((ballX >> 2) & 0x03);
        symbols.push(ballX & 0x03);

        const ballY = Math.floor(Math.max(0, Math.min(255, state.ballY)));
        symbols.push((ballY >> 6) & 0x03);
        symbols.push((ballY >> 4) & 0x03);
        symbols.push((ballY >> 2) & 0x03);
        symbols.push(ballY & 0x03);

        const vxSign = state.ballVX >= 0 ? 1 : 0;
        const vySign = state.ballVY >= 0 ? 1 : 0;
        symbols.push((vxSign << 1) | vySign);
        symbols.push(0);

        let checksum = 0;
        for (const s of symbols) checksum = (checksum + s) & 0x0F;
        symbols.push((checksum >> 2) & 0x03);
        symbols.push(checksum & 0x03);

        return symbols;
    }

    async transmitPacket(symbols) {
        const now = this.audioCtx.currentTime;
        let time = now;

        this.oscillator.frequency.setValueAtTime(SYNC_FREQ, time);
        this.gainNode.gain.setValueAtTime(0.5, time);
        time += SYNC_DURATION;

        for (const symbol of symbols) {
            const freq = DATA_FREQ_BASE + (symbol * DATA_FREQ_STEP);
            this.oscillator.frequency.setValueAtTime(freq, time);
            time += SYMBOL_DURATION;
        }

        this.gainNode.gain.setValueAtTime(0, time);
        const packetDuration = (time - now) + PACKET_PAUSE;
        await new Promise(r => setTimeout(r, packetDuration * 1000));
    }

    getTxCount() { return this.txCount; }
}

// ===================== AUDIO RECEIVER =====================

class AudioReceiver {
    constructor(onPacketReceived) {
        this.onPacketReceived = onPacketReceived;
        this.audioCtx = null;
        this.mediaStream = null;
        this.isListening = false;
        this.rxCount = 0;
        this.sampleRate = 48000;
        this.sampleBuffer = [];
        this.state = 'WAITING_SYNC';
        this.symbols = [];
        this.silenceCount = 0;
        this.debugCounter = 0;
        this.frequencies = [SYNC_FREQ, DATA_FREQ_BASE, DATA_FREQ_BASE + DATA_FREQ_STEP,
            DATA_FREQ_BASE + 2 * DATA_FREQ_STEP, DATA_FREQ_BASE + 3 * DATA_FREQ_STEP];
    }

    async start() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            });
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.audioCtx.sampleRate;
            console.log('Receiver sample rate:', this.sampleRate);

            const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
            this.scriptProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);

            this.scriptProcessor.onaudioprocess = (event) => {
                if (!this.isListening) return;
                this.processSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
            };

            source.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioCtx.destination);
            this.isListening = true;
            return true;
        } catch (err) {
            console.error('Failed to start audio receiver:', err);
            return false;
        }
    }

    stop() {
        this.isListening = false;
        this.scriptProcessor?.disconnect();
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.audioCtx?.close();
        this.scriptProcessor = null;
        this.mediaStream = null;
        this.audioCtx = null;
        this.state = 'WAITING_SYNC';
        this.symbols = [];
        this.sampleBuffer = [];
    }

    processSamples(samples) {
        for (let i = 0; i < samples.length; i++) this.sampleBuffer.push(samples[i]);
        const chunkSize = Math.floor(this.sampleRate * SYMBOL_DURATION);

        while (this.sampleBuffer.length >= chunkSize) {
            const chunk = new Float32Array(chunkSize);
            for (let i = 0; i < chunkSize; i++) chunk[i] = this.sampleBuffer.shift();
            this.processChunk(chunk);
        }
    }

    processChunk(samples) {
        let maxMag = 0, maxFreq = 0;
        for (const freq of this.frequencies) {
            const mag = this.goertzelMagnitude(samples, freq);
            if (mag > maxMag) { maxMag = mag; maxFreq = freq; }
        }

        if (maxMag < 0.005) {
            this.silenceCount++;
            if (this.silenceCount > 5 && this.state === 'DECODING' && this.symbols.length >= 10) {
                this.decodePacket();
                this.state = 'WAITING_SYNC';
                this.symbols = [];
            }
            return;
        }

        this.silenceCount = 0;

        if (this.state === 'WAITING_SYNC') {
            if (maxFreq === SYNC_FREQ) {
                this.state = 'DECODING';
                this.symbols = [];
            }
        } else if (this.state === 'DECODING') {
            if (maxFreq === SYNC_FREQ) {
                if (this.symbols.length >= 10) this.decodePacket();
                this.symbols = [];
            } else {
                const symbol = this.freqToSymbol(maxFreq);
                if (symbol >= 0) {
                    this.symbols.push(symbol);
                    if (this.symbols.length >= 17) {
                        this.decodePacket();
                        this.state = 'WAITING_SYNC';
                        this.symbols = [];
                    }
                }
            }
        }
    }

    goertzelMagnitude(samples, targetFreq) {
        const N = samples.length;
        const k = Math.round(N * targetFreq / this.sampleRate);
        const w = (2 * Math.PI * k) / N;
        const coeff = 2 * Math.cos(w);
        let s1 = 0, s2 = 0;
        for (let i = 0; i < N; i++) { const s0 = samples[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
        const real = s1 - s2 * Math.cos(w);
        const imag = s2 * Math.sin(w);
        return Math.sqrt(real * real + imag * imag) / N;
    }

    freqToSymbol(freq) {
        if (freq === DATA_FREQ_BASE) return 0;
        if (freq === DATA_FREQ_BASE + DATA_FREQ_STEP) return 1;
        if (freq === DATA_FREQ_BASE + 2 * DATA_FREQ_STEP) return 2;
        if (freq === DATA_FREQ_BASE + 3 * DATA_FREQ_STEP) return 3;
        return -1;
    }

    decodePacket() {
        if (this.symbols.length < 17) return;
        try {
            const playerId = this.symbols[0] & 0x03;
            const paddleY = (this.symbols[1] << 6) | (this.symbols[2] << 4) | (this.symbols[3] << 2) | this.symbols[4];
            const ballX = (this.symbols[5] << 6) | (this.symbols[6] << 4) | (this.symbols[7] << 2) | this.symbols[8];
            const ballY = (this.symbols[9] << 6) | (this.symbols[10] << 4) | (this.symbols[11] << 2) | this.symbols[12];
            const velBits = this.symbols[13];
            const receivedChecksum = (this.symbols[15] << 2) | this.symbols[16];
            let checksum = 0;
            for (let i = 0; i < 15; i++) checksum = (checksum + this.symbols[i]) & 0x0F;

            if (checksum === receivedChecksum) {
                this.rxCount++;
                if (this.onPacketReceived) {
                    this.onPacketReceived({
                        playerId, paddleY, ballX, ballY,
                        ballVX: ((velBits >> 1) & 1) ? 1 : -1,
                        ballVY: (velBits & 1) ? 1 : -1
                    });
                }
            }
        } catch (err) { console.error('Decode error:', err); }
    }

    getRxCount() { return this.rxCount; }
    isActive() { return this.isListening; }
}

// ===================== AUDIO VISUALIZER =====================

class AudioVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas?.getContext('2d');
        this.analyser = null;
        this.animationId = null;
    }

    attachToReceiver(receiver) {
        if (!receiver.audioCtx || !receiver.mediaStream || !this.canvas) return;
        this.analyser = receiver.audioCtx.createAnalyser();
        this.analyser.fftSize = 512;
        const source = receiver.audioCtx.createMediaStreamSource(receiver.mediaStream);
        source.connect(this.analyser);
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.sampleRate = receiver.sampleRate;
        this.draw();
    }

    draw() {
        if (!this.analyser || !this.ctx) return;
        this.animationId = requestAnimationFrame(() => this.draw());
        this.analyser.getByteFrequencyData(this.dataArray);

        const width = this.canvas.width, height = this.canvas.height;
        this.ctx.fillStyle = '#12122a';
        this.ctx.fillRect(0, 0, width, height);

        const binCount = this.dataArray.length;
        const freqPerBin = (this.sampleRate / 2) / binCount;
        const startBin = Math.floor(1000 / freqPerBin);
        const endBin = Math.ceil(2200 / freqPerBin);
        const barWidth = width / (endBin - startBin);

        for (let i = startBin; i < endBin; i++) {
            const barHeight = (this.dataArray[i] / 255) * height;
            const freq = i * freqPerBin;
            let color = 'rgba(100, 100, 150, 0.6)';
            if (Math.abs(freq - SYNC_FREQ) < 50) color = 'rgba(255, 100, 100, 0.9)';
            else if (freq >= DATA_FREQ_BASE - 50 && freq <= DATA_FREQ_BASE + 650) color = 'rgba(100, 255, 200, 0.8)';
            this.ctx.fillStyle = color;
            this.ctx.fillRect((i - startBin) * barWidth, height - barHeight, barWidth - 1, barHeight);
        }
    }

    stop() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        this.animationId = null;
    }
}

// Export
window.AudioSync = { AudioTransmitter, AudioReceiver, AudioVisualizer, LocalChannel };
