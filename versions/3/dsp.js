/**
 * DSP Module for SSTV Decoder
 * Based on xdsopl/robot36 implementation
 */

// ===================== Complex Numbers =====================

class Complex {
    constructor(real = 0, imag = 0) {
        this.real = real;
        this.imag = imag;
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

// ===================== Phasor (Rotating Oscillator) =====================

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
}

// ===================== FM Demodulator =====================

class FrequencyModulation {
    constructor(bandwidth, sampleRate) {
        this.scale = sampleRate / (bandwidth * Math.PI);
        this.prev = 0;
    }

    wrap(value) {
        if (value < -Math.PI) return value + 2 * Math.PI;
        if (value > Math.PI) return value - 2 * Math.PI;
        return value;
    }

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

// ===================== Schmitt Trigger =====================

class SchmittTrigger {
    constructor(lowThreshold, highThreshold) {
        this.lowThreshold = lowThreshold;
        this.highThreshold = highThreshold;
        this.state = false;
    }

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

// ===================== Exponential Moving Average =====================

class ExponentialMovingAverage {
    constructor() {
        this.alpha = 1;
        this.prev = 0;
    }

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

// ===================== Kaiser Window =====================

class Kaiser {
    constructor() {
        this.summands = new Float64Array(35);
    }

    square(value) {
        return value * value;
    }

    i0(x) {
        this.summands[0] = 1;
        let val = 1;
        for (let n = 1; n < this.summands.length; n++) {
            val *= x / (2 * n);
            this.summands[n] = this.square(val);
        }
        this.summands.sort((a, b) => a - b);
        let sum = 0;
        for (let n = this.summands.length - 1; n >= 0; n--) {
            sum += this.summands[n];
        }
        return sum;
    }

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

// ===================== Complex Convolution (Lowpass Filter) =====================

class ComplexConvolution {
    constructor(length) {
        this.length = length;
        this.taps = new Float32Array(length);
        this.realBuf = new Float32Array(length);
        this.imagBuf = new Float32Array(length);
        this.sum = new Complex();
        this.pos = 0;
    }

    push(input) {
        this.realBuf[this.pos] = input.real;
        this.imagBuf[this.pos] = input.imag;
        if (++this.pos >= this.length) {
            this.pos = 0;
        }
        this.sum.real = 0;
        this.sum.imag = 0;
        let readPos = this.pos;
        for (const tap of this.taps) {
            this.sum.real += tap * this.realBuf[readPos];
            this.sum.imag += tap * this.imagBuf[readPos];
            if (++readPos >= this.length) {
                readPos = 0;
            }
        }
        return this.sum;
    }

    static createLowPassFilter(length, cutoffFrequency, sampleRate) {
        const filter = new ComplexConvolution(length);
        const kaiser = new Kaiser();
        for (let i = 0; i < filter.length; i++) {
            filter.taps[i] = kaiser.window(2.0, i, filter.length) * Filter.lowPass(cutoffFrequency, sampleRate, i, filter.length);
        }
        return filter;
    }
}

// ===================== Goertzel Filter =====================

class GoertzelFilter {
    constructor(sampleRate, targetFreq) {
        this.sampleRate = sampleRate;
        this.targetFreq = targetFreq;
        const normalizedFreq = targetFreq / sampleRate;
        this.coefficient = 2 * Math.cos(2 * Math.PI * normalizedFreq);
        this.s1 = 0;
        this.s2 = 0;
    }

    processSample(sample) {
        const s0 = sample + this.coefficient * this.s1 - this.s2;
        this.s2 = this.s1;
        this.s1 = s0;
    }

    getMagnitude() {
        const real = this.s1 - this.s2 * Math.cos(2 * Math.PI * this.targetFreq / this.sampleRate);
        const imag = this.s2 * Math.sin(2 * Math.PI * this.targetFreq / this.sampleRate);
        return Math.sqrt(real * real + imag * imag);
    }

    reset() {
        this.s1 = 0;
        this.s2 = 0;
    }
}

// Export for use in other modules
window.DSP = {
    Complex,
    Phasor,
    FrequencyModulation,
    SimpleMovingAverage,
    SchmittTrigger,
    Delay,
    ExponentialMovingAverage,
    ComplexConvolution,
    GoertzelFilter
};
