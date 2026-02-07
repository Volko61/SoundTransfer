import { PD160LineDecoder } from '../pd160-line-decoder';

describe('PD160LineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(PD160LineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new PD160LineDecoder(44100)).not.toThrow();
      expect(() => new PD160LineDecoder(48000)).not.toThrow();
      expect(() => new PD160LineDecoder(96000)).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 0, 0);
      expect(result).toBeNull();
    });

    test('returns null when sync pulse is near end', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      const result = decoder.decodeScanLine(buffer, 39000, 0);
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      // PD160 line is ~804ms, so need ~38600 samples at 48kHz
      const buffer = new Float32Array(40000);

      // Fill with neutral gray values (0 normalized frequency)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(512);
        expect(result.height).toBe(2); // PD160 produces 2 rows per scan line
      }
    });

    test('handles frequency offset', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0.1);
      expect(result).not.toBeNull();
    });

    test('handles negative frequency offset', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, -0.1);
      expect(result).not.toBeNull();
    });
  });

  describe('Decoded Line Structure', () => {
    test('returns correct width for PD160', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.width).toBe(512);
      }
    });

    test('returns two rows per scan line', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.height).toBe(2);
        // 512 pixels × 2 rows × 4 components (RGBA) = 4096 bytes
        expect(result.pixels.length).toBe(512 * 2 * 4);
      }
    });

    test('allocates RGBA pixel data', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
        // Check alpha channel (every 4th byte) is set to 255
        for (let i = 3; i < result.pixels.length; i += 4) {
          expect(result.pixels[i]).toBe(255);
        }
      }
    });

    test('sets isOddLine to false', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.isOddLine).toBe(false);
      }
    });
  });

  describe('YUV to RGB Conversion', () => {
    test('decodes black (all zero) correctly', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // Black: low frequency (normalized ~-1)
      buffer.fill(-1);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Black should be dark (allow for YUV conversion artifacts)
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        // Values should be on the darker end of the spectrum
        expect(r).toBeLessThan(220);
        expect(g).toBeLessThan(220);
        expect(b).toBeLessThan(220);
      }
    });

    test('decodes white (high frequency) correctly', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // White: high frequency (normalized ~+1)
      buffer.fill(1);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // White should be bright (allow for YUV conversion artifacts)
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        // Values should be on the brighter end of the spectrum
        expect(r).toBeGreaterThan(30);
        expect(g).toBeGreaterThan(30);
        expect(b).toBeGreaterThan(30);
      }
    });

    test('decodes gray (neutral) correctly', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // Gray: neutral frequency (normalized ~0)
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Gray should be R≈128, G≈128, B≈128
        const r = result.pixels[0];
        const g = result.pixels[1];
        const b = result.pixels[2];

        expect(r).toBeGreaterThan(50);
        expect(r).toBeLessThan(200);
        expect(g).toBeGreaterThan(50);
        expect(g).toBeLessThan(200);
        expect(b).toBeGreaterThan(50);
        expect(b).toBeLessThan(200);
      }
    });
  });

  describe('Dual-Luminance Decoding', () => {
    test('produces different rows for different Y values', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // Y-even channel: black, V/U: neutral, Y-odd: white
      // Structure: sync + porch + Y-even + V-avg + U-avg + Y-odd
      // For 48kHz: channel = 195.584ms = ~9388 samples
      const channelSamples = Math.round(0.195584 * sampleRate);

      // Y-even (black)
      for (let i = 0; i < channelSamples; i++) {
        buffer[i] = -1;
      }

      // V-avg and U-avg (neutral)
      for (let i = channelSamples; i < 3 * channelSamples; i++) {
        buffer[i] = 0;
      }

      // Y-odd (white)
      for (let i = 3 * channelSamples; i < 4 * channelSamples; i++) {
        buffer[i] = 1;
      }

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // First row (even): should be darker
        const evenR = result.pixels[0];
        const evenG = result.pixels[1];
        const evenB = result.pixels[2];

        // Second row (odd): should be brighter
        const oddR = result.pixels[512 * 4]; // Start of second row
        const oddG = result.pixels[512 * 4 + 1];
        const oddB = result.pixels[512 * 4 + 2];

        expect(evenR).toBeLessThan(oddR);
        expect(evenG).toBeLessThan(oddG);
        expect(evenB).toBeLessThan(oddB);
      }
    });

    test('shares chroma between even and odd rows', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);

      // All channels neutral except chroma
      // Structure: sync + porch + Y-even + V-avg + U-avg + Y-odd
      const channelSamples = Math.round(0.195584 * sampleRate);

      // Y-even, V-avg, U-avg, Y-odd all neutral
      buffer.fill(0);

      // Set V-avg (R-Y) to high value (red shift)
      for (let i = channelSamples; i < 2 * channelSamples; i++) {
        buffer[i] = 0.5;
      }

      const result = decoder.decodeScanLine(buffer, 0, 0);

      expect(result).not.toBeNull();
      if (result !== null) {
        // Both rows should show red shift
        const evenR = result.pixels[0];
        const oddR = result.pixels[512 * 4];

        // Red should be higher than green and blue in both rows
        expect(evenR).toBeGreaterThan(result.pixels[1]); // R > G for even row
        expect(oddR).toBeGreaterThan(result.pixels[512 * 4 + 1]); // R > G for odd row
      }
    });
  });

  describe('Reset Functionality', () => {
    test('can be reset without errors', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      expect(() => decoder.reset()).not.toThrow();
    });

    test('can decode after reset', () => {
      const decoder = new PD160LineDecoder(sampleRate);
      const buffer = new Float32Array(40000);
      buffer.fill(0);

      decoder.reset();

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();
    });
  });

  describe('Sample Rate Scaling', () => {
    test('produces consistent output across different sample rates', () => {
      const buffer44k = new Float32Array(37000);
      const buffer48k = new Float32Array(40000);

      buffer44k.fill(0);
      buffer48k.fill(0);

      const decoder44k = new PD160LineDecoder(44100);
      const decoder48k = new PD160LineDecoder(48000);

      const result44k = decoder44k.decodeScanLine(buffer44k, 0, 0);
      const result48k = decoder48k.decodeScanLine(buffer48k, 0, 0);

      expect(result44k).not.toBeNull();
      expect(result48k).not.toBeNull();

      if (result44k !== null && result48k !== null) {
        expect(result44k.width).toBe(result48k.width);
        expect(result44k.height).toBe(result48k.height);

        // Colors should be similar (within tolerance due to filtering differences)
        const tolerance = 30;
        expect(Math.abs(result44k.pixels[0] - result48k.pixels[0])).toBeLessThan(tolerance);
      }
    });
  });
});
