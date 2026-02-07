const imgEmitBtn = document.getElementById("imgEmitBtn")
const imgEmitInput = document.getElementById("imgEmitInput")

const imgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

const imgCanvasPreview = document.getElementById('imgCanvasPreview');
const imgCanvaCtx = imgCanvasPreview.getContext('2d');

let imgWidth = 320
let imgHeight = 240

// ===================== EMITTER FUNCTIONS =====================

const imgImg = new Image()

imgEmitInput.addEventListener("change", () => {
    if (imgEmitInput.files.length !== 1) {
        console.log("Select only one file")
        return
    }
    let file = imgEmitInput.files[0]
    imgImg.onload = () => {
        imgCanvasPreview.width = imgWidth;
        imgCanvasPreview.height = imgHeight;
        imgCanvaCtx.fillStyle = "black"
        imgCanvaCtx.fillRect(0, 0, imgWidth, imgHeight)

        const scale = Math.min(imgWidth / imgImg.width, imgHeight / imgImg.height)
        const x = (imgWidth / 2) - (imgImg.width / 2) * scale
        const y = (imgHeight / 2) - (imgImg.height / 2) * scale

        imgCanvaCtx.drawImage(imgImg, x, y, imgImg.width * scale, imgImg.height * scale)
    }
    imgImg.src = URL.createObjectURL(file)
    imgEmitBtn.disabled = false
})

imgEmitBtn.addEventListener("click", () => {
    if (imgAudioCtx.state === 'suspended') {
        imgAudioCtx.resume();
    }

    encodeImage(imgCanvaCtx.getImageData(0, 0, imgWidth, imgHeight).data)
})

function encodeImage(imageData) {
    const osc = imgAudioCtx.createOscillator();
    const gain = imgAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(imgAudioCtx.destination);

    let time = imgAudioCtx.currentTime + 0.2;
    osc.start(time);

    for (let y = 0; y < imgHeight; y++) {
        const isEven = (y % 2 === 0)

        // SYNC (sync pulse 9ms@1200Hz)
        osc.frequency.setValueAtTime(1200, time)
        time += 0.009

        // SYNC Porch 3ms@1500Hz
        osc.frequency.setValueAtTime(1500, time)
        time += 0.003

        // Y SCAN (88ms for 320px)
        const yPixelDuration = 0.088 / imgWidth
        for (let x = 0; x < imgWidth; x++) {
            const pixel = getPixelRGB(imageData, x, y)
            const yVal = rgbToY(pixel.r, pixel.g, pixel.b)
            osc.frequency.linearRampToValueAtTime(pixelToFreq(yVal), time)
            time += yPixelDuration
        }

        // SEPARATOR Even = 1500Hz, Odd = 2300Hz for 4.5ms
        const separatorFreq = isEven ? 1500 : 2300
        osc.frequency.setValueAtTime(separatorFreq, time)
        time += 0.0045

        // PORCH 1.5ms @1900Hz
        osc.frequency.setValueAtTime(1900, time)
        time += 0.0015

        // Color Scan (R-Y or B-Y) 44ms for 320px
        const cPixelDuration = 0.044 / imgWidth
        for (let x = 0; x < imgWidth; x++) {
            const pixel = getPixelRGB(imageData, x, y)
            let cVal;
            if (isEven) {
                cVal = rgbToCr(pixel.r, pixel.g, pixel.b)
            } else {
                cVal = rgbToCb(pixel.r, pixel.g, pixel.b)
            }
            osc.frequency.linearRampToValueAtTime(pixelToFreq(cVal), time)
            time += cPixelDuration
        }
    }
    osc.stop(time)
    return time
}

function getPixelRGB(data, x, y) {
    const index = (y * imgWidth + x) * 4;
    return {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
    };
}

function rgbToY(r, g, b) { return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255; }
function rgbToCb(r, g, b) { return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255; }
function rgbToCr(r, g, b) { return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255; }

function pixelToFreq(pixel_value) {
    return 1500 + (pixel_value * ((2300 - 1500) / 255))
}

// ===================== DECODER CONSTANTS =====================

const SYNC_FREQ = 1200;
const BLACK_FREQ = 1500;
const WHITE_FREQ = 2300;
const SAMPLE_RATE = 44100;

// Robot36 timing in samples at 44100Hz
const SYNC_MS = 9;
const SYNC_PORCH_MS = 3;
const Y_SCAN_MS = 88;
const SEPARATOR_MS = 4.5;
const PORCH_MS = 1.5;
const CHROMA_SCAN_MS = 44;

const LINE_TOTAL_MS = SYNC_MS + SYNC_PORCH_MS + Y_SCAN_MS + SEPARATOR_MS + PORCH_MS + CHROMA_SCAN_MS; // ~150ms

const DecoderState = {
    IDLE: 'IDLE',
    WAITING_SYNC: 'WAITING_SYNC',
    DECODING_IMAGE: 'DECODING_IMAGE'
};

// ===================== GOERTZEL FREQUENCY DETECTOR =====================

class GoertzelDetector {
    constructor(sampleRate, frequencies) {
        this.sampleRate = sampleRate;
        this.frequencies = frequencies;
        this.coefficients = frequencies.map(f => 2 * Math.cos(2 * Math.PI * f / sampleRate));
    }

    detectFrequency(samples) {
        const magnitudes = this.frequencies.map((freq, idx) => {
            let s0 = 0, s1 = 0, s2 = 0;
            const coeff = this.coefficients[idx];

            for (let i = 0; i < samples.length; i++) {
                s0 = samples[i] + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }

            const real = s1 - s2 * Math.cos(2 * Math.PI * freq / this.sampleRate);
            const imag = s2 * Math.sin(2 * Math.PI * freq / this.sampleRate);
            return Math.sqrt(real * real + imag * imag);
        });

        // Find frequency with max magnitude
        let maxIdx = 0;
        for (let i = 1; i < magnitudes.length; i++) {
            if (magnitudes[i] > magnitudes[maxIdx]) maxIdx = i;
        }

        // Interpolate for more accuracy
        const f0 = this.frequencies[maxIdx];
        if (maxIdx > 0 && maxIdx < this.frequencies.length - 1) {
            const m0 = magnitudes[maxIdx - 1];
            const m1 = magnitudes[maxIdx];
            const m2 = magnitudes[maxIdx + 1];
            const delta = 0.5 * (m0 - m2) / (m0 - 2 * m1 + m2);
            const step = this.frequencies[1] - this.frequencies[0];
            return f0 + delta * step;
        }

        return f0;
    }

    getMagnitudeAt(samples, targetFreq) {
        const coeff = 2 * Math.cos(2 * Math.PI * targetFreq / this.sampleRate);
        let s0 = 0, s1 = 0, s2 = 0;

        for (let i = 0; i < samples.length; i++) {
            s0 = samples[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }

        const real = s1 - s2 * Math.cos(2 * Math.PI * targetFreq / this.sampleRate);
        const imag = s2 * Math.sin(2 * Math.PI * targetFreq / this.sampleRate);
        return Math.sqrt(real * real + imag * imag);
    }
}

// ===================== SIMPLE SSTV DECODER =====================

class SimpleSSTVDecoder {
    constructor(sampleRate = SAMPLE_RATE) {
        this.sampleRate = sampleRate;
        this.state = DecoderState.IDLE;
        this.currentLine = 0;

        // Image data
        this.imageData = new Uint8ClampedArray(imgWidth * imgHeight * 4);
        this.clearImage();

        // Audio buffer - larger for better sync detection
        this.sampleBuffer = [];
        this.maxBufferSize = Math.ceil(sampleRate * 1.0); // 1 second buffer

        // Line timing in samples
        this.syncSamples = Math.round(SYNC_MS * sampleRate / 1000);
        this.syncPorchSamples = Math.round(SYNC_PORCH_MS * sampleRate / 1000);
        this.yScanSamples = Math.round(Y_SCAN_MS * sampleRate / 1000);
        this.separatorSamples = Math.round(SEPARATOR_MS * sampleRate / 1000);
        this.porchSamples = Math.round(PORCH_MS * sampleRate / 1000);
        this.chromaScanSamples = Math.round(CHROMA_SCAN_MS * sampleRate / 1000);
        this.lineSamples = Math.round(LINE_TOTAL_MS * sampleRate / 1000);

        // Sync detection - use 3ms window for precision
        this.syncDetectWindowSamples = Math.round(3 * sampleRate / 1000);

        // Interlacing storage
        this.evenLineY = new Float32Array(imgWidth);
        this.evenLineChroma = new Float32Array(imgWidth);
        this.lineCounter = 0;
        this.lastLineWasEven = false;

        this.signalStrength = 0;
    }

    clearImage() {
        for (let i = 0; i < this.imageData.length; i += 4) {
            this.imageData[i] = 0;
            this.imageData[i + 1] = 0;
            this.imageData[i + 2] = 0;
            this.imageData[i + 3] = 255;
        }
    }

    processSamples(samples) {
        // Calculate signal strength
        const rms = Math.sqrt(samples.reduce((sum, val) => sum + val * val, 0) / samples.length);
        this.signalStrength = this.signalStrength * 0.9 + Math.min(100, rms * 400) * 0.1;

        if (this.state === DecoderState.IDLE) return;

        // Add samples to buffer
        for (let i = 0; i < samples.length; i++) {
            this.sampleBuffer.push(samples[i]);
        }

        // Keep buffer size manageable
        while (this.sampleBuffer.length > this.maxBufferSize) {
            this.sampleBuffer.shift();
        }

        // Process buffer to find and decode lines
        this.processBuffer();
    }

    processBuffer() {
        // Need at least one line worth of samples plus buffer
        if (this.sampleBuffer.length < this.lineSamples + this.syncSamples * 2) return;

        // Look for sync pulse (1200Hz for 9ms)
        const syncPos = this.findSyncPulse();

        if (syncPos >= 0 && syncPos + this.lineSamples <= this.sampleBuffer.length) {
            // Found sync, decode the line
            this.decodeLine(syncPos);

            // Remove processed samples, keep small overlap
            const removeCount = syncPos + this.lineSamples - this.syncSamples;
            this.sampleBuffer = this.sampleBuffer.slice(Math.max(0, removeCount));
        } else if (this.sampleBuffer.length > this.lineSamples * 1.5) {
            // No sync found, discard some old samples
            this.sampleBuffer = this.sampleBuffer.slice(Math.floor(this.lineSamples / 2));
        }
    }

    // Estimate frequency using Goertzel with parabolic interpolation
    estimateFrequency(samples) {
        // Coarse search: 1450-2350 Hz in 20Hz steps
        const step = 20;
        const freqs = [];
        const mags = [];

        for (let f = 1450; f <= 2350; f += step) {
            freqs.push(f);
            mags.push(this.getMagnitudeAt(samples, f));
        }

        // Find peak
        let peakIdx = 0;
        for (let i = 1; i < mags.length; i++) {
            if (mags[i] > mags[peakIdx]) {
                peakIdx = i;
            }
        }

        // Parabolic interpolation for sub-bin accuracy
        let peakFreq = freqs[peakIdx];
        if (peakIdx > 0 && peakIdx < mags.length - 1) {
            const alpha = mags[peakIdx - 1];
            const beta = mags[peakIdx];
            const gamma = mags[peakIdx + 1];

            // Parabolic peak location
            const denom = alpha - 2 * beta + gamma;
            if (Math.abs(denom) > 0.0001) {
                const delta = 0.5 * (alpha - gamma) / denom;
                peakFreq = freqs[peakIdx] + delta * step;
            }
        }

        // Clamp to valid range
        return Math.max(1500, Math.min(2300, peakFreq));
    }

    // Get magnitude at a specific frequency using Goertzel
    getMagnitudeAt(samples, targetFreq) {
        const coeff = 2 * Math.cos(2 * Math.PI * targetFreq / this.sampleRate);
        let s0 = 0, s1 = 0, s2 = 0;

        for (let i = 0; i < samples.length; i++) {
            s0 = samples[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }

        const real = s1 - s2 * Math.cos(2 * Math.PI * targetFreq / this.sampleRate);
        const imag = s2 * Math.sin(2 * Math.PI * targetFreq / this.sampleRate);
        return Math.sqrt(real * real + imag * imag);
    }

    // Median filter to reduce noise
    medianFilter(values, windowSize) {
        const result = new Float32Array(values.length);
        const halfWindow = Math.floor(windowSize / 2);

        for (let i = 0; i < values.length; i++) {
            const window = [];
            for (let j = -halfWindow; j <= halfWindow; j++) {
                const idx = Math.max(0, Math.min(values.length - 1, i + j));
                window.push(values[idx]);
            }
            window.sort((a, b) => a - b);
            result[i] = window[Math.floor(window.length / 2)];
        }

        return result;
    }

    // Low-pass smoothing filter
    smoothFilter(values, strength) {
        const result = new Float32Array(values.length);
        result[0] = values[0];

        for (let i = 1; i < values.length; i++) {
            result[i] = result[i - 1] * strength + values[i] * (1 - strength);
        }

        // Backward pass for zero-phase filtering
        for (let i = values.length - 2; i >= 0; i--) {
            result[i] = result[i + 1] * strength + result[i] * (1 - strength);
        }

        return result;
    }

    findSyncPulse() {
        const windowSize = this.syncDetectWindowSamples;
        const smallWindow = Math.floor(windowSize / 2);

        // Scan through buffer looking for 1200Hz sync pulse
        for (let pos = 0; pos < this.sampleBuffer.length - this.syncSamples - this.lineSamples; pos += Math.floor(windowSize / 3)) {
            // Check start of potential sync
            const startWindow = new Float32Array(this.sampleBuffer.slice(pos, pos + windowSize));
            const syncMagStart = this.getMagnitudeAt(startWindow, SYNC_FREQ);
            const dataMagStart = this.getMagnitudeAt(startWindow, 1900);

            // Sync frequency should dominate at start
            if (syncMagStart > dataMagStart * 2) {
                // Check middle of sync pulse to verify it's really a sync
                const midPos = pos + Math.floor(this.syncSamples / 2);
                const midWindow = new Float32Array(this.sampleBuffer.slice(midPos, midPos + windowSize));
                const syncMagMid = this.getMagnitudeAt(midWindow, SYNC_FREQ);
                const dataMagMid = this.getMagnitudeAt(midWindow, 1900);

                if (syncMagMid > dataMagMid * 2) {
                    // Found valid sync - now find the precise end point
                    // Search sample-by-sample around expected sync end
                    const expectedEnd = pos + this.syncSamples;
                    let bestTransition = expectedEnd;
                    let bestScore = 0;

                    // Search in a window around expected end
                    const searchStart = expectedEnd - Math.floor(smallWindow);
                    const searchEnd = expectedEnd + Math.floor(smallWindow);

                    for (let testPos = searchStart; testPos < searchEnd; testPos += 2) {
                        if (testPos + smallWindow >= this.sampleBuffer.length) break;

                        // Check if this is the transition point
                        const beforeWindow = new Float32Array(this.sampleBuffer.slice(testPos - smallWindow, testPos));
                        const afterWindow = new Float32Array(this.sampleBuffer.slice(testPos, testPos + smallWindow));

                        const syncBefore = this.getMagnitudeAt(beforeWindow, SYNC_FREQ);
                        const porchAfter = this.getMagnitudeAt(afterWindow, 1500);

                        // Score: sync before transition, porch after
                        const score = syncBefore * porchAfter;
                        if (score > bestScore) {
                            bestScore = score;
                            bestTransition = testPos;
                        }
                    }

                    // Return position so that syncPos + syncSamples = bestTransition
                    const adjustedPos = bestTransition - this.syncSamples;
                    console.log(`✅ Found sync at pos ${adjustedPos} (adjusted from ${pos}), line ${this.currentLine}`);
                    return Math.max(0, adjustedPos);
                }
            }
        }

        return -1;
    }

    decodeLine(syncPos) {
        // Line structure after sync:
        // sync(9ms) + porch(3ms) + Y(88ms) + separator(4.5ms) + porch(1.5ms) + chroma(44ms)

        const yStart = syncPos + this.syncSamples + this.syncPorchSamples;
        const separatorStart = yStart + this.yScanSamples;
        const chromaStart = separatorStart + this.separatorSamples + this.porchSamples;

        // Detect if even or odd line from separator frequency
        const sepWindow = this.sampleBuffer.slice(separatorStart, separatorStart + this.separatorSamples);
        const sepSamples = new Float32Array(sepWindow);
        const freq1500 = this.getMagnitudeAt(sepSamples, 1500);
        const freq2300 = this.getMagnitudeAt(sepSamples, 2300);

        const isEven = freq1500 > freq2300; // Even lines have 1500Hz separator, odd have 2300Hz

        // Decode Y channel (luminance) with overlapping windows
        const yValues = new Float32Array(imgWidth);
        const samplesPerPixel = this.yScanSamples / imgWidth;
        const windowSamples = Math.max(Math.ceil(samplesPerPixel * 2), 30); // Larger window

        for (let x = 0; x < imgWidth; x++) {
            const pixelCenter = yStart + Math.floor((x + 0.5) * samplesPerPixel);
            const pixelStart = Math.max(yStart, pixelCenter - Math.floor(windowSamples / 2));
            const pixelEnd = Math.min(yStart + this.yScanSamples, pixelStart + windowSamples);
            const pixelSamples = new Float32Array(this.sampleBuffer.slice(pixelStart, pixelEnd));

            const freq = this.estimateFrequency(pixelSamples);
            yValues[x] = this.freqToPixel(freq);
        }

        // Apply median filter then smooth filter to Y values
        let yFiltered = this.medianFilter(yValues, 3);
        yFiltered = this.smoothFilter(yFiltered, 0.2);

        // Decode chroma channel with larger windows
        const chromaValues = new Float32Array(imgWidth);
        const chromaSamplesPerPixel = this.chromaScanSamples / imgWidth;
        const chromaWindowSamples = Math.max(Math.ceil(chromaSamplesPerPixel * 2.5), 30);

        for (let x = 0; x < imgWidth; x++) {
            const pixelCenter = chromaStart + Math.floor((x + 0.5) * chromaSamplesPerPixel);
            const pixelStart = Math.max(chromaStart, pixelCenter - Math.floor(chromaWindowSamples / 2));
            const pixelEnd = Math.min(chromaStart + this.chromaScanSamples, pixelStart + chromaWindowSamples);
            const pixelSamples = new Float32Array(this.sampleBuffer.slice(pixelStart, pixelEnd));

            const freq = this.estimateFrequency(pixelSamples);
            chromaValues[x] = this.freqToPixel(freq);
        }

        // Apply median filter then smooth filter for better quality
        let chromaFiltered = this.medianFilter(chromaValues, 7);
        chromaFiltered = this.smoothFilter(chromaFiltered, 0.3);

        if (isEven) {
            // Store even line data for interlacing
            this.evenLineY.set(yFiltered);
            this.evenLineChroma.set(chromaFiltered); // This is Cr (R-Y)
            this.lastLineWasEven = true;
        } else {
            // Odd line - combine with even line and output both
            const evenY = this.evenLineY;
            const cr = this.evenLineChroma; // Cr from even line
            const oddY = yFiltered;
            const cb = chromaFiltered; // Cb from odd line

            // Decode two lines (even=0, odd=1)
            for (let lineOffset = 0; lineOffset < 2; lineOffset++) {
                const targetLine = this.currentLine + lineOffset;
                if (targetLine >= imgHeight) continue;

                const y = lineOffset === 0 ? evenY : oddY;

                for (let x = 0; x < imgWidth; x++) {
                    const rgb = this.yuvToRgb(y[x], cb[x], cr[x]);
                    const idx = (targetLine * imgWidth + x) * 4;

                    this.imageData[idx] = rgb.r;
                    this.imageData[idx + 1] = rgb.g;
                    this.imageData[idx + 2] = rgb.b;
                    this.imageData[idx + 3] = 255;
                }
            }

            this.currentLine += 2;
            console.log(`📺 Decoded lines ${this.currentLine - 2}-${this.currentLine - 1}, now at ${this.currentLine}/${imgHeight}`);
            this.lastLineWasEven = false;
        }

        this.lineCounter++;
    }

    freqToPixel(freq) {
        // Map 1500-2300 Hz to 0-255
        const normalized = (freq - BLACK_FREQ) / (WHITE_FREQ - BLACK_FREQ);
        return Math.max(0, Math.min(255, normalized * 255));
    }

    yuvToRgb(y, cb, cr) {
        // Simple inverse - encoder maps 0-255 range directly
        // Y is luminance (brightness), Cb/Cr are color difference signals
        // The encoder uses: Y = 16 + (65.481*R + 128.553*G + 24.966*B)/255
        //                   Cb = 128 + (-37.797*R - 74.203*G + 112*B)/255
        //                   Cr = 128 + (112*R - 93.786*G - 18.214*B)/255

        // Direct inversion using standard BT.601 coefficients
        const yVal = y;
        const cbVal = cb - 128;
        const crVal = cr - 128;

        const r = yVal + 1.402 * crVal;
        const g = yVal - 0.344 * cbVal - 0.714 * crVal;
        const b = yVal + 1.772 * cbVal;

        return {
            r: Math.max(0, Math.min(255, Math.round(r))),
            g: Math.max(0, Math.min(255, Math.round(g))),
            b: Math.max(0, Math.min(255, Math.round(b)))
        };
    }

    getImageData() {
        return this.imageData;
    }

    getStats() {
        return {
            state: this.state,
            currentLine: this.currentLine,
            totalLines: imgHeight,
            progress: (this.currentLine / imgHeight) * 100,
            signalStrength: Math.round(this.signalStrength),
            bufferSize: this.sampleBuffer.length
        };
    }

    start() {
        this.reset();
        this.state = DecoderState.DECODING_IMAGE;
        console.log('🎬 Starting SSTV decode');
    }

    stop() {
        this.state = DecoderState.IDLE;
        console.log('⏹️ Stopped SSTV decode');
    }

    reset() {
        this.currentLine = 0;
        this.sampleBuffer = [];
        this.lineCounter = 0;
        this.lastLineWasEven = false;
        this.clearImage();
    }
}

// ===================== RECEIVER UI =====================

const imgListenBtn = document.getElementById("imgListenBtn");
const imgCanvasReceive = document.getElementById('imgCanvasReceive');
const imgReceiveCtx = imgCanvasReceive.getContext('2d');
const imgStatus = document.getElementById('imgStatus');
const imgSpectrum = document.getElementById('imgSpectrum');
const imgSpectrumCtx = imgSpectrum.getContext('2d');

let decoder = null;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let analyser = null;
let isListening = false;

function updateStatus(text) {
    if (imgStatus) {
        imgStatus.textContent = text;
    }
}

function drawSpectrum() {
    if (!analyser || !isListening) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    imgSpectrumCtx.fillStyle = '#000';
    imgSpectrumCtx.fillRect(0, 0, imgSpectrum.width, imgSpectrum.height);

    // Draw spectrum for 1000-3000 Hz range
    const nyquist = audioContext.sampleRate / 2;
    const minFreq = 1000;
    const maxFreq = 3000;
    const minBin = Math.floor((minFreq / nyquist) * bufferLength);
    const maxBin = Math.floor((maxFreq / nyquist) * bufferLength);

    const barWidth = imgSpectrum.width / (maxBin - minBin);

    for (let i = minBin; i < maxBin; i++) {
        const barHeight = (dataArray[i] / 255) * imgSpectrum.height;
        const x = (i - minBin) * barWidth;

        // Color based on frequency band
        const freq = (i / bufferLength) * nyquist;
        if (freq < 1300) {
            imgSpectrumCtx.fillStyle = '#ff4444'; // Sync range (red)
        } else if (freq < 1600) {
            imgSpectrumCtx.fillStyle = '#44ff44'; // Black/porch (green)
        } else {
            imgSpectrumCtx.fillStyle = '#4444ff'; // Data range (blue)
        }

        imgSpectrumCtx.fillRect(x, imgSpectrum.height - barHeight, barWidth, barHeight);
    }

    // Draw frequency markers
    imgSpectrumCtx.fillStyle = '#fff';
    imgSpectrumCtx.font = '10px sans-serif';
    imgSpectrumCtx.fillText('1200Hz', 10, 12);
    imgSpectrumCtx.fillText('1500Hz', imgSpectrum.width * 0.25, 12);
    imgSpectrumCtx.fillText('1900Hz', imgSpectrum.width * 0.45, 12);
    imgSpectrumCtx.fillText('2300Hz', imgSpectrum.width * 0.65, 12);

    requestAnimationFrame(drawSpectrum);
}

function updateCanvas() {
    if (!decoder || !isListening) return;

    const imageData = decoder.getImageData();
    const imgData = imgReceiveCtx.createImageData(imgWidth, imgHeight);
    imgData.data.set(imageData);
    imgReceiveCtx.putImageData(imgData, 0, 0);

    const stats = decoder.getStats();
    updateStatus(`${stats.state} - Line ${stats.currentLine}/${stats.totalLines} (${stats.progress.toFixed(1)}%) - Signal: ${stats.signalStrength}%`);

    requestAnimationFrame(updateCanvas);
}

async function startListening() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });

        // Disable all audio processing to get raw signal
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: SAMPLE_RATE
            }
        });

        const source = audioContext.createMediaStreamSource(mediaStream);

        // Create analyser for spectrum visualization
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        // Create script processor for audio processing
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        decoder = new SimpleSSTVDecoder(audioContext.sampleRate);
        decoder.start();

        scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            decoder.processSamples(inputData);
        };

        isListening = true;
        imgListenBtn.textContent = 'Stop';
        updateStatus('LISTENING...');

        drawSpectrum();
        updateCanvas();

    } catch (err) {
        console.error('Error accessing microphone:', err);
        updateStatus('Error: ' + err.message);
    }
}

function stopListening() {
    isListening = false;

    if (decoder) {
        decoder.stop();
    }

    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    imgListenBtn.textContent = 'Listen';
    updateStatus('STOPPED');
}

imgListenBtn.addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});