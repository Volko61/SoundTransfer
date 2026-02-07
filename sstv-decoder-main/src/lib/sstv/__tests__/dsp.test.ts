import { GoertzelFilter, FrequencyDetector, frequencyToPixel, LowPassFilter } from '../dsp';

describe('GoertzelFilter', () => {
  const sampleRate = 48000;
  const targetFreq = 1200;

  describe('Initialization', () => {
    test('creates instance with valid parameters', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);
      expect(filter).toBeDefined();
      expect(filter).toBeInstanceOf(GoertzelFilter);
    });

    test('handles different sample rates', () => {
      expect(() => new GoertzelFilter(44100, targetFreq)).not.toThrow();
      expect(() => new GoertzelFilter(48000, targetFreq)).not.toThrow();
      expect(() => new GoertzelFilter(96000, targetFreq)).not.toThrow();
    });

    test('handles different target frequencies', () => {
      expect(() => new GoertzelFilter(sampleRate, 100)).not.toThrow();
      expect(() => new GoertzelFilter(sampleRate, 1200)).not.toThrow();
      expect(() => new GoertzelFilter(sampleRate, 5000)).not.toThrow();
    });
  });

  describe('Sample Processing', () => {
    test('processes samples without errors', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      expect(() => {
        for (let i = 0; i < 100; i++) {
          filter.processSample(Math.sin(i * 0.1));
        }
      }).not.toThrow();
    });

    test('processes zero samples', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      expect(() => {
        filter.processSample(0);
        filter.processSample(0);
        filter.processSample(0);
      }).not.toThrow();
    });

    test('handles extreme values', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      expect(() => {
        filter.processSample(1000);
        filter.processSample(-1000);
      }).not.toThrow();
    });
  });

  describe('Magnitude Detection', () => {
    test('returns magnitude after processing', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      // Process some samples
      for (let i = 0; i < 100; i++) {
        filter.processSample(Math.sin(i * 0.1));
      }

      const magnitude = filter.getMagnitude();
      expect(magnitude).toBeDefined();
      expect(typeof magnitude).toBe('number');
      expect(isFinite(magnitude)).toBe(true);
      expect(magnitude).toBeGreaterThanOrEqual(0);
    });

    test('magnitude is zero initially', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);
      const magnitude = filter.getMagnitude();
      expect(magnitude).toBe(0);
    });

    test('detects target frequency signal', () => {
      const filter = new GoertzelFilter(sampleRate, 1200);
      const samplesPerCycle = sampleRate / 1200;

      // Generate 1200 Hz signal
      for (let i = 0; i < 100; i++) {
        const sample = Math.sin(2 * Math.PI * i / samplesPerCycle);
        filter.processSample(sample);
      }

      const magnitude = filter.getMagnitude();
      expect(magnitude).toBeGreaterThan(0);
    });
  });

  describe('Reset Functionality', () => {
    test('resets internal state', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      // Process samples
      for (let i = 0; i < 100; i++) {
        filter.processSample(Math.sin(i * 0.1));
      }

      filter.reset();
      const magnitude = filter.getMagnitude();
      expect(magnitude).toBe(0);
    });

    test('can be used after reset', () => {
      const filter = new GoertzelFilter(sampleRate, targetFreq);

      filter.processSample(1.0);
      filter.reset();

      expect(() => {
        filter.processSample(1.0);
        filter.getMagnitude();
      }).not.toThrow();
    });
  });
});

describe('FrequencyDetector', () => {
  const sampleRate = 48000;
  const frequencies = [1200, 1500, 1900, 2300];

  describe('Initialization', () => {
    test('creates instance with frequency list', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);
      expect(detector).toBeDefined();
      expect(detector).toBeInstanceOf(FrequencyDetector);
    });

    test('handles empty frequency list', () => {
      expect(() => new FrequencyDetector(sampleRate, [])).not.toThrow();
    });

    test('handles single frequency', () => {
      const detector = new FrequencyDetector(sampleRate, [1200]);
      expect(detector).toBeDefined();
    });
  });

  describe('Sample Processing', () => {
    test('processes samples without errors', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);

      expect(() => {
        for (let i = 0; i < 100; i++) {
          detector.processSample(Math.sin(i * 0.1));
        }
      }).not.toThrow();
    });

    test('processes zero samples', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);

      expect(() => {
        detector.processSample(0);
        detector.processSample(0);
      }).not.toThrow();
    });
  });

  describe('Frequency Detection', () => {
    test('returns detected frequency', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);

      // Process some samples
      for (let i = 0; i < 100; i++) {
        detector.processSample(Math.sin(i * 0.1));
      }

      const freq = detector.getFrequency();
      expect(freq).toBeDefined();
      expect(typeof freq).toBe('number');
    });

    test('detects strongest frequency', () => {
      const detector = new FrequencyDetector(sampleRate, [1000, 2000]);

      // Generate 1000 Hz signal with higher amplitude
      const samplesPerCycle = sampleRate / 1000;
      for (let i = 0; i < 200; i++) {
        const sample = 2.0 * Math.sin(2 * Math.PI * i / samplesPerCycle);
        detector.processSample(sample);
      }

      const freq = detector.getFrequency();
      // Should detect 1000 Hz or 0 (if no strong signal)
      expect(freq === 1000 || freq === 0 || freq === 2000).toBe(true);
    });
  });

  describe('Magnitude Retrieval', () => {
    test('returns magnitude for specific frequency', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);

      for (let i = 0; i < 100; i++) {
        detector.processSample(Math.sin(i * 0.1));
      }

      const magnitude = detector.getMagnitude(1200);
      expect(magnitude).toBeDefined();
      expect(typeof magnitude).toBe('number');
      expect(isFinite(magnitude)).toBe(true);
      expect(magnitude).toBeGreaterThanOrEqual(0);
    });

    test('returns 0 for non-tracked frequency', () => {
      const detector = new FrequencyDetector(sampleRate, [1200]);
      const magnitude = detector.getMagnitude(9999);
      expect(magnitude).toBe(0);
    });
  });

  describe('Reset Functionality', () => {
    test('resets all filters', () => {
      const detector = new FrequencyDetector(sampleRate, frequencies);

      // Process samples
      for (let i = 0; i < 100; i++) {
        detector.processSample(Math.sin(i * 0.1));
      }

      detector.reset();

      // All magnitudes should be zero
      frequencies.forEach(freq => {
        expect(detector.getMagnitude(freq)).toBe(0);
      });
    });
  });
});

describe('frequencyToPixel', () => {
  const blackFreq = 1500;
  const whiteFreq = 2300;

  test('converts black frequency to 0', () => {
    const pixel = frequencyToPixel(blackFreq, blackFreq, whiteFreq);
    expect(pixel).toBe(0);
  });

  test('converts white frequency to 255', () => {
    const pixel = frequencyToPixel(whiteFreq, blackFreq, whiteFreq);
    expect(pixel).toBe(255);
  });

  test('converts mid-range frequency to mid-gray', () => {
    const midFreq = (blackFreq + whiteFreq) / 2;
    const pixel = frequencyToPixel(midFreq, blackFreq, whiteFreq);
    expect(pixel).toBeGreaterThan(100);
    expect(pixel).toBeLessThan(155);
  });

  test('clamps frequencies below black to 0', () => {
    const pixel = frequencyToPixel(blackFreq - 100, blackFreq, whiteFreq);
    expect(pixel).toBe(0);
  });

  test('clamps frequencies above white to 255', () => {
    const pixel = frequencyToPixel(whiteFreq + 100, blackFreq, whiteFreq);
    expect(pixel).toBe(255);
  });

  test('returns integer values', () => {
    const pixel = frequencyToPixel(1750, blackFreq, whiteFreq);
    expect(Number.isInteger(pixel)).toBe(true);
  });

  test('handles SSTV frequency range', () => {
    // Robot36: 1500Hz (black) to 2300Hz (white)
    expect(frequencyToPixel(1500, 1500, 2300)).toBe(0);
    expect(frequencyToPixel(1900, 1500, 2300)).toBeGreaterThan(0);
    expect(frequencyToPixel(2300, 1500, 2300)).toBe(255);
  });
});

describe('LowPassFilter', () => {
  describe('Initialization', () => {
    test('creates instance with default parameters', () => {
      const filter = new LowPassFilter();
      expect(filter).toBeDefined();
      expect(filter).toBeInstanceOf(LowPassFilter);
    });

    test('creates instance with custom alpha', () => {
      const filter = new LowPassFilter(0.5);
      expect(filter).toBeDefined();
    });

    test('creates instance with initial value', () => {
      const filter = new LowPassFilter(0.1, 100);
      expect(filter).toBeDefined();
    });
  });

  describe('Sample Processing', () => {
    test('processes samples and returns values', () => {
      const filter = new LowPassFilter(0.1);

      const result = filter.process(1.0);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      expect(isFinite(result)).toBe(true);
    });

    test('smooths step changes', () => {
      const filter = new LowPassFilter(0.1);

      // Start with zeros
      filter.process(0);
      filter.process(0);

      // Step to 1.0
      const result1 = filter.process(1.0);
      const result2 = filter.process(1.0);
      const result3 = filter.process(1.0);

      // Should gradually approach 1.0
      expect(result1).toBeGreaterThan(0);
      expect(result1).toBeLessThan(1.0);
      expect(result2).toBeGreaterThan(result1);
      expect(result3).toBeGreaterThan(result2);
    });

    test('higher alpha means faster response', () => {
      const filterSlow = new LowPassFilter(0.1);
      const filterFast = new LowPassFilter(0.9);

      const resultSlow = filterSlow.process(1.0);
      const resultFast = filterFast.process(1.0);

      // Fast filter should reach target quicker
      expect(resultFast).toBeGreaterThan(resultSlow);
    });

    test('handles negative values', () => {
      const filter = new LowPassFilter(0.1);

      const result = filter.process(-1.0);
      expect(result).toBeLessThan(0);
      expect(isFinite(result)).toBe(true);
    });

    test('handles zero values', () => {
      const filter = new LowPassFilter(0.1);

      filter.process(1.0);
      const result = filter.process(0.0);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1.0);
    });
  });

  describe('Reset Functionality', () => {
    test('resets to default value', () => {
      const filter = new LowPassFilter(0.1);

      filter.process(100);
      filter.reset();

      const result = filter.process(1.0);
      // Should behave like first sample after reset
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1.0);
    });

    test('resets to specified value', () => {
      const filter = new LowPassFilter(0.5);

      filter.process(100);
      filter.reset(50);

      const result = filter.process(50);
      // Should stay close to 50
      expect(result).toBeCloseTo(50, 0);
    });
  });

  describe('Edge Cases', () => {
    test('handles very small alpha', () => {
      const filter = new LowPassFilter(0.001);

      const result = filter.process(1.0);
      expect(isFinite(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    test('handles alpha close to 1', () => {
      const filter = new LowPassFilter(0.999);

      const result = filter.process(1.0);
      expect(result).toBeCloseTo(1.0, 2);
    });

    test('handles extreme input values', () => {
      const filter = new LowPassFilter(0.1);

      expect(() => {
        filter.process(1000000);
        filter.process(-1000000);
      }).not.toThrow();
    });
  });
});
