# SSTV Decoder Architecture

## Overview

This is a web-based SSTV (Slow Scan Television) decoder supporting multiple modes including Robot36 Color and PD120. The implementation follows professional DSP techniques with FM demodulation, sync pulse detection, and proper color space processing, based on the [Robot36 Android app](https://github.com/xdsopl/robot36) by xdsopl.

**Live Demo:** [https://sstv-decoder.vercel.app](https://sstv-decoder.vercel.app)

## Supported SSTV Modes

### Robot36 Color
- **Resolution**: 320×240 pixels
- **Line time**: ~150ms (fast mode)
- **Total time**: ~36 seconds
- **Color encoding**: Interlaced YUV (Y + R-Y/B-Y alternating)
- **Use case**: Quick transmissions, amateur radio

### PD120
- **Resolution**: 640×496 pixels
- **Scan line time**: ~508ms per scan line
- **Total time**: ~2 minutes 6 seconds
- **Color encoding**: Dual-luminance YUV (Y-even + V-avg + U-avg + Y-odd)
- **Rows per scan**: 2 rows (shared chroma)
- **Use case**: High-quality images, ISS SSTV events

For detailed specifications, see:
- [Robot36 Technical Documentation](./doc/ROBOT36.md)
- [PD120 Technical Documentation](./doc/PD120.md)

### Mode Comparison

| Feature | Robot36 | PD120 |
|---------|---------|-------|
| **Resolution** | 320×240 | 640×496 |
| **Total Pixels** | 76,800 | 317,440 (4.1×) |
| **Sync Pulse** | 9ms | 20ms |
| **Scan Line Time** | 150ms | 508ms |
| **Total Time** | 36 seconds | 2m 6s |
| **Scan Lines** | 240 | 248 |
| **Rows per Scan** | 1 row | 2 rows |
| **Color Encoding** | Interlaced YUV | Dual-luminance YUV |
| **Chroma Strategy** | Alternating R-Y/B-Y | Shared V-avg/U-avg |
| **Vertical Subsampling** | 2:1 (interlaced) | 2:1 (shared) |
| **ISS Usage** | Rare | Very Common |
| **Best For** | Quick QSOs | High-quality images |

### Key Features

- **Multi-mode support** - Robot36 (320×240) and PD120 (640×496) with manual mode selection
- **Sync pulse detection** - Detects 9ms (Robot36) and 20ms (PD120) pulses at 1200Hz
- **Line-based processing** - Buffers audio and decodes complete lines after sync detection
- **FM demodulation** - Converts audio to baseband complex signal, extracts instantaneous frequency
- **Bidirectional filtering** - Forward and backward exponential moving average for smooth horizontal pixels
- **Mode-specific decoding**:
  - Robot36: Interlaced YUV (even lines R-Y, odd lines B-Y, paired for RGB)
  - PD120: Dual-luminance (2 rows per scan, shared chroma)
- **Multi-browser support** - Works on Chrome, Firefox, Safari (desktop and mobile)
- **Real-time visualization** - Live spectrum analyzer and signal strength meter
- **Progressive rendering** - Image appears line-by-line as it decodes

### Technology Stack

**Frontend:**
- Next.js 15 (React 19, App Router)
- TypeScript 5
- Canvas API for image rendering

**Audio Processing:**
- Web Audio API (AudioContext, MediaStream)
- ScriptProcessorNode (Chrome/Firefox/Edge)
- requestAnimationFrame polling (Safari/iOS fallback)
- AnalyserNode for spectrum visualization

**DSP Implementation:**
- Complex baseband conversion
- FM demodulation (phase differentiation)
- Kaiser-windowed FIR lowpass filter
- Exponential moving average (bidirectional)
- Schmitt trigger sync detection
- ITU-R BT.601 YUV color space

## Getting Started

### Prerequisites
- Node.js 18+
- Modern browser with Web Audio API support
- Microphone access (for real-time decoding)

### Installation

```bash
# Clone the repository
git clone https://github.com/smolgroot/sstv-decoder.git
cd sstv-decoder

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

### Usage

1. Open the app in your browser
2. Click "Start Decoding" to enable microphone
3. Play an SSTV signal (from radio, audio file, or signal generator)
4. Watch the image decode in real-time
5. Click "Save Image" to download the result

### Module Structure

The codebase is organized into modular DSP components and decoder logic:

```
src/lib/sstv/
├── constants.ts           # SSTV mode specifications
│   └── Defines Robot36 timing, frequencies, and image dimensions
│
├── fm-demodulator.ts      # DSP building blocks
│   ├── Complex            # Complex number math (multiply, conjugate, argument)
│   ├── Phasor             # Oscillator for baseband conversion
│   ├── FrequencyModulation # FM demodulation: arg(sample × conj(prev)) / π
│   ├── SimpleMovingAverage # Circular buffer averaging
│   ├── SchmittTrigger     # Dual-threshold state machine
│   ├── Delay              # Sample delay buffer
│   └── ExponentialMovingAverage # Configurable EMA for bidirectional filtering
│
├── sync-detector.ts       # Sync pulse detection
│   └── SyncDetector       # Detects 1200Hz sync pulses (5ms/9ms/20ms)
│       ├── Converts audio to complex baseband (Phasor at -1900Hz)
│       ├── FM demodulates baseband signal
│       ├── Applies moving average filter
│       ├── Uses Schmitt trigger to detect sync threshold crossings
│       └── Returns pulse width classification + frequency offset calibration
│
├── robot36-line-decoder.ts # Robot36 line decoding
│   └── Robot36LineDecoder
│       ├── Timing: sync(9ms) + syncPorch(3ms) + Y(88ms) + sep(4.5ms) + porch(1.5ms) + chroma(44ms)
│       ├── Separator frequency determines even (R-Y chroma) vs odd (B-Y chroma)
│       ├── Bidirectional filtering: forward pass then backward pass with EMA
│       ├── Even lines: Store Y + R-Y for interlacing
│       ├── Odd lines: Combine with stored even line → Output 2 RGB pixel rows
│       └── YUV→RGB: ITU-R BT.601 color space conversion
│
└── decoder.ts             # Main decoder orchestration
    └── SSTVDecoder
        ├── Maintains dual circular buffers (raw audio + FM demodulated)
        ├── Processes samples through sync detector continuously
        ├── When sync pulse detected, extracts line between sync boundaries
        ├── Passes extracted line to Robot36LineDecoder
        ├── Updates canvas with decoded RGB pixel data
        └── Tracks signal strength, frequency offset, and decode progress
```

**Additional Components:**

```
src/hooks/
└── useAudioProcessor.ts   # Web Audio API integration
    ├── Manages AudioContext and MediaStream
    ├── Handles microphone access and permissions
    ├── Dual strategy: ScriptProcessorNode (Chrome/Firefox) + polling (Safari)
    └── Provides spectrum analyzer via AnalyserNode

src/components/
└── SSTVDecoder.tsx        # React UI component
    ├── Canvas rendering (decoded image + spectrum)
    ├── Control buttons (start/stop/reset/save)
    ├── Real-time stats display (mode, line, frequency, signal strength)
    └── Responsive design for mobile and desktop
```

### Processing Flow

The decoder processes audio in a multi-stage pipeline:

```
1. AUDIO INPUT
   └── Microphone → Web Audio API (44.1kHz or 48kHz)

2. DUAL BUFFER STORAGE
   ├── Raw audio buffer (7 seconds circular)
   └── FM demodulated buffer (7 seconds circular)

3. SYNC DETECTION (SyncDetector.process)
   ├── Convert to complex baseband (multiply by Phasor at -1900Hz center frequency)
   ├── FM demodulate: instantaneous_frequency = arg(sample × conj(prev)) / π
   ├── Apply moving average filter (smoothing)
   ├── Schmitt trigger: detect frequency drops below -1.750 threshold (1200Hz sync)
   ├── Measure pulse width duration
   └── Classify: 5ms (VIS half), 9ms (scan line), 20ms (VIS full)

4. LINE EXTRACTION
   ├── When 9ms sync detected, calculate distance to previous sync
   ├── Extract demodulated samples between sync boundaries
   └── Pass to Robot36LineDecoder

5. LINE DECODING (Robot36LineDecoder.decodeScanLine)
   ├── Parse line structure: sync → porch → Y → separator → porch → chroma
   ├── Detect even/odd line type from separator frequency
   ├── Apply bidirectional exponential moving average (forward + backward)
   ├── Extract 320 luminance (Y) pixels from 88ms segment
   ├── Extract 320 chrominance pixels from 44ms segment
   ├── **Even lines**: Store Y + R-Y for interlacing
   ├── **Odd lines**: Combine stored even Y+R-Y with odd Y+B-Y
   ├── YUV→RGB conversion (ITU-R BT.601)
   └── Output 2 RGB pixel rows (even + odd combined)

6. IMAGE UPDATE
   ├── Copy decoded RGB pixels to canvas imageData (Uint8ClampedArray)
   ├── Progressive rendering (updates visible immediately)
   └── Update statistics (line count, progress %, frequency offset)

7. VISUALIZATION
   ├── Main canvas: Decoded SSTV image (320×240 → scaled)
   ├── Spectrum canvas: Real-time frequency spectrum (FFT)
   └── Stats display: Mode, line progress, frequency, signal strength
```

### Robot36 Format Specifications

**Image Format:**
- Resolution: 320×240 pixels
- Color: Interlaced YUV (ITU-R BT.601)
- Line time: ~150ms per scan line
- Total image time: ~36 seconds (240 lines)
- Sample rate: Adaptive (44.1kHz or 48kHz)

**Frequency Mapping:**
- Sync pulse: 1200 Hz (9ms duration)
- Black level: 1500 Hz
- Gray level: 1900 Hz (center frequency)
- White level: 2300 Hz
- Frequency range: 800 Hz (1500-2300 Hz)

**Scan Line Structure:**
```
|--9ms--|--3ms--|--------88ms--------|--4.5ms--|1.5ms|-------44ms-------|
  Sync   S.Porch   Luminance (Y)      Separator Porch  Chrominance
 1200Hz  1500Hz    (320 pixels)      (even/odd) 1900Hz  (R-Y or B-Y)
                   1500-2300Hz                          1500-2300Hz
```

**Timing Breakdown:**
- Sync: 9ms @ 1200Hz (line boundary marker)
- Sync porch: 3ms @ 1500Hz (transition period)
- Luminance (Y): 88ms @ 1500-2300Hz (brightness, 320 pixels)
- Separator: 4.5ms @ frequency determines even/odd
- Porch: 1.5ms @ 1900Hz (transition period)
- Chrominance: 44ms @ 1500-2300Hz (color difference, 320 pixels)

**Interlaced Color Encoding:**
- **Even lines** (separator < 0): Y + R-Y chrominance (red difference)
- **Odd lines** (separator > 0): Y + B-Y chrominance (blue difference)
- Decoding combines consecutive even/odd pairs → outputs 2 RGB rows per odd line

**Horizontal Filtering:**
- Algorithm: Bidirectional exponential moving average (EMA)
- Configuration: Adaptive cutoff based on line length
- Process: Forward pass (left→right) + Backward pass (right→left)
- Purpose: Smooth horizontal transitions, reduce noise while preserving detail

### Key Algorithms

#### FM Demodulation
```typescript
// Convert audio to complex baseband
const baseband = sample.multiply(oscillator.nextComplex());

// Instantaneous frequency from phase difference
const frequency = baseband.multiply(prevSample.conjugate()).argument() / Math.PI;
```

#### Sync Detection
```typescript
// Schmitt trigger with hysteresis
if (value < lowThreshold) state = false;
if (value > highThreshold) state = true;

// Classify pulse width
const pulseWidthMs = (pulseLength / sampleRate) * 1000;
if (pulseWidthMs < 7) return SyncPulseWidth.FiveMilliSeconds;
if (pulseWidthMs < 15) return SyncPulseWidth.NineMilliSeconds;
return SyncPulseWidth.TwentyMilliSeconds;
```

#### Bidirectional Filtering
```typescript
// Forward pass
for (let i = start; i < end; i++) {
  buffer[i] = ema.avg(input[i]);
}

// Backward pass
ema.reset();
for (let i = end - 1; i >= start; i--) {
  buffer[i] = ema.avg(buffer[i]);
}
```

#### YUV to RGB (ITU-R BT.601)
```typescript
const yScaled = (y - 16) * 298;
const uScaled = u - 128;
const vScaled = v - 128;

r = (yScaled + 409 * vScaled + 128) >> 8;
g = (yScaled - 100 * uScaled - 208 * vScaled + 128) >> 8;
b = (yScaled + 516 * uScaled + 128) >> 8;
```

### Testing Plan

1. **Sync Detection Test**: Verify 1200Hz sync pulses are detected
2. **Timing Test**: Confirm 150ms line spacing
3. **Frequency Calibration**: Check frequency offset correction
4. **Interlacing Test**: Verify even/odd line pairing
5. **Color Test**: Confirm YUV→RGB conversion produces correct colors

### Current Limitations & Future Enhancements

**Current Scope:**
- Multi-mode support (Robot36, PD120)
- Manual mode selection via settings UI
- 7-second audio buffer (sufficient for normal operation)
- Manual volume adjustment required for optimal signal levels

**Planned Improvements:**

**Phase 1 - Additional PD Modes (Low Complexity):**
- [ ] PD50, PD90, PD160, PD180, PD240, PD290
- [ ] All use dual-luminance encoding like PD120
- [ ] Minimal code changes required

**Phase 2 - Robot Family:**
- [ ] Robot72 Color (similar to Robot36, longer duration)
- [ ] Uses same interlaced YUV structure

**Phase 3 - Sequential RGB Modes:**
- [ ] Scottie S1, S2, DX (RGB sequential)
- [ ] Martin M1, M2 (GBR sequential)
- [ ] Wraase SC2-180

**Phase 4 - Advanced Features:**
- [ ] VIS code detection for automatic mode selection
- [ ] Automatic gain control (AGC)
- [ ] Enhanced noise reduction algorithms
- [ ] Audio file upload for offline decoding

### Implementation Notes

This decoder is a TypeScript/Web Audio API port of the algorithms from the [Robot36 Android app](https://github.com/xdsopl/robot36) by Ahmet Inan (xdsopl). The core DSP techniques (FM demodulation, complex baseband conversion, bidirectional filtering, and interlaced YUV processing) closely follow the original Java implementation while adapting to the web platform.

**Key Adaptations:**
- Dynamic sample rate support (44.1kHz or 48kHz) for browser compatibility
- Dual audio processing strategy (ScriptProcessorNode + requestAnimationFrame polling)
- Real-time canvas rendering for progressive image display
- Mobile-responsive UI with touch support

### Performance Characteristics

**Processing Efficiency:**
- Audio latency: ~35-90ms (depending on browser/buffer size)
- Decode time: Real-time (processes as fast as audio arrives)
- Memory usage: ~50MB for buffers + image data
- CPU usage: 5-15% on modern devices (single core)

**Signal Requirements:**
- Frequency range: 1200-2300 Hz
- Minimum SNR: 15 dB for reliable sync detection
- Recommended input level: -20dB to -6dB (not clipping)
- Works with: Radio receivers, audio files, signal generators, ISS transmissions
