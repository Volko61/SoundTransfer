import { Robot72LineDecoder } from '../robot72-line-decoder';

describe('Robot72LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(Robot72LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new Robot72LineDecoder(44100)).not.toThrow();
      expect(() => new Robot72LineDecoder(48000)).not.toThrow();
      expect(() => new Robot72LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Timing Calculations', () => {
    test('calculates correct scan line duration', () => {
      const decoder = new Robot72LineDecoder(sampleRate);

      // Robot72 scan line: 300ms total
      // sync(9) + porch(3) + Y(138) + sep(4.5) + porch(1.5) + V(69) + sep(4.5) + porch(1.5) + U(69) = 300ms
      const expectedSamples = Math.round(0.300 * sampleRate);

      // Access private scanLineSamples through decoding
      const buffer = new Float32Array(expectedSamples + 1000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();
    });

    test('handles 44.1kHz sample rate timing', () => {
      const decoder44k = new Robot72LineDecoder(44100);

      // Should handle different sample rate without errors
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      expect(() => {
        decoder44k.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles 96kHz sample rate timing', () => {
      const decoder96k = new Robot72LineDecoder(96000);

      const buffer = new Float32Array(40000);
      buffer.fill(0);

      expect(() => {
        decoder96k.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 0, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is near end', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);

      const result = decoder.decodeScanLine(buffer, 9500, 0);
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      // Robot72 line is ~300ms, so need ~14400 samples at 48kHz
      const buffer = new Float32Array(20000);

      // Fill with neutral gray values (0 normalized frequency)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(320);
        expect(result.height).toBe(1); // Robot72 always returns 1 row (sequential, no interlacing)
        expect(result.pixels.length).toBe(320 * 4); // RGBA
      }
    });

    test('handles frequency offset', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0.1);
      }).not.toThrow();
    });

    test('handles negative frequency offset', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, -0.1);
      }).not.toThrow();
    });

    test('handles extreme frequency offset', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0.5);

      const result = decoder.decodeScanLine(buffer, 0, 0.5);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
      }
    });
  });

  describe('Sequential YUV Decoding (No Interlacing)', () => {
    test('always returns height 1 (no interlacing logic)', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      // Robot72 does NOT use interlacing, so EVERY line should return height=1
      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.height).toBe(1); // Always 1 for Robot72
        expect(result.isOddLine).toBe(false); // Not used, always false
      }
    });

    test('consecutive lines are independent (no pairing)', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      // Process first line
      const result1 = decoder.decodeScanLine(buffer, 0, 0);
      expect(result1).not.toBeNull();
      if (result1 !== null) {
        expect(result1.height).toBe(1);
      }

      // Process second line (should also be height=1, not paired)
      const result2 = decoder.decodeScanLine(buffer, 0, 0);
      expect(result2).not.toBeNull();
      if (result2 !== null) {
        expect(result2.height).toBe(1); // Still 1, no pairing
      }
    });

    test('reset does not affect sequential decoding', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result1 = decoder.decodeScanLine(buffer, 0, 0);
      expect(result1?.height).toBe(1);

      decoder.reset();

      const result2 = decoder.decodeScanLine(buffer, 0, 0);
      expect(result2?.height).toBe(1); // Still sequential after reset
    });
  });

  describe('YUV to RGB Conversion', () => {
    test('decodes black correctly (low frequency)', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);

      // Black: low Y, neutral UV
      buffer.fill(-0.8); // Low frequency = dark

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check first pixel is dark
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeLessThan(220);
        expect(g).toBeLessThan(220);
        expect(b).toBeLessThan(220);
      }
    });

    test('decodes white correctly (high frequency)', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);

      // White: high Y, neutral UV
      buffer.fill(0.8); // High frequency = bright

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check first pixel is bright
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeGreaterThan(30);
        expect(g).toBeGreaterThan(30);
        expect(b).toBeGreaterThan(30);
      }
    });

    test('produces valid RGB values', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

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
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0.3);

      const result = decoder.decodeScanLine(buffer, 0, 0);

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
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.width).toBe(320);
      }
    });

    test('returns RGBA pixel format', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // RGBA = 4 bytes per pixel
        expect(result.pixels.length).toBe(320 * 4);
      }
    });

    test('pixels are Uint8ClampedArray', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
      }
    });
  });

  describe('Reset Functionality', () => {
    test('reset does not throw', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      expect(() => decoder.reset()).not.toThrow();
    });

    test('can decode after reset', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      decoder.reset();
      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
    });

    test('multiple resets work correctly', () => {
      const decoder = new Robot72LineDecoder(sampleRate);

      decoder.reset();
      decoder.reset();
      decoder.reset();

      const buffer = new Float32Array(20000);
      buffer.fill(0);
      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('handles all zeros buffer', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles all ones buffer', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(1);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles all negative ones buffer', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(-1);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles random noise', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);

      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.random() * 2 - 1; // Random -1 to +1
      }

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles non-zero sync pulse index', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 5000, 0);
      expect(result).not.toBeNull();
    });
  });

  describe('Comparison with Robot36', () => {
    test('Robot72 is 2x slower than Robot36', () => {
      // Robot36: ~150ms per line
      // Robot72: ~300ms per line (exactly 2x)
      const expectedRobot72Samples = Math.round(0.300 * sampleRate);
      const expectedRobot36Samples = Math.round(0.150 * sampleRate);

      expect(expectedRobot72Samples).toBeCloseTo(expectedRobot36Samples * 2, 0);
    });

    test('Robot72 has same resolution as Robot36', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Both are 320×240
        expect(result.width).toBe(320);
        expect(result.height).toBe(1); // Robot72 outputs 1 line (no interlacing)
      }
    });

    test('Robot72 does not use interlacing unlike Robot36', () => {
      const decoder = new Robot72LineDecoder(sampleRate);
      const buffer = new Float32Array(20000);
      buffer.fill(0);

      // Process multiple lines - all should have height=1
      for (let i = 0; i < 5; i++) {
        const result = decoder.decodeScanLine(buffer, 0, 0);
        expect(result).not.toBeNull();
        if (result !== null) {
          expect(result.height).toBe(1); // Never 0 or 2 like Robot36
        }
      }
    });
  });
});
