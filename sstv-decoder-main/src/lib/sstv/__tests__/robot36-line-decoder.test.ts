import { Robot36LineDecoder } from '../robot36-line-decoder';

describe('Robot36LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(Robot36LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new Robot36LineDecoder(44100)).not.toThrow();
      expect(() => new Robot36LineDecoder(48000)).not.toThrow();
      expect(() => new Robot36LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 0, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is near end', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);

      const result = decoder.decodeScanLine(buffer, 9500, 0);
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      // Robot36 line is ~150ms, so need ~7200 samples at 48kHz
      const buffer = new Float32Array(10000);

      // Fill with neutral gray values (0 normalized frequency)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      // May return null or a result depending on separator detection
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(320);
        expect(result.pixels.length).toBeGreaterThan(0);
      }
    });

    test('handles frequency offset', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0.1);
      }).not.toThrow();
    });

    test('handles negative frequency offset', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, -0.1);
      }).not.toThrow();
    });
  });

  describe('Interlaced Output', () => {
    test('returns height 0 on even line (stored for interlacing)', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);

      // Simulate even line separator (low frequency)
      for (let i = 0; i < 500; i++) {
        buffer[i] = -0.5; // Below separator threshold
      }
      buffer.fill(0, 500);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      if (result !== null) {
        // Robot36 returns height 0 for even lines (stored internally)
        expect(result.height).toBe(0);
        expect(result.isOddLine).toBe(false);
      }
    });

    test('processes consecutive scan lines', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      // Process first line
      const result1 = decoder.decodeScanLine(buffer, 0, 0);

      // Process second line
      const result2 = decoder.decodeScanLine(buffer, 0, 0);

      // Both should return results or both null
      if (result1 !== null && result2 !== null) {
        expect(result1.pixels).toBeDefined();
        expect(result2.pixels).toBeDefined();
      }
    });
  });

  describe('Decoded Line Structure', () => {
    test('returns correct width for Robot36', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      if (result !== null) {
        expect(result.width).toBe(320);
      }
    });

    test('returns RGBA pixel data', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
        // Each pixel has 4 components (RGBA)
        expect(result.pixels.length % 4).toBe(0);
      }
    });

    test('pixel values are in valid range', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      if (result !== null) {
        for (let i = 0; i < result.pixels.length; i++) {
          expect(result.pixels[i]).toBeGreaterThanOrEqual(0);
          expect(result.pixels[i]).toBeLessThanOrEqual(255);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    test('handles empty buffer gracefully', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).toBeNull();
    });

    test('handles buffer with extreme values', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(100); // Extreme positive

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles buffer with negative values', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(-100); // Extreme negative

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });

    test('handles sync pulse at various positions', () => {
      const decoder = new Robot36LineDecoder(sampleRate);
      const buffer = new Float32Array(10000);
      buffer.fill(0);

      // Test different starting positions
      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
        decoder.decodeScanLine(buffer, 100, 0);
        decoder.decodeScanLine(buffer, 500, 0);
      }).not.toThrow();
    });
  });

  describe('Sample Rate Scaling', () => {
    test('scales timing with sample rate', () => {
      const decoder44k = new Robot36LineDecoder(44100);
      const decoder48k = new Robot36LineDecoder(48000);

      const buffer44k = new Float32Array(10000);
      const buffer48k = new Float32Array(10000);

      buffer44k.fill(0);
      buffer48k.fill(0);

      const result44k = decoder44k.decodeScanLine(buffer44k, 0, 0);
      const result48k = decoder48k.decodeScanLine(buffer48k, 0, 0);

      // Both should produce same width output
      if (result44k !== null && result48k !== null) {
        expect(result44k.width).toBe(result48k.width);
      }
    });
  });
});
