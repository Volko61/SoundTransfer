import { waveformCanvas, waveformCtx } from "./dom.js";
import { state } from "./state.js";

export async function startVisualizer() {
    if (!waveformCtx) return;
    stopVisualizer();
    try {
        state.vizStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.vizAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = state.vizAudioCtx.createMediaStreamSource(state.vizStream);
        state.vizAnalyser = state.vizAudioCtx.createAnalyser();
        state.vizAnalyser.fftSize = 2048;
        source.connect(state.vizAnalyser);
        drawVisualizer();
    } catch (err) {
        console.error("Visualizer mic error:", err);
    }
}

export function stopVisualizer() {
    if (state.vizAnimationId) {
        cancelAnimationFrame(state.vizAnimationId);
        state.vizAnimationId = null;
    }
    if (state.vizStream) {
        state.vizStream.getTracks().forEach((t) => t.stop());
        state.vizStream = null;
    }
    if (state.vizAudioCtx) {
        state.vizAudioCtx.close();
        state.vizAudioCtx = null;
    }
    state.vizAnalyser = null;
    clearCanvas();
}

export function clearCanvas() {
    waveformCtx.fillStyle = "#0f1421";
    waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

export function setVizMode(mode) {
    state.vizMode = mode;
}

function drawVisualizer() {
    if (!state.vizAnalyser) return;
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    if (state.vizMode === "waveform") {
        const dataArray = new Uint8Array(state.vizAnalyser.fftSize);
        state.vizAnalyser.getByteTimeDomainData(dataArray);
        waveformCtx.fillStyle = "#0f1421";
        waveformCtx.fillRect(0, 0, width, height);
        waveformCtx.lineWidth = 2;
        waveformCtx.strokeStyle = "#6aa5ff";
        waveformCtx.beginPath();
        const slice = width / dataArray.length;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;
            if (i === 0) waveformCtx.moveTo(x, y);
            else waveformCtx.lineTo(x, y);
            x += slice;
        }
        waveformCtx.lineTo(width, height / 2);
        waveformCtx.stroke();
    } else {
        const freqData = new Uint8Array(state.vizAnalyser.frequencyBinCount);
        state.vizAnalyser.getByteFrequencyData(freqData);
        waveformCtx.drawImage(waveformCanvas, -1, 0);
        for (let y = 0; y < height; y++) {
            const index = Math.floor((y / height) * freqData.length);
            const value = freqData[index] / 255;
            const hue = 220 - value * 220;
            waveformCtx.fillStyle = `hsl(${hue}, 90%, ${30 + value * 50}%)`;
            waveformCtx.fillRect(width - 1, height - y, 1, 1);
        }
    }

    state.vizAnimationId = requestAnimationFrame(drawVisualizer);
}
