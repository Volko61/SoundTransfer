// ===================== VIDEO SSTV TRANSMISSION =====================

const videoWidth = 160;
const videoHeight = 120;

// DOM Elements
const vidInput = document.getElementById('vidInput');
const vidEmitBtn = document.getElementById('vidEmitBtn');
const vidStopBtn = document.getElementById('vidStopBtn');
const vidPreviewCanvas = document.getElementById('vidPreviewCanvas');
const vidCurrentFrame = document.getElementById('vidCurrentFrame');
const vidResultCanvas = document.getElementById('vidResultCanvas');
const vidStatus = document.getElementById('vidStatus');
const vidFpsInput = document.getElementById('vidFpsInput');
const vidFrameCounter = document.getElementById('vidFrameCounter');
const vidLineProgress = document.getElementById('vidLineProgress');

// Receiver DOM Elements
const vidListenBtn = document.getElementById('vidListenBtn');
const vidReceiveCanvas = document.getElementById('vidReceiveCanvas');
const vidReceivedResultCanvas = document.getElementById('vidReceivedResultCanvas');
const vidReceiveStatus = document.getElementById('vidReceiveStatus');

const vidPreviewCtx = vidPreviewCanvas?.getContext('2d');
const vidCurrentFrameCtx = vidCurrentFrame?.getContext('2d');
const vidResultCtx = vidResultCanvas?.getContext('2d');
const vidReceiveCtx = vidReceiveCanvas?.getContext('2d');
const vidReceivedResultCtx = vidReceivedResultCanvas?.getContext('2d');

let videoAudioCtx = null;
let videoElement = null;
let isTransmitting = false;
let transmittedFrames = [];
let currentFrameIndex = 0;
let stopRequested = false;

// Receiver State
let isListening = false;
let videoDecoder = null;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let receivedFrames = [];
let receivePlaybackInterval = null;

// Initialize canvases
function initVideoCanvases() {
    if (vidPreviewCanvas) {
        vidPreviewCanvas.width = videoWidth;
        vidPreviewCanvas.height = videoHeight;
    }
    if (vidCurrentFrame) {
        vidCurrentFrame.width = videoWidth;
        vidCurrentFrame.height = videoHeight;
    }
    if (vidResultCanvas) {
        vidResultCanvas.width = videoWidth;
        vidResultCanvas.height = videoHeight;
    }
    if (vidReceiveCanvas) {
        vidReceiveCanvas.width = videoWidth;
        vidReceiveCanvas.height = videoHeight;
    }
    if (vidReceivedResultCanvas) {
        vidReceivedResultCanvas.width = videoWidth;
        vidReceivedResultCanvas.height = videoHeight;
    }
}

// Update status display
function updateVideoStatus(text) {
    if (vidStatus) {
        vidStatus.textContent = text;
    }
}

function updateReceiveStatus(text) {
    if (vidReceiveStatus) {
        vidReceiveStatus.textContent = text;
    }
}

// Video file selection handler
vidInput?.addEventListener('change', () => {
    if (!vidInput.files || vidInput.files.length !== 1) {
        updateVideoStatus('Please select a video file');
        return;
    }

    const file = vidInput.files[0];

    // Create video element to load the file
    if (videoElement) {
        videoElement.pause();
        URL.revokeObjectURL(videoElement.src);
    }

    videoElement = document.createElement('video');
    videoElement.src = URL.createObjectURL(file);
    videoElement.muted = true;
    videoElement.playsInline = true;

    videoElement.addEventListener('loadedmetadata', () => {
        updateVideoStatus(`Video loaded: ${Math.round(videoElement.duration)}s, ${videoElement.videoWidth}x${videoElement.videoHeight}`);
        vidEmitBtn.disabled = false;

        // Draw first frame as preview
        videoElement.currentTime = 0;
    });

    videoElement.addEventListener('seeked', () => {
        if (!isTransmitting) {
            drawVideoFrame(videoElement, vidPreviewCtx);
        }
    });

    videoElement.addEventListener('error', (e) => {
        updateVideoStatus('Error loading video: ' + (e.message || 'Unknown error'));
    });
});

// Draw a video frame to a canvas, scaled to fit
function drawVideoFrame(video, ctx) {
    if (!ctx || !video) return null;

    const canvas = ctx.canvas;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const x = (canvas.width - video.videoWidth * scale) / 2;
    const y = (canvas.height - video.videoHeight * scale) / 2;

    ctx.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Get pixel RGB from image data
function getVideoPixelRGB(data, x, y, width) {
    const index = (y * width + x) * 4;
    return {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
    };
}

// Color space conversions (same as image SSTV)
function vidRgbToY(r, g, b) { return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255; }
function vidRgbToCb(r, g, b) { return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255; }
function vidRgbToCr(r, g, b) { return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255; }
function vidPixelToFreq(pixel_value) { return 1500 + (pixel_value * ((2300 - 1500) / 255)); }

// Encode a single frame and visualize line-by-line
async function encodeVideoFrame(imageData, frameIndex, osc, startTime) {
    const data = imageData.data;
    let time = startTime;

    // Frame start marker (optional distinctive pulse)
    osc.frequency.setValueAtTime(1100, time);
    time += 0.015; // 15ms frame start marker

    for (let y = 0; y < videoHeight; y++) {
        if (stopRequested) return time;

        const isEven = (y % 2 === 0);

        // SYNC (sync pulse 9ms@1200Hz)
        osc.frequency.setValueAtTime(1200, time);
        time += 0.009;

        // SYNC Porch 3ms@1500Hz
        osc.frequency.setValueAtTime(1500, time);
        time += 0.003;

        // Y SCAN (88ms for width pixels)
        const yPixelDuration = 0.088 / videoWidth;
        for (let x = 0; x < videoWidth; x++) {
            const pixel = getVideoPixelRGB(data, x, y, videoWidth);
            const yVal = vidRgbToY(pixel.r, pixel.g, pixel.b);
            osc.frequency.linearRampToValueAtTime(vidPixelToFreq(yVal), time);
            time += yPixelDuration;
        }

        // SEPARATOR Even = 1500Hz, Odd = 2300Hz for 4.5ms
        const separatorFreq = isEven ? 1500 : 2300;
        osc.frequency.setValueAtTime(separatorFreq, time);
        time += 0.0045;

        // PORCH 1.5ms @1900Hz
        osc.frequency.setValueAtTime(1900, time);
        time += 0.0015;

        // Color Scan (R-Y or B-Y) 44ms for width pixels
        const cPixelDuration = 0.044 / videoWidth;
        for (let x = 0; x < videoWidth; x++) {
            const pixel = getVideoPixelRGB(data, x, y, videoWidth);
            let cVal;
            if (isEven) {
                cVal = vidRgbToCr(pixel.r, pixel.g, pixel.b);
            } else {
                cVal = vidRgbToCb(pixel.r, pixel.g, pixel.b);
            }
            osc.frequency.linearRampToValueAtTime(vidPixelToFreq(cVal), time);
            time += cPixelDuration;
        }

        // Update line progress visualization
        updateLineProgress(y, videoHeight);

        // Draw current line being encoded on current frame canvas
        drawEncodingLine(data, y);
    }

    // Frame end marker
    osc.frequency.setValueAtTime(1100, time);
    time += 0.010; // 10ms frame end marker

    return time;
}

// Update line progress bar
function updateLineProgress(currentLine, totalLines) {
    if (vidLineProgress) {
        const percentage = ((currentLine + 1) / totalLines) * 100;
        vidLineProgress.style.width = percentage + '%';
    }
}

// Draw encoding line visualization
function drawEncodingLine(data, lineY) {
    if (!vidCurrentFrameCtx) return;

    // Draw the line that was just encoded in red highlight
    for (let x = 0; x < videoWidth; x++) {
        const pixel = getVideoPixelRGB(data, x, lineY, videoWidth);
        vidCurrentFrameCtx.fillStyle = `rgb(${pixel.r}, ${pixel.g}, ${pixel.b})`;
        vidCurrentFrameCtx.fillRect(x, lineY, 1, 1);
    }

    // Draw a red line indicator for current encoding position
    vidCurrentFrameCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    vidCurrentFrameCtx.fillRect(0, lineY, videoWidth, 1);
}

// Store frame for result playback
function storeFrame(imageData) {
    transmittedFrames.push({
        data: new Uint8ClampedArray(imageData.data),
        width: imageData.width,
        height: imageData.height
    });
}

// Extract frames from video at specified interval
async function extractFrames(video, fps) {
    const frames = [];
    const frameInterval = 1 / fps;
    const duration = video.duration;

    video.currentTime = 0;
    await new Promise(r => setTimeout(r, 100));

    for (let t = 0; t < duration && !stopRequested; t += frameInterval) {
        video.currentTime = t;

        // Wait for seek to complete
        await new Promise(resolve => {
            const handler = () => {
                video.removeEventListener('seeked', handler);
                resolve();
            };
            video.addEventListener('seeked', handler);
        });

        // Small delay to ensure frame is rendered
        await new Promise(r => setTimeout(r, 50));

        // Draw and capture frame
        const imageData = drawVideoFrame(video, vidPreviewCtx);
        if (imageData) {
            frames.push(imageData);
        }

        updateVideoStatus(`Extracting frames: ${frames.length} (${Math.round(t / duration * 100)}%)`);
    }

    return frames;
}

// Main transmission function
async function startVideoTransmission() {
    if (!videoElement) {
        updateVideoStatus('No video loaded');
        return;
    }

    if (isTransmitting) {
        updateVideoStatus('Already transmitting');
        return;
    }

    // if (isListening) {
    //    stopVideoListening();
    // }

    isTransmitting = true;
    stopRequested = false;
    transmittedFrames = [];
    currentFrameIndex = 0;

    vidEmitBtn.disabled = true;
    vidStopBtn.disabled = false;

    initVideoCanvases();
    stopResultPlayback();

    // Clear current frame canvas
    if (vidCurrentFrameCtx) {
        vidCurrentFrameCtx.fillStyle = 'black';
        vidCurrentFrameCtx.fillRect(0, 0, videoWidth, videoHeight);
    }

    const targetFps = parseFloat(vidFpsInput?.value) || 2;

    updateVideoStatus('Extracting frames from video...');
    const frames = await extractFrames(videoElement, targetFps);

    if (stopRequested || frames.length === 0) {
        isTransmitting = false;
        vidEmitBtn.disabled = false;
        vidStopBtn.disabled = true;
        updateVideoStatus(stopRequested ? 'Stopped' : 'No frames extracted');
        return;
    }

    updateVideoStatus(`Extracted ${frames.length} frames. Starting transmission...`);

    // Create audio context and oscillator
    videoAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (videoAudioCtx.state === 'suspended') {
        await videoAudioCtx.resume();
    }

    const osc = videoAudioCtx.createOscillator();
    const gain = videoAudioCtx.createGain();
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(videoAudioCtx.destination);

    let time = videoAudioCtx.currentTime + 0.2;
    osc.start(time);

    // Encode each frame
    for (let i = 0; i < frames.length && !stopRequested; i++) {
        currentFrameIndex = i;

        // Update frame counter
        if (vidFrameCounter) {
            vidFrameCounter.textContent = `Frame ${i + 1}/${frames.length}`;
        }

        // Clear current frame canvas for new frame
        if (vidCurrentFrameCtx) {
            vidCurrentFrameCtx.fillStyle = 'black';
            vidCurrentFrameCtx.fillRect(0, 0, videoWidth, videoHeight);
        }

        updateVideoStatus(`Transmitting frame ${i + 1}/${frames.length}...`);

        // Encode frame
        time = await encodeVideoFrame(frames[i], i, osc, time);

        // Store frame for playback
        storeFrame(frames[i]);

        // Show completed frame in result canvas
        if (vidResultCtx) {
            const imgData = vidResultCtx.createImageData(videoWidth, videoHeight);
            imgData.data.set(frames[i].data);
            vidResultCtx.putImageData(imgData, 0, 0);
        }

        // Wait for audio to finish this frame (rough sync)
        const frameAudioDuration = videoHeight * 0.150; // ~150ms per line
        const waitUntil = time - videoAudioCtx.currentTime;
        if (waitUntil > 0) {
            await new Promise(r => setTimeout(r, waitUntil * 1000 * 0.8));
        }
    }

    osc.stop(time + 0.1);

    // Wait for audio to finish
    const remaining = time - videoAudioCtx.currentTime;
    if (remaining > 0) {
        await new Promise(r => setTimeout(r, remaining * 1000 + 500));
    }

    videoAudioCtx.close();
    videoAudioCtx = null;

    isTransmitting = false;
    vidEmitBtn.disabled = false;
    vidStopBtn.disabled = true;

    updateVideoStatus(`Transmission complete! ${transmittedFrames.length} frames transmitted.`);
    updateLineProgress(0, 1);

    // Start playback of transmitted frames
    if (transmittedFrames.length > 0) {
        startResultPlayback();
    }
}

// Stop transmission
function stopVideoTransmission() {
    stopRequested = true;
    updateVideoStatus('Stopping...');
}

// Playback transmitted frames in result canvas
let playbackInterval = null;

function startResultPlayback() {
    if (playbackInterval) {
        clearInterval(playbackInterval);
    }

    let playbackIndex = 0;
    const fps = parseFloat(vidFpsInput?.value) || 2;

    playbackInterval = setInterval(() => {
        if (playbackIndex >= transmittedFrames.length) {
            playbackIndex = 0; // Loop
        }

        const frame = transmittedFrames[playbackIndex];
        if (frame && vidResultCtx) {
            const imgData = vidResultCtx.createImageData(frame.width, frame.height);
            imgData.data.set(frame.data);
            vidResultCtx.putImageData(imgData, 0, 0);
        }

        playbackIndex++;
    }, 1000 / fps);
}

function stopResultPlayback() {
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
}

// ===================== VIDEO DECODER & RECEIVER =====================

class VideoSSTVDecoder {
    constructor(sampleRate = 44100) {
        this.sampleRate = sampleRate;
        this.state = 'IDLE';
        this.currentLine = 0;

        // Image data
        this.imageData = new Uint8ClampedArray(videoWidth * videoHeight * 4);
        this.clearImage();

        // Audio buffer
        this.sampleBuffer = [];
        this.maxBufferSize = Math.ceil(sampleRate * 2.0);

        // Timings (Robot36 adapted)
        this.syncSamples = Math.round(9 * sampleRate / 1000); // 9ms
        this.syncPorchSamples = Math.round(3 * sampleRate / 1000); // 3ms
        this.yScanSamples = Math.round(88 * sampleRate / 1000); // 88ms
        this.separatorSamples = Math.round(4.5 * sampleRate / 1000); // 4.5ms
        this.porchSamples = Math.round(1.5 * sampleRate / 1000); // 1.5ms
        this.chromaScanSamples = Math.round(44 * sampleRate / 1000); // 44ms

        // Total line time ~150ms
        this.lineSamples = this.syncSamples + this.syncPorchSamples + this.yScanSamples +
            this.separatorSamples + this.porchSamples + this.chromaScanSamples;

        // Sync detection
        this.syncDetectWindowSamples = Math.round(3 * sampleRate / 1000);

        // Interlacing
        this.evenLineY = new Float32Array(videoWidth);
        this.evenLineChroma = new Float32Array(videoWidth);
        this.lineCounter = 0;

        this.signalStrength = 0;
        this.framesDecoded = 0;
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
        // Calculate signal strength (RMS)
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        this.signalStrength = this.signalStrength * 0.9 + Math.min(100, rms * 400) * 0.1;

        if (this.state === 'IDLE') return;

        // Add to buffer
        for (let i = 0; i < samples.length; i++) {
            this.sampleBuffer.push(samples[i]);
        }

        // Limit buffer
        if (this.sampleBuffer.length > this.maxBufferSize) {
            this.sampleBuffer.shift(); // Naive shifting, but okay for real-time drop
        }

        this.processBuffer();
    }

    processBuffer() {
        if (this.sampleBuffer.length < this.lineSamples + this.syncSamples * 2) return;

        // Find sync
        const syncPos = this.findSyncPulse();

        if (syncPos >= 0) {
            // Check availability
            if (syncPos + this.lineSamples <= this.sampleBuffer.length) {
                this.decodeLine(syncPos);

                // Consume samples
                const removeCount = syncPos + this.lineSamples - this.syncSamples;
                this.sampleBuffer = this.sampleBuffer.slice(Math.max(0, removeCount));
            }
        } else {
            // Trim old samples if buffer getting full and no sync found
            if (this.sampleBuffer.length > this.lineSamples * 2.0) {
                this.sampleBuffer = this.sampleBuffer.slice(this.lineSamples);
            }
        }
    }

    findSyncPulse() {
        const windowSize = this.syncDetectWindowSamples;
        const smallWindow = Math.floor(windowSize / 2);

        // Coarse scan
        for (let pos = 0; pos < this.sampleBuffer.length - this.syncSamples - this.lineSamples; pos += Math.floor(windowSize / 2)) {
            const startWindow = this.sampleBuffer.slice(pos, pos + windowSize);
            const syncMag = this.getMagnitudeAt(startWindow, 1200);
            const noiseMag = this.getMagnitudeAt(startWindow, 1900);

            if (syncMag > noiseMag * 2.0) {
                // Potential sync, refine
                // Check middle
                const midPos = pos + Math.floor(this.syncSamples / 2);
                if (midPos + windowSize >= this.sampleBuffer.length) continue;

                const midWindow = this.sampleBuffer.slice(midPos, midPos + windowSize);
                const syncMagMid = this.getMagnitudeAt(midWindow, 1200);

                if (syncMagMid > noiseMag * 1.5) {
                    // Refine edge
                    // Logic: find transition from 1200Hz to 1500Hz (Porch)
                    // Expected end: pos + syncSamples
                    // We search around expected end
                    const expectedEnd = pos + this.syncSamples;
                    return Math.max(0, expectedEnd - this.syncSamples); // Return start of sync
                }
            }
        }
        return -1;
    }

    decodeLine(syncPos) {
        // Timings relative to syncPos
        const yStart = syncPos + this.syncSamples + this.syncPorchSamples;
        const separatorStart = yStart + this.yScanSamples;
        const chromaStart = separatorStart + this.separatorSamples + this.porchSamples;

        // Even/Odd determination (Separator: 1500Hz Even, 2300Hz Odd)
        const sepWindow = this.sampleBuffer.slice(separatorStart, separatorStart + this.separatorSamples);
        const freq1500 = this.getMagnitudeAt(sepWindow, 1500);
        const freq2300 = this.getMagnitudeAt(sepWindow, 2300);
        const isEven = freq1500 > freq2300;

        // Decode Y
        const yValues = new Float32Array(videoWidth);
        const samplesPerPixelY = this.yScanSamples / videoWidth;

        for (let x = 0; x < videoWidth; x++) {
            const pCenter = yStart + Math.floor((x + 0.5) * samplesPerPixelY);
            // Use 80 samples window (~3.3 pixels) to ensure we capture full cycles (1500Hz period is ~30 samples)
            // 24 samples per pixel is too small. Overlap is necessary.
            const winSize = 80;
            const pWinStart = Math.max(0, pCenter - Math.floor(winSize / 2));
            const pWin = this.sampleBuffer.slice(pWinStart, pWinStart + winSize);

            const freq = this.estimateFrequency(pWin);
            yValues[x] = this.freqToPixel(freq);
        }

        // Filter Y
        const yFiltered = this.medianFilter(yValues);

        // Decode Chroma
        const chromaValues = new Float32Array(videoWidth);
        const samplesPerPixelC = this.chromaScanSamples / videoWidth;

        for (let x = 0; x < videoWidth; x++) {
            const pCenter = chromaStart + Math.floor((x + 0.5) * samplesPerPixelC);
            // Chroma is half resolution but same timing slot principle apply if we want stability
            // 44ms / 160 = 0.275ms per pixel -> ~12 samples!! Way too small.
            // We definitely need a large window here. 80 samples is ~6-7 chroma pixels.
            const winSize = 80;
            const pWinStart = Math.max(0, pCenter - Math.floor(winSize / 2));
            const pWin = this.sampleBuffer.slice(pWinStart, pWinStart + winSize);

            const freq = this.estimateFrequency(pWin);
            chromaValues[x] = this.freqToPixel(freq);
        }

        // Filter Chroma
        const chromaFiltered = this.medianFilter(chromaValues);

        // --- Store / Combine ---
        if (isEven) {
            this.evenLineY.set(yFiltered);
            this.evenLineChroma.set(chromaFiltered); // Cr
        } else {
            // Odd line: combine with stored Even
            // Ideally we assume lines come in order: 0(Even), 1(Odd), 2(Even)...
            // We just write to currentLine and currentLine+1

            // Check if we need to wrap frame
            if (this.currentLine >= videoHeight) {
                this.finishFrame();
            }

            const evenY = this.evenLineY;
            const evenCr = this.evenLineChroma;
            const oddY = yFiltered;
            const oddCb = chromaFiltered;

            // Update line pairs
            this.writeLineToImage(this.currentLine, evenY, oddCb, evenCr);
            this.writeLineToImage(this.currentLine + 1, oddY, oddCb, evenCr);

            this.currentLine += 2;
        }

        this.lineCounter++;
        // Safety wrap
        if (this.currentLine >= videoHeight * 1.5) {
            this.finishFrame();
        }
    }

    writeLineToImage(lineIndex, yArr, cbArr, crArr) {
        if (lineIndex >= videoHeight) return;

        for (let x = 0; x < videoWidth; x++) {
            const rgb = this.yuvToRgb(yArr[x], cbArr[x], crArr[x]);
            const idx = (lineIndex * videoWidth + x) * 4;
            this.imageData[idx] = rgb.r;
            this.imageData[idx + 1] = rgb.g;
            this.imageData[idx + 2] = rgb.b;
            this.imageData[idx + 3] = 255;
        }
    }

    finishFrame() {
        // Push frame to global received list
        storeReceivedFrame(new Uint8ClampedArray(this.imageData));
        this.framesDecoded++;
        updateReceiveStatus(`Rx Frames: ${this.framesDecoded} - Signal: ${Math.round(this.signalStrength)}%`);

        // Reset for next frame
        this.currentLine = 0;
        // this.clearImage(); // Optional: clear or overwrite
    }

    // --- Helpers (Simplified from DSP) ---
    getMagnitudeAt(samples, targetFreq) {
        if (samples.length === 0) return 0;
        const k = 2 * Math.PI * targetFreq / this.sampleRate;
        const coeff = 2 * Math.cos(k);
        let s0 = 0, s1 = 0, s2 = 0;
        for (let i = 0; i < samples.length; i++) {
            s0 = samples[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        const real = s1 - s2 * Math.cos(k);
        const imag = s2 * Math.sin(k);
        return Math.sqrt(real * real + imag * imag);
    }

    estimateFrequency(samples) {
        // Zero-crossing Rate (ZCR) with linear interpolation for better precision
        // This is much faster and smoother than the previous coarse DFT scan

        let crossings = 0;
        let firstCrossIndex = -1;
        let lastCrossIndex = -1;
        let lastSign = Math.sign(samples[0]);
        let sumSq = 0;

        // Calculate RMS to detect silence
        for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
        const rms = Math.sqrt(sumSq / samples.length);

        if (rms < 0.01) return 1900; // Silence -> Grey (1900Hz) to avoid green tint

        for (let i = 1; i < samples.length; i++) {
            const sign = Math.sign(samples[i]);
            if (sign !== lastSign && sign !== 0) {
                // Linear interpolation: find exact time where signal crosses zero
                const y1 = samples[i - 1];
                const y2 = samples[i];
                // slope = (y2-y1)/1
                // 0 = y1 + slope * offset => offset = -y1/slope
                const offset = -y1 / (y2 - y1);
                const exactIndex = (i - 1) + offset;

                if (firstCrossIndex < 0) firstCrossIndex = exactIndex;
                lastCrossIndex = exactIndex;
                crossings++;
                lastSign = sign;
            }
        }

        if (crossings < 1 || lastCrossIndex === firstCrossIndex) {
            return 1900; // Fallback to 1900Hz (Grey) instead of 1500Hz (Green/Black shift)
        }

        // Avg frequency = (cycles / duration) * sampleRate
        // cycles = (crossings-1)/2
        const cycles = (crossings - 1) / 2;
        const duration = (lastCrossIndex - firstCrossIndex) / this.sampleRate;
        const freq = cycles / duration;

        // Clamp to valid range, return 1900 if way out
        if (freq < 1000 || freq > 3000) return 1900;

        return Math.max(1500, Math.min(2300, freq));
    }

    // Simple 3-tap median filter
    medianFilter(values) {
        const res = new Float32Array(values.length);
        res[0] = values[0];
        for (let i = 1; i < values.length - 1; i++) {
            const arr = [values[i - 1], values[i], values[i + 1]];
            arr.sort((a, b) => a - b);
            res[i] = arr[1];
        }
        res[values.length - 1] = values[values.length - 1];
        return res;
    }

    freqToPixel(freq) {
        const normalized = (freq - 1500) / (2300 - 1500);
        return Math.max(0, Math.min(255, normalized * 255));
    }

    yuvToRgb(y, cb, cr) {
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

    start() { this.state = 'DECODING'; }
    stop() { this.state = 'IDLE'; }
}

// Store received frame and update result playback
function storeReceivedFrame(data) {
    receivedFrames.push({
        data: data,
        width: videoWidth,
        height: videoHeight
    });

    // Auto-update result playback if loop is not running?
    // Actually we just start the playback loop once we have frames
    if (receivedFrames.length === 1) {
        startReceivePlayback();
    }
}

function startReceivePlayback() {
    if (receivePlaybackInterval) clearInterval(receivePlaybackInterval);

    let idx = 0;
    receivePlaybackInterval = setInterval(() => {
        if (receivedFrames.length === 0) return;
        if (idx >= receivedFrames.length) idx = 0;

        const frame = receivedFrames[idx];
        if (frame && vidReceivedResultCtx) {
            const imgData = vidReceivedResultCtx.createImageData(videoWidth, videoHeight);
            imgData.data.set(frame.data);
            vidReceivedResultCtx.putImageData(imgData, 0, 0);
        }
        idx++;
    }, 100); // 10 FPS playback
}

async function startVideoListening() {
    try {
        if (isTransmitting) return;

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 44100
            }
        });

        const source = audioContext.createMediaStreamSource(mediaStream);
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination); // Required for Chrome

        videoDecoder = new VideoSSTVDecoder(audioContext.sampleRate);
        videoDecoder.start();
        receivedFrames = [];

        scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            videoDecoder.processSamples(inputData);

            // Update live view (current decoding buffer)
            const liveData = videoDecoder.getImageData();
            if (vidReceiveCtx) {
                const imgData = vidReceiveCtx.createImageData(videoWidth, videoHeight);
                imgData.data.set(liveData);
                vidReceiveCtx.putImageData(imgData, 0, 0);
            }
        };

        isListening = true;
        vidListenBtn.textContent = 'Stop Listening';
        updateReceiveStatus('Listening for Video SSTV...');

    } catch (err) {
        console.error(err);
        updateReceiveStatus('Error: ' + err.message);
    }
}

function stopVideoListening() {
    isListening = false;
    if (videoDecoder) videoDecoder.stop();
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    vidListenBtn.textContent = 'Receive';
    updateReceiveStatus('Stopped listening');
    if (receivePlaybackInterval) clearInterval(receivePlaybackInterval);
}

vidListenBtn?.addEventListener('click', () => {
    if (isListening) stopVideoListening();
    else startVideoListening();
});

// Event listeners
vidEmitBtn?.addEventListener('click', startVideoTransmission);
vidStopBtn?.addEventListener('click', stopVideoTransmission);

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initVideoCanvases();
    if (vidStopBtn) vidStopBtn.disabled = true;
    if (vidEmitBtn) vidEmitBtn.disabled = true;
});
