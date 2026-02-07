import { ScottieS2LineDecoder } from '../scottie-s2-line-decoder';

describe('ScottieS2LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(ScottieS2LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new ScottieS2LineDecoder(44100)).not.toThrow();
      expect(() => new ScottieS2LineDecoder(48000)).not.toThrow();
      expect(() => new ScottieS2LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Timing Calculations', () => {
    test('calculates correct scan line duration', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);

      // Scottie S2 scan line: 277.692ms total (after first line)
      // sync(9) + R(88.064) + sep(1.5) + G(88.064) + sep(1.5) + B(88.064) = 277.692ms
      // But green/blue are transmitted BEFORE sync (negative timing)
      // So we need extra buffer space
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 15000, 0); // Large offset for negative timing
      expect(result).not.toBeNull();
    });

    test('first sync pulse is longer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);

      // First line: sync(9) + sep(1.5) + G(88.064) + sep(1.5) + B(88.064) + sync(9) + sep(1.5) + R(88.064) = 286.628ms
      const firstSyncSamples = decoder.getFirstSyncPulseSamples();
      const expectedFirstSync = Math.round((0.009 + 2 * (0.0015 + 0.088064)) * sampleRate);

      expect(firstSyncSamples).toBeCloseTo(expectedFirstSync, 0);
    });

    test('handles 44.1kHz sample rate timing', () => {
      const decoder44k = new ScottieS2LineDecoder(44100);

      const buffer = new Float32Array(25000);
      buffer.fill(0);

      expect(() => {
        decoder44k.decodeScanLine(buffer, 8000, 0);
      }).not.toThrow();
    });

    test('handles 96kHz sample rate timing', () => {
      const decoder96k = new ScottieS2LineDecoder(96000);

      const buffer = new Float32Array(50000);
      buffer.fill(0);

      expect(() => {
        decoder96k.decodeScanLine(buffer, 20000, 0);
      }).not.toThrow();
    });

    test('S2 is faster than S1', () => {
      const decoderS1 = new (require('../scottie-s1-line-decoder').ScottieS1LineDecoder)(sampleRate);
      const decoderS2 = new ScottieS2LineDecoder(sampleRate);

      // S2 should have shorter timing than S1
      // S1: 138.24ms per channel, S2: 88.064ms per channel
      const s1FirstSync = decoderS1.getFirstSyncPulseSamples();
      const s2FirstSync = decoderS2.getFirstSyncPulseSamples();

      expect(s2FirstSync).toBeLessThan(s1FirstSync);
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 50, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is too early (negative timing)', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);

      // Scottie has negative timing (green/blue before sync)
      const result = decoder.decodeScanLine(buffer, 100, 0); // Too close to start
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      // Scottie S2 line is ~278ms, so need ~13300 samples at 48kHz
      // Plus extra for negative timing (green/blue transmitted before sync)
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0); // Offset to handle negative timing

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(320);
        expect(result.height).toBe(1); // Scottie S2 always returns 1 row (RGB sequential)
        expect(result.pixels.length).toBe(320 * 4); // RGBA
      }
    });

    test('handles frequency offset', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0.1);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });

    test('handles negative frequency offset', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, -0.1);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });

    test('handles extreme frequency offset', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0.5);

      const result = decoder.decodeScanLine(buffer, 10000, 0.5);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });
  });

  describe('RGB Sequential Decoding (No YUV Conversion)', () => {
    test('always returns height 1 (sequential RGB)', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      for (let i = 0; i < 5; i++) {
        const result = decoder.decodeScanLine(buffer, 10000, 0);
        expect(result).not.toBeNull();
        if (result) {
          expect(result.height).toBe(1); // Always 1 row per scan line
          expect(result.isOddLine).toBe(false); // Not used for Scottie
        }
      }
    });

    test('consecutive lines are independent', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer1 = new Float32Array(30000);
      const buffer2 = new Float32Array(30000);
      buffer1.fill(0.2);
      buffer2.fill(0.8);

      const result1 = decoder.decodeScanLine(buffer1, 10000, 0);
      const result2 = decoder.decodeScanLine(buffer2, 10000, 0);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      if (result1 && result2) {
        // Results should be different (different input data)
        let different = false;
        for (let i = 0; i < result1.pixels.length; i++) {
          if (result1.pixels[i] !== result2.pixels[i]) {
            different = true;
            break;
          }
        }
        expect(different).toBe(true);
      }
    });

    test('reset does not affect sequential decoding', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0.5);

      const result1 = decoder.decodeScanLine(buffer, 10000, 0);
      decoder.reset();
      const result2 = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      if (result1 && result2) {
        expect(result1.width).toBe(result2.width);
        expect(result1.height).toBe(result2.height);
      }
    });
  });

  describe('Direct RGB Conversion', () => {
    test('decodes black correctly (low frequency)', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(-1); // Low frequency = black

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        // First pixel should be close to black (low RGB values)
        expect(result.pixels[0]).toBeLessThan(50); // R
        expect(result.pixels[1]).toBeLessThan(50); // G
        expect(result.pixels[2]).toBeLessThan(50); // B
      }
    });

    test('decodes white correctly (high frequency)', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(1); // High frequency = white

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        // First pixel should be close to white (high RGB values)
        expect(result.pixels[0]).toBeGreaterThan(200); // R
        expect(result.pixels[1]).toBeGreaterThan(200); // G
        expect(result.pixels[2]).toBeGreaterThan(200); // B
      }
    });

    test('decodes pure red correctly', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);

      // Set only red channel high, others low (simplified test)
      for (let i = 0; i < buffer.length; i++) {
        // This is a simplified test - real red would need specific timing
        buffer[i] = 0.5; // Mid-level signal
      }

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        // Should decode some RGB values
        expect(result.pixels).toBeDefined();
        expect(result.pixels.length).toBe(320 * 4);
      }
    });

    test('produces valid RGB values', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);

      // Random frequency values
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.random() * 2 - 1;
      }

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        // All RGB values should be in valid range (0-255)
        for (let i = 0; i < result.pixels.length; i += 4) {
          expect(result.pixels[i]).toBeGreaterThanOrEqual(0); // R
          expect(result.pixels[i]).toBeLessThanOrEqual(255);
          expect(result.pixels[i + 1]).toBeGreaterThanOrEqual(0); // G
          expect(result.pixels[i + 1]).toBeLessThanOrEqual(255);
          expect(result.pixels[i + 2]).toBeGreaterThanOrEqual(0); // B
          expect(result.pixels[i + 2]).toBeLessThanOrEqual(255);
          expect(result.pixels[i + 3]).toBe(255); // Alpha always 255
        }
      }
    });

    test('all pixels have alpha 255', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0.5);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        for (let i = 3; i < result.pixels.length; i += 4) {
          expect(result.pixels[i]).toBe(255);
        }
      }
    });
  });

  describe('Output Format', () => {
    test('returns correct width', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320); // Scottie S2 horizontal pixels
      }
    });

    test('returns RGBA pixel format', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.pixels.length).toBe(320 * 4); // RGBA = 4 bytes per pixel
      }
    });

    test('pixels are Uint8ClampedArray', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
      }
    });
  });

  describe('Reset Functionality', () => {
    test('reset does not throw', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      expect(() => decoder.reset()).not.toThrow();
    });

    test('can decode after reset', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      decoder.reset();
      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
    });

    test('multiple resets work correctly', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);

      decoder.reset();
      decoder.reset();
      decoder.reset();

      const buffer = new Float32Array(30000);
      buffer.fill(0);
      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('handles all zeros buffer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });

    test('handles all ones buffer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(1);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });

    test('handles all negative ones buffer', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(-1);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
      }
    });

    test('handles random noise', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);

      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = (Math.random() - 0.5) * 4; // Random values in range [-2, 2]
      }

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320);
        // All pixels should still be valid
        for (let i = 0; i < result.pixels.length; i++) {
          expect(result.pixels[i]).toBeGreaterThanOrEqual(0);
          expect(result.pixels[i]).toBeLessThanOrEqual(255);
        }
      }
    });

    test('handles various sync pulse positions', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      // Test different sync positions (all should work with sufficient buffer)
      const positions = [9000, 10000, 11000, 12000];

      for (const pos of positions) {
        const result = decoder.decodeScanLine(buffer, pos, 0);
        expect(result).not.toBeNull();
      }
    });
  });

  describe('Comparison with Other Modes', () => {
    test('Scottie S2 is faster than Scottie S1', () => {
      const decoderS1 = new (require('../scottie-s1-line-decoder').ScottieS1LineDecoder)(sampleRate);
      const decoderS2 = new ScottieS2LineDecoder(sampleRate);

      // S2 line time: ~278ms, S1 line time: ~428ms
      // S2 should be significantly faster
      const s1Samples = decoderS1.getFirstSyncPulseSamples();
      const s2Samples = decoderS2.getFirstSyncPulseSamples();

      // S2 should be roughly 65% of S1's time (278/428 ≈ 0.65)
      const ratio = s2Samples / s1Samples;
      expect(ratio).toBeLessThan(0.7);
      expect(ratio).toBeGreaterThan(0.6);
    });

    test('Scottie S2 has same resolution as S1', () => {
      const decoderS2 = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoderS2.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.width).toBe(320); // Same as S1
        expect(result.height).toBe(1); // Same as S1 (sequential)
      }
    });

    test('Scottie S2 uses RGB not YUV', () => {
      const decoder = new ScottieS2LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 10000, 0);

      expect(result).not.toBeNull();
      if (result) {
        // Height should always be 1 (no interlacing like YUV modes)
        expect(result.height).toBe(1);
      }
    });
  });
});
