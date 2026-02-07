import { PD120LineDecoder } from '../pd120-line-decoder';

describe('PD120LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(PD120LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new PD120LineDecoder(44100)).not.toThrow();
      expect(() => new PD120LineDecoder(48000)).not.toThrow();
      expect(() => new PD120LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 0, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is near end', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);

      const result = decoder.decodeScanLine(buffer, 29000, 0);
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      // PD120 line is ~508ms, so need ~24400 samples at 48kHz
      const buffer = new Float32Array(30000);

      // Fill with neutral gray values (0 normalized frequency)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(640);
        expect(result.height).toBe(2); // PD120 produces 2 rows per scan line
      }
    });

    test('handles frequency offset', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0.1);
      expect(result).not.toBeNull();
    });

    test('handles negative frequency offset', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, -0.1);
      expect(result).not.toBeNull();
    });
  });

  describe('Decoded Line Structure', () => {
    test('returns correct width for PD120', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.width).toBe(640);
      }
    });

    test('returns two rows per scan line', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.height).toBe(2);
        // 640 pixels × 2 rows × 4 components (RGBA) = 5120 bytes
        expect(result.pixels.length).toBe(640 * 2 * 4);
      }
    });

    test('returns RGBA pixel data', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
        expect(result.pixels.length % 4).toBe(0);
      }
    });

    test('pixel values are in valid range', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        for (let i = 0; i < result.pixels.length; i++) {
          expect(result.pixels[i]).toBeGreaterThanOrEqual(0);
          expect(result.pixels[i]).toBeLessThanOrEqual(255);
        }
      }
    });

    test('isOddLine is always false for PD120', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.isOddLine).toBe(false);
      }
    });
  });

  describe('YUV to RGB Conversion', () => {
    test('produces valid RGB colors from gray input', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);

      // Fill with neutral gray (0 = 1900 Hz center frequency)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check first pixel RGB values
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];
        const a = result.pixels[3];

        expect(a).toBe(255); // Alpha should be 255
        expect(r).toBeGreaterThanOrEqual(0);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
      }
    });

    test('alpha channel is always 255', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Check every 4th byte (alpha channel)
        for (let i = 3; i < result.pixels.length; i += 4) {
          expect(result.pixels[i]).toBe(255);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    test('handles empty buffer gracefully', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).toBeNull();
    });

    test('handles buffer with extreme positive values', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(100);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();
    });

    test('handles buffer with extreme negative values', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(-100);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();
    });

    test('handles sync pulse at various positions', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
        decoder.decodeScanLine(buffer, 100, 0);
        decoder.decodeScanLine(buffer, 500, 0);
      }).not.toThrow();
    });
  });

  describe('Sample Rate Scaling', () => {
    test('scales timing with sample rate', () => {
      const decoder44k = new PD120LineDecoder(44100);
      const decoder48k = new PD120LineDecoder(48000);

      // Buffer sizes scale with sample rate
      const buffer44k = new Float32Array(27500); // ~508ms at 44.1kHz
      const buffer48k = new Float32Array(30000); // ~508ms at 48kHz

      buffer44k.fill(0);
      buffer48k.fill(0);

      const result44k = decoder44k.decodeScanLine(buffer44k, 0, 0);
      const result48k = decoder48k.decodeScanLine(buffer48k, 0, 0);

      expect(result44k).not.toBeNull();
      expect(result48k).not.toBeNull();

      if (result44k !== null && result48k !== null) {
        // Both should produce same dimensions
        expect(result44k.width).toBe(result48k.width);
        expect(result44k.height).toBe(result48k.height);
      }
    });
  });

  describe('Multiple Scan Lines', () => {
    test('processes consecutive scan lines independently', () => {
      const decoder = new PD120LineDecoder(sampleRate);
      const buffer = new Float32Array(30000);
      buffer.fill(0);

      const result1 = decoder.decodeScanLine(buffer, 0, 0);
      const result2 = decoder.decodeScanLine(buffer, 0, 0);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();

      if (result1 !== null && result2 !== null) {
        expect(result1.width).toBe(result2.width);
        expect(result1.height).toBe(result2.height);
      }
    });
  });
});
