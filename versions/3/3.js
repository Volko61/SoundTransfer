const imgEmitBtn = document.getElementById("imgEmitBtn")
const imgEmitInput = document.getElementById("imgEmitInput")
const imgListenBtn = document.getElementById("imgListenBtn")
const imgStopListenBtn = document.getElementById("imgStopListenBtn")
const imgListenStatus = document.getElementById("imgListenStatus")

const imgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
let imgSampleRate = imgAudioCtx.sampleRate;

const imgCanvasPreview = document.getElementById('imgCanvasPreview');
const imgCanvaCtx = imgCanvasPreview.getContext('2d');

const imgCanvasReceived = document.getElementById('imgCanvasReceived');
const imgCanvasReceivedCtx = imgCanvasReceived.getContext('2d');

let imgWidth = 320
let imgHeight = 240

// Receiver state
let imgIsListening = false;
let imgReceiverState = 'WAITING_SYNC';
let imgCurrentLine = 0;
let imgReceivedImageData = null;

// DSP components (initialized after audio context is ready)
let signalProcessor = null;
let lineDecoder = null;

// Audio buffer for line-based decoding
const AUDIO_BUFFER_SECONDS = 7; // 7 seconds of audio
let audioRingBuffer = null;
let demodulatedRingBuffer = null;
let ringBufferWritePos = 0;
let ringBufferSize = 0;

// Sync tracking
let lastSyncEndSample = -1;
let totalSamplesProcessed = 0;
let expectedNextEvenLine = true; // Track expected parity

// Visualization
const imgCanvas = document.getElementById("waveform-img");
const imgCanvasCtx = imgCanvas.getContext("2d");
imgCanvas.width = window.innerWidth;
imgCanvas.height = 200;

// Visualization data
let visualFrequencies = new Float32Array(1024);
let visualIndex = 0;

// Initialize DSP components
function initDSP() {
    if (!window.SSTVDsp) {
        console.error('DSP module not loaded!');
        return false;
    }

    imgSampleRate = imgAudioCtx.sampleRate;
    ringBufferSize = Math.floor(imgSampleRate * AUDIO_BUFFER_SECONDS);
    audioRingBuffer = new Float32Array(ringBufferSize);
    demodulatedRingBuffer = new Float32Array(ringBufferSize);

    signalProcessor = new window.SSTVDsp.SSTVSignalProcessor(imgSampleRate);
    lineDecoder = new window.SSTVDsp.Robot36LineDecoder(imgSampleRate);

    // Log sample rate detection info
    const sampleRateInfo = signalProcessor.getSampleRateInfo();
    console.log(`[DSP] Initialized with sample rate: ${sampleRateInfo.detected} (${sampleRateInfo.actual} Hz)`);
    console.log(`[DSP] Ring buffer size: ${ringBufferSize} samples (${AUDIO_BUFFER_SECONDS}s)`);

    return true;
}

// Process audio using ScriptProcessor (will migrate to AudioWorklet later)
const SCRIPT_BUFFER_SIZE = 256; // Smaller buffer for better timing
let imgScriptProcessor = null;
let imgAudioSource = null;

function setupAudioProcessor(stream) {
    if (!initDSP()) {
        console.error('Failed to initialize DSP');
        return;
    }

    imgAudioSource = imgAudioCtx.createMediaStreamSource(stream);
    imgScriptProcessor = imgAudioCtx.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);

    imgScriptProcessor.onaudioprocess = (e) => {
        if (!imgIsListening) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Process through DSP pipeline
        for (let i = 0; i < inputData.length; i++) {
            const result = signalProcessor.processSample(inputData[i]);

            // Store in ring buffers
            audioRingBuffer[ringBufferWritePos] = inputData[i];
            demodulatedRingBuffer[ringBufferWritePos] = result.frequency;

            ringBufferWritePos = (ringBufferWritePos + 1) % ringBufferSize;

            // Store for visualization (every 4th sample)
            if (totalSamplesProcessed % 4 === 0) {
                visualFrequencies[visualIndex] = result.frequency;
                visualIndex = (visualIndex + 1) % visualFrequencies.length;
            }

            totalSamplesProcessed++;
        }

        // Check for sync pulses
        const syncPulses = signalProcessor.getSyncPulses();
        for (const pulse of syncPulses) {
            handleSyncPulse(pulse);
        }
    };

    imgAudioSource.connect(imgScriptProcessor);
    imgScriptProcessor.connect(imgAudioCtx.destination);

    // Start visualization
    requestAnimationFrame(drawVisualization);
}

function handleSyncPulse(pulse) {
    const modeInfo = pulse.mode || 'UNKNOWN';
    const syncType = pulse.isPDMode ? 'PD' : (pulse.isRobotMode ? 'Robot' : 'Unknown');
    console.log(`[SYNC] ${syncType} pulse: ${pulse.durationMs.toFixed(1)}ms at sample ${pulse.endSample} (mode: ${modeInfo})`);

    if (imgReceiverState === 'WAITING_SYNC') {
        // First sync detected - start receiving
        lastSyncEndSample = pulse.endSample;
        imgReceiverState = 'RECEIVING_LINE';

        // Display mode and sample rate info
        const detectedMode = signalProcessor.getDetectedMode();
        const sampleRateInfo = signalProcessor.getSampleRateInfo();
        const modeText = detectedMode.mode ? detectedMode.mode : 'Detecting...';
        imgListenStatus.textContent = `Receiving [${modeText}] @ ${sampleRateInfo.detected} - Line 0/${imgHeight}`;
        console.log(`[SYNC] First sync detected, starting reception in ${modeInfo} mode`);
        return;
    }

    if (imgReceiverState === 'RECEIVING_LINE' && lastSyncEndSample >= 0) {
        // Decode the line between previous sync and current sync
        const lineLengthSamples = pulse.endSample - lastSyncEndSample;
        const lineLengthMs = lineLengthSamples / imgSampleRate * 1000;

        // Robot36 line should be ~150ms
        // if (lineLengthMs >= 120 && lineLengthMs <= 180) {
        decodeLine(lastSyncEndSample, pulse.endSample);
        // } else {
        //     console.log(`Skipping line: unusual length ${lineLengthMs.toFixed(1)}ms`);
        // }

        lastSyncEndSample = pulse.endSample;
    }
}

function decodeLine(startSample, endSample) {
    const lineLength = endSample - startSample;
    const lineLengthMs = lineLength / imgSampleRate * 1000;

    // Robot36 expected line: ~150ms (9ms sync + 3ms porch + 88ms Y + 4.5ms sep + 1.5ms porch + 44ms chroma)
    const expectedLineMs = 150;
    const tolerance = 40;

    // Check if this looks like a double line (missed sync)
    if (lineLengthMs > expectedLineMs * 1.7 && lineLengthMs < expectedLineMs * 2.5) {
        console.log(`Detected double line: ${lineLengthMs.toFixed(1)}ms - sync was missed, skipping 2 lines`);
        // A sync was missed, so we lost 2 lines (one even + one odd pair)
        imgCurrentLine += 2;
        imgListenStatus.textContent = `Receiving - Line ${imgCurrentLine}/${imgHeight} (sync missed)`;
        return;
    }

    // Skip completely invalid lines
    if (lineLengthMs < expectedLineMs - tolerance || lineLengthMs > expectedLineMs + tolerance) {
        console.log(`Skipping line: unusual length ${lineLengthMs.toFixed(1)}ms`);
        return;
    }

    // Calculate how many samples ago the line started
    const samplesAgo = totalSamplesProcessed - startSample;

    // Check if line data is still in buffer
    if (samplesAgo > ringBufferSize - 1000) {
        console.log(`Line data no longer in buffer (${samplesAgo} samples ago)`);
        return;
    }

    // Extract demodulated samples for this line from ring buffer
    const lineSamples = new Float32Array(lineLength);
    for (let i = 0; i < lineLength; i++) {
        const sampleAge = totalSamplesProcessed - startSample - i;
        const bufferPos = (ringBufferWritePos - sampleAge + ringBufferSize * 2) % ringBufferSize;
        lineSamples[i] = demodulatedRingBuffer[bufferPos];
    }

    // Decode using Robot36 line decoder with expected parity hint
    const decoded = lineDecoder.decodeScanLine(lineSamples, 0, 0, expectedNextEvenLine);

    if (!decoded) {
        console.log(`Failed to decode line ${imgCurrentLine}`);
        return;
    }

    if (decoded.height > 0) {
        // We have pixels to display
        const pixelsPerLine = decoded.width;

        for (let lineIdx = 0; lineIdx < decoded.height; lineIdx++) {
            const targetLine = imgCurrentLine + lineIdx;
            if (targetLine >= imgHeight) continue;

            for (let x = 0; x < pixelsPerLine && x < imgWidth; x++) {
                const srcIdx = (lineIdx * pixelsPerLine + x) * 4;
                const destIdx = (targetLine * imgWidth + x) * 4;

                imgReceivedImageData.data[destIdx] = decoded.pixels[srcIdx];       // R
                imgReceivedImageData.data[destIdx + 1] = decoded.pixels[srcIdx + 1]; // G
                imgReceivedImageData.data[destIdx + 2] = decoded.pixels[srcIdx + 2]; // B
                imgReceivedImageData.data[destIdx + 3] = 255; // A
            }
        }

        imgCurrentLine += decoded.height;
        // Update expected parity - after 2 lines (even+odd pair), we expect even again
        expectedNextEvenLine = (imgCurrentLine % 2 === 0);

        // Update status with mode info
        const detectedMode = signalProcessor.getDetectedMode();
        const sampleRateInfo = signalProcessor.getSampleRateInfo();
        const modeText = detectedMode.mode ? detectedMode.mode : 'Unknown';
        const confidence = Math.round(detectedMode.confidence * 100);
        imgListenStatus.textContent = `Receiving [${modeText}] @ ${sampleRateInfo.detected} - Line ${imgCurrentLine}/${imgHeight}`;

        // Update canvas
        imgCanvasReceivedCtx.putImageData(imgReceivedImageData, 0, 0);

        console.log(`Decoded ${decoded.height} line(s), now at line ${imgCurrentLine}/${imgHeight}`);
    }

    // Check if image is complete
    if (imgCurrentLine >= imgHeight) {
        imgListenStatus.textContent = 'Image complete!';
        console.log('Image reception complete');
        imgIsListening = false;
        imgListenBtn.disabled = false;
        imgStopListenBtn.disabled = true;
    }
}

function drawVisualization() {
    if (!imgIsListening) {
        return;
    }

    requestAnimationFrame(drawVisualization);

    imgCanvasCtx.fillStyle = "black";
    imgCanvasCtx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

    const centerY = imgCanvas.height / 2;
    const scale = imgCanvas.height / 4; // ±2 normalized range

    imgCanvasCtx.strokeStyle = "#333";
    imgCanvasCtx.beginPath();
    imgCanvasCtx.moveTo(0, centerY);
    imgCanvasCtx.lineTo(imgCanvas.width, centerY);
    imgCanvasCtx.stroke();

    // Draw frequency line
    imgCanvasCtx.strokeStyle = "red";
    imgCanvasCtx.beginPath();

    const step = imgCanvas.width / visualFrequencies.length;
    for (let i = 0; i < visualFrequencies.length; i++) {
        const x = i * step;
        const freqNorm = visualFrequencies[(visualIndex + i) % visualFrequencies.length];
        const y = centerY - freqNorm * scale;

        if (i === 0) {
            imgCanvasCtx.moveTo(x, y);
        } else {
            imgCanvasCtx.lineTo(x, y);
        }
    }
    imgCanvasCtx.stroke();

    // Draw reference lines for sync (1200Hz = -1.75) and black/white (1500/2300 = -0.5/+1.0)
    imgCanvasCtx.strokeStyle = "#444";
    imgCanvasCtx.setLineDash([5, 5]);

    // Sync line (-1.75)
    imgCanvasCtx.beginPath();
    imgCanvasCtx.moveTo(0, centerY + 1.75 * scale);
    imgCanvasCtx.lineTo(imgCanvas.width, centerY + 1.75 * scale);
    imgCanvasCtx.stroke();

    // Black line (-0.5)
    imgCanvasCtx.beginPath();
    imgCanvasCtx.moveTo(0, centerY + 0.5 * scale);
    imgCanvasCtx.lineTo(imgCanvas.width, centerY + 0.5 * scale);
    imgCanvasCtx.stroke();

    // White line (+1.0)
    imgCanvasCtx.beginPath();
    imgCanvasCtx.moveTo(0, centerY - 1.0 * scale);
    imgCanvasCtx.lineTo(imgCanvas.width, centerY - 1.0 * scale);
    imgCanvasCtx.stroke();

    imgCanvasCtx.setLineDash([]);
}

// Reset receiver state
function resetReceiver() {
    imgReceiverState = 'WAITING_SYNC';
    imgCurrentLine = 0;
    lastSyncEndSample = -1;
    totalSamplesProcessed = 0;
    ringBufferWritePos = 0;
    visualIndex = 0;
    expectedNextEvenLine = true; // First line should be even

    if (signalProcessor) signalProcessor.reset();
    if (lineDecoder) lineDecoder.reset();
    if (audioRingBuffer) audioRingBuffer.fill(0);
    if (demodulatedRingBuffer) demodulatedRingBuffer.fill(0);
    if (visualFrequencies) visualFrequencies.fill(0);

    // Clear received canvas
    imgCanvasReceivedCtx.fillStyle = "black";
    imgCanvasReceivedCtx.fillRect(0, 0, imgWidth, imgHeight);

    // Initialize image data
    imgReceivedImageData = imgCanvasReceivedCtx.createImageData(imgWidth, imgHeight);
    for (let i = 0; i < imgReceivedImageData.data.length; i += 4) {
        imgReceivedImageData.data[i] = 0;     // R
        imgReceivedImageData.data[i + 1] = 0; // G
        imgReceivedImageData.data[i + 2] = 0; // B
        imgReceivedImageData.data[i + 3] = 255; // A
    }
}

// Initialize audio on page load
navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
    }
}).then(async (stream) => {
    if (imgAudioCtx.state === 'suspended') {
        await imgAudioCtx.resume();
    }
    setupAudioProcessor(stream);
});

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

    resetReceiver();
    imgIsListening = true;
    imgListenBtn.disabled = true;
    imgStopListenBtn.disabled = false;
    imgListenStatus.textContent = 'Listening for sync...';
    requestAnimationFrame(drawVisualization);

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

// ===================== EVENT LISTENERS =====================

imgListenBtn.addEventListener("click", () => {
    if (imgAudioCtx.state === 'suspended') {
        imgAudioCtx.resume();
    }

    resetReceiver();
    imgIsListening = true;
    imgListenBtn.disabled = true;
    imgStopListenBtn.disabled = false;
    imgListenStatus.textContent = 'Listening for sync...';
    requestAnimationFrame(drawVisualization);
});

imgStopListenBtn.addEventListener("click", () => {
    imgIsListening = false;
    imgListenBtn.disabled = false;
    imgStopListenBtn.disabled = true;
    imgListenStatus.textContent = 'Stopped';
});

// Initialize received canvas
imgCanvasReceived.width = imgWidth;
imgCanvasReceived.height = imgHeight;
imgCanvasReceivedCtx.fillStyle = "black";
imgCanvasReceivedCtx.fillRect(0, 0, imgWidth, imgHeight);