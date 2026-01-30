import { pixelDrawToggle } from "./dom.js";
import { formatBytes, replaceExtension, bytesToBase64, base64ToBytes, loadImage } from "./utils.js";
import { IMAGE_STREAM_MAX_DIM, IMAGE_STREAM_CHUNK_BYTES } from "./constants.js";

const imageStreamSessions = new Map();

export function handleImageStreamStart(msg) {
    if (!msg.id || !Number.isFinite(msg.width) || !Number.isFinite(msg.height)) return null;
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

    return wrapper;
}

export function handleImageStreamChunk(msg) {
    const session = imageStreamSessions.get(msg.id);
    if (!session || typeof msg.data !== "string" || !Number.isFinite(msg.offset)) return;

    const bytes = base64ToBytes(msg.data);
    const data = session.imageData.data;

    data.set(bytes, msg.offset);
    session.receivedBytes += bytes.length;

    if (pixelDrawToggle.checked) {
        // Draw pixel immediately upon receipt
        drawPixelImmediate(session, bytes, msg.offset);
    }
}

export function handleImageStreamEnd(msg) {
    const session = imageStreamSessions.get(msg.id);
    if (!session) return;

    if (!pixelDrawToggle.checked) {
        session.ctx.putImageData(session.imageData, 0, 0);
    }
    imageStreamSessions.delete(msg.id);
}

function drawPixelImmediate(session, bytes, offset) {
    const ctx = session.ctx;
    const width = session.width;

    // Each chunk should be exactly 4 bytes (one RGBA pixel) when pixel draw is enabled
    // Draw immediately upon receipt
    for (let i = 0; i < bytes.length; i += 4) {
        const pixelIdx = (offset + i) / 4;
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);
        const r = bytes[i];
        const g = bytes[i + 1];
        const b = bytes[i + 2];
        const a = bytes[i + 3];
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        ctx.fillRect(x, y, 1, 1);
    }
}

export function drawImagePixelByPixel(url, canvas) {
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

export async function prepareImageStreamEnvelopes(file) {
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

    // Use 4 bytes per chunk (one pixel) when pixel draw is enabled for true pixel-by-pixel streaming
    const chunkSize = pixelDrawToggle.checked ? 4 : IMAGE_STREAM_CHUNK_BYTES;

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

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
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
