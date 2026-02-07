// SSTV Mode Specifications
export interface SSTVMode {
  readonly name: string;
  readonly visCode: number;
  readonly width: number;
  readonly height: number;
  readonly scanTime: number; // milliseconds per line
  readonly syncPulse: number; // milliseconds
  readonly syncPorch: number; // milliseconds
  readonly porchFreq: number; // Hz
  readonly separatorPulse: number; // milliseconds (default separator)
  readonly separatorPulses?: readonly number[]; // Optional: different separator after each channel (for Robot36)
  readonly colorScanTime: number; // milliseconds per color component (for uniform modes)
  readonly colorScanTimes?: readonly number[]; // Optional: different scan time per channel (for Robot36)
  readonly colorOrder: readonly ('R' | 'G' | 'B')[];
}

// SSTV modes
export const SSTV_MODES = {
  ROBOT36: {
    name: 'Robot 36',
    visCode: 8,
    width: 320,
    height: 240,
    // Actual line: sync(9) + syncPorch(3) + Y(88) + separator(4.5) + porch(1.5) + chrominance(44) = 150ms
    scanTime: 150,
    syncPulse: 9,
    syncPorch: 3,
    porchFreq: 1500,
    separatorPulse: 4.5,
    separatorPulses: [4.5], // Only one separator after Y
    colorScanTime: 88,
    colorScanTimes: [88, 44], // Y=88ms, then ONE chrominance channel=44ms (alternates R-Y/B-Y)
    colorOrder: ['G', 'R', 'B'], // Not used for Robot36 (it's interlaced)
  },
  ROBOT72: {
    name: 'Robot 72',
    visCode: 12,
    width: 320,
    height: 240,
    // Robot72 line: sync(9) + syncPorch(3) + Y(138) + separator(4.5) + porch(1.5) + V(69) + separator(4.5) + porch(1.5) + U(69) = 300ms
    // Sequential YUV encoding (no interlacing) - better color fidelity than Robot36
    scanTime: 300,
    syncPulse: 9,
    syncPorch: 3,
    porchFreq: 1500,
    separatorPulse: 4.5,
    separatorPulses: [4.5, 4.5], // Two separators (after Y and after V)
    colorScanTime: 138,
    colorScanTimes: [138, 69, 69], // Y=138ms, V=69ms, U=69ms (all three channels per line)
    colorOrder: ['G', 'R', 'B'], // Actually Y, V (R-Y), U (B-Y)
  },
  PD120: {
    name: 'PD 120',
    visCode: 95,
    width: 640,
    height: 496,
    // PD120 line format: sync(20) + porch(2.08) + Y(121.6) + separator(4.862) + porch(1.504) + R(121.6) + separator(4.862) + porch(1.504) + B(121.6) = 496.628ms per line
    scanTime: 496.628,
    syncPulse: 20,
    syncPorch: 2.08,
    porchFreq: 1500,
    separatorPulse: 4.862,
    separatorPulses: [4.862, 4.862], // Two separators (after Y and after R)
    colorScanTime: 121.6,
    colorScanTimes: [121.6, 121.6, 121.6], // Y, R, B channels all 121.6ms
    colorOrder: ['G', 'R', 'B'], // Actually Y, R, B for PD modes
  },
  PD160: {
    name: 'PD 160',
    visCode: 98,
    width: 512,
    height: 400,
    // PD160 line format: sync(20) + porch(2.08) + Y-even(195.584) + V-avg(195.584) + U-avg(195.584) + Y-odd(195.584) = 804.416ms per line
    // Balanced mode: 382µs per pixel (between PD120's 190µs and PD180's 286µs)
    // Total transmission time: ~160s for 200 scan lines (400 rows / 2)
    scanTime: 804.416,
    syncPulse: 20,
    syncPorch: 2.08,
    porchFreq: 1500,
    separatorPulse: 0, // PD160 uses dual-luminance, no separators
    separatorPulses: [], // No separators in PD160
    colorScanTime: 195.584,
    colorScanTimes: [195.584, 195.584, 195.584, 195.584], // Y-even, V-avg, U-avg, Y-odd channels all 195.584ms
    colorOrder: ['G', 'R', 'B'], // Actually Y, V, U for PD modes (dual-luminance)
  },
  PD180: {
    name: 'PD 180',
    visCode: 96,
    width: 640,
    height: 496,
    // PD180 line format: sync(20) + porch(2.08) + Y-even(182.4) + V-avg(182.4) + U-avg(182.4) + Y-odd(182.4) = 751.68ms per line
    // Higher quality than PD120: 286µs per pixel vs 190µs per pixel
    scanTime: 751.68,
    syncPulse: 20,
    syncPorch: 2.08,
    porchFreq: 1500,
    separatorPulse: 0, // PD180 uses dual-luminance, no separators
    separatorPulses: [], // No separators in PD180
    colorScanTime: 182.4,
    colorScanTimes: [182.4, 182.4, 182.4, 182.4], // Y-even, V-avg, U-avg, Y-odd channels all 182.4ms
    colorOrder: ['G', 'R', 'B'], // Actually Y, V, U for PD modes (dual-luminance)
  },
  SCOTTIE_S1: {
    name: 'Scottie S1',
    visCode: 60,
    width: 320,
    height: 256,
    // Scottie S1 line format (after first line): sync(9) + R(138.24) + sep(1.5) + G(138.24) + sep(1.5) + B(138.24) = 428.22ms
    // First line is special: sync(9) + sep(1.5) + G(138.24) + sep(1.5) + B(138.24) + sync(9) + sep(1.5) + R(138.24) = 438.72ms
    // RGB sequential encoding (no YUV conversion needed)
    scanTime: 428.22,
    syncPulse: 9,
    syncPorch: 0, // Scottie uses separator, not sync porch
    porchFreq: 1500,
    separatorPulse: 1.5,
    separatorPulses: [1.5, 1.5], // Two separators (after R and after G)
    colorScanTime: 138.24,
    colorScanTimes: [138.24, 138.24, 138.24], // R, G, B channels all 138.24ms
    colorOrder: ['R', 'G', 'B'], // RGB sequential (sync-R-sep-G-sep-B)
  },
  SCOTTIE_S2: {
    name: 'Scottie S2',
    visCode: 56,
    width: 320,
    height: 256,
    // Scottie S2 is faster than S1: sync(9) + R(88.064) + sep(1.5) + G(88.064) + sep(1.5) + B(88.064) = 277.692ms
    // Same RGB sequential encoding as S1, just faster transmission
    // Transmission order: Green → Blue → [SYNC] → Red (negative timing like S1)
    scanTime: 277.692,
    syncPulse: 9,
    syncPorch: 0, // Scottie uses separator, not sync porch
    porchFreq: 1500,
    separatorPulse: 1.5,
    separatorPulses: [1.5, 1.5], // Two separators (after R and after G)
    colorScanTime: 88.064,
    colorScanTimes: [88.064, 88.064, 88.064], // R, G, B channels all 88.064ms
    colorOrder: ['R', 'G', 'B'], // RGB sequential (G-B-sync-R order in time)
  },
} as const;

// Frequency constants
export const FREQ_SYNC = 1200; // Hz - sync pulse
export const FREQ_BLACK = 1500; // Hz - black level
export const FREQ_WHITE = 2300; // Hz - white level
export const FREQ_VIS_BIT1 = 1100; // Hz - VIS bit 1
export const FREQ_VIS_BIT0 = 1300; // Hz - VIS bit 0
export const FREQ_VIS_START = 1900; // Hz - VIS start bit
export const FREQ_VIS_STOP = 1200; // Hz - VIS stop bit

export const SAMPLE_RATE = 44100; // Standard audio sample rate
