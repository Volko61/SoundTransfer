const btnSend = document.getElementById("send");
const btnListen = document.getElementById("listen");
const btnSendFile = document.getElementById("sendFile");
const msgInput = document.getElementById("msgtosend");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const profileSelect = document.getElementById("profileSelect");
const vizSelect = document.getElementById("vizSelect");
const statusEl = document.getElementById("status");
const receivedList = document.getElementById("receivedList");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");
const profileHint = document.getElementById("profileHint");
const sendProgress = document.getElementById("sendProgress");
const progressInfo = document.getElementById("progressInfo");
const pixelDrawToggle = document.getElementById("pixelDraw");

// Approximate bytes per second for each profile (empirically measured)
const PROFILE_BPS = {
    "hello-world-loud": 50,
    "hello-world": 50,
    "audible": 100,
    "audible-7k-channel-0": 80,
    "audible-7k-channel-1": 80,
    "audible-fsk-fast": 200,
    "ultrasonic": 60,
    "ultrasonic-3600": 150,
    "ultrasonic-fsk-fast": 180,
    "cable-64k": 6000,
    "reliable": 200,
    "ultra-fast": 400
};

const START = "\u0002";
const END = "\u0003";
const MAX_BASE64_CHARS = 240000;
const IMAGE_STREAM_MAX_DIM = 96;
const IMAGE_STREAM_CHUNK_BYTES = 6000;

let isReady = false;
let transmitter = null;
let receiverInstance = null;
let receiverActive = false;
let currentProfile = "hello-world-loud";
let rxBuffer = "";
let vizMode = "waveform";
let vizStream = null;
let vizAudioCtx = null;
let vizAnalyser = null;
let vizAnimationId = null;
let progressTimer = null;
let profileMeta = {};
let pendingSendResolve = null;
let sendQueue = Promise.resolve();
const imageStreamSessions = new Map();

const PROFILE_DESCRIPTIONS = {
    "hello-world-loud": "Loud, very audible tone. Best for testing and hearing the signal.",
    "hello-world": "Audible tone with moderate gain. Good balance of audibility and comfort.",
    "audible": "Audible tones with modest gain. Use for normal audible demos.",
    "audible-7k-channel-0": "Higher audible band. Less annoying to humans but more fragile.",
    "audible-7k-channel-1": "Near ultrasonic edge. Better for humans, worse for microphones.",
    "ultrasonic": "Near ultrasonic; mostly inaudible. Use if you don't want to hear it.",
    "ultrasonic-3600": "Ultrasonic OFDM profile; slower and more fragile for some mics.",
    "cable-64k": "Very fast but fragile; best on good speakers and mics.",
    "audible-fsk-fast": "Fast audible FSK; can be less robust.",
    "ultrasonic-fsk-fast": "Fast near ultrasonic; may fail on many devices.",
    "reliable": "Slower OFDM with QAM16 + strong FEC. More robust in noisy environments.",
    "ultra-fast": "Fast OFDM with QAM64. Good speed over speakers/mic. Louder signal."
};

function setStatus(text, tone = "info") {
    statusEl.textContent = text;
    statusEl.classList.remove("ok", "error");
    if (tone === "ok") statusEl.classList.add("ok");
    if (tone === "error") statusEl.classList.add("error");
}

function setUiReady(ready) {
    btnSend.disabled = !ready;
    btnListen.disabled = !ready;
    btnSendFile.disabled = !ready;
    profileSelect.disabled = !ready;
    vizSelect.disabled = !ready;
    fileInput.disabled = !ready;
}

function updateProfileHint() {
    const desc = PROFILE_DESCRIPTIONS[currentProfile] || "Pick a profile based on audibility vs reliability.";
    const profile = profileMeta[currentProfile];
    const details = profile ? describeProfileDetailed(profile) : "";
    profileHint.textContent = `${currentProfile}: ${desc}${details ? ` • ${details}` : ""}`;
}

async function loadProfiles() {
    try {
        const res = await fetch("./quiet-profiles.json");
        const text = await res.text();
        const data = JSON.parse(text);
        profileMeta = data;
        const keys = Object.keys(data);
        const preferred = [
            "hello-world-loud",
            "hello-world",
            "audible",
            "audible-7k-channel-0",
            "audible-7k-channel-1",
            "audible-fsk-fast",
            "ultrasonic",
            "ultrasonic-3600",
            "ultrasonic-fsk-fast",
            "cable-64k",
            "reliable",
            "ultra-fast"
        ];
        const ordered = preferred.filter((k) => keys.includes(k));

        profileSelect.innerHTML = "";
        ordered.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = formatProfileOption(name);
            profileSelect.appendChild(opt);
        });

        if (!ordered.includes(currentProfile)) {
            currentProfile = ordered[0];
        }
        profileSelect.value = currentProfile;
        updateProfileHint();
    } catch (err) {
        console.warn("Failed to load profiles:", err);
        profileSelect.innerHTML = "<option value=\"audible\">audible — fast but robust + audible</option>";
        currentProfile = "audible";
        updateProfileHint();
    }
}

function formatProfileOption(name) {
    const profile = profileMeta[name];
    const hintText = profile ? describeProfile(profile) : "custom profile";
    return `${name} — ${hintText}`;
}

function describeProfile(profile) {
    const frame = Number(profile.frame_length || 0);
    const sps = Number(profile.interpolation?.samples_per_symbol || 0);
    const fec = `${profile.inner_fec_scheme || "none"}/${profile.outer_fec_scheme || "none"}`;
    const freq = Number(profile.modulation?.center_frequency || 0);
    const gain = Number(profile.modulation?.gain || 0);

    const speedScore = frame * (sps > 0 ? 1 / sps : 1);
    let speedLabel = "balanced";
    if (speedScore >= 2000) speedLabel = "absolute fastest";
    else if (speedScore >= 700) speedLabel = "fastest";
    else if (speedScore >= 200) speedLabel = "fast";
    else if (speedScore >= 80) speedLabel = "medium";
    else speedLabel = "slow";

    const fecHeavy = /rs|v29|v27p|v29p/i.test(fec);
    const robustLabel = fecHeavy ? "robust" : "unreliable";

    const audibleLabel = freq > 0 ? (freq <= 16000 ? "audible" : "near ultrasonic") : "unknown band";
    const loudLabel = gain >= 0.2 ? "loud" : gain >= 0.08 ? "audible" : "quiet";

    return `${speedLabel}, ${robustLabel}, ${audibleLabel}, ${loudLabel}`;
}

function describeProfileDetailed(profile) {
    const frame = Number(profile.frame_length || 0);
    const sps = Number(profile.interpolation?.samples_per_symbol || 0);
    const mod = profile.mod_scheme || "unknown";
    const fec = `${profile.inner_fec_scheme || "none"}/${profile.outer_fec_scheme || "none"}`;
    const freq = Number(profile.modulation?.center_frequency || 0);
    const gain = Number(profile.modulation?.gain || 0);
    const freqLabel = freq ? `${freq} Hz` : "n/a";
    return `mod ${mod}, FEC ${fec}, frame ${frame}, sps ${sps || "n/a"}, freq ${freqLabel}, gain ${gain}`;
}

function initQuiet() {
    setUiReady(false);
    setStatus("Initializing…");

    Quiet.init({
        profilesPrefix: "./",
        memoryInitializerPrefix: "./",
        libfecPrefix: "./",
        onReady: () => {
            isReady = true;
            createTransmitter();
            setUiReady(true);
            setStatus("Ready", "ok");
        },
        onError: (reason) => {
            console.error("Quiet init failed:", reason);
            setUiReady(false);
            setStatus("Init failed", "error");
        }
    });
}

function waitForQuiet(remaining = 50) {
    if (window.Quiet) {
        initQuiet();
        return;
    }
    if (remaining <= 0) {
        console.error("Quiet.js did not load.");
        setUiReady(false);
        setStatus("Quiet.js failed to load", "error");
        return;
    }
    window.setTimeout(() => waitForQuiet(remaining - 1), 100);
}

function createTransmitter() {
    if (!isReady) return;
    if (transmitter && transmitter.destroy) {
        transmitter.destroy();
    }
    transmitter = Quiet.transmitter({
        profile: currentProfile,
        onFinish: () => {
            if (pendingSendResolve) {
                pendingSendResolve();
                pendingSendResolve = null;
            }
            finishProgress();
        }
    });
}

function resetReceiver() {
    if (receiverInstance && receiverInstance.destroy) {
        receiverInstance.destroy();
    }
    receiverInstance = null;
    receiverActive = false;
    btnListen.textContent = "Listen";
}

function ensureReceiver() {
    if (receiverInstance) return;

    receiverInstance = Quiet.receiver({
        profile: currentProfile,
        onReceive: (payload) => {
            if (!receiverActive) return;
            handleIncomingPayload(payload);
        },
        onCreate: () => {
            setStatus("Listening…", "ok");
        },
        onCreateFail: (reason) => {
            console.error("Receiver create failed:", reason);
            setStatus("Mic access failed", "error");
        },
        onReceiveFail: (totalFails) => {
            console.warn("Receiver checksum fails:", totalFails);
        }
    });
}

function sendEnvelope(envelope) {
    if (!isReady || !transmitter) return;
    const payload = JSON.stringify(envelope);
    const framed = `${START}${payload}${END}`;
    startProgress(framed.length);
    transmitter.transmit(Quiet.str2ab(framed));
}

function sendEnvelopeAsync(envelope) {
    if (!isReady || !transmitter) return Promise.resolve();
    return new Promise((resolve) => {
        pendingSendResolve = resolve;
        sendEnvelope(envelope);
    });
}

function queueEnvelope(envelope) {
    sendQueue = sendQueue.then(() => sendEnvelopeAsync(envelope));
    return sendQueue;
}

function handleIncomingPayload(payload) {
    const chunk = Quiet.ab2str(payload);
    rxBuffer += chunk;

    if (rxBuffer.length > 200000) {
        rxBuffer = rxBuffer.slice(-200000);
    }

    let startIdx = rxBuffer.indexOf(START);
    while (startIdx !== -1) {
        const endIdx = rxBuffer.indexOf(END, startIdx + 1);
        if (endIdx === -1) {
            rxBuffer = rxBuffer.slice(startIdx);
            break;
        }

        const jsonStr = rxBuffer.slice(startIdx + 1, endIdx);
        rxBuffer = rxBuffer.slice(endIdx + 1);

        try {
            const msg = JSON.parse(jsonStr);
            renderMessage(msg);
            setStatus("Received", "ok");
        } catch (err) {
            console.warn("Failed to parse message:", err);
        }

        startIdx = rxBuffer.indexOf(START);
    }
}

function renderMessage(msg) {
    if (msg.type === "image-stream-start") {
        handleImageStreamStart(msg);
        return;
    }

    if (msg.type === "image-stream-chunk") {
        handleImageStreamChunk(msg);
        return;
    }

    if (msg.type === "image-stream-end") {
        handleImageStreamEnd(msg);
        return;
    }

    if (msg.type === "text") {
        appendMessage("Text", document.createTextNode(msg.text || ""));
        return;
    }

    if (msg.type === "file") {
        const blob = base64ToBlob(msg.data, msg.mime || "application/octet-stream");
        const url = URL.createObjectURL(blob);
        const wrapper = document.createElement("div");

        if ((msg.mime || "").startsWith("image/")) {
            if (pixelDrawToggle.checked) {
                const canvas = document.createElement("canvas");
                canvas.width = 320;
                canvas.height = 240;
                wrapper.appendChild(canvas);
                drawImagePixelByPixel(url, canvas);
            } else {
                const img = document.createElement("img");
                img.src = url;
                wrapper.appendChild(img);
            }
        } else if ((msg.mime || "").startsWith("audio/")) {
            const audio = document.createElement("audio");
            audio.controls = true;
            audio.src = url;
            wrapper.appendChild(audio);
        } else if ((msg.mime || "").startsWith("video/")) {
            const video = document.createElement("video");
            video.controls = true;
            video.src = url;
            wrapper.appendChild(video);
        } else {
            const link = document.createElement("a");
            link.href = url;
            link.download = msg.name || "file";
            link.textContent = `Download ${msg.name || "file"}`;
            wrapper.appendChild(link);
        }

        const meta = document.createElement("div");
        meta.className = "file-info";
        const sizeText = `${formatBytes(msg.size || blob.size)}${msg.originalSize ? ` (original ${formatBytes(msg.originalSize)})` : ""}`;
        meta.textContent = `${msg.name || "file"} • ${msg.mime || blob.type} • ${sizeText}`;
        wrapper.appendChild(meta);

        appendMessage("File", wrapper);
        return;
    }
}

function appendMessage(title, contentNode) {
    const item = document.createElement("div");
    item.className = "message";
    const heading = document.createElement("h3");
    heading.textContent = title;
    item.appendChild(heading);

    if (contentNode instanceof Node) {
        item.appendChild(contentNode);
    } else {
        item.appendChild(document.createTextNode(String(contentNode)));
    }
    receivedList.prepend(item);
}

let progressState = null;

function setProgress(value) {
    const clamped = Math.max(0, Math.min(100, value));
    sendProgress.style.width = `${clamped}%`;
}

function clearProgress() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
    progressState = null;
    setProgress(0);
    progressInfo.innerHTML = "";
}

function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "--";
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function getProfileBps(profile) {
    // Get from our estimates, or calculate from profile metadata
    if (PROFILE_BPS[profile]) return PROFILE_BPS[profile];
    const meta = profileMeta[profile];
    if (meta) {
        const frame = Number(meta.frame_length || 64);
        const sps = Number(meta.interpolation?.samples_per_symbol || 10);
        // Rough estimate: higher frame, lower sps = faster
        return Math.max(20, Math.min(500, (frame / sps) * 5));
    }
    return 80; // Default fallback
}

function startProgress(length) {
    clearProgress();
    
    const bps = getProfileBps(currentProfile);
    const estimatedMs = (length / bps) * 1000;
    const startTime = Date.now();
    
    progressState = {
        length,
        bps,
        estimatedMs,
        startTime,
        lastUpdate: startTime
    };
    
    updateProgressDisplay();
    
    progressTimer = window.setInterval(() => {
        if (!progressState) return;
        
        const now = Date.now();
        const elapsed = now - progressState.startTime;
        
        // Use eased progress that approaches but never quite reaches 100%
        // until onFinish is called
        const rawPct = (elapsed / progressState.estimatedMs) * 100;
        const easedPct = Math.min(95, rawPct * (1 - Math.exp(-rawPct / 50)));
        
        setProgress(easedPct);
        updateProgressDisplay();
        
        // If we've exceeded estimate by 3x, something's likely wrong
        if (elapsed > progressState.estimatedMs * 3) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    }, 100);
}

function updateProgressDisplay() {
    if (!progressState) {
        progressInfo.innerHTML = "";
        return;
    }
    
    const elapsed = Date.now() - progressState.startTime;
    const remaining = Math.max(0, progressState.estimatedMs - elapsed);
    const dataSize = formatBytes(progressState.length);
    
    const elapsedStr = formatTime(elapsed);
    const remainingStr = remaining > 0 ? formatTime(remaining) : "finishing...";
    
    progressInfo.innerHTML = `
        <span class="data-info">${dataSize} @ ~${progressState.bps} B/s</span>
        <span class="time-left">${elapsedStr} / ~${formatTime(progressState.estimatedMs)} (${remainingStr} left)</span>
    `;
}

function finishProgress() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
    setProgress(100);
    
    if (progressState) {
        const elapsed = Date.now() - progressState.startTime;
        const actualBps = Math.round(progressState.length / (elapsed / 1000));
        progressInfo.innerHTML = `
            <span class="data-info">Sent ${formatBytes(progressState.length)}</span>
            <span class="time-left">Completed in ${formatTime(elapsed)} (${actualBps} B/s)</span>
        `;
        progressState = null;
    }
    
    setTimeout(() => {
        setProgress(0);
        progressInfo.innerHTML = "";
    }, 3000);
}


function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "0 B";
    const units = ["B", "KB", "MB"];
    let size = bytes;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024;
        idx++;
    }
    return `${size.toFixed(size < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function replaceExtension(name, ext) {
    const base = name.replace(/\.[^/.]+$/, "");
    return `${base}.${ext}`;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function bytesToBase64(bytes) {
    const slice = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return arrayBufferToBase64(slice);
}

function handleImageStreamStart(msg) {
    if (!msg.id || !Number.isFinite(msg.width) || !Number.isFinite(msg.height)) return;
    const wrapper = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = msg.width;
    canvas.height = msg.height;
    wrapper.appendChild(canvas);

    const meta = document.createElement("div");
    meta.className = "file-info";
    const sizeText = formatBytes(msg.totalBytes || msg.width * msg.height * 4);
    meta.textContent = `${msg.name || "image"} • ${msg.width}×${msg.height} • ${sizeText}`;
    wrapper.appendChild(meta);

    appendMessage("Image", wrapper);

    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(msg.width, msg.height);
    imageStreamSessions.set(msg.id, {
        id: msg.id,
        width: msg.width,
        height: msg.height,
        ctx,
        imageData,
        receivedBytes: 0,
        totalBytes: msg.totalBytes || imageData.data.length,
        leftover: null
    });
}

function handleImageStreamChunk(msg) {
    const session = imageStreamSessions.get(msg.id);
    if (!session || typeof msg.data !== "string" || !Number.isFinite(msg.offset)) return;

    const bytes = base64ToBytes(msg.data);
    const data = session.imageData.data;

    data.set(bytes, msg.offset);
    session.receivedBytes += bytes.length;

    if (pixelDrawToggle.checked) {
        drawPixelsIncremental(session, bytes, msg.offset);
    }
}

function handleImageStreamEnd(msg) {
    const session = imageStreamSessions.get(msg.id);
    if (!session) return;

    if (!pixelDrawToggle.checked) {
        session.ctx.putImageData(session.imageData, 0, 0);
        imageStreamSessions.delete(msg.id);
    } else {
        // Wait for pixel animation to complete before cleaning up
        const waitForAnimation = () => {
            if (session.pixelQueue && session.pixelQueue.length > 0) {
                requestAnimationFrame(waitForAnimation);
            } else {
                imageStreamSessions.delete(msg.id);
            }
        };
        waitForAnimation();
    }
}

function drawPixelsIncremental(session, bytes, offset) {
    const ctx = session.ctx;
    const width = session.width;
    const alignedLength = bytes.length - (bytes.length % 4);

    // Queue pixels for animated drawing
    if (!session.pixelQueue) {
        session.pixelQueue = [];
        session.isDrawing = false;
    }

    // Add all pixels from this chunk to the queue
    for (let i = 0; i < alignedLength; i += 4) {
        const idx = (offset + i) / 4;
        const x = idx % width;
        const y = Math.floor(idx / width);
        session.pixelQueue.push({
            x,
            y,
            r: bytes[i],
            g: bytes[i + 1],
            b: bytes[i + 2],
            a: bytes[i + 3]
        });
    }

    // Start the animation loop if not already running
    if (!session.isDrawing) {
        session.isDrawing = true;
        animatePixels(session);
    }
}

function animatePixels(session) {
    const ctx = session.ctx;
    const pixelsPerFrame = Math.max(1, Math.ceil(session.pixelQueue.length / 60)); // Draw enough to finish in ~1 second per chunk

    const drawFrame = () => {
        if (session.pixelQueue.length === 0) {
            session.isDrawing = false;
            return;
        }

        // Draw a batch of pixels per frame for smooth animation
        const batch = Math.min(pixelsPerFrame, session.pixelQueue.length);
        for (let i = 0; i < batch; i++) {
            const pixel = session.pixelQueue.shift();
            if (pixel) {
                ctx.fillStyle = `rgba(${pixel.r}, ${pixel.g}, ${pixel.b}, ${pixel.a / 255})`;
                ctx.fillRect(pixel.x, pixel.y, 1, 1);
            }
        }

        requestAnimationFrame(drawFrame);
    };

    requestAnimationFrame(drawFrame);
}

function drawImagePixelByPixel(url, canvas) {
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, canvas.width / img.width, canvas.height / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        ctx.clearRect(0, 0, w, h);
        let i = 0;
        const step = 400;
        const drawChunk = () => {
            const end = Math.min(data.data.length, i + step * 4);
            for (; i < end; i += 4) {
                const idx = i / 4;
                const x = idx % w;
                const y = Math.floor(idx / w);
                ctx.fillStyle = `rgba(${data.data[i]}, ${data.data[i + 1]}, ${data.data[i + 2]}, ${data.data[i + 3] / 255})`;
                ctx.fillRect(x, y, 1, 1);
            }
            if (i < data.data.length) {
                requestAnimationFrame(drawChunk);
            }
        };
        requestAnimationFrame(drawChunk);
    };
    img.src = url;
}

async function startVisualizer() {
    if (!waveformCtx) return;
    stopVisualizer();
    try {
        vizStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        vizAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = vizAudioCtx.createMediaStreamSource(vizStream);
        vizAnalyser = vizAudioCtx.createAnalyser();
        vizAnalyser.fftSize = 2048;
        source.connect(vizAnalyser);
        drawVisualizer();
    } catch (err) {
        console.error("Visualizer mic error:", err);
    }
}

function stopVisualizer() {
    if (vizAnimationId) {
        cancelAnimationFrame(vizAnimationId);
        vizAnimationId = null;
    }
    if (vizStream) {
        vizStream.getTracks().forEach((t) => t.stop());
        vizStream = null;
    }
    if (vizAudioCtx) {
        vizAudioCtx.close();
        vizAudioCtx = null;
    }
    vizAnalyser = null;
    clearCanvas();
}

function clearCanvas() {
    waveformCtx.fillStyle = "#0f1421";
    waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}

function drawVisualizer() {
    if (!vizAnalyser) return;
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    if (vizMode === "waveform") {
        const dataArray = new Uint8Array(vizAnalyser.fftSize);
        vizAnalyser.getByteTimeDomainData(dataArray);
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
        const freqData = new Uint8Array(vizAnalyser.frequencyBinCount);
        vizAnalyser.getByteFrequencyData(freqData);
        waveformCtx.drawImage(waveformCanvas, -1, 0);
        for (let y = 0; y < height; y++) {
            const index = Math.floor((y / height) * freqData.length);
            const value = freqData[index] / 255;
            const hue = 220 - value * 220;
            waveformCtx.fillStyle = `hsl(${hue}, 90%, ${30 + value * 50}%)`;
            waveformCtx.fillRect(width - 1, height - y, 1, 1);
        }
    }

    vizAnimationId = requestAnimationFrame(drawVisualizer);
}

async function compressImage(file) {
    const img = await loadImage(file);
    const maxDim = 420;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7)
    );
    return blob || file;
}

async function prepareImageStreamEnvelopes(file) {
    const img = await loadImage(file);
    const scale = Math.min(1, IMAGE_STREAM_MAX_DIM / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const bytes = imageData.data;
    const id = (window.crypto && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const envelopes = [];
    envelopes.push({
        type: "image-stream-start",
        id,
        name: replaceExtension(file.name, "raw"),
        mime: "image/raw+rgba",
        width,
        height,
        totalBytes: bytes.length,
        originalName: file.name,
        originalType: file.type,
        originalSize: file.size,
        note: "Pixel stream"
    });

    for (let offset = 0; offset < bytes.length; offset += IMAGE_STREAM_CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + IMAGE_STREAM_CHUNK_BYTES);
        const data = bytesToBase64(chunk);
        envelopes.push({
            type: "image-stream-chunk",
            id,
            offset,
            data
        });
    }

    envelopes.push({
        type: "image-stream-end",
        id
    });

    return envelopes;
}

async function compressAudio(file) {
    if (typeof MediaRecorder === "undefined") {
        return file;
    }
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    const chunks = [];
    const preferredMime = "audio/webm;codecs=opus";
    const recorder = new MediaRecorder(dest.stream, {
        mimeType: MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : undefined,
        audioBitsPerSecond: 16000
    });

    const stopPromise = new Promise((resolve) => {
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = resolve;
    });

    recorder.start();
    source.start();

    await new Promise((resolve) => {
        source.onended = resolve;
    });

    recorder.stop();
    await stopPromise;
    await audioCtx.close();

    return new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
}

async function compressVideo(file) {
    if (typeof MediaRecorder === "undefined") {
        return file;
    }
    const video = document.createElement("video");
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
    });

    const maxDim = 320;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");

    const canvasStream = canvas.captureStream(12);
    const sourceStream = typeof video.captureStream === "function" ? video.captureStream() : null;
    const tracks = [
        ...canvasStream.getVideoTracks(),
        ...(sourceStream ? sourceStream.getAudioTracks() : [])
    ];
    const stream = new MediaStream(tracks);
    const chunks = [];
    const preferredMime = "video/webm;codecs=vp8";
    const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : undefined,
        videoBitsPerSecond: 150000
    });

    const stopPromise = new Promise((resolve) => {
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = resolve;
    });

    recorder.start();
    await video.play();

    const draw = () => {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

    await new Promise((resolve) => {
        video.onended = resolve;
    });

    recorder.stop();
    await stopPromise;
    URL.revokeObjectURL(video.src);

    return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

async function prepareFileEnvelope(file) {
    let blob = file;
    let name = file.name;
    let note = "";

    if (file.type.startsWith("image/")) {
        blob = await compressImage(file);
        name = replaceExtension(name, "jpg");
        note = "Compressed image";
    } else if (file.type.startsWith("audio/")) {
        blob = await compressAudio(file);
        name = replaceExtension(name, "webm");
        note = "Compressed audio (opus)";
    } else if (file.type.startsWith("video/")) {
        blob = await compressVideo(file);
        name = replaceExtension(name, "webm");
        note = "Compressed video (low-res)";
    }

    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    if (base64.length > MAX_BASE64_CHARS) {
        throw new Error(`File too large after compression (${formatBytes(blob.size)}).`);
    }

    return {
        type: "file",
        name,
        mime: blob.type || file.type || "application/octet-stream",
        data: base64,
        size: blob.size,
        originalName: file.name,
        originalType: file.type,
        originalSize: file.size,
        note
    };
}

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
        fileInfo.textContent = "";
        return;
    }
    fileInfo.textContent = `${file.name} • ${file.type || "unknown"} • ${formatBytes(file.size)}`;
});

btnSend.addEventListener("click", () => {
    if (!isReady || !transmitter) return;
    const text = msgInput.value.trim();
    if (!text) return;
    const envelope = { type: "text", text };
    sendEnvelope(envelope);
    msgInput.value = "";
    setStatus("Text queued", "ok");
});

btnSendFile.addEventListener("click", async () => {
    if (!isReady || !transmitter) return;
    const file = fileInput.files?.[0];
    if (!file) {
        setStatus("Choose a file first", "error");
        return;
    }
    try {
        if (file.type.startsWith("image/") && pixelDrawToggle.checked) {
            setStatus("Preparing pixel stream…");
            const envelopes = await prepareImageStreamEnvelopes(file);
            for (const envelope of envelopes) {
                await queueEnvelope(envelope);
            }
            setStatus("Pixel stream queued", "ok");
        } else {
            setStatus("Compressing file…");
            const envelope = await prepareFileEnvelope(file);
            sendEnvelope(envelope);
            setStatus("File queued", "ok");
        }
    } catch (err) {
        console.error(err);
        setStatus(err.message || "File failed", "error");
    }
});

btnListen.addEventListener("click", () => {
    if (!isReady) return;
    if (!receiverActive) {
        ensureReceiver();
        receiverActive = true;
        btnListen.textContent = "Stop Listening";
        startVisualizer();
        return;
    }

    resetReceiver();
    stopVisualizer();
    setStatus("Listening stopped", "info");
});

profileSelect.addEventListener("change", () => {
    currentProfile = profileSelect.value;
    createTransmitter();
    if (receiverActive) {
        resetReceiver();
        ensureReceiver();
        receiverActive = true;
        btnListen.textContent = "Stop Listening";
    }
    updateProfileHint();
    setStatus(`Profile set to ${currentProfile}`, "ok");
});

vizSelect.addEventListener("change", () => {
    vizMode = vizSelect.value;
    clearCanvas();
});

loadProfiles();
updateProfileHint();
waitForQuiet();
