import { sendProgress, progressInfo } from "./dom.js";
import { state } from "./state.js";
import { formatBytes, formatTime } from "./utils.js";
import { getProfileBps } from "./profiles.js";

let progressState = null;
let progressTimer = null;

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

    progressInfo.innerHTML = `${dataSize} @ ${progressState.bps} B/s • ${elapsedStr} elapsed, ~${remainingStr} remaining`;
}

export function startProgress(length) {
    clearProgress();

    const bps = getProfileBps(state.currentProfile);
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

export function finishProgress() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
    setProgress(100);

    if (progressState) {
        const elapsed = Date.now() - progressState.startTime;
        const actualBps = Math.round(progressState.length / (elapsed / 1000));
        progressInfo.innerHTML = `✓ Sent ${formatBytes(progressState.length)} in ${formatTime(elapsed)} (${actualBps} B/s)`;
        progressState = null;
    }

    setTimeout(() => {
        setProgress(0);
        progressInfo.innerHTML = "";
    }, 3000);
}
