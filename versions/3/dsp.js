/**
 * Digital Signal Processing Module for SSTV Decoding
 * Based on xdsopl/robot36 and smolgroot/sstv-decoder
 * 
 * Signal Processing Chain:
 * 1. Baseband Conversion: Complex multiplication at center frequency (1900 Hz)
 * 2. Lowpass Filter: Kaiser-windowed FIR filter (2ms length, 900 Hz cutoff)
 * 3. FM Demodulation: Phase difference detection
 * 4. Sync Detection: Schmitt trigger detecting frequency drops to 1200 Hz
 * 5. Line Decoding: Bidirectional exponential moving average filtering
 */

// ===================== Complex Number =====================
class Complex {
    constructor(real = 0, imag = 0) {
        this.real = real;
        this.imag = imag;
    }

    set(real, imag = 0) {
        this.real = real;
        this.imag = imag;
        return this;
    }

    mul(other) {
        const real = this.real * other.real - this.imag * other.imag;
        const imag = this.real * other.imag + this.imag * other.real;
        return new Complex(real, imag);
    }

    conj() {
        return new Complex(this.real, -this.imag);
    }

    arg() {
        return Math.atan2(this.imag, this.real);
    }
}

// ===================== Phasor (Local Oscillator) =====================
class Phasor {
    constructor(frequency, sampleRate) {
        this.phase = 0;
        this.deltaPhase = (2 * Math.PI * frequency) / sampleRate;
    }

    rotate() {
        const result = new Complex(Math.cos(this.phase), Math.sin(this.phase));
        this.phase += this.deltaPhase;
        // Keep phase in range [-PI, PI]
        while (this.phase > Math.PI) this.phase -= 2 * Math.PI;
        while (this.phase < -Math.PI) this.phase += 2 * Math.PI;
        return result;
    }

    reset() {
        this.phase = 0;
    }
}

// ===================== FM Demodulator =====================
class FrequencyModulation {
    constructor(bandwidth, sampleRate) {
        // Scale factor: converts phase difference to normalized frequency
        // Output range will be approximately [-1, +1] for the bandwidth
        this.scale = sampleRate / (bandwidth * Math.PI);
        this.prev = 0;
    }

    wrap(value) {
        if (value < -Math.PI) return value + 2 * Math.PI;
        if (value > Math.PI) return value - 2 * Math.PI;
        return value;
    }

    /**
     * Demodulate complex baseband signal to frequency
     * Returns normalized frequency value
     */
    demod(sample) {
        const phase = sample.arg();
        const delta = this.wrap(phase - this.prev);
        this.prev = phase;
        return this.scale * delta;
    }

    reset() {
        this.prev = 0;
    }
}

// ===================== Schmitt Trigger =====================
class SchmittTrigger {
    constructor(lowThreshold, highThreshold) {
        this.lowThreshold = lowThreshold;
        this.highThreshold = highThreshold;
        this.state = false;
    }

    /**
     * Returns false when value is below low threshold (sync pulse active)
     * Returns true when value is above high threshold (no sync pulse)
     */
    latch(value) {
        if (value < this.lowThreshold) {
            this.state = false;
        } else if (value > this.highThreshold) {
            this.state = true;
        }
        return this.state;
    }

    reset() {
        this.state = false;
    }
}

// ===================== Exponential Moving Average =====================
class ExponentialMovingAverage {
    constructor() {
        this.alpha = 1;
        this.prev = 0;
    }

    /**
     * Configure the filter cutoff frequency
     * @param freq Cutoff frequency (number of output pixels)
     * @param rate Sample rate (number of input samples)
     * @param order Filter order (number of passes)
     */
    cutoff(freq, rate, order) {
        const x = Math.cos(2 * Math.PI * freq / rate);
        const alphaBase = x - 1 + Math.sqrt(x * (x - 4) + 3);
        this.alpha = Math.pow(alphaBase, 1.0 / order);
    }

    avg(value) {
        this.prev = this.prev * (1 - this.alpha) + this.alpha * value;
        return this.prev;
    }

    reset() {
        this.prev = 0;
    }
}

// ===================== Simple Moving Average =====================
class SimpleMovingAverage {
    constructor(length) {
        this.length = length;
        this.buffer = new Float32Array(length);
        this.index = 0;
        this.sum = 0;
        this.count = 0;
    }

    avg(value) {
        this.sum -= this.buffer[this.index];
        this.sum += value;
        this.buffer[this.index] = value;
        this.index = (this.index + 1) % this.length;
        if (this.count < this.length) {
            this.count++;
        }
        return this.sum / this.count;
    }

    reset() {
        this.buffer.fill(0);
        this.index = 0;
        this.sum = 0;
        this.count = 0;
    }
}

// ===================== Kaiser Window =====================
class Kaiser {
    constructor() {
        // i0(x) converges for x inside -3*Pi:3*Pi in less than 35 iterations
        this.summands = new Float64Array(35);
    }

    square(value) {
        return value * value;
    }

    /**
     * Zero-th order modified Bessel function of the first kind
     */
    i0(x) {
        this.summands[0] = 1;
        let val = 1;
        for (let n = 1; n < this.summands.length; n++) {
            val *= x / (2 * n);
            this.summands[n] = this.square(val);
        }
        // Sort for numerical stability
        this.summands.sort((a, b) => a - b);
        let sum = 0;
        for (let n = this.summands.length - 1; n >= 0; n--) {
            sum += this.summands[n];
        }
        return sum;
    }

    /**
     * Kaiser window function
     * @param a Shape parameter
     * @param n Sample index
     * @param N Window length
     */
    window(a, n, N) {
        return this.i0(Math.PI * a * Math.sqrt(1 - this.square((2.0 * n) / (N - 1) - 1))) / this.i0(Math.PI * a);
    }
}

// ===================== FIR Filter Utilities =====================
class Filter {
    static sinc(x) {
        if (x === 0) return 1;
        const px = x * Math.PI;
        return Math.sin(px) / px;
    }

    static lowPass(cutoff, rate, n, N) {
        const f = 2 * cutoff / rate;
        const x = n - (N - 1) / 2.0;
        return f * Filter.sinc(f * x);
    }
}

// ===================== Complex Convolution (FIR Filter) =====================
class ComplexConvolution {
    constructor(length) {
        this.length = length;
        this.taps = new Float32Array(length);
        this.real = new Float32Array(length);
        this.imag = new Float32Array(length);
        this.sum = new Complex();
        this.pos = 0;
    }

    push(input) {
        this.real[this.pos] = input.real;
        this.imag[this.pos] = input.imag;
        if (++this.pos >= this.length) {
            this.pos = 0;
        }
        this.sum.real = 0;
        this.sum.imag = 0;
        let readPos = this.pos;
        for (const tap of this.taps) {
            this.sum.real += tap * this.real[readPos];
            this.sum.imag += tap * this.imag[readPos];
            if (++readPos >= this.length) {
                readPos = 0;
            }
        }
        return this.sum;
    }

    reset() {
        this.real.fill(0);
        this.imag.fill(0);
        this.pos = 0;
    }

    /**
     * Create Kaiser-windowed lowpass FIR filter
     */
    static createLowPassFilter(length, cutoffFrequency, sampleRate) {
        const filter = new ComplexConvolution(length);
        const kaiser = new Kaiser();
        for (let i = 0; i < filter.length; i++) {
            filter.taps[i] = kaiser.window(2.0, i, filter.length) * Filter.lowPass(cutoffFrequency, sampleRate, i, filter.length);
        }
        return filter;
    }
}

// ===================== Delay Line =====================
class Delay {
    constructor(length) {
        this.length = length;
        this.buffer = new Float32Array(length);
        this.index = 0;
    }

    push(value) {
        const delayed = this.buffer[this.index];
        this.buffer[this.index] = value;
        this.index = (this.index + 1) % this.length;
        return delayed;
    }

    reset() {
        this.buffer.fill(0);
        this.index = 0;
    }
}

// ===================== SSTV Mode Definitions =====================
const SSTVModes = {
    ROBOT36: {
        name: 'Robot36',
        syncMinMs: 7,
        syncMaxMs: 11,
        syncTypicalMs: 9,
        lineTimeMs: 150
    },
    ROBOT72: {
        name: 'Robot72',
        syncMinMs: 7,
        syncMaxMs: 11,
        syncTypicalMs: 9,
        lineTimeMs: 150
    },
    PD90: {
        name: 'PD90',
        syncMinMs: 18,
        syncMaxMs: 25,
        syncTypicalMs: 20,
        lineTimeMs: 170
    },
    PD120: {
        name: 'PD120',
        syncMinMs: 18,
        syncMaxMs: 25,
        syncTypicalMs: 20,
        lineTimeMs: 190
    },
    PD180: {
        name: 'PD180',
        syncMinMs: 18,
        syncMaxMs: 25,
        syncTypicalMs: 20,
        lineTimeMs: 240
    },
    PD240: {
        name: 'PD240',
        syncMinMs: 18,
        syncMaxMs: 25,
        syncTypicalMs: 20,
        lineTimeMs: 290
    }
};

// ===================== SSTV Signal Processor =====================
/**
 * Main DSP class that processes raw audio samples and outputs
 * demodulated frequency values suitable for SSTV decoding.
 * 
 * Real-time Audio Processing Chain:
 * 1. Microphone input capture via Web Audio API
 * 2. Sample rate auto-detection (44.1 kHz or 48 kHz)
 * 3. FM demodulation with complex baseband conversion
 * 4. Kaiser-windowed FIR lowpass filtering (2ms, 900 Hz cutoff)
 * 5. Schmitt trigger sync detection with hysteresis
 * 6. Multi-mode sync pulse detection (Robot36: 9ms, PD modes: 20ms)
 */
class SSTVSignalProcessor {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;

        // Log detected sample rate
        this.detectedSampleRate = this._detectSampleRate(sampleRate);
        console.log(`[DSP] Audio sample rate detected: ${this.detectedSampleRate}`);
        console.log(`[DSP] Actual sample rate: ${sampleRate} Hz`);

        // SSTV frequency parameters
        this.centerFrequency = 1900; // Hz - midpoint of SSTV range
        this.bandwidth = 800;         // Hz - range from 1500 (black) to 2300 (white)

        // Local oscillator for baseband conversion at center frequency
        this.phasor = new Phasor(this.centerFrequency, sampleRate);

        // Kaiser-windowed FIR lowpass filter
        // Filter length: 2ms worth of samples for optimal response
        const filterLength = Math.round(sampleRate * 0.002);
        const cutoffFrequency = 900; // Hz - passes SSTV signal, rejects noise
        this.lowpassFilter = ComplexConvolution.createLowPassFilter(filterLength, cutoffFrequency, sampleRate);
        console.log(`[DSP] FIR filter: ${filterLength} taps, ${cutoffFrequency}Hz cutoff`);

        // FM demodulator for frequency extraction
        this.fmDemod = new FrequencyModulation(this.bandwidth, sampleRate);

        // Schmitt trigger for sync detection with hysteresis
        // Sync at 1200 Hz = normalized (1200 - 1900) / 400 = -1.75
        // Low threshold: ~1275 Hz, High threshold: ~1350 Hz
        this.syncTrigger = new SchmittTrigger(-1.563, -1.375);

        // Sync pulse timing and mode detection
        this.syncStartSample = -1;
        this.syncPulses = [];
        this.totalSamples = 0;

        // Mode detection state
        this.detectedMode = null;
        this.modePulseCount = 0;
        this.modeConfidence = 0;
    }

    /**
     * Detect if sample rate is 44.1kHz or 48kHz
     */
    _detectSampleRate(sampleRate) {
        if (Math.abs(sampleRate - 44100) < 100) {
            return '44.1 kHz';
        } else if (Math.abs(sampleRate - 48000) < 100) {
            return '48 kHz';
        } else if (Math.abs(sampleRate - 22050) < 100) {
            return '22.05 kHz';
        } else if (Math.abs(sampleRate - 96000) < 100) {
            return '96 kHz';
        } else {
            return `${(sampleRate / 1000).toFixed(1)} kHz (non-standard)`;
        }
    }

    /**
     * Identify SSTV mode from sync pulse duration
     */
    _identifyMode(syncDurationMs) {
        for (const [modeName, mode] of Object.entries(SSTVModes)) {
            if (syncDurationMs >= mode.syncMinMs && syncDurationMs <= mode.syncMaxMs) {
                return { name: modeName, ...mode };
            }
        }
        return null;
    }

    /**
     * Process a single audio sample
     * @param sample Raw audio sample (-1 to +1)
     * @returns Object with demodulated frequency and sync state
     */
    processSample(sample) {
        // Step 1: Baseband conversion
        // Multiply by complex local oscillator to shift center frequency to DC
        const lo = this.phasor.rotate();
        const baseband = new Complex(sample * lo.real, sample * (-lo.imag)); // Conjugate for downconversion

        // Step 2: Lowpass filter
        const filtered = this.lowpassFilter.push(baseband);

        // Step 3: FM demodulation
        const frequency = this.fmDemod.demod(filtered);

        // Step 4: Sync detection
        const wasInSync = !this.syncTrigger.state;
        const notInSync = this.syncTrigger.latch(frequency);
        const inSync = !notInSync;

        // Detect sync pulse edges
        if (inSync && !wasInSync) {
            // Rising edge of sync (entering sync)
            this.syncStartSample = this.totalSamples;
        } else if (!inSync && wasInSync && this.syncStartSample >= 0) {
            // Falling edge of sync (leaving sync)
            const syncDuration = this.totalSamples - this.syncStartSample;
            const syncDurationMs = syncDuration / this.sampleRate * 1000;

            // Detect mode from sync pulse duration
            // Robot36/Robot72: 7-11ms (typical 9ms)
            // PD90/PD120/PD180/PD240: 18-25ms (typical 20ms)
            const isRobotSync = syncDurationMs >= 7 && syncDurationMs <= 15;
            const isPDSync = syncDurationMs >= 17 && syncDurationMs <= 27;

            if (isRobotSync || isPDSync) {
                // Identify the mode
                const identifiedMode = this._identifyMode(syncDurationMs);

                // Update mode detection confidence
                if (identifiedMode) {
                    if (this.detectedMode === identifiedMode.name) {
                        this.modePulseCount++;
                        if (this.modePulseCount >= 3) {
                            this.modeConfidence = Math.min(1.0, this.modeConfidence + 0.1);
                        }
                    } else {
                        this.detectedMode = identifiedMode.name;
                        this.modePulseCount = 1;
                        this.modeConfidence = 0.3;
                        console.log(`[DSP] Detected SSTV mode: ${identifiedMode.name} (sync: ${syncDurationMs.toFixed(1)}ms)`);
                    }
                }

                this.syncPulses.push({
                    startSample: this.syncStartSample,
                    endSample: this.totalSamples,
                    durationMs: syncDurationMs,
                    mode: identifiedMode ? identifiedMode.name : 'UNKNOWN',
                    isRobotMode: isRobotSync,
                    isPDMode: isPDSync
                });
            }
            this.syncStartSample = -1;
        }

        this.totalSamples++;

        return {
            frequency: frequency,
            inSync: inSync,
            sampleIndex: this.totalSamples - 1,
            detectedMode: this.detectedMode,
            modeConfidence: this.modeConfidence
        };
    }

    /**
     * Process an array of audio samples
     * @param samples Float32Array of audio samples
     * @returns Float32Array of demodulated frequency values
     */
    processBuffer(samples) {
        const output = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const result = this.processSample(samples[i]);
            output[i] = result.frequency;
        }
        return output;
    }

    /**
     * Get and clear detected sync pulses
     */
    getSyncPulses() {
        const pulses = this.syncPulses;
        this.syncPulses = [];
        return pulses;
    }

    /**
     * Get current detected mode and confidence
     */
    getDetectedMode() {
        return {
            mode: this.detectedMode,
            confidence: this.modeConfidence,
            modeInfo: this.detectedMode ? SSTVModes[this.detectedMode] : null
        };
    }

    /**
     * Get sample rate information
     */
    getSampleRateInfo() {
        return {
            actual: this.sampleRate,
            detected: this.detectedSampleRate
        };
    }

    reset() {
        this.phasor.reset();
        this.lowpassFilter.reset();
        this.fmDemod.reset();
        this.syncTrigger.reset();
        this.syncStartSample = -1;
        this.syncPulses = [];
        this.totalSamples = 0;
        this.detectedMode = null;
        this.modePulseCount = 0;
        this.modeConfidence = 0;
    }
}

// ===================== Robot36 Line Decoder =====================
class Robot36LineDecoder {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.horizontalPixels = 320;
        this.verticalPixels = 240;

        // Robot36 timing in seconds
        const syncPulseSeconds = 0.009;
        const syncPorchSeconds = 0.003;
        const luminanceSeconds = 0.088;
        const separatorSeconds = 0.0045;
        const porchSeconds = 0.0015;
        const chrominanceSeconds = 0.044;

        // Convert to samples
        this.luminanceSamples = Math.round(luminanceSeconds * sampleRate);
        this.separatorSamples = Math.round(separatorSeconds * sampleRate);
        this.chrominanceSamples = Math.round(chrominanceSeconds * sampleRate);

        this.luminanceBeginSamples = Math.round(syncPorchSeconds * sampleRate);
        this.separatorBeginSamples = Math.round((syncPorchSeconds + luminanceSeconds) * sampleRate);
        this.chrominanceBeginSamples = Math.round((syncPorchSeconds + luminanceSeconds + separatorSeconds + porchSeconds) * sampleRate);
        this.endSamples = Math.round((syncPorchSeconds + luminanceSeconds + separatorSeconds + porchSeconds + chrominanceSeconds) * sampleRate);

        this.lowPassFilter = new ExponentialMovingAverage();
        this.evenLinePixels = new Uint8ClampedArray(this.horizontalPixels * 4);
        this.lastEven = false;
    }

    /**
     * Convert normalized frequency (-1 to +1) to level (0 to 1)
     * Input: -0.5 (black/1500Hz) to +0.5 (white/2300Hz) approximately
     */
    freqToLevel(frequency, offset) {
        // Map from [-0.5, 0.5] to [0, 1]
        // Clamp to prevent artifacts
        const level = 0.5 * (frequency - offset + 1.0);
        return Math.max(0, Math.min(1, level));
    }

    /**
     * Convert YUV to RGB using ITU-R BT.601
     */
    yuv2rgb(y, u, v) {
        const yAdj = y - 16;
        const uAdj = u - 128;
        const vAdj = v - 128;

        const r = Math.max(0, Math.min(255, ((298 * yAdj + 409 * vAdj + 128) >> 8)));
        const g = Math.max(0, Math.min(255, ((298 * yAdj - 100 * uAdj - 208 * vAdj + 128) >> 8)));
        const b = Math.max(0, Math.min(255, ((298 * yAdj + 516 * uAdj + 128) >> 8)));

        return { r, g, b };
    }

    /**
     * Decode a single Robot36 scan line
     * @param scanLineBuffer Demodulated frequency values for the entire line
     * @param syncPulseIndex Index where sync porch starts (after sync pulse)
     * @param frequencyOffset Frequency calibration offset
     * @param expectedEven Optional hint about expected line parity
     * @returns Decoded line data
     */
    decodeScanLine(scanLineBuffer, syncPulseIndex, frequencyOffset = 0, expectedEven = null) {
        // Check buffer bounds
        if (syncPulseIndex + this.endSamples > scanLineBuffer.length) {
            return null;
        }

        // Compensate for FIR filter group delay (~1ms at typical sample rates)
        // This shifts timing to better align with actual signal positions
        const groupDelayCompensation = Math.round(this.sampleRate * 0.001);

        // Detect even/odd line by examining separator pulse frequency
        // Sample from the middle of the separator pulse for more reliable detection
        let separator = 0;
        let validSamples = 0;
        const separatorMidpoint = syncPulseIndex + this.separatorBeginSamples - groupDelayCompensation + Math.floor(this.separatorSamples / 2);
        const halfWindow = Math.floor(this.separatorSamples / 4);

        for (let i = separatorMidpoint - halfWindow; i < separatorMidpoint + halfWindow && i < scanLineBuffer.length; i++) {
            if (i < 0) continue;
            const val = scanLineBuffer[i];
            // Only count samples that are in valid frequency range
            if (val > -2 && val < 2) {
                separator += val;
                validSamples++;
            }
        }

        if (validSamples > 0) {
            separator /= validSamples;
        }
        separator -= frequencyOffset;

        // Separator frequency determines even (R-Y) vs odd (B-Y) line
        // Even line: 1500 Hz = normalized ~ -1.0 (negative)
        // Odd line: 2300 Hz = normalized ~ +1.0 (positive)
        let even;
        if (separator < -0.3) {
            even = true;
        } else if (separator > 0.3) {
            even = false;
        } else {
            // Ambiguous separator - use expected parity hint if available, otherwise alternate
            if (expectedEven !== null) {
                even = expectedEven;
                console.log(`Ambiguous separator: ${separator.toFixed(2)}, using expected parity: ${even ? 'even' : 'odd'}`);
            } else {
                even = !this.lastEven;
                console.log(`Ambiguous separator: ${separator.toFixed(2)}, using alternation`);
            }
        }
        this.lastEven = even;

        // Apply bidirectional low-pass filter
        const scratchBuffer = new Float32Array(this.endSamples);

        // Configure filter for horizontal resolution
        this.lowPassFilter.cutoff(this.horizontalPixels, 2 * this.luminanceSamples, 2);
        this.lowPassFilter.reset();

        // Forward pass
        for (let i = this.luminanceBeginSamples; i < this.endSamples; i++) {
            scratchBuffer[i] = this.lowPassFilter.avg(scanLineBuffer[syncPulseIndex + i]);
        }

        // Backward pass
        this.lowPassFilter.reset();
        for (let i = this.endSamples - 1; i >= this.luminanceBeginSamples; i--) {
            scratchBuffer[i] = this.freqToLevel(this.lowPassFilter.avg(scratchBuffer[i]), frequencyOffset);
        }

        // Decode pixels
        const pixels = new Uint8ClampedArray(this.horizontalPixels * 4 * 2);

        // Extract Y and chroma values with interpolation for smoother results
        const rawY = new Float32Array(this.horizontalPixels);
        const rawChroma = new Float32Array(this.horizontalPixels);

        for (let i = 0; i < this.horizontalPixels; i++) {
            // Use floating point position for interpolation
            const luminanceFrac = (i * this.luminanceSamples) / this.horizontalPixels;
            const chrominanceFrac = (i * this.chrominanceSamples) / this.horizontalPixels;

            const luminancePos = this.luminanceBeginSamples + Math.floor(luminanceFrac);
            const chrominancePos = this.chrominanceBeginSamples + Math.floor(chrominanceFrac);

            // Linear interpolation for luminance
            const lumT = luminanceFrac - Math.floor(luminanceFrac);
            const lumPos1 = Math.min(luminancePos, scratchBuffer.length - 1);
            const lumPos2 = Math.min(luminancePos + 1, scratchBuffer.length - 1);
            const yRaw = scratchBuffer[lumPos1] * (1 - lumT) + scratchBuffer[lumPos2] * lumT;

            // Linear interpolation for chroma
            const chromaT = chrominanceFrac - Math.floor(chrominanceFrac);
            const chromaPos1 = Math.min(chrominancePos, scratchBuffer.length - 1);
            const chromaPos2 = Math.min(chrominancePos + 1, scratchBuffer.length - 1);
            const chromaRaw = scratchBuffer[chromaPos1] * (1 - chromaT) + scratchBuffer[chromaPos2] * chromaT;

            rawY[i] = Math.max(0, Math.min(1, yRaw)) * 255;
            rawChroma[i] = Math.max(0, Math.min(1, chromaRaw)) * 255;
        }

        // Apply 3-pixel median filter to luminance to reduce noise
        const filteredY = new Float32Array(this.horizontalPixels);
        for (let i = 0; i < this.horizontalPixels; i++) {
            const i1 = Math.max(0, i - 1);
            const i2 = i;
            const i3 = Math.min(this.horizontalPixels - 1, i + 1);
            const values = [rawY[i1], rawY[i2], rawY[i3]];
            values.sort((a, b) => a - b);
            filteredY[i] = values[1];
        }

        // Apply 5-pixel median filter to chroma
        const filteredChroma = new Float32Array(this.horizontalPixels);
        for (let i = 0; i < this.horizontalPixels; i++) {
            const i1 = Math.max(0, i - 2);
            const i2 = Math.max(0, i - 1);
            const i3 = i;
            const i4 = Math.min(this.horizontalPixels - 1, i + 1);
            const i5 = Math.min(this.horizontalPixels - 1, i + 2);

            const values = [rawChroma[i1], rawChroma[i2], rawChroma[i3], rawChroma[i4], rawChroma[i5]];
            values.sort((a, b) => a - b);
            filteredChroma[i] = values[2];
        }

        // Decode with color conversion
        const CHROMA_REDUCTION = 0.7;

        for (let i = 0; i < this.horizontalPixels; i++) {
            const y = Math.max(0, Math.min(255, Math.round(filteredY[i])));
            const chroma = Math.max(0, Math.min(255, Math.round(filteredChroma[i])));

            if (even) {
                // Even line: Y + R-Y (store for interlacing)
                this.evenLinePixels[i * 4] = y;
                this.evenLinePixels[i * 4 + 1] = 0;
                this.evenLinePixels[i * 4 + 2] = chroma;
                this.evenLinePixels[i * 4 + 3] = 255;
            } else {
                // Odd line: Y + B-Y, combine with previous even line
                const evenY = this.evenLinePixels[i * 4];
                let evenRY = this.evenLinePixels[i * 4 + 2];
                const oddY = y;
                let oddBY = chroma;

                // Reduce chroma saturation
                evenRY = 128 + (evenRY - 128) * CHROMA_REDUCTION;
                oddBY = 128 + (oddBY - 128) * CHROMA_REDUCTION;

                // Convert even line
                const evenRGB = this.yuv2rgb(evenY, oddBY, evenRY);
                pixels[i * 4] = evenRGB.r;
                pixels[i * 4 + 1] = evenRGB.g;
                pixels[i * 4 + 2] = evenRGB.b;
                pixels[i * 4 + 3] = 255;

                // Convert odd line
                const oddRGB = this.yuv2rgb(oddY, oddBY, evenRY);
                pixels[this.horizontalPixels * 4 + i * 4] = oddRGB.r;
                pixels[this.horizontalPixels * 4 + i * 4 + 1] = oddRGB.g;
                pixels[this.horizontalPixels * 4 + i * 4 + 2] = oddRGB.b;
                pixels[this.horizontalPixels * 4 + i * 4 + 3] = 255;
            }
        }

        return {
            pixels,
            width: this.horizontalPixels,
            height: even ? 0 : 2,
            isOddLine: !even
        };
    }

    reset() {
        this.lastEven = false;
        this.evenLinePixels.fill(0);
        this.lowPassFilter.reset();
    }
}

// Export for use in main application
window.SSTVDsp = {
    Complex,
    Phasor,
    FrequencyModulation,
    SchmittTrigger,
    ExponentialMovingAverage,
    SimpleMovingAverage,
    ComplexConvolution,
    Delay,
    SSTVSignalProcessor,
    Robot36LineDecoder,
    SSTVModes
};
