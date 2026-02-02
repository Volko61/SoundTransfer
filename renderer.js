import { receivedList, pixelDrawToggle } from "./dom.js";
import { base64ToBlob, formatBytes } from "./utils.js";
import { handleImageStreamStart, handleImageStreamChunk, handleImageStreamEnd, drawImagePixelByPixel } from "./imageStream.js";

export function renderMessage(msg) {
    if (msg.type === "image-stream-start") {
        const wrapper = handleImageStreamStart(msg);
        if (wrapper) appendMessage("Image", wrapper);
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
        meta.style.fontSize = "12px";
        meta.style.color = "#999";
        meta.style.marginTop = "8px";
        const sizeText = `${formatBytes(msg.size || blob.size)}${msg.originalSize ? ` (original ${formatBytes(msg.originalSize)})` : ""}`;
        meta.textContent = `${msg.name || "file"} • ${msg.mime || blob.type} • ${sizeText}`;
        wrapper.appendChild(meta);

        appendMessage("File", wrapper);
        return;
    }
}

export function appendMessage(title, contentNode) {
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
