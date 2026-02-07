/**
 * Robot36 Line Decoder
 * Decodes a single Robot36 scan line using interlaced YUV format
 * Based on xdsopl/robot36 Robot_36_Color.java
 */

import { ExponentialMovingAverage } from './fm-demodulator';

export interface DecodedLine {
  pixels: Uint8ClampedArray; // RGBA pixel data
  width: number;
  height: number; // Will be 2 for interlaced (even and odd lines)
  isOddLine: boolean; // True if this completes an odd line (returns a line pair)
}

export class Robot36LineDecoder {
  private lowPassFilter: ExponentialMovingAverage;
  private lastEven: boolean = false;
  private evenLinePixels: Uint8ClampedArray; // Store even line for interlacing

  private readonly horizontalPixels = 320;
  private readonly verticalPixels = 240;
  private readonly samplesPerMs: number;
  private readonly luminanceSamples: number;
  private readonly separatorSamples: number;
  private readonly chrominanceSamples: number;
  private readonly luminanceBeginSamples: number;
  private readonly separatorBeginSamples: number;
  private readonly chrominanceBeginSamples: number;
  private readonly endSamples: number;

  constructor(sampleRate: number) {
    this.samplesPerMs = sampleRate / 1000;

    // Robot36 timing
    const syncPulseSeconds = 0.009;
    const syncPorchSeconds = 0.003;
    const luminanceSeconds = 0.088;
    const separatorSeconds = 0.0045;
    const porchSeconds = 0.0015;
    const chrominanceSeconds = 0.044;

    this.luminanceSamples = Math.round(luminanceSeconds * sampleRate);
    this.separatorSamples = Math.round(separatorSeconds * sampleRate);
    this.chrominanceSamples = Math.round(chrominanceSeconds * sampleRate);

    this.luminanceBeginSamples = Math.round(syncPorchSeconds * sampleRate);
    this.separatorBeginSamples = Math.round((syncPorchSeconds + luminanceSeconds) * sampleRate);
    this.chrominanceBeginSamples = Math.round((syncPorchSeconds + luminanceSeconds + separatorSeconds + porchSeconds) * sampleRate);
    this.endSamples = Math.round((syncPorchSeconds + luminanceSeconds + separatorSeconds + porchSeconds + chrominanceSeconds) * sampleRate);

    this.lowPassFilter = new ExponentialMovingAverage();
    this.evenLinePixels = new Uint8ClampedArray(this.horizontalPixels * 4);
  }

  /**
   * Convert normalized frequency (-1 to +1) to level (0 to 1)
   */
  private freqToLevel(frequency: number, offset: number): number {
    return 0.5 * (frequency - offset + 1.0);
  }

  /**
   * Convert YUV to RGB
   * U and V are color difference signals: U = B-Y, V = R-Y
   */
  private yuv2rgb(y: number, u: number, v: number): { r: number; g: number; b: number } {
    // YUV to RGB conversion (ITU-R BT.601)
    // Matches Java ColorConverter.YUV2RGB()
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
   * @param syncPulseIndex Index where sync pulse starts
   * @param frequencyOffset Frequency calibration offset
   * @returns Decoded line data (may contain 2 lines for interlaced decoding)
   */
  decodeScanLine(
    scanLineBuffer: Float32Array,
    syncPulseIndex: number,
    frequencyOffset: number
  ): DecodedLine | null {
    // Check buffer bounds
    if (syncPulseIndex + this.endSamples > scanLineBuffer.length) {
      return null;
    }

    // Detect even/odd line by examining separator pulse frequency
    let separator = 0;
    for (let i = 0; i < this.separatorSamples; i++) {
      separator += scanLineBuffer[syncPulseIndex + this.separatorBeginSamples + i];
    }
    separator /= this.separatorSamples;
    separator -= frequencyOffset;

    // Separator frequency determines even (B-Y) vs odd (R-Y) line
    // Negative separator = even line (B-Y), Positive = odd line (R-Y)
    let even = separator < 0;

    // Validate separator frequency
    if (separator < -1.1 || (separator > -0.9 && separator < 0.9) || separator > 1.1) {
      even = !this.lastEven;
    }
    this.lastEven = even;

    // Apply bidirectional low-pass filter
    const scratchBuffer = new Float32Array(this.endSamples);

    // Configure filter for horizontal resolution
    this.lowPassFilter.cutoff(this.horizontalPixels, 2 * this.luminanceSamples, 2);

    // Debug: Check alpha value
    const alphaValue = (this.lowPassFilter as any).alpha;
    console.log(`🔧 LowPass alpha=${alphaValue.toFixed(6)}, freq=${this.horizontalPixels}, rate=${2 * this.luminanceSamples}`);

    // Debug: Check scanLineBuffer RAW values before filtering (10 samples from luminance region)
    const rawSamples = Array.from({length: 10}, (_, idx) => {
      const pos = syncPulseIndex + this.luminanceBeginSamples + Math.floor((idx * this.luminanceSamples) / 10);
      return scanLineBuffer[pos]?.toFixed(4) || 'undef';
    });
    console.log(`📡 RAW scanLineBuffer samples (10 points): ${rawSamples.join(', ')}`);

    this.lowPassFilter.reset();

    // Forward pass - apply lowpass filtering
    // FM demod output is already scaled correctly by FILTER_COMPENSATION in FrequencyModulation
    for (let i = this.luminanceBeginSamples; i < this.endSamples; i++) {
      scratchBuffer[i] = this.lowPassFilter.avg(scanLineBuffer[syncPulseIndex + i]);
    }

    // Backward pass
    this.lowPassFilter.reset();
    for (let i = this.endSamples - 1; i >= this.luminanceBeginSamples; i--) {
      scratchBuffer[i] = this.freqToLevel(this.lowPassFilter.avg(scratchBuffer[i]), frequencyOffset);
    }

    // Debug: Check scratchBuffer values after filtering
    const sampleValues = Array.from({length: 10}, (_, idx) => {
      const pos = this.luminanceBeginSamples + Math.floor((idx * this.luminanceSamples) / 10);
      return scratchBuffer[pos].toFixed(3);
    });
    console.log(`📊 ScratchBuffer samples (10 points): ${sampleValues.join(', ')}`);

    // Decode pixels
    const pixels = new Uint8ClampedArray(this.horizontalPixels * 4 * 2); // Allocate for 2 lines

    // First pass: extract raw Y and chroma values (keep as floats for better filtering)
    const rawY = new Float32Array(this.horizontalPixels);
    const rawChroma = new Float32Array(this.horizontalPixels);

    for (let i = 0; i < this.horizontalPixels; i++) {
      const luminancePos = this.luminanceBeginSamples + Math.floor((i * this.luminanceSamples) / this.horizontalPixels);
      const chrominancePos = this.chrominanceBeginSamples + Math.floor((i * this.chrominanceSamples) / this.horizontalPixels);

      // Clamp extreme values before conversion (normalized ±3 range)
      const yRaw = Math.max(-3, Math.min(3, scratchBuffer[luminancePos]));
      const chromaRaw = Math.max(-3, Math.min(3, scratchBuffer[chrominancePos]));

      rawY[i] = yRaw * 255;
      rawChroma[i] = chromaRaw * 255;
    }

    // Second pass: apply 5-pixel median filter to chroma for stronger noise reduction
    const filteredChroma = new Float32Array(this.horizontalPixels);
    for (let i = 0; i < this.horizontalPixels; i++) {
      // Get 5 neighboring values (or edge values if near boundaries)
      const i1 = Math.max(0, i - 2);
      const i2 = Math.max(0, i - 1);
      const i3 = i;
      const i4 = Math.min(this.horizontalPixels - 1, i + 1);
      const i5 = Math.min(this.horizontalPixels - 1, i + 2);

      const values = [rawChroma[i1], rawChroma[i2], rawChroma[i3], rawChroma[i4], rawChroma[i5]];
      values.sort((a, b) => a - b);
      filteredChroma[i] = values[2]; // Median of 5 values
    }

    // Third pass: decode pixels with filtered chroma (clamp to valid 0-255 range)
    for (let i = 0; i < this.horizontalPixels; i++) {
      const y = Math.max(0, Math.min(255, Math.round(rawY[i])));
      const chroma = Math.max(0, Math.min(255, Math.round(filteredChroma[i])));

      if (even) {
        // Even line: Y + R-Y (store for interlacing)
        this.evenLinePixels[i * 4] = y;      // Store Y
        this.evenLinePixels[i * 4 + 1] = 0;  // U placeholder
        this.evenLinePixels[i * 4 + 2] = chroma; // Store R-Y
        this.evenLinePixels[i * 4 + 3] = 255;
      } else {
        // Odd line: Y + B-Y, combine with previous even line
        const evenY = this.evenLinePixels[i * 4];
        let evenRY = this.evenLinePixels[i * 4 + 2];
        const oddY = y;
        let oddBY = chroma;

        // Reduce chroma saturation to suppress color noise (70% intensity)
        const CHROMA_REDUCTION = 0.7;
        evenRY = 128 + (evenRY - 128) * CHROMA_REDUCTION;
        oddBY = 128 + (oddBY - 128) * CHROMA_REDUCTION;

        // Debug YUV values for first pixel
        if (i === 100) {
          console.log(`🎨 Pixel ${i} YUV values: evenY=${evenY}, oddY=${oddY}, R-Y=${Math.round(evenRY)}, B-Y=${Math.round(oddBY)}`);
        }

        // Convert even line: [Y_even, R-Y_even, B-Y_odd] → RGB
        // YUV2RGB expects (Y, U=B-Y, V=R-Y) per ITU-R BT.601
        const evenRGB = this.yuv2rgb(evenY, oddBY, evenRY);
        pixels[i * 4] = evenRGB.r;
        pixels[i * 4 + 1] = evenRGB.g;
        pixels[i * 4 + 2] = evenRGB.b;
        pixels[i * 4 + 3] = 255;

        // Convert odd line: [Y_odd, R-Y_even, B-Y_odd] → RGB
        // YUV2RGB expects (Y, U=B-Y, V=R-Y) per ITU-R BT.601
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
      height: even ? 0 : 2, // Return 2 lines only on odd lines
      isOddLine: !even,
    };
  }

  reset(): void {
    this.lastEven = false;
    this.evenLinePixels.fill(0);
    this.lowPassFilter.reset();
  }
}
