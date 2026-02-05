export const state = {
    isReady: false,
    transmitter: null,
    receiverInstance: null,
    receiverActive: false,
    currentProfile: "hello-world-loud",
    rxBuffer: "",
    vizMode: "waveform",
    vizStream: null,
    vizAudioCtx: null,
    vizAnalyser: null,
    vizAnimationId: null,
    profileMeta: {}
};
