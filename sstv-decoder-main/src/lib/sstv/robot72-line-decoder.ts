/**
 * Robot72 Line Decoder
 * Decodes a single Robot72 scan line using sequential YUV format
 * Unlike Robot36, Robot72 transmits Y, V (R-Y), and U (B-Y) sequentially on EACH line
 * This eliminates interlacing and provides better color fidelity at the cost of 2× transmission time
 * Based on xdsopl/robot36 Robot_72_Color.java
 */

import { ExponentialMovingAverage } from './fm-demodulator';

export interface DecodedLine {
  pixels: Uint8ClampedArray; // RGBA pixel data
  width: number;
  height: number; // Always 1 for Robot72 (sequential, not interlaced)
  isOddLine: boolean; // Not used for Robot72, always false
}

export class Robot72LineDecoder {
  private lowPassFilter: ExponentialMovingAverage;

  private readonly horizontalPixels = 320;
  private readonly verticalPixels = 240;
  private readonly scanLineSamples: number;
  private readonly luminanceSamples: number;
  private readonly chrominanceSamples: number;
  private readonly beginSamples: number;

  // Begin positions for Y, V, U channels
  private readonly yBeginSamples: number;
  private readonly vBeginSamples: number;
  private readonly uBeginSamples: number;
  private readonly endSamples: number;

  constructor(sampleRate: number) {
    // Robot72 timing (in seconds)
    const syncPulseSeconds = 0.009;      // 9ms sync pulse
    const syncPorchSeconds = 0.003;      // 3ms porch after sync
    const luminanceSeconds = 0.138;      // 138ms for Y channel (longer than Robot36's 88ms)
    const separatorSeconds = 0.0045;     // 4.5ms separator
    const porchSeconds = 0.0015;         // 1.5ms porch
    const chrominanceSeconds = 0.069;    // 69ms for each chroma channel (V and U)

    // Total scan line: sync(9) + porch(3) + Y(138) + sep(4.5) + porch(1.5) + V(69) + sep(4.5) + porch(1.5) + U(69) = 300ms
    const scanLineSeconds = syncPulseSeconds + syncPorchSeconds + luminanceSeconds +
                           2 * (separatorSeconds + porchSeconds + chrominanceSeconds);

    this.scanLineSamples = Math.round(scanLineSeconds * sampleRate);
    this.luminanceSamples = Math.round(luminanceSeconds * sampleRate);
    this.chrominanceSamples = Math.round(chrominanceSeconds * sampleRate);

    // Calculate begin positions for each channel
    const yBeginSeconds = syncPorchSeconds;
    this.yBeginSamples = Math.round(yBeginSeconds * sampleRate);
    this.beginSamples = this.yBeginSamples;

    const yEndSeconds = yBeginSeconds + luminanceSeconds;
    const vBeginSeconds = yEndSeconds + separatorSeconds + porchSeconds;
    this.vBeginSamples = Math.round(vBeginSeconds * sampleRate);

    const vEndSeconds = vBeginSeconds + chrominanceSeconds;
    const uBeginSeconds = vEndSeconds + separatorSeconds + porchSeconds;
    this.uBeginSamples = Math.round(uBeginSeconds * sampleRate);

    const uEndSeconds = uBeginSeconds + chrominanceSeconds;
    this.endSamples = Math.round(uEndSeconds * sampleRate);

    this.lowPassFilter = new ExponentialMovingAverage();
  }

  /**
   * Convert normalized frequency (-1 to +1) to level (0 to 1)
   */
  private freqToLevel(frequency: number, offset: number): number {
    return 0.5 * (frequency - offset + 1.0);
  }

  /**
   * Convert YUV to RGB
   * V = R-Y, U = B-Y (same as Robot36)
   * Uses ITU-R BT.601 color space conversion
   */
  private yuv2rgb(y: number, u: number, v: number): { r: number; g: number; b: number } {
    const yAdj = y - 16;
    const uAdj = u - 128;  // B-Y
    const vAdj = v - 128;  // R-Y

    const r = Math.max(0, Math.min(255, ((298 * yAdj + 409 * vAdj + 128) >> 8)));
    const g = Math.max(0, Math.min(255, ((298 * yAdj - 100 * uAdj - 208 * vAdj + 128) >> 8)));
    const b = Math.max(0, Math.min(255, ((298 * yAdj + 516 * uAdj + 128) >> 8)));

    return { r, g, b };
  }

  /**
   * Decode a single Robot72 scan line
   * @param scanLineBuffer Demodulated frequency values for the entire line
   * @param syncPulseIndex Index where sync pulse starts
   * @param frequencyOffset Frequency calibration offset
   * @returns Decoded line data (1 row for Robot72, no interlacing)
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

    // Apply bidirectional low-pass filter
    const scratchBuffer = new Float32Array(this.endSamples);

    // Configure filter for horizontal resolution
    // Use luminance samples as the rate (longest channel)
    this.lowPassFilter.cutoff(this.horizontalPixels, 2 * this.luminanceSamples, 2);

    this.lowPassFilter.reset();

    // Forward pass - apply lowpass filtering
    for (let i = this.beginSamples; i < this.endSamples; i++) {
      scratchBuffer[i] = this.lowPassFilter.avg(scanLineBuffer[syncPulseIndex + i]);
    }

    // Backward pass
    this.lowPassFilter.reset();
    for (let i = this.endSamples - 1; i >= this.beginSamples; i--) {
      scratchBuffer[i] = this.freqToLevel(this.lowPassFilter.avg(scratchBuffer[i]), frequencyOffset);
    }

    // Allocate pixels for one row
    const pixels = new Uint8ClampedArray(this.horizontalPixels * 4);

    // Decode pixels: Y, V (R-Y), U (B-Y) are all transmitted sequentially on this line
    for (let i = 0; i < this.horizontalPixels; i++) {
      // Calculate sample position within each channel
      const yPos = this.yBeginSamples + Math.floor((i * this.luminanceSamples) / this.horizontalPixels);
      const uPos = this.uBeginSamples + Math.floor((i * this.chrominanceSamples) / this.horizontalPixels);
      const vPos = this.vBeginSamples + Math.floor((i * this.chrominanceSamples) / this.horizontalPixels);

      // Extract and convert values (0-1 range to 0-255)
      const y = Math.max(0, Math.min(1, scratchBuffer[yPos])) * 255;
      const u = Math.max(0, Math.min(1, scratchBuffer[uPos])) * 255;
      const v = Math.max(0, Math.min(1, scratchBuffer[vPos])) * 255;

      // Convert YUV to RGB
      // yuv2rgb expects: Y, U (B-Y), V (R-Y)
      const rgb = this.yuv2rgb(y, u, v);

      pixels[i * 4] = rgb.r;
      pixels[i * 4 + 1] = rgb.g;
      pixels[i * 4 + 2] = rgb.b;
      pixels[i * 4 + 3] = 255;
    }

    return {
      pixels,
      width: this.horizontalPixels,
      height: 1, // Robot72 returns ONE row per scan line (sequential, no interlacing)
      isOddLine: false,
    };
  }

  reset(): void {
    this.lowPassFilter.reset();
  }
}
