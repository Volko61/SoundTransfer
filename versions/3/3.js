const imgEmitBtn = document.getElementById("imgEmitBtn")
const imgEmitInput = document.getElementById("imgEmitInput")
const imgListenBtn = document.getElementById("imgListenBtn")
const imgStopListenBtn = document.getElementById("imgStopListenBtn")
const imgListenStatus = document.getElementById("imgListenStatus")

const imgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
const imgAnalyserNode = imgAudioCtx.createAnalyser();
imgAnalyserNode.fftSize = 8192; // Larger FFT = better frequency resolution (~5.8Hz at 48kHz)
imgAnalyserNode.smoothingTimeConstant = 0;
const imgBufferLength = imgAnalyserNode.frequencyBinCount;
const imgDataArray = new Float32Array(imgBufferLength);

// For real-time audio processing  
const SCRIPT_BUFFER_SIZE = 512; // Larger buffer for better frequency analysis
let imgScriptProcessor = null;
let imgAudioSource = null;
let imgRawSamples = []; // Buffer of {time, freq} samples  
let imgSampleRate = 48000;

const imgCanvasPreview = document.getElementById('imgCanvasPreview');
const imgCanvaCtx = imgCanvasPreview.getContext('2d');

const imgCanvasReceived = document.getElementById('imgCanvasReceived');
const imgCanvasReceivedCtx = imgCanvasReceived.getContext('2d');

let imgCalibrationBuffer = new Float32Array(imgBufferLength).fill(-100);
let imgIsCalibrating = false;

let imgWidth = 320
let imgHeight = 240

// Receiver state
let imgIsListening = false;
let imgReceiverState = 'WAITING_SYNC';
let imgCurrentLine = 0;
let imgStateStartTime = 0;
let imgReceivedImageData = null;
let imgYBuffer = [];
let imgColorBuffer = [];
let imgCrLines = [];
let imgCbLines = [];
let imgYLines = [];

// Timing constants for Robot36 (in seconds)
const SYNC_DURATION = 0.009;
const SYNC_PORCH_DURATION = 0.003;
const Y_SCAN_DURATION = 0.088;
const SEPARATOR_DURATION = 0.0045;
const PORCH_DURATION = 0.0015;
const COLOR_SCAN_DURATION = 0.044;

// Frequency constants
const SYNC_FREQ = 1200;
const SYNC_PORCH_FREQ = 1500;
const BLACK_FREQ = 1500;
const WHITE_FREQ = 2300;
const PORCH_FREQ = 1900;

const imgCanvas = document.getElementById("waveform-img");
const imgCanvasCtx = imgCanvas.getContext("2d");
imgCanvas.width = window.innerWidth;
imgCanvas.height = 200;

// Use FFT from AnalyserNode to find dominant frequency with improved accuracy
function getDominantFrequencyFFT() {
    imgAnalyserNode.getFloatFrequencyData(imgDataArray);
    
    let maxValue = -Infinity;
    let peakIndex = 0;
    
    // Look in the frequency range we care about (1100Hz - 2400Hz)
    const minFreq = 1100;
    const maxFreq = 2400;
    const binSize = imgAudioCtx.sampleRate / imgAnalyserNode.fftSize;
    const minBin = Math.floor(minFreq / binSize);
    const maxBin = Math.ceil(maxFreq / binSize);
    
    // Find the peak with 3-bin averaging to reduce noise
    for (let i = minBin + 1; i < maxBin - 1 && i < imgBufferLength - 1; i++) {
        const calibratedValue = imgDataArray[i] - imgCalibrationBuffer[i];
        // Also consider neighboring bins for smoothing
        const avgValue = (calibratedValue + 
            (imgDataArray[i-1] - imgCalibrationBuffer[i-1]) + 
            (imgDataArray[i+1] - imgCalibrationBuffer[i+1])) / 3;
        if (calibratedValue > maxValue) {
            maxValue = calibratedValue;
            peakIndex = i;
        }
    }
    
    // Gaussian interpolation for more accurate sub-bin frequency estimation
    let freq = peakIndex * binSize;
    if (peakIndex > minBin + 1 && peakIndex < maxBin - 2) {
        const y0 = imgDataArray[peakIndex - 1] - imgCalibrationBuffer[peakIndex - 1];
        const y1 = imgDataArray[peakIndex] - imgCalibrationBuffer[peakIndex];
        const y2 = imgDataArray[peakIndex + 1] - imgCalibrationBuffer[peakIndex + 1];
        
        // Gaussian interpolation (better than parabolic for FFT peaks)
        if (y0 > -120 && y1 > -120 && y2 > -120) {
            const ln_y0 = Math.log(Math.max(0.001, y0 + 150));
            const ln_y1 = Math.log(Math.max(0.001, y1 + 150));
            const ln_y2 = Math.log(Math.max(0.001, y2 + 150));
            const denom = ln_y0 - 2 * ln_y1 + ln_y2;
            if (Math.abs(denom) > 0.0001) {
                const delta = 0.5 * (ln_y0 - ln_y2) / denom;
                if (Math.abs(delta) <= 1) {
                    freq = (peakIndex + delta) * binSize;
                }
            }
        }
    }
    
    // Only return if signal is strong enough (lowered threshold)
    if (maxValue > -70) {
        return freq;
    }
    return null;
}

// Process audio in real-time using ScriptProcessor
function setupAudioProcessor(stream) {
    imgSampleRate = imgAudioCtx.sampleRate;
    imgAudioSource = imgAudioCtx.createMediaStreamSource(stream);
    
    // Create script processor for raw sample access
    imgScriptProcessor = imgAudioCtx.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);
    
    imgScriptProcessor.onaudioprocess = (e) => {
        if (!imgIsListening) return;
        
        const currentTime = imgAudioCtx.currentTime;
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Use FFT to get current dominant frequency
        const freq = getDominantFrequencyFFT();
        
        if (freq !== null) {
            // Store sample with signal strength for quality filtering
            imgRawSamples.push({ 
                time: currentTime, 
                freq: freq,
                strength: Math.max(...Array.from(inputData).map(Math.abs))
            });
        }
        
        // Keep buffer manageable (last 10 seconds for better sync detection)
        while (imgRawSamples.length > 0 && imgRawSamples[0].time < currentTime - 10) {
            imgRawSamples.shift();
        }
    };
    
    imgAudioSource.connect(imgScriptProcessor);
    imgAudioSource.connect(imgAnalyserNode); // Keep for visualization
    imgScriptProcessor.connect(imgAudioCtx.destination); // Required for processing to work
}

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
    imgProcessAudio();
});
const imgImg = new Image()

imgEmitInput.addEventListener("change", () => {
    if (imgEmitInput.files.length !== 1) {
        console.log("Selectionnez qu'un seul fichier")
        return
    }
    let file = imgEmitInput.files[0]
    imgImg.onload = () => {
        // 1. Set the internal resolution of the canvas to match your target size
        imgCanvasPreview.width = imgWidth;   // Sets to 320
        imgCanvasPreview.height = imgHeight; // Sets to 240

        // 2. Clear background (optional if you draw over the whole thing)
        imgCanvaCtx.fillStyle = "black"
        imgCanvaCtx.fillRect(0, 0, imgWidth, imgHeight)

        // 3. Calculate scaling to fit image within 320x240 (Letterboxing)
        const scale = Math.min(imgWidth / imgImg.width, imgHeight / imgImg.height)
        const x = (imgWidth / 2) - (imgImg.width / 2) * scale
        const y = (imgHeight / 2) - (imgImg.height / 2) * scale

        // 4. Actually draw the image (Uncommented)
        imgCanvaCtx.drawImage(imgImg, x, y, imgImg.width * scale, imgImg.height * scale)
    }
    imgImg.src = URL.createObjectURL(file)
    imgEmitBtn.disabled = false
})
imgEmitBtn.addEventListener("click", () => {
    // Start listening before emitting
    if (imgAudioCtx.state === 'suspended') {
        imgAudioCtx.resume();
    }
    
    resetReceiver();
    imgIsListening = true;
    imgListenBtn.disabled = true;
    imgStopListenBtn.disabled = false;
    imgListenStatus.textContent = 'Listening for sync...';
    startReceiver();
    
    // Start emitting
    encodeImage(imgCanvaCtx.getImageData(0, 0, imgWidth, imgHeight).data)
})

imgCalibrateBtn.addEventListener("click", () => {
    imgIsCalibrating = true;
    const imgTempBuffer = new Float32Array(imgBufferLength).fill(-140);
    const imgStartTime = Date.now();

    const imgCapture = () => {
        imgAnalyserNode.getFloatFrequencyData(imgDataArray);
        for (let i = 0; i < imgBufferLength; i++) {
            if (imgDataArray[i] > imgTempBuffer[i]) {
                imgTempBuffer[i] = imgDataArray[i];
            }
        }

        if (Date.now() - imgStartTime < 2000) {
            requestAnimationFrame(imgCapture);
        } else {
            imgCalibrationBuffer.set(imgTempBuffer);
            imgIsCalibrating = false;
        }
    };
    imgCapture();
});

function imgProcessAudio() {
    requestAnimationFrame(imgProcessAudio);
    imgAnalyserNode.getFloatFrequencyData(imgDataArray);
    imgDrawVisuals();

}

function generateFrequency(frequency, duration_ms) {
    const osc = imgAudioCtx.createOscillator();
    const gain = imgAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(imgAudioCtx.destination);

    osc.frequency.value = frequency;

    const time = imgAudioCtx.currentTime + (duration_ms / 1000)
    osc.start(time);
}

function encodeImage(imageData) {
    const osc = imgAudioCtx.createOscillator();
    const gain = imgAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(imgAudioCtx.destination);

    let time = imgAudioCtx.currentTime + 0.2;
    osc.start(time);

    // 1. Calibration Header (VOX + VIS Code) would go here
    // (Skipped for brevity, but includes the VIS code for Robot36: 0x08)

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
            const pixel = getPixelRGB(imageData, x, y, imgWidth)
            const yVal = rgbToY(pixel.r, pixel.g, pixel.b)
            
            // Ramp frequency smoothly to the next pixel's value
            osc.frequency.linearRampToValueAtTime(pixelToFreq(yVal), time)
            time += yPixelDuration
        }

        // SEPARATOR Even = 1500Hz, Odd = 2300Hz for 4.5ms
        const separatorFreq = isEven ? 1500 : 2300
        osc.frequency.setValueAtTime(separatorFreq, time)
        time += 0.0045

        //PORCH 1.5 1900Hz
        osc.frequency.setValueAtTime(1900, time)
        time += 0.0015

        // Color Scan (R-Y or B-Y) 44ms fdor 320px (half od the time of Y scan)
        const cPixelDuration = 0.044 / imgWidth
        for (let x = 0; x < imgWidth; x++) {
            const pixel = getPixelRGB(imageData, x, y, imgWidth)
            let cVal;
            if (isEven) {
                // R-Y (Cr)
                cVal = rgbToCr(pixel.r, pixel.g, pixel.b)
            } else {
                // B-Y (Cb)
                cVal = rgbToCb(pixel.r, pixel.g, pixel.b)
            }

            osc.frequency.linearRampToValueAtTime(pixelToFreq(cVal), time)
            time += cPixelDuration
        }
    }
    osc.stop(time)
    return time // Return total duration
}

function getPixelRGB(data, x, y) {
    const index = (y * imgWidth + x) * 4;
    return {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
    };
}

function imgDrawVisuals() {
    imgCanvasCtx.fillStyle = "black";
    imgCanvasCtx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

    const imgBarimgWidth = (imgCanvas.width / imgBufferLength) * 2.5;
    let imgPosX = 0;

    for (let i = 0; i < imgBufferLength; i++) {
        let imgVal = imgDataArray[i];
        let imgFloor = imgCalibrationBuffer[i];
        if (imgFloor === -Infinity) imgFloor = -140;

        const imgAdjustedValue = Math.max(0, imgVal - imgFloor);
        const imgBarHeight = imgAdjustedValue * 5;

        imgCanvasCtx.fillStyle = imgIsCalibrating ? "yellow" : "red";

        const imgFreq = i * imgAudioCtx.sampleRate / imgAnalyserNode.fftSize;

        imgCanvasCtx.fillRect(imgPosX, imgCanvas.height - imgBarHeight, imgBarimgWidth, imgBarHeight);
        imgPosX += imgBarimgWidth + 1;
    }
}


function RGB_to_YCrCb(R, G, B) {
    let Y = rgbToY(R, G, B)
    let Cr = rgbToCr(R, G, B)
    let Cb = rgbToCb(R, G, B)
    return [Y, Cr, Cb]
}

function rgbToY(r, g, b) { return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255; }
function rgbToCb(r, g, b) { return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255; }
function rgbToCr(r, g, b) { return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255; }



function pixelToFreq(pixel_value) {
    let frequency = 1500 + (pixel_value * ((2300 - 1500) / 255))
    return frequency
}

// ===================== RECEIVING FUNCTIONS =====================

// Initialize received canvas
imgCanvasReceived.width = imgWidth;
imgCanvasReceived.height = imgHeight;
imgCanvasReceivedCtx.fillStyle = "black";
imgCanvasReceivedCtx.fillRect(0, 0, imgWidth, imgHeight);

// Get dominant frequency from FFT data
function getDominantFrequency() {
    imgAnalyserNode.getFloatFrequencyData(imgDataArray);
    
    let maxValue = -Infinity;
    let maxIndex = 0;
    
    // Look in the frequency range we care about (1100Hz - 2400Hz)
    const minFreq = 1100;
    const maxFreq = 2400;
    const minIndex = Math.floor(minFreq * imgAnalyserNode.fftSize / imgAudioCtx.sampleRate);
    const endIndex = Math.ceil(maxFreq * imgAnalyserNode.fftSize / imgAudioCtx.sampleRate);
    
    for (let i = minIndex; i < endIndex && i < imgBufferLength; i++) {
        const calibratedValue = imgDataArray[i] - imgCalibrationBuffer[i];
        if (calibratedValue > maxValue) {
            maxValue = calibratedValue;
            maxIndex = i;
        }
    }
    
    // Convert index to frequency
    const frequency = maxIndex * imgAudioCtx.sampleRate / imgAnalyserNode.fftSize;
    
    // Only return if signal is strong enough (lowered threshold for better detection)
    if (maxValue > -50) {
        return frequency;
    }
    return null;
}

// Convert frequency (Hz) back to pixel value (0-255) with better precision
function freqToPixel(freq) {
    // Clamp frequency to valid range (1500-2300 Hz)
    // Use slightly wider range to avoid clipping valid signals
    const clampedFreq = Math.max(BLACK_FREQ - 10, Math.min(WHITE_FREQ + 10, freq));
    
    // Linear mapping from frequency to pixel value
    let pixel = (clampedFreq - BLACK_FREQ) * 255 / (WHITE_FREQ - BLACK_FREQ);
    
    // Clamp result to valid range
    return Math.max(0, Math.min(255, Math.round(pixel)));
}

// Check if frequency is close to sync frequency (1200 Hz)
function isSyncFreq(freq) {
    return freq !== null && Math.abs(freq - SYNC_FREQ) < 100;
}

// Reset receiver state
function resetReceiver() {
    imgReceiverState = 'WAITING_SYNC';
    imgCurrentLine = 0;
    imgStateStartTime = 0;
    imgYBuffer = [];
    imgColorBuffer = [];
    imgCrLines = [];
    imgCbLines = [];
    imgYLines = [];
    syncStartTime = 0;
    transmissionStartTime = 0;
    lastLineSyncTime = 0;
    imgRawSamples = []; // Clear the raw samples buffer
    
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

// Convert YCbCr to RGB - corrected for Robot36/SSTV standard
// Y: 16-235 range (black=16, white=235), Cb/Cr: 16-240 range (neutral=128)
function ycbcrToRgb(y, cb, cr) {
    // Robot36 uses full range 0-255 directly from frequency mapping
    // Normalize to standard video range first
    const yNorm = (y - 16) * 255 / 219;
    const cbNorm = cb - 128;
    const crNorm = cr - 128;
    
    // BT.601 inverse matrix with proper scaling
    // R = Y + 1.402 * Cr
    // G = Y - 0.344136 * Cb - 0.714136 * Cr  
    // B = Y + 1.772 * Cb
    const r = yNorm + 1.402 * crNorm;
    const g = yNorm - 0.344136 * cbNorm - 0.714136 * crNorm;
    const b = yNorm + 1.772 * cbNorm;
    
    return {
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b)))
    };
}

// Alternative: direct conversion assuming full range Y and chroma
function ycbcrToRgbFullRange(y, cb, cr) {
    const cbNorm = cb - 128;
    const crNorm = cr - 128;
    
    // Full range coefficients
    const r = y + 1.402 * crNorm;
    const g = y - 0.344136 * cbNorm - 0.714136 * crNorm;
    const b = y + 1.772 * cbNorm;
    
    return {
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b)))
    };
}

// Set pixel in received image
function setReceivedPixel(x, y, r, g, b) {
    if (x < 0 || x >= imgWidth || y < 0 || y >= imgHeight) return;
    
    const index = (y * imgWidth + x) * 4;
    imgReceivedImageData.data[index] = r;
    imgReceivedImageData.data[index + 1] = g;
    imgReceivedImageData.data[index + 2] = b;
    imgReceivedImageData.data[index + 3] = 255;
}

// Process a completed line pair (even + odd) to reconstruct color
function processLinePair(evenLine, oddLine) {
    if (evenLine >= imgHeight || oddLine >= imgHeight) return;
    if (evenLine < 0) return;
    
    // For Robot36: even lines have Cr, odd lines have Cb
    // Both lines share the same Cr (from even) and Cb (from odd)
    const crData = imgCrLines[evenLine] || new Array(imgWidth).fill(128);
    const cbData = imgCbLines[oddLine] || new Array(imgWidth).fill(128);
    const yEvenData = imgYLines[evenLine] || new Array(imgWidth).fill(128);
    const yOddData = imgYLines[oddLine] || new Array(imgWidth).fill(128);
    
    for (let x = 0; x < imgWidth; x++) {
        const yEven = yEvenData[x] !== undefined ? yEvenData[x] : 128;
        const yOdd = yOddData[x] !== undefined ? yOddData[x] : 128;
        const cr = crData[x] !== undefined ? crData[x] : 128;
        const cb = cbData[x] !== undefined ? cbData[x] : 128;
        
        // Even line - use full range conversion for Robot36
        const rgbEven = ycbcrToRgbFullRange(yEven, cb, cr);
        setReceivedPixel(x, evenLine, rgbEven.r, rgbEven.g, rgbEven.b);
        
        // Odd line
        const rgbOdd = ycbcrToRgbFullRange(yOdd, cb, cr);
        setReceivedPixel(x, oddLine, rgbOdd.r, rgbOdd.g, rgbOdd.b);
    }
    
    // Update canvas
    imgCanvasReceivedCtx.putImageData(imgReceivedImageData, 0, 0);
}

// Render a single line in grayscale (Y channel only)
function renderLineGrayscale(lineNum) {
    if (!imgYLines[lineNum]) return;
    const yData = imgYLines[lineNum];
    
    for (let x = 0; x < imgWidth; x++) {
        const y = yData[x] !== undefined ? yData[x] : 128;
        // Y is already 0-255 from freqToPixel
        setReceivedPixel(x, lineNum, y, y, y);
    }
    imgCanvasReceivedCtx.putImageData(imgReceivedImageData, 0, 0);
}

// Apply chroma upsampling - Robot36 sends half-resolution chroma
// Each chroma line covers 2 Y lines, so we need to interpolate
function upsampleChroma(chromaLines, height) {
    const result = [];
    for (let y = 0; y < height; y++) {
        // Find the two nearest chroma lines
        const chromaY = Math.floor(y / 2) * 2;
        const nextChromaY = Math.min(chromaY + 2, height - 2);
        
        if (y % 2 === 0) {
            // Even line - use the Cr line directly
            result[y] = chromaLines[chromaY] || new Array(imgWidth).fill(128);
        } else {
            // Odd line - interpolate between current and next
            const current = chromaLines[chromaY] || new Array(imgWidth).fill(128);
            const next = chromaLines[nextChromaY] || current;
            result[y] = current.map((v, i) => Math.round((v + (next[i] || 128)) / 2));
        }
    }
    return result;
}

// Post-process image for better quality
function postProcessImage() {
    // Upsample chroma channels for smoother color transitions
    const fullCr = [];
    const fullCb = [];
    
    // Robot36: Cr on even lines, Cb on odd lines
    // We need to spread each chroma value to both lines of the pair
    for (let y = 0; y < imgHeight; y += 2) {
        const cr = imgCrLines[y] || new Array(imgWidth).fill(128);
        const cb = imgCbLines[y + 1] || new Array(imgWidth).fill(128);
        
        // Apply both Cr and Cb to both lines of the pair
        fullCr[y] = cr;
        fullCr[y + 1] = cr;
        fullCb[y] = cb;
        fullCb[y + 1] = cb;
    }
    
    // Apply vertical smoothing to chroma to reduce artifacts
    for (let y = 1; y < imgHeight - 1; y++) {
        if (fullCr[y-1] && fullCr[y] && fullCr[y+1]) {
            const smoothedCr = new Array(imgWidth);
            const smoothedCb = new Array(imgWidth);
            for (let x = 0; x < imgWidth; x++) {
                smoothedCr[x] = Math.round((fullCr[y-1][x] + fullCr[y][x] * 2 + fullCr[y+1][x]) / 4);
                smoothedCb[x] = Math.round((fullCb[y-1][x] + fullCb[y][x] * 2 + fullCb[y+1][x]) / 4);
            }
            fullCr[y] = smoothedCr;
            fullCb[y] = smoothedCb;
        }
    }
    
    // Reconstruct full color image
    for (let y = 0; y < imgHeight; y++) {
        const yData = imgYLines[y] || new Array(imgWidth).fill(128);
        const crData = fullCr[y] || new Array(imgWidth).fill(128);
        const cbData = fullCb[y] || new Array(imgWidth).fill(128);
        
        for (let x = 0; x < imgWidth; x++) {
            const yVal = yData[x] !== undefined ? yData[x] : 128;
            const cr = crData[x] !== undefined ? crData[x] : 128;
            const cb = cbData[x] !== undefined ? cbData[x] : 128;
            
            const rgb = ycbcrToRgbFullRange(yVal, cb, cr);
            setReceivedPixel(x, y, rgb.r, rgb.g, rgb.b);
        }
    }
    
    imgCanvasReceivedCtx.putImageData(imgReceivedImageData, 0, 0);
}

// Main receiver processing loop
let syncStartTime = 0;
let receiverIntervalId = null;
let transmissionStartTime = 0;
let lastLineSyncTime = 0;

// Total line duration for Robot36
const LINE_DURATION = SYNC_DURATION + SYNC_PORCH_DURATION + Y_SCAN_DURATION + SEPARATOR_DURATION + PORCH_DURATION + COLOR_SCAN_DURATION;

// Find sync pulses in the sample buffer with improved detection
function findSyncPulses(samples, minDuration) {
    const syncPulses = [];
    let syncStart = null;
    let syncSamples = [];
    const SYNC_TOLERANCE = 120; // Hz tolerance for sync frequency
    
    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        // Sync detection: frequency near 1200Hz
        if (Math.abs(sample.freq - SYNC_FREQ) < 100) {
            if (syncStart === null) {
                syncStart = sample.time;
                syncSamples = [sample];
            } else {
                syncSamples.push(sample);
            }
        } else {
            if (syncStart !== null && syncSamples.length > 0) {
                const syncEnd = syncSamples[syncSamples.length - 1].time;
                const duration = syncEnd - syncStart;
                // Accept sync pulses between 50% and 150% of expected duration
                if (duration >= minDuration * 0.5 && duration <= SYNC_DURATION * 1.5) {
                    // Calculate average sync time for more accurate positioning
                    const avgTime = syncSamples.reduce((sum, s) => sum + s.time, 0) / syncSamples.length;
                    syncPulses.push({ 
                        start: syncStart, 
                        end: syncEnd, 
                        duration,
                        center: avgTime
                    });
                }
                syncStart = null;
                syncSamples = [];
            }
        }
    }
    
    // Handle case where sync extends to end of buffer
    if (syncStart !== null && syncSamples.length > 0) {
        const syncEnd = syncSamples[syncSamples.length - 1].time;
        const duration = syncEnd - syncStart;
        if (duration >= minDuration * 0.5) {
            const avgTime = syncSamples.reduce((sum, s) => sum + s.time, 0) / syncSamples.length;
            syncPulses.push({ start: syncStart, end: syncEnd, duration, center: avgTime });
        }
    }
    
    return syncPulses;
}

// Extract line data based on sync pulse timing with improved precision
function extractLineData(samples, syncTime) {
    // More precise timing offsets
    const porchStart = syncTime + SYNC_DURATION;
    const yStart = porchStart + SYNC_PORCH_DURATION;
    const yEnd = yStart + Y_SCAN_DURATION;
    const sepEnd = yEnd + SEPARATOR_DURATION;
    const porch2End = sepEnd + PORCH_DURATION;
    const colorEnd = porch2End + COLOR_SCAN_DURATION;
    
    const ySamples = [];
    const colorSamples = [];
    
    // Apply small timing offset correction (empirical adjustment)
    const yOffset = 0.0005; // 0.5ms offset to center the samples better
    const colorOffset = 0.0003;
    
    for (const sample of samples) {
        const t = sample.time;
        const freq = sample.freq;
        
        // Filter out sync/porch frequencies from pixel data
        if (freq < 1450 || freq > 2350) continue;
        
        if (t >= yStart + yOffset && t < yEnd - yOffset) {
            // Normalize position within Y scan (0 to 1)
            const pos = (t - yStart - yOffset) / (Y_SCAN_DURATION - 2 * yOffset);
            if (pos >= 0 && pos <= 1) {
                ySamples.push({ pos, value: freqToPixel(freq), freq });
            }
        } else if (t >= porch2End + colorOffset && t < colorEnd - colorOffset) {
            // Normalize position within color scan (0 to 1)  
            const pos = (t - porch2End - colorOffset) / (COLOR_SCAN_DURATION - 2 * colorOffset);
            if (pos >= 0 && pos <= 1) {
                colorSamples.push({ pos, value: freqToPixel(freq), freq });
            }
        }
    }
    
    return { ySamples, colorSamples };
}

// Convert position-based samples to pixel array with weighted averaging and median filtering
function samplesToPixels(samples, width) {
    if (samples.length === 0) return new Array(width).fill(128);
    if (samples.length === 1) return new Array(width).fill(samples[0].value);
    
    const pixels = new Array(width).fill(0);
    const counts = new Array(width).fill(0);
    const sampleBins = Array.from({length: width}, () => []);
    
    // Bin samples into pixels with sub-pixel positioning
    for (const sample of samples) {
        const exactPos = sample.pos * width;
        const x = Math.floor(exactPos);
        if (x >= 0 && x < width) {
            sampleBins[x].push(sample.value);
        }
        // Also contribute to adjacent bin with weight based on position
        const frac = exactPos - x;
        if (frac > 0.5 && x + 1 < width) {
            sampleBins[x + 1].push(sample.value);
        } else if (frac < 0.5 && x - 1 >= 0) {
            sampleBins[x - 1].push(sample.value);
        }
    }
    
    // Use median of samples for each bin (more robust to noise)
    for (let x = 0; x < width; x++) {
        if (sampleBins[x].length > 0) {
            // Sort and take median
            const sorted = sampleBins[x].slice().sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            if (sorted.length % 2 === 0) {
                pixels[x] = Math.round((sorted[mid - 1] + sorted[mid]) / 2);
            } else {
                pixels[x] = sorted[mid];
            }
            counts[x] = sampleBins[x].length;
        }
    }
    
    // Fill gaps by cubic interpolation for smoother results
    let lastValid = -1;
    for (let x = 0; x < width; x++) {
        if (counts[x] > 0) {
            if (lastValid >= 0 && lastValid < x - 1) {
                // Linear interpolation for gaps
                for (let i = lastValid + 1; i < x; i++) {
                    const t = (i - lastValid) / (x - lastValid);
                    pixels[i] = Math.round(pixels[lastValid] * (1 - t) + pixels[x] * t);
                }
            }
            lastValid = x;
        }
    }
    
    // Fill leading gaps
    let firstValid = 0;
    while (firstValid < width && counts[firstValid] === 0) firstValid++;
    if (firstValid < width) {
        for (let x = 0; x < firstValid; x++) pixels[x] = pixels[firstValid];
    }
    // Fill trailing gaps  
    if (lastValid >= 0 && lastValid < width - 1) {
        for (let x = lastValid + 1; x < width; x++) pixels[x] = pixels[lastValid];
    }
    
    // Apply light smoothing to reduce noise (3-point moving average)
    const smoothed = new Array(width);
    for (let x = 0; x < width; x++) {
        if (x === 0) {
            smoothed[x] = Math.round((pixels[x] * 2 + pixels[x + 1]) / 3);
        } else if (x === width - 1) {
            smoothed[x] = Math.round((pixels[x - 1] + pixels[x] * 2) / 3);
        } else {
            smoothed[x] = Math.round((pixels[x - 1] + pixels[x] * 2 + pixels[x + 1]) / 4);
        }
    }
    
    return smoothed;
}

// Get latest frequency from raw samples buffer
function getLatestFrequency() {
    if (imgRawSamples.length === 0) return null;
    const latest = imgRawSamples[imgRawSamples.length - 1];
    if (imgAudioCtx.currentTime - latest.time < 0.05) {
        return latest.freq;
    }
    return null;
}

function processReceivedAudio() {
    if (!imgIsListening) {
        if (receiverIntervalId) {
            clearInterval(receiverIntervalId);
            receiverIntervalId = null;
        }
        return;
    }
    
    const currentTime = imgAudioCtx.currentTime;
    const freq = getLatestFrequency();
    
    switch (imgReceiverState) {
        case 'WAITING_SYNC':
            // Look for 1200Hz sync pulse to start reception
            if (freq !== null && isSyncFreq(freq)) {
                if (syncStartTime === 0) {
                    syncStartTime = currentTime;
                } else if (currentTime - syncStartTime >= SYNC_DURATION * 0.5) {
                    // First sync detected! Start line-by-line reception
                    lastLineSyncTime = syncStartTime;
                    imgReceiverState = 'RECEIVING_LINE';
                    imgCurrentLine = 0;
                    imgListenStatus.textContent = `Receiving - Line 0/${imgHeight}`;
                    console.log('First sync detected, starting reception');
                    syncStartTime = 0;
                }
            } else {
                if (syncStartTime !== 0 && currentTime - syncStartTime > SYNC_DURATION * 3) {
                    syncStartTime = 0;
                }
            }
            break;
            
        case 'RECEIVING_LINE':
            // Check if enough time has passed for this line
            const lineElapsed = currentTime - lastLineSyncTime;
            
            if (lineElapsed >= LINE_DURATION * 0.98) {
                // Look for next sync to determine actual line boundary
                const searchStart = lastLineSyncTime + LINE_DURATION * 0.90;
                const searchEnd = lastLineSyncTime + LINE_DURATION * 1.10;
                const recentSamples = imgRawSamples.filter(s => 
                    s.time >= searchStart && s.time < searchEnd
                );
                const syncPulses = findSyncPulses(recentSamples, SYNC_DURATION * 0.4);
                
                let nextSyncStart = lastLineSyncTime + LINE_DURATION;
                
                if (syncPulses.length > 0) {
                    // Use the detected sync for precise timing
                    nextSyncStart = syncPulses[0].start;
                }
                
                // Process the completed line using the sync timing
                const lineSamples = imgRawSamples.filter(s => 
                    s.time >= lastLineSyncTime && s.time < nextSyncStart
                );
                
                if (lineSamples.length > 20) {
                    const { ySamples, colorSamples } = extractLineData(lineSamples, lastLineSyncTime);
                    
                    const yPixels = samplesToPixels(ySamples, imgWidth);
                    const colorPixels = samplesToPixels(colorSamples, imgWidth);
                    
                    imgYLines[imgCurrentLine] = yPixels;
                    const isEven = (imgCurrentLine % 2 === 0);
                    
                    if (isEven) {
                        imgCrLines[imgCurrentLine] = colorPixels;
                    } else {
                        imgCbLines[imgCurrentLine] = colorPixels;
                        processLinePair(imgCurrentLine - 1, imgCurrentLine);
                    }
                    
                    renderLineGrayscale(imgCurrentLine);
                    console.log(`Line ${imgCurrentLine} complete - Y:${ySamples.length}, C:${colorSamples.length}`);
                }
                
                imgCurrentLine++;
                imgListenStatus.textContent = `Receiving - Line ${imgCurrentLine}/${imgHeight}`;
                
                if (imgCurrentLine >= imgHeight) {
                    // Final pass: apply post-processing for best quality
                    console.log('Applying post-processing...');
                    postProcessImage();
                    
                    imgListenStatus.textContent = 'Image complete!';
                    console.log('Image reception complete');
                    imgIsListening = false;
                    imgListenBtn.disabled = false;
                    imgStopListenBtn.disabled = true;
                    if (receiverIntervalId) {
                        clearInterval(receiverIntervalId);
                        receiverIntervalId = null;
                    }
                    return;
                }
                
                // Update timing for next line
                lastLineSyncTime = nextSyncStart;
            }
            break;
    }
}

// Start receiver with fast polling
function startReceiver() {
    if (receiverIntervalId) {
        clearInterval(receiverIntervalId);
    }
    // Poll every 1ms for better timing accuracy
    receiverIntervalId = setInterval(processReceivedAudio, 1);
}

// Resample buffer to target length using linear interpolation
function resampleBuffer(buffer, targetLength) {
    if (buffer.length === 0) return new Array(targetLength).fill(128);
    if (buffer.length === 1) return new Array(targetLength).fill(buffer[0]);
    if (buffer.length === targetLength) return buffer.slice();
    
    const result = [];
    const ratio = (buffer.length - 1) / (targetLength - 1);
    
    for (let i = 0; i < targetLength; i++) {
        const srcIndex = i * ratio;
        const lower = Math.floor(srcIndex);
        const upper = Math.min(lower + 1, buffer.length - 1);
        const fraction = srcIndex - lower;
        
        const value = buffer[lower] * (1 - fraction) + buffer[upper] * fraction;
        result.push(Math.round(value));
    }
    
    return result;
}

// Event listeners for receiver controls
imgListenBtn.addEventListener("click", () => {
    if (imgAudioCtx.state === 'suspended') {
        imgAudioCtx.resume();
    }
    
    resetReceiver();
    imgIsListening = true;
    imgListenBtn.disabled = true;
    imgStopListenBtn.disabled = false;
    imgListenStatus.textContent = 'Listening for sync...';
    startReceiver();
});

imgStopListenBtn.addEventListener("click", () => {
    imgIsListening = false;
    imgListenBtn.disabled = false;
    imgStopListenBtn.disabled = true;
    imgListenStatus.textContent = 'Stopped';
    if (receiverIntervalId) {
        clearInterval(receiverIntervalId);
        receiverIntervalId = null;
    }
});