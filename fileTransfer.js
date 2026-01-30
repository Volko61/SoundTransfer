import { MAX_BASE64_CHARS } from "./constants.js";
import { arrayBufferToBase64, formatBytes, loadImage, replaceExtension } from "./utils.js";

export async function compressImage(file) {
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

export async function compressAudio(file) {
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

export async function compressVideo(file) {
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

export async function prepareFileEnvelope(file) {
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
