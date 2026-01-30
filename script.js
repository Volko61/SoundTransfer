const btnSend = document.getElementById("send");
const btnListen = document.getElementById("listen");
const btnSendFile = document.getElementById("sendFile");
const msgInput = document.getElementById("msgtosend");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const profileSelect = document.getElementById("profileSelect");
const statusEl = document.getElementById("status");
const receivedList = document.getElementById("receivedList");

const START = "\u0002";
const END = "\u0003";
const MAX_BASE64_CHARS = 24000;

let isReady = false;
let transmitter = null;
let receiverInstance = null;
let receiverActive = false;
let currentProfile = "hello-world-loud";
let rxBuffer = "";

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
    fileInput.disabled = !ready;
}

async function loadProfiles() {
    try {
        const res = await fetch("./quiet-profiles.json");
        const text = await res.text();
        const data = JSON.parse(text);
        const keys = Object.keys(data);
        const preferred = [
            "hello-world-loud",
            "hello-world",
            "audible",
            "audible-7k-channel-0",
            "audible-7k-channel-1"
        ];
        const ordered = [
            ...preferred.filter((k) => keys.includes(k)),
            ...keys.filter((k) => !preferred.includes(k))
        ];

        profileSelect.innerHTML = "";
        ordered.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            profileSelect.appendChild(opt);
        });

        if (!ordered.includes(currentProfile)) {
            currentProfile = ordered[0];
        }
        profileSelect.value = currentProfile;
    } catch (err) {
        console.warn("Failed to load profiles:", err);
        profileSelect.innerHTML = "<option value=\"audible\">audible</option>";
        currentProfile = "audible";
    }
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
    transmitter = Quiet.transmitter({ profile: currentProfile });
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
    transmitter.transmit(Quiet.str2ab(framed));
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
        } catch (err) {
            console.warn("Failed to parse message:", err);
        }

        startIdx = rxBuffer.indexOf(START);
    }
}

function renderMessage(msg) {
    if (msg.type === "text") {
        appendMessage("Text", document.createTextNode(msg.text || ""));
        return;
    }

    if (msg.type === "file") {
        const blob = base64ToBlob(msg.data, msg.mime || "application/octet-stream");
        const url = URL.createObjectURL(blob);
        const wrapper = document.createElement("div");

        if ((msg.mime || "").startsWith("image/")) {
            const img = document.createElement("img");
            img.src = url;
            wrapper.appendChild(img);
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
    sendEnvelope({ type: "text", text });
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
        setStatus("Compressing file…");
        const envelope = await prepareFileEnvelope(file);
        sendEnvelope(envelope);
        setStatus("File queued", "ok");
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
        setStatus("Listening…", "ok");
        return;
    }

    resetReceiver();
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
    setStatus(`Profile set to ${currentProfile}`, "ok");
});

loadProfiles();
waitForQuiet();
