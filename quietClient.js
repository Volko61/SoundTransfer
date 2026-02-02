import { state } from "./state.js";
import { setStatus, setUiReady } from "./utils.js";
import { startProgress, finishProgress } from "./progress.js";
import { START, END } from "./constants.js";
import { renderMessage } from "./renderer.js";

let pendingSendResolve = null;
let sendQueue = Promise.resolve();

export function initQuiet() {
    setUiReady(false);
    setStatus("Starting…");

    Quiet.init({
        profilesPrefix: "./",
        memoryInitializerPrefix: "./",
        libfecPrefix: "./",
        onReady: () => {
            state.isReady = true;
            createTransmitter();
            setUiReady(true);
        },
        onError: (reason) => {
            console.error("Quiet init failed:", reason);
            setUiReady(false);
            setStatus("Couldn’t start", "error");
        }
    });
}

export function waitForQuiet(remaining = 50) {
    if (window.Quiet) {
        initQuiet();
        return;
    }
    if (remaining <= 0) {
        console.error("Quiet.js did not load.");
        setUiReady(false);
        setStatus("Audio engine didn’t load", "error");
        return;
    }
    window.setTimeout(() => waitForQuiet(remaining - 1), 100);
}

export function createTransmitter() {
    if (!state.isReady) return;
    if (state.transmitter && state.transmitter.destroy) {
        state.transmitter.destroy();
    }
    state.transmitter = Quiet.transmitter({
        profile: state.currentProfile,
        onFinish: () => {
            if (pendingSendResolve) {
                pendingSendResolve();
                pendingSendResolve = null;
            }
            finishProgress();
        }
    });
}

export function resetReceiver() {
    if (state.receiverInstance && state.receiverInstance.destroy) {
        state.receiverInstance.destroy();
    }
    state.receiverInstance = null;
    state.receiverActive = false;
}

export function ensureReceiver() {
    if (state.receiverInstance) return;

    state.receiverInstance = Quiet.receiver({
        profile: state.currentProfile,
        onReceive: (payload) => {
            if (!state.receiverActive) return;
            handleIncomingPayload(payload);
        },
        onCreate: () => {
            setStatus("Listening", "ok");
        },
        onCreateFail: (reason) => {
            console.error("Receiver create failed:", reason);
            setStatus("Microphone blocked", "error");
        },
        onReceiveFail: (totalFails) => {
            console.warn("Receiver checksum fails:", totalFails);
        }
    });
}

export function sendEnvelope(envelope) {
    if (!state.isReady || !state.transmitter) return;
    const payload = JSON.stringify(envelope);
    const framed = `${START}${payload}${END}`;
    startProgress(framed.length);
    state.transmitter.transmit(Quiet.str2ab(framed));
}

export function sendEnvelopeAsync(envelope) {
    if (!state.isReady || !state.transmitter) return Promise.resolve();
    return new Promise((resolve) => {
        pendingSendResolve = resolve;
        sendEnvelope(envelope);
    });
}

export function queueEnvelope(envelope) {
    sendQueue = sendQueue.then(() => sendEnvelopeAsync(envelope));
    return sendQueue;
}

function handleIncomingPayload(payload) {
    const chunk = Quiet.ab2str(payload);
    state.rxBuffer += chunk;

    if (state.rxBuffer.length > 200000) {
        state.rxBuffer = state.rxBuffer.slice(-200000);
    }

    let startIdx = state.rxBuffer.indexOf(START);
    while (startIdx !== -1) {
        const endIdx = state.rxBuffer.indexOf(END, startIdx + 1);
        if (endIdx === -1) {
            state.rxBuffer = state.rxBuffer.slice(startIdx);
            break;
        }

        const jsonStr = state.rxBuffer.slice(startIdx + 1, endIdx);
        state.rxBuffer = state.rxBuffer.slice(endIdx + 1);

        try {
            const msg = JSON.parse(jsonStr);

            renderMessage(msg);
            setStatus("Got it", "ok");
        } catch (err) {
            console.warn("Failed to parse message:", err);
            setStatus("Couldn’t read the data", "error");
        }

        startIdx = state.rxBuffer.indexOf(START);
    }
}
