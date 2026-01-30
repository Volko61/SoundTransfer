import { profileSelect, profileHint } from "./dom.js";
import { state } from "./state.js";

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

export function updateProfileHint() {
    const desc = PROFILE_DESCRIPTIONS[state.currentProfile] || "Pick a profile based on audibility vs reliability.";
    const profile = state.profileMeta[state.currentProfile];
    const details = profile ? describeProfileDetailed(profile) : "";
    profileHint.textContent = `${state.currentProfile}: ${desc}${details ? ` • ${details}` : ""}`;
}

export async function loadProfiles() {
    try {
        const res = await fetch("./quiet-profiles.json");
        const text = await res.text();
        const data = JSON.parse(text);
        state.profileMeta = data;
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

        if (!ordered.includes(state.currentProfile)) {
            state.currentProfile = ordered[0];
        }
        state.currentProfile = "ultra-fast";
        profileSelect.value = state.currentProfile;
        updateProfileHint();
    } catch (err) {
        console.warn("Failed to load profiles:", err);
        profileSelect.innerHTML = "<option value=\"audible\">audible — fast but robust + audible</option>";
        state.currentProfile = "audible";
        updateProfileHint();
    }
}

export function formatProfileOption(name) {
    const profile = state.profileMeta[name];
    const hintText = profile ? describeProfile(profile) : "custom profile";
    return `${name} — ${hintText}`;
}

export function describeProfile(profile) {
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

export function describeProfileDetailed(profile) {
    const frame = Number(profile.frame_length || 0);
    const sps = Number(profile.interpolation?.samples_per_symbol || 0);
    const mod = profile.mod_scheme || "unknown";
    const fec = `${profile.inner_fec_scheme || "none"}/${profile.outer_fec_scheme || "none"}`;
    const freq = Number(profile.modulation?.center_frequency || 0);
    const gain = Number(profile.modulation?.gain || 0);
    const freqLabel = freq ? `${freq} Hz` : "n/a";
    return `mod ${mod}, FEC ${fec}, frame ${frame}, sps ${sps || "n/a"}, freq ${freqLabel}, gain ${gain}`;
}

export function getProfileBps(profile) {
    // Get from our estimates, or calculate from profile metadata
    if (PROFILE_BPS[profile]) return PROFILE_BPS[profile];
    const meta = state.profileMeta[profile];
    if (meta) {
        const frame = Number(meta.frame_length || 64);
        const sps = Number(meta.interpolation?.samples_per_symbol || 10);
        // Rough estimate: higher frame, lower sps = faster
        return Math.max(20, Math.min(500, (frame / sps) * 5));
    }
    return 80; // Default fallback
}
