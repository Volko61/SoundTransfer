/**
 * Frequency Modulation Demodulator
 * Converts complex baseband signal to normalized frequency values
 * Based on xdsopl/robot36 FrequencyModulation.java
 */

export class Complex {
  real: number;
  imag: number;

  constructor(real = 0, imag = 0) {
    this.real = real;
    this.imag = imag;
  }

  set(real: number, imag = 0): Complex {
    this.real = real;
    this.imag = imag;
    return this;
  }

  mul(other: Complex): Complex {
    const real = this.real * other.real - this.imag * other.imag;
    const imag = this.real * other.imag + this.imag * other.real;
    return new Complex(real, imag);
  }

  conj(): Complex {
    return new Complex(this.real, -this.imag);
  }

  arg(): number {
    return Math.atan2(this.imag, this.real);
  }
}

export class Phasor {
  private phase: number = 0;
  private deltaPhase: number;

  constructor(frequency: number, sampleRate: number) {
    this.deltaPhase = (2 * Math.PI * frequency) / sampleRate;
  }

  rotate(): Complex {
    const result = new Complex(Math.cos(this.phase), Math.sin(this.phase));
    this.phase += this.deltaPhase;
    // Keep phase in range [-PI, PI]
    while (this.phase > Math.PI) this.phase -= 2 * Math.PI;
    while (this.phase < -Math.PI) this.phase += 2 * Math.PI;
    return result;
  }
}

export class FrequencyModulation {
  private prev: number;
  private scale: number;

  constructor(bandwidth: number, sampleRate: number) {
    // Scale factor from Java: sampleRate / (bandwidth * PI)
    // This converts phase difference to frequency deviation
    this.scale = sampleRate / (bandwidth * Math.PI);
    this.prev = 0;
  }

  private wrap(value: number): number {
    if (value < -Math.PI) return value + 2 * Math.PI;
    if (value > Math.PI) return value - 2 * Math.PI;
    return value;
  }

  /**
   * Demodulate complex baseband signal to frequency
   * Returns instantaneous frequency value (not normalized to [-1,1])
   */
  demod(sample: Complex): number {
    // FM demodulation: phase difference
    const phase = sample.arg();
    const delta = this.wrap(phase - this.prev);
    this.prev = phase;

    // Apply scale factor to convert to frequency
    return this.scale * delta;
  }

  reset(): void {
    this.prev = 0;
  }
}

export class SimpleMovingAverage {
  private buffer: Float32Array;
  private index: number = 0;
  private sum: number = 0;
  private count: number = 0;

  constructor(public readonly length: number) {
    this.buffer = new Float32Array(length);
  }

  avg(value: number): number {
    this.sum -= this.buffer[this.index];
    this.sum += value;
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.length;

    if (this.count < this.length) {
      this.count++;
    }

    return this.sum / this.count;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.sum = 0;
    this.count = 0;
  }
}

export class SchmittTrigger {
  private state: boolean = false;

  constructor(
    private lowThreshold: number,
    private highThreshold: number
  ) {}

  /**
   * Returns false when value is below low threshold (sync pulse active)
   * Returns true when value is above high threshold (no sync pulse)
   */
  latch(value: number): boolean {
    if (value < this.lowThreshold) {
      this.state = false;
    } else if (value > this.highThreshold) {
      this.state = true;
    }
    return this.state;
  }

  reset(): void {
    this.state = false;
  }
}

export class Delay {
  private buffer: Float32Array;
  private index: number = 0;

  constructor(public readonly length: number) {
    this.buffer = new Float32Array(length);
  }

  push(value: number): number {
    const delayed = this.buffer[this.index];
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.length;
    return delayed;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
  }
}

export class ExponentialMovingAverage {
  private alpha: number = 1;
  private prev: number = 0;

  /**
   * Configure the filter cutoff frequency
   * Matches Java ExponentialMovingAverage.cutoff()
   * @param freq Cutoff frequency (number of output pixels)
   * @param rate Sample rate (number of input samples)
   * @param order Filter order (number of passes)
   */
  cutoff(freq: number, rate: number, order: number): void {
    // Calculate alpha using the same formula as Java
    const x = Math.cos(2 * Math.PI * freq / rate);
    const alphaBase = x - 1 + Math.sqrt(x * (x - 4) + 3);
    this.alpha = Math.pow(alphaBase, 1.0 / order);
  }

  avg(value: number): number {
    this.prev = this.prev * (1 - this.alpha) + this.alpha * value;
    return this.prev;
  }

  reset(): void {
    this.prev = 0;
  }
}

/**
 * Kaiser window function for FIR filter design
 */
class Kaiser {
  private summands: Float64Array;

  constructor() {
    // i0(x) converges for x inside -3*Pi:3*Pi in less than 35 iterations
    this.summands = new Float64Array(35);
  }

  private square(value: number): number {
    return value * value;
  }

  /**
   * Zero-th order modified Bessel function of the first kind
   */
  private i0(x: number): number {
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
  window(a: number, n: number, N: number): number {
    return this.i0(Math.PI * a * Math.sqrt(1 - this.square((2.0 * n) / (N - 1) - 1))) / this.i0(Math.PI * a);
  }
}

/**
 * FIR Filter utilities
 */
class Filter {
  static sinc(x: number): number {
    if (x === 0) return 1;
    const px = x * Math.PI;
    return Math.sin(px) / px;
  }

  static lowPass(cutoff: number, rate: number, n: number, N: number): number {
    const f = 2 * cutoff / rate;
    const x = n - (N - 1) / 2.0;
    return f * Filter.sinc(f * x);
  }
}

/**
 * Complex convolution for lowpass filtering baseband signal
 */
export class ComplexConvolution {
  public readonly length: number;
  public taps: Float32Array;
  private real: Float32Array;
  private imag: Float32Array;
  private sum: Complex;
  private pos: number = 0;

  constructor(length: number) {
    this.length = length;
    this.taps = new Float32Array(length);
    this.real = new Float32Array(length);
    this.imag = new Float32Array(length);
    this.sum = new Complex();
  }

  push(input: Complex): Complex {
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

  /**
   * Initialize filter taps with Kaiser-windowed lowpass FIR filter
   */
  static createLowPassFilter(length: number, cutoffFrequency: number, sampleRate: number): ComplexConvolution {
    const filter = new ComplexConvolution(length);
    const kaiser = new Kaiser();
    for (let i = 0; i < filter.length; i++) {
      filter.taps[i] = kaiser.window(2.0, i, filter.length) * Filter.lowPass(cutoffFrequency, sampleRate, i, filter.length);
    }
    return filter;
  }
}
