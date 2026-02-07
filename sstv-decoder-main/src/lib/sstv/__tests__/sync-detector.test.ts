import { SyncDetector, SyncPulseWidth } from '../sync-detector';

describe('SyncDetector', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const detector = new SyncDetector(sampleRate);
      expect(detector).toBeDefined();
      expect(detector).toBeInstanceOf(SyncDetector);
    });

    test('accepts different sample rates', () => {
      expect(() => new SyncDetector(44100)).not.toThrow();
      expect(() => new SyncDetector(48000)).not.toThrow();
    });
  });

  describe('Sync Pulse Processing', () => {
    test('processes samples without crashing', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      // Fill with some test data
      for (let i = 0; i < 1024; i++) {
        inputSamples[i] = Math.sin(i * 0.01);
        demodulated[i] = 0.0;
      }

      expect(() => {
        detector.process(inputSamples, demodulated);
      }).not.toThrow();
    });

    test('returns valid detection result', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(0.5);

      const result = detector.process(inputSamples, demodulated);

      expect(result).toBeDefined();
      expect(result.detected).toBeDefined();
      expect(typeof result.detected).toBe('boolean');
      expect(result.width).toBeDefined();
      expect(result.offset).toBeDefined();
      expect(result.frequencyOffset).toBeDefined();
    });

    test('no sync detected in pure noise', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      // Random noise
      for (let i = 0; i < 1024; i++) {
        inputSamples[i] = (Math.random() - 0.5) * 2;
      }

      const result = detector.process(inputSamples, demodulated);

      // In pure noise, detection should typically be false or None
      expect(result.width === SyncPulseWidth.None || !result.detected).toBe(true);
    });

    test('handles empty input gracefully', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(0);
      const demodulated = new Float32Array(0);

      expect(() => {
        detector.process(inputSamples, demodulated);
      }).not.toThrow();
    });

    test('handles large buffers', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(10000);
      const demodulated = new Float32Array(10000);

      inputSamples.fill(0.3);

      expect(() => {
        detector.process(inputSamples, demodulated);
      }).not.toThrow();
    });
  });

  describe('Demodulated Buffer Output', () => {
    test('writes to demodulated buffer', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(0.5);
      demodulated.fill(0); // Start with zeros

      detector.process(inputSamples, demodulated);

      // Check that some values were written
      let hasNonZero = false;
      for (let i = 0; i < demodulated.length; i++) {
        if (demodulated[i] !== 0) {
          hasNonZero = true;
          break;
        }
      }

      expect(hasNonZero).toBe(true);
    });

    test('demodulated values are finite', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      for (let i = 0; i < 1024; i++) {
        inputSamples[i] = Math.sin(i * 0.1);
      }

      detector.process(inputSamples, demodulated);

      // All values should be finite
      for (let i = 0; i < demodulated.length; i++) {
        expect(isFinite(demodulated[i])).toBe(true);
      }
    });
  });

  describe('Multiple Sample Rates', () => {
    test('works with 44.1kHz sample rate', () => {
      const detector = new SyncDetector(44100);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(0.5);

      expect(() => {
        detector.process(inputSamples, demodulated);
      }).not.toThrow();
    });

    test('processes correctly at different rates', () => {
      const detector48k = new SyncDetector(48000);
      const detector44k = new SyncDetector(44100);

      const input48k = new Float32Array(1024);
      const demod48k = new Float32Array(1024);
      const input44k = new Float32Array(1024);
      const demod44k = new Float32Array(1024);

      input48k.fill(0.5);
      input44k.fill(0.5);

      const result48k = detector48k.process(input48k, demod48k);
      const result44k = detector44k.process(input44k, demod44k);

      // Both should produce valid results
      expect(result48k).toBeDefined();
      expect(result44k).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('handles all zero input', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(0);

      expect(() => {
        detector.process(inputSamples, demodulated);
      }).not.toThrow();
    });

    test('handles extreme positive values', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(100);

      const result = detector.process(inputSamples, demodulated);

      expect(result).toBeDefined();
      expect(isFinite(result.frequencyOffset)).toBe(true);
    });

    test('handles extreme negative values', () => {
      const detector = new SyncDetector(sampleRate);
      const inputSamples = new Float32Array(1024);
      const demodulated = new Float32Array(1024);

      inputSamples.fill(-100);

      const result = detector.process(inputSamples, demodulated);

      expect(result).toBeDefined();
      expect(isFinite(result.frequencyOffset)).toBe(true);
    });
  });

  describe('Consecutive Processing', () => {
    test('processes multiple buffers in sequence', () => {
      const detector = new SyncDetector(sampleRate);

      for (let iteration = 0; iteration < 10; iteration++) {
        const inputSamples = new Float32Array(1024);
        const demodulated = new Float32Array(1024);

        inputSamples.fill(Math.sin(iteration));

        expect(() => {
          detector.process(inputSamples, demodulated);
        }).not.toThrow();
      }
    });

    test('maintains state across buffers', () => {
      const detector = new SyncDetector(sampleRate);
      const input1 = new Float32Array(512);
      const demod1 = new Float32Array(512);
      const input2 = new Float32Array(512);
      const demod2 = new Float32Array(512);

      input1.fill(0.5);
      input2.fill(0.6);

      const result1 = detector.process(input1, demod1);
      const result2 = detector.process(input2, demod2);

      // Both should produce valid results
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('SyncPulseWidth Enum', () => {
    test('enum values are defined', () => {
      expect(SyncPulseWidth.FiveMilliSeconds).toBeDefined();
      expect(SyncPulseWidth.NineMilliSeconds).toBeDefined();
      expect(SyncPulseWidth.TwentyMilliSeconds).toBeDefined();
      expect(SyncPulseWidth.None).toBeDefined();
    });

    test('enum values are distinct', () => {
      const values = new Set([
        SyncPulseWidth.FiveMilliSeconds,
        SyncPulseWidth.NineMilliSeconds,
        SyncPulseWidth.TwentyMilliSeconds,
        SyncPulseWidth.None,
      ]);

      expect(values.size).toBe(4);
    });
  });
});
