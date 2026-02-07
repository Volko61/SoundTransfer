/**
 * Goertzel algorithm for efficient single-frequency detection
 * More efficient than FFT when detecting specific frequencies
 */
export class GoertzelFilter {
  private readonly coefficient: number;
  private readonly sampleRate: number;
  private readonly targetFreq: number;
  private s1 = 0;
  private s2 = 0;

  constructor(sampleRate: number, targetFreq: number) {
    this.sampleRate = sampleRate;
    this.targetFreq = targetFreq;
    const normalizedFreq = targetFreq / sampleRate;
    this.coefficient = 2 * Math.cos(2 * Math.PI * normalizedFreq);
  }

  processSample(sample: number): void {
    const s0 = sample + this.coefficient * this.s1 - this.s2;
    this.s2 = this.s1;
    this.s1 = s0;
  }

  getMagnitude(): number {
    const real = this.s1 - this.s2 * Math.cos(2 * Math.PI * this.targetFreq / this.sampleRate);
    const imag = this.s2 * Math.sin(2 * Math.PI * this.targetFreq / this.sampleRate);
    return Math.sqrt(real * real + imag * imag);
  }

  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
  }
}

/**
 * Frequency detector using multiple Goertzel filters
 */
export class FrequencyDetector {
  private filters: Map<number, GoertzelFilter>;
  private sampleRate: number;

  constructor(sampleRate: number, frequencies: number[]) {
    this.sampleRate = sampleRate;
    this.filters = new Map();

    frequencies.forEach(freq => {
      this.filters.set(freq, new GoertzelFilter(sampleRate, freq));
    });
  }

  processSample(sample: number): void {
    this.filters.forEach(filter => filter.processSample(sample));
  }

  getFrequency(): number {
    let maxMagnitude = 0;
    let detectedFreq = 0;

    this.filters.forEach((filter, freq) => {
      const magnitude = filter.getMagnitude();
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        detectedFreq = freq;
      }
    });

    return detectedFreq;
  }

  getMagnitude(frequency: number): number {
    const filter = this.filters.get(frequency);
    return filter ? filter.getMagnitude() : 0;
  }

  reset(): void {
    this.filters.forEach(filter => filter.reset());
  }
}

/**
 * Convert frequency to pixel brightness value (0-255)
 */
export function frequencyToPixel(freq: number, blackFreq: number, whiteFreq: number): number {
  if (freq <= blackFreq) return 0;
  if (freq >= whiteFreq) return 255;

  const normalized = (freq - blackFreq) / (whiteFreq - blackFreq);
  return Math.round(normalized * 255);
}

/**
 * Simple low-pass filter for smoothing
 */
export class LowPassFilter {
  private alpha: number;
  private value: number;

  constructor(alpha: number = 0.1, initialValue: number = 0) {
    this.alpha = alpha;
    this.value = initialValue;
  }

  process(sample: number): number {
    this.value = this.alpha * sample + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset(value: number = 0): void {
    this.value = value;
  }
}
