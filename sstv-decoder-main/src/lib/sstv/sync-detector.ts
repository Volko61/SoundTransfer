/**
 * SSTV Sync Pulse Detector
 * Detects 1200Hz sync pulses of various durations (5ms, 9ms, 20ms)
 * Based on xdsopl/robot36 Demodulator.java
 */

import {
  Complex,
  Phasor,
  FrequencyModulation,
  SimpleMovingAverage,
  SchmittTrigger,
  Delay,
  ComplexConvolution,
} from './fm-demodulator';

export enum SyncPulseWidth {
  FiveMilliSeconds,
  NineMilliSeconds,
  TwentyMilliSeconds,
  None,
}

export interface SyncPulseDetection {
  detected: boolean;
  width: SyncPulseWidth;
  offset: number; // Sample offset where sync pulse ended
  frequencyOffset: number; // Frequency calibration offset
}

export class SyncDetector {
  private syncPulseFilter: SimpleMovingAverage;
  private baseBandLowPass: ComplexConvolution;
  private frequencyModulation: FrequencyModulation;
  private syncPulseTrigger: SchmittTrigger;
  private baseBandOscillator: Phasor;
  private syncPulseValueDelay: Delay;

  private syncPulseCounter: number = 0;
  private centerFrequency: number;
  private scanLineBandwidth: number;
  private syncPulseFrequencyValue: number;
  private syncPulseFrequencyTolerance: number;

  private syncPulse5msMinSamples: number;
  private syncPulse5msMaxSamples: number;
  private syncPulse9msMaxSamples: number;
  private syncPulse20msMaxSamples: number;
  private syncPulseFilterDelay: number;

  // Debug counters
  private debugSampleCount: number = 0;
  private debugLastLogTime: number = 0;
  private debugMaxCounter: number = 0;

  public static readonly SYNC_PULSE_FREQ = 1200;
  public static readonly BLACK_FREQ = 1500;
  public static readonly WHITE_FREQ = 2300;

  constructor(sampleRate: number) {
    // Use the same approach as Java: bandwidth is black-to-white range
    this.scanLineBandwidth = SyncDetector.WHITE_FREQ - SyncDetector.BLACK_FREQ;  // 800Hz
    this.frequencyModulation = new FrequencyModulation(this.scanLineBandwidth, sampleRate);

    // Sync pulse timing
    const syncPulse5msSeconds = 0.005;
    const syncPulse9msSeconds = 0.009;
    const syncPulse20msSeconds = 0.020;

    // Min/max bounds for pulse width detection
    const syncPulse5msMinSeconds = syncPulse5msSeconds / 2;
    const syncPulse5msMaxSeconds = (syncPulse5msSeconds + syncPulse9msSeconds) / 2;
    const syncPulse9msMaxSeconds = (syncPulse9msSeconds + syncPulse20msSeconds) / 2;
    const syncPulse20msMaxSeconds = syncPulse20msSeconds + syncPulse5msSeconds;

    this.syncPulse5msMinSamples = Math.round(syncPulse5msMinSeconds * sampleRate);
    this.syncPulse5msMaxSamples = Math.round(syncPulse5msMaxSeconds * sampleRate);
    this.syncPulse9msMaxSamples = Math.round(syncPulse9msMaxSeconds * sampleRate);
    this.syncPulse20msMaxSamples = Math.round(syncPulse20msMaxSeconds * sampleRate);

    // Sync pulse filter
    const syncPulseFilterSeconds = syncPulse5msSeconds / 2;
    const syncPulseFilterSamples = Math.round(syncPulseFilterSeconds * sampleRate) | 1;
    this.syncPulseFilterDelay = (syncPulseFilterSamples - 1) / 2;
    this.syncPulseFilter = new SimpleMovingAverage(syncPulseFilterSamples);
    this.syncPulseValueDelay = new Delay(syncPulseFilterSamples);

    // Baseband conversion - same as Java
    const lowestFrequency = 1000;   // 1000Hz (below sync)
    const highestFrequency = 2800;  // 2800Hz (above white)
    const cutoffFrequency = (highestFrequency - lowestFrequency) / 2;
    const baseBandLowPassSeconds = 0.002;
    const baseBandLowPassSamples = Math.round(baseBandLowPassSeconds * sampleRate) | 1;
    this.baseBandLowPass = ComplexConvolution.createLowPassFilter(baseBandLowPassSamples, cutoffFrequency, sampleRate);
    this.centerFrequency = (lowestFrequency + highestFrequency) / 2;  // 1900Hz
    this.baseBandOscillator = new Phasor(-this.centerFrequency, sampleRate);

    // Sync pulse detection thresholds
    this.syncPulseFrequencyValue = this.normalizeFrequency(SyncDetector.SYNC_PULSE_FREQ);
    this.syncPulseFrequencyTolerance = (50 * 2) / this.scanLineBandwidth;

    const syncPorchFrequency = 1500;
    const syncHighFrequency = (SyncDetector.SYNC_PULSE_FREQ + syncPorchFrequency) / 2;
    const syncLowFrequency = (SyncDetector.SYNC_PULSE_FREQ + syncHighFrequency) / 2;
    const syncLowValue = this.normalizeFrequency(syncLowFrequency);
    const syncHighValue = this.normalizeFrequency(syncHighFrequency);

    this.syncPulseTrigger = new SchmittTrigger(syncLowValue, syncHighValue);

    // Log configuration for debugging
    console.log(`🔧 SyncDetector initialized:`);
    console.log(`   Center freq: ${this.centerFrequency}Hz, Bandwidth: ${this.scanLineBandwidth}Hz`);
    console.log(`   Sync freq: ${SyncDetector.SYNC_PULSE_FREQ}Hz → normalized: ${this.syncPulseFrequencyValue.toFixed(3)}`);
    console.log(`   Schmitt trigger: low=${syncLowValue.toFixed(3)} (${syncLowFrequency}Hz), high=${syncHighValue.toFixed(3)} (${syncHighFrequency}Hz)`);
    console.log(`   Pulse width samples: 5ms=${this.syncPulse5msMinSamples}-${this.syncPulse5msMaxSamples}, 9ms=${this.syncPulse5msMaxSamples}-${this.syncPulse9msMaxSamples}, 20ms=${this.syncPulse9msMaxSamples}-${this.syncPulse20msMaxSamples}`);
    console.log(`   Freq tolerance: ${this.syncPulseFrequencyTolerance.toFixed(3)}`);
  }

  private normalizeFrequency(frequency: number): number {
    return ((frequency - this.centerFrequency) * 2) / this.scanLineBandwidth;
  }

  /**
   * Process audio samples and detect sync pulses
   * @param samples Input audio samples
   * @param demodulated Output buffer for demodulated frequency values
   * @returns Sync pulse detection result
   */
  process(samples: Float32Array, demodulated: Float32Array): SyncPulseDetection {
    let syncPulseDetected = false;
    let syncPulseWidth = SyncPulseWidth.None;
    let syncPulseOffset = 0;
    let frequencyOffset = 0;

    this.debugSampleCount += samples.length;

    // Track demodulated value statistics
    let minDemod = Infinity;
    let maxDemod = -Infinity;
    let sumDemod = 0;

    for (let i = 0; i < samples.length; i++) {
      // Convert to complex baseband (shift center frequency to 0)
      let baseBand = new Complex(samples[i], 0).mul(this.baseBandOscillator.rotate());

      // Apply lowpass filter to baseband signal
      baseBand = this.baseBandLowPass.push(baseBand);

      // FM demodulation
      const frequencyValue = this.frequencyModulation.demod(baseBand);

      // Filter for sync detection (matches Robot36 implementation)
      const syncPulseValue = this.syncPulseFilter.avg(frequencyValue);
      const syncPulseDelayedValue = this.syncPulseValueDelay.push(syncPulseValue);

      // Store UNcompensated value for line decoder
      // Line decoder expects normalized frequency values (±1.0 range) to convert to pixel levels
      demodulated[i] = frequencyValue;

      // Track demodulated value statistics
      minDemod = Math.min(minDemod, syncPulseValue);
      maxDemod = Math.max(maxDemod, syncPulseValue);
      sumDemod += syncPulseValue;

      // Track max counter for debugging
      if (this.syncPulseCounter > this.debugMaxCounter) {
        this.debugMaxCounter = this.syncPulseCounter;
      }

      // Sync pulse detection using Schmitt trigger
      if (!this.syncPulseTrigger.latch(syncPulseValue)) {
        // In sync pulse (low frequency)
        this.syncPulseCounter++;
      } else if (
        this.syncPulseCounter < this.syncPulse5msMinSamples ||
        this.syncPulseCounter > this.syncPulse20msMaxSamples ||
        Math.abs(syncPulseDelayedValue - this.syncPulseFrequencyValue) > this.syncPulseFrequencyTolerance
      ) {
        // Invalid sync pulse - log why
        if (this.syncPulseCounter > 0) {
          const now = Date.now();
          if (now - this.debugLastLogTime > 1000) {  // Log every 1 second instead of 5
            const reason =
              this.syncPulseCounter < this.syncPulse5msMinSamples ? 'too short' :
              this.syncPulseCounter > this.syncPulse20msMaxSamples ? 'too long' :
              'freq mismatch';
            console.log(`❌ Rejected pulse: ${reason}, counter=${this.syncPulseCounter} (need ${this.syncPulse5msMinSamples}-${this.syncPulse20msMaxSamples}), freqDiff=${Math.abs(syncPulseDelayedValue - this.syncPulseFrequencyValue).toFixed(3)} (tol=${this.syncPulseFrequencyTolerance.toFixed(3)})`);
            console.log(`   syncPulseValue=${syncPulseValue.toFixed(3)}, delayed=${syncPulseDelayedValue.toFixed(3)}, target=${this.syncPulseFrequencyValue.toFixed(3)}`);
            this.debugLastLogTime = now;
          }
        }
        this.syncPulseCounter = 0;
      } else {
        // Valid sync pulse detected!
        if (this.syncPulseCounter < this.syncPulse5msMaxSamples) {
          syncPulseWidth = SyncPulseWidth.FiveMilliSeconds;
        } else if (this.syncPulseCounter < this.syncPulse9msMaxSamples) {
          syncPulseWidth = SyncPulseWidth.NineMilliSeconds;
        } else {
          syncPulseWidth = SyncPulseWidth.TwentyMilliSeconds;
        }

        syncPulseOffset = i - this.syncPulseFilterDelay;
        frequencyOffset = syncPulseDelayedValue - this.syncPulseFrequencyValue;
        syncPulseDetected = true;
        console.log(`✅ Valid sync detected: width=${syncPulseWidth}, counter=${this.syncPulseCounter}, freqOffset=${frequencyOffset.toFixed(3)}`);
        this.syncPulseCounter = 0;
        this.debugMaxCounter = 0;
      }
    }

    // Periodic debug logging
    const now = Date.now();
    if (now - this.debugLastLogTime > 3000 && !syncPulseDetected) {
      // Track COMPENSATED values (raw after compensation), not filtered EMA values
      let minCompensated = Infinity;
      let maxCompensated = -Infinity;
      let sumCompensated = 0;
      for (let i = 0; i < demodulated.length; i++) {
        minCompensated = Math.min(minCompensated, demodulated[i]);
        maxCompensated = Math.max(maxCompensated, demodulated[i]);
        sumCompensated += demodulated[i];
      }
      const avgCompensated = sumCompensated / demodulated.length;
      const avgFiltered = sumDemod / samples.length;

      console.log(`🔍 SyncDetector: ${this.debugSampleCount} samples, maxCounter=${this.debugMaxCounter}`);
      console.log(`   RAW compensated: min=${minCompensated.toFixed(3)}, max=${maxCompensated.toFixed(3)}, avg=${avgCompensated.toFixed(3)}`);
      console.log(`   Filtered (EMA): min=${minDemod.toFixed(3)}, max=${maxDemod.toFixed(3)}, avg=${avgFiltered.toFixed(3)}`);
      console.log(`   Target sync: ${this.syncPulseFrequencyValue.toFixed(3)} ± ${this.syncPulseFrequencyTolerance.toFixed(3)}`);
      console.log(`   Schmitt thresholds: low=-1.563, high=-1.375 (trigger on sync pulse)`);
      this.debugLastLogTime = now;
      this.debugMaxCounter = 0;
    }

    return {
      detected: syncPulseDetected,
      width: syncPulseWidth,
      offset: syncPulseOffset,
      frequencyOffset,
    };
  }

  reset(): void {
    this.syncPulseFilter.reset();
    this.frequencyModulation.reset();
    this.syncPulseTrigger.reset();
    this.syncPulseValueDelay.reset();
    this.syncPulseCounter = 0;
  }
}
