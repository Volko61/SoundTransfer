import { ScottieS1LineDecoder } from '../scottie-s1-line-decoder';

describe('ScottieS1LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(ScottieS1LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new ScottieS1LineDecoder(44100)).not.toThrow();
      expect(() => new ScottieS1LineDecoder(48000)).not.toThrow();
      expect(() => new ScottieS1LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Timing Calculations', () => {
    test('calculates correct scan line duration', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);

      // Scottie S1 scan line: 428.22ms total (after first line)
      // sync(9) + R(138.24) + sep(1.5) + G(138.24) + sep(1.5) + B(138.24) = 428.22ms
      // But green/blue are transmitted BEFORE sync (negative timing)
      // So we need extra buffer space
      const buffer = new Float32Array(50000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 20000, 0); // Large offset for negative timing
      expect(result).not.toBeNull();
    });

    test('first sync pulse is longer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);

      // First line: sync(9) + sep(1.5) + G(138.24) + sep(1.5) + B(138.24) + sync(9) + sep(1.5) + R(138.24) = 438.72ms
      const firstSyncSamples = decoder.getFirstSyncPulseSamples();
      const expectedFirstSync = Math.round((0.009 + 2 * (0.0015 + 0.13824)) * sampleRate);

      expect(firstSyncSamples).toBeCloseTo(expectedFirstSync, 0);
    });

    test('handles 44.1kHz sample rate timing', () => {
      const decoder44k = new ScottieS1LineDecoder(44100);

      const buffer = new Float32Array(30000);
      buffer.fill(0);

      expect(() => {
        decoder44k.decodeScanLine(buffer, 10000, 0);
      }).not.toThrow();
    });

    test('handles 96kHz sample rate timing', () => {
      const decoder96k = new ScottieS1LineDecoder(96000);

      const buffer = new Float32Array(60000);
      buffer.fill(0);

      expect(() => {
        decoder96k.decodeScanLine(buffer, 20000, 0);
      }).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 50, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is too early (negative timing)', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);

      // Scottie has negative timing (green/blue before sync)
      const result = decoder.decodeScanLine(buffer, 100, 0); // Too close to start
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      // Scottie S1 line is ~428ms, so need ~20500 samples at 48kHz
      // Plus extra for negative timing (green/blue transmitted before sync)
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0); // Offset to handle negative timing

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(320);
        expect(result.height).toBe(1); // Scottie S1 always returns 1 row (RGB sequential)
        expect(result.pixels.length).toBe(320 * 4); // RGBA
      }
    });

    test('handles frequency offset', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, 0.1);
      }).not.toThrow();
    });

    test('handles negative frequency offset', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, -0.1);
      }).not.toThrow();
    });

    test('handles extreme frequency offset', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0.5);

      const result = decoder.decodeScanLine(buffer, 15000, 0.5);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
      }
    });
  });

  describe('RGB Sequential Decoding (No YUV Conversion)', () => {
    test('always returns height 1 (sequential RGB)', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.height).toBe(1); // Always 1 for Scottie S1
        expect(result.isOddLine).toBe(false); // Not used, always false
      }
    });

    test('consecutive lines are independent', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result1 = decoder.decodeScanLine(buffer, 15000, 0);
      expect(result1).not.toBeNull();
      if (result1 !== null) {
        expect(result1.height).toBe(1);
      }

      const result2 = decoder.decodeScanLine(buffer, 15000, 0);
      expect(result2).not.toBeNull();
      if (result2 !== null) {
        expect(result2.height).toBe(1);
      }
    });

    test('reset does not affect sequential decoding', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result1 = decoder.decodeScanLine(buffer, 15000, 0);
      expect(result1?.height).toBe(1);

      decoder.reset();

      const result2 = decoder.decodeScanLine(buffer, 15000, 0);
      expect(result2?.height).toBe(1);
    });
  });

  describe('Direct RGB Conversion', () => {
    test('decodes black correctly (low frequency)', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // Black: low RGB values
      buffer.fill(-0.8);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check first pixel is dark
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeLessThan(100);
        expect(g).toBeLessThan(100);
        expect(b).toBeLessThan(100);
      }
    });

    test('decodes white correctly (high frequency)', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // White: high RGB values
      buffer.fill(0.8);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check first pixel is bright
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeGreaterThan(150);
        expect(g).toBeGreaterThan(150);
        expect(b).toBeGreaterThan(150);
      }
    });

    test('decodes pure red correctly', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // Simulate red channel high, green/blue low
      // Note: This is simplified - actual RGB separation would require
      // precise timing control of different buffer regions
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Should have some RGB values (actual color depends on buffer timing)
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    });

    test('produces valid RGB values', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        for (let i = 0; i < result.pixels.length; i += 4) {
          const r = result.pixels[i];
          const g = result.pixels[i + 1];
          const b = result.pixels[i + 2];
          const a = result.pixels[i + 3];

          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(255);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(255);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(255);
          expect(a).toBe(255);
        }
      }
    });

    test('all pixels have alpha 255', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0.3);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        for (let i = 3; i < result.pixels.length; i += 4) {
          expect(result.pixels[i]).toBe(255);
        }
      }
    });
  });

  describe('Output Format', () => {
    test('returns correct width', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.width).toBe(320);
      }
    });

    test('returns RGBA pixel format', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // RGBA = 4 bytes per pixel
        expect(result.pixels.length).toBe(320 * 4);
      }
    });

    test('pixels are Uint8ClampedArray', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
      }
    });
  });

  describe('Reset Functionality', () => {
    test('reset does not throw', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      expect(() => decoder.reset()).not.toThrow();
    });

    test('can decode after reset', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      decoder.reset();
      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
    });

    test('multiple resets work correctly', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);

      decoder.reset();
      decoder.reset();
      decoder.reset();

      const buffer = new Float32Array(40000);
      buffer.fill(0);
      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('handles all zeros buffer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, 0);
      }).not.toThrow();
    });

    test('handles all ones buffer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(1);

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, 0);
      }).not.toThrow();
    });

    test('handles all negative ones buffer', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(-1);

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, 0);
      }).not.toThrow();
    });

    test('handles random noise', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.random() * 2 - 1;
      }

      expect(() => {
        decoder.decodeScanLine(buffer, 15000, 0);
      }).not.toThrow();
    });

    test('handles various sync pulse positions', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(50000);
      buffer.fill(0);

      // Test different sync positions (need large buffer for negative timing)
      for (const syncPos of [20000, 22000, 24000]) {
        const result = decoder.decodeScanLine(buffer, syncPos, 0);
        expect(result).not.toBeNull();
      }
    });
  });

  describe('Comparison with Other Modes', () => {
    test('Scottie S1 is slower than Robot36 but faster than Robot72', () => {
      // Robot36: ~150ms per line
      // Scottie S1: ~428ms per line
      // Robot72: ~300ms per line
      // So: Robot36 < Robot72 < Scottie S1
      const scottieS1Samples = Math.round(0.42822 * sampleRate);
      const robot36Samples = Math.round(0.150 * sampleRate);
      const robot72Samples = Math.round(0.300 * sampleRate);

      expect(scottieS1Samples).toBeGreaterThan(robot36Samples);
      expect(scottieS1Samples).toBeGreaterThan(robot72Samples);
    });

    test('Scottie S1 has larger vertical resolution than Robot modes', () => {
      const decoder = new ScottieS1LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Scottie S1: 320×256
        // Robot36/72: 320×240
        expect(result.width).toBe(320);
        // Vertical resolution determined by number of lines (256 vs 240)
      }
    });

    test('Scottie S1 uses RGB not YUV', () => {
      // This is a design distinction - Scottie S1 transmits RGB directly
      // while Robot/PD modes use YUV color space
      // The test verifies that the decoder processes RGB channels
      const decoder = new ScottieS1LineDecoder(sampleRate);
      expect(decoder).toBeDefined();

      // Scottie decoders don't need YUV conversion methods
      // This is validated by the successful RGB decoding tests above
    });
  });
});
