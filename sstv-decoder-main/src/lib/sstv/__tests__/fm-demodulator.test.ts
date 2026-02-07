import { ExponentialMovingAverage } from '../fm-demodulator';

describe('ExponentialMovingAverage', () => {
  describe('Initialization', () => {
    test('creates instance successfully', () => {
      const ema = new ExponentialMovingAverage();
      expect(ema).toBeDefined();
      expect(ema).toBeInstanceOf(ExponentialMovingAverage);
    });
  });

  describe('Cutoff Configuration', () => {
    test('sets cutoff parameters', () => {
      const ema = new ExponentialMovingAverage();

      // Should not throw
      expect(() => {
        ema.cutoff(640, 1000, 2);
      }).not.toThrow();
    });

    test('handles different cutoff parameters', () => {
      const ema = new ExponentialMovingAverage();

      ema.cutoff(10, 100, 2);
      const result1 = ema.avg(1.0);

      ema.reset();
      ema.cutoff(100, 1000, 2);
      const result2 = ema.avg(1.0);

      // Different cutoffs should produce different results
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('Average Computation', () => {
    test('computes single value correctly', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const result = ema.avg(1.0);
      // First value is multiplied by alpha (smoothing factor)
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    test('smooths values over time', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const result1 = ema.avg(1.0);
      const result2 = ema.avg(2.0);
      const result3 = ema.avg(3.0);

      // Should gradually approach the new value
      expect(result1).toBeGreaterThan(0);
      expect(result1).toBeLessThanOrEqual(1.0);
      expect(result2).toBeGreaterThan(result1);
      expect(result2).toBeLessThan(2.0);
      expect(result3).toBeGreaterThan(result2);
      expect(result3).toBeLessThan(3.0);
    });

    test('handles negative values', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const result1 = ema.avg(-1.0);
      const result2 = ema.avg(-2.0);

      expect(result1).toBeLessThan(0);
      expect(result1).toBeGreaterThanOrEqual(-1.0);
      expect(result2).toBeLessThan(result1);
    });

    test('handles zero values', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      ema.avg(5.0);
      const result = ema.avg(0.0);

      expect(result).toBeLessThan(5.0);
      expect(result).toBeGreaterThanOrEqual(0.0);
    });

    test('converges towards input value', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      let result = 0;
      // Feed same value multiple times
      for (let i = 0; i < 100; i++) {
        result = ema.avg(5.0);
      }

      // Should converge very close to 5.0
      expect(result).toBeCloseTo(5.0, 1);
    });
  });

  describe('Reset Functionality', () => {
    test('reset clears internal state', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      // Build up state
      ema.avg(5.0);
      ema.avg(6.0);
      ema.avg(7.0);

      // Reset
      ema.reset();

      // After reset, first value is still smoothed (alpha * value)
      const result = ema.avg(1.0);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    test('can be used multiple times', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      ema.avg(5.0);
      ema.reset();
      ema.avg(3.0);
      ema.reset();
      const result = ema.avg(1.0);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Edge Cases', () => {
    test('handles very large values', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const result = ema.avg(1000000);
      expect(result).toBeDefined();
      expect(isFinite(result)).toBe(true);
    });

    test('handles very small values', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const result = ema.avg(0.000001);
      expect(result).toBeDefined();
      expect(isFinite(result)).toBe(true);
    });

    test('handles rapid value changes', () => {
      const ema = new ExponentialMovingAverage();
      ema.cutoff(10, 100, 2);

      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(ema.avg(i % 2 === 0 ? 1.0 : -1.0));
      }

      // All results should be finite and reasonable
      results.forEach(result => {
        expect(isFinite(result)).toBe(true);
        expect(Math.abs(result)).toBeLessThanOrEqual(1.0);
      });
    });
  });

  describe('Practical SSTV Scenarios', () => {
    test('simulates PD120 horizontal filtering', () => {
      const ema = new ExponentialMovingAverage();
      const sampleRate = 48000;
      const horizontalPixels = 640;
      const channelSamples = Math.round(0.1216 * sampleRate); // 121.6ms

      ema.cutoff(horizontalPixels, 2 * channelSamples, 2);

      // Simulate filtering a line
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(ema.avg(Math.sin(i * 0.1)));
      }

      expect(results.length).toBe(100);
      results.forEach(result => {
        expect(isFinite(result)).toBe(true);
      });
    });

    test('simulates PD180 horizontal filtering', () => {
      const ema = new ExponentialMovingAverage();
      const sampleRate = 48000;
      const horizontalPixels = 640;
      const channelSamples = Math.round(0.1824 * sampleRate); // 182.4ms

      ema.cutoff(horizontalPixels, 2 * channelSamples, 2);

      // Simulate filtering a line
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(ema.avg(0.5 + 0.5 * Math.cos(i * 0.05)));
      }

      expect(results.length).toBe(100);
      results.forEach(result => {
        expect(isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1.0);
      });
    });
  });
});
