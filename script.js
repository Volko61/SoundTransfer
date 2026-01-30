import { btnSend, btnListen, btnSendFile, msgInput, fileInput, fileInfo, profileSelect, vizSelect, pixelDrawToggle } from "./dom.js";
import { state } from "./state.js";
import { setStatus, formatBytes } from "./utils.js";
import { loadProfiles, updateProfileHint } from "./profiles.js";
import { createTransmitter, ensureReceiver, resetReceiver, sendEnvelope, waitForQuiet } from "./quietClient.js";
import { prepareFileEnvelope } from "./fileTransfer.js";
import { prepareImageStreamEnvelopes } from "./imageStream.js";
import { startVisualizer, stopVisualizer, clearCanvas, setVizMode } from "./visualizer.js";

vizSelect.value = "spectrogram";
setVizMode("spectrogram");

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
        fileInfo.textContent = "";
        return;
    }
    fileInfo.textContent = `${file.name} • ${file.type || "unknown"} • ${formatBytes(file.size)}`;
});

btnSend.addEventListener("click", () => {
    if (!state.isReady || !state.transmitter) return;
    const text = msgInput.value.trim();
    if (!text) return;
    const envelope = { type: "text", text };

    sendEnvelope(envelope);
    setStatus("Text queued", "ok");
    msgInput.value = "";
});

btnSendFile.addEventListener("click", async () => {
    if (!state.isReady || !state.transmitter) return;
    const file = fileInput.files?.[0];
    if (!file) {
        setStatus("Choose a file first", "error");
        return;
    }

    try {
        if (file.type.startsWith("image/") && pixelDrawToggle.checked) {
            setStatus("Preparing pixel stream…");
            const envelopes = await prepareImageStreamEnvelopes(file);
            // Send all envelopes at once without waiting between each
            for (const envelope of envelopes) {
                sendEnvelope(envelope);
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
    if (!state.isReady) return;
    if (!state.receiverActive) {
        ensureReceiver();
        state.receiverActive = true;
        btnListen.textContent = "Stop Listening";
        startVisualizer();
        return;
    }

    resetReceiver();
    stopVisualizer();
    btnListen.textContent = "Listen";
    setStatus("Listening stopped", "info");
});

profileSelect.addEventListener("change", () => {
    state.currentProfile = profileSelect.value;
    createTransmitter();
    if (state.receiverActive) {
        resetReceiver();
        ensureReceiver();
        state.receiverActive = true;
        btnListen.textContent = "Stop Listening";
    }
    updateProfileHint();
    setStatus(`Profile set to ${state.currentProfile}`, "ok");
});

vizSelect.addEventListener("change", () => {
    setVizMode(vizSelect.value);
    clearCanvas();
});

loadProfiles();
updateProfileHint();
waitForQuiet();
