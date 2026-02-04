const textEmitBtn = document.getElementById("textEmitBtn");
const textEmit = document.getElementById("textEmit");
const textReceive = document.getElementById("textReceive");
const textCalibrateBtn = document.getElementById("textCalibrateBtn");

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyserNode = audioCtx.createAnalyser();
analyserNode.fftSize = 2048;
const bufferLength = analyserNode.frequencyBinCount;
const dataArray = new Float32Array(bufferLength);

let calibrationBuffer = new Float32Array(bufferLength).fill(-100);
let isCalibrating = false;

const FREQ_0 = 3000;
const FREQ_1 = 3500;
const FREQ_START = 4000;
const FREQ_END = 4500;
const TONE_DURATION = 0.3;
const THRESHOLD_OFFSET = 20;

// const canvas = document.createElement("canvas");
// document.body.appendChild(canvas);
const canvas = document.getElementById("waveform-text");
const canvasCtx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = 200;

let isListening = false;
let receivedBits = "";
let receptionCooldown = 0;

// navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
//     const source = audioCtx.createMediaStreamSource(stream);
//     source.connect(analyserNode);
//     processAudio();
// });

navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
    }
}).then(async (stream) => {
    // Ensure context is running (some browsers require this after stream access)
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyserNode);
    processAudio();
});

textCalibrateBtn.addEventListener("click", () => {
    isCalibrating = true;
    const tempBuffer = new Float32Array(bufferLength).fill(-140);
    const startTime = Date.now();

    const capture = () => {
        analyserNode.getFloatFrequencyData(dataArray);
        for (let i = 0; i < bufferLength; i++) {
            if (dataArray[i] > tempBuffer[i]) {
                tempBuffer[i] = dataArray[i];
            }
        }

        if (Date.now() - startTime < 2000) {
            requestAnimationFrame(capture);
        } else {
            calibrationBuffer.set(tempBuffer);
            isCalibrating = false;
        }
    };
    capture();
});

function getIndexFromFreq(freq) {
    return Math.round(freq * analyserNode.fftSize / audioCtx.sampleRate);
}

function getFrequencyMagnitude(freq) {
    const index = getIndexFromFreq(freq);
    let val = dataArray[index];
    let floor = calibrationBuffer[index];
    if (floor === -Infinity) floor = -140;
    return val - floor;
}

function generateSound(type, startTime) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';

    if (type === "0") osc.frequency.value = FREQ_0;
    else if (type === "1") osc.frequency.value = FREQ_1;
    else if (type === "START") osc.frequency.value = FREQ_START;
    else if (type === "END") osc.frequency.value = FREQ_END;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + 0.01);
    gain.gain.setValueAtTime(1, startTime + TONE_DURATION - 0.01);
    gain.gain.linearRampToValueAtTime(0, startTime + TONE_DURATION);

    osc.start(startTime);
    osc.stop(startTime + TONE_DURATION);
    return TONE_DURATION + 0.05;
}

textEmitBtn.addEventListener("click", async () => {
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    let input = textEmit.value;
    let sequence = ["START"];

    for (let i = 0; i < input.length; i++) {
        let bin = input[i].charCodeAt(0).toString(2).padStart(8, '0');
        for (let bit of bin) sequence.push(bit);
    }
    sequence.push("END");

    let timeOffset = audioCtx.currentTime + 0.5;
    for (let item of sequence) {
        timeOffset += generateSound(item, timeOffset);
    }
});

function decodeBits(bits) {
    let text = "";
    for (let i = 0; i < bits.length; i += 8) {
        const byte = bits.substr(i, 8);
        if (byte.length === 8) {
            text += String.fromCharCode(parseInt(byte, 2));
        }
    }
    return text;
}

function processAudio() {
    requestAnimationFrame(processAudio);
    analyserNode.getFloatFrequencyData(dataArray);
    drawVisuals();

    if (receptionCooldown > 0) {
        receptionCooldown--;
        return;
    }

    const mag0 = getFrequencyMagnitude(FREQ_0);
    const mag1 = getFrequencyMagnitude(FREQ_1);
    const magStart = getFrequencyMagnitude(FREQ_START);
    const magEnd = getFrequencyMagnitude(FREQ_END);

    const maxMag = Math.max(mag0, mag1, magStart, magEnd);

    if (maxMag > THRESHOLD_OFFSET) {
        if (maxMag === magStart) {
            receivedBits = "";
            isListening = true;
            textReceive.value = "Listening...";
            setCooldown();
        } else if (isListening) {
            if (maxMag === magEnd) {
                isListening = false;
                textReceive.value = decodeBits(receivedBits);
                setCooldown();
            } else if (maxMag === mag0) {
                receivedBits += "0";
                setCooldown();
            } else if (maxMag === mag1) {
                receivedBits += "1";
                setCooldown();
            }
        }
    }
}

function setCooldown() {
    receptionCooldown = Math.floor((TONE_DURATION * 60) * 0.8);
}

function drawVisuals() {
    canvasCtx.fillStyle = "black";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let posX = 0;

    for (let i = 0; i < bufferLength; i++) {
        let val = dataArray[i];
        let floor = calibrationBuffer[i];
        if (floor === -Infinity) floor = -140;

        const adjustedValue = Math.max(0, val - floor);
        const barHeight = adjustedValue * 5;

        canvasCtx.fillStyle = isCalibrating ? "yellow" : "red";

        const freq = i * audioCtx.sampleRate / analyserNode.fftSize;
        if (Math.abs(freq - FREQ_0) < 50 || Math.abs(freq - FREQ_1) < 50 ||
            Math.abs(freq - FREQ_START) < 50 || Math.abs(freq - FREQ_END) < 50) {
            canvasCtx.fillStyle = "lime";
        }

        canvasCtx.fillRect(posX, canvas.height - barHeight, barWidth, barHeight);
        posX += barWidth + 1;
    }
}