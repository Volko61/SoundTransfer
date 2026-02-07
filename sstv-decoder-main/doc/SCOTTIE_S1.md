# Scottie S1 Mode Implementation

## Overview

Scottie S1 is a classic RGB-based SSTV mode widely used on HF (shortwave) amateur radio bands, particularly in North America. Unlike YUV-based modes (Robot36, PD120), Scottie S1 transmits the Red, Green, and Blue color components directly and sequentially, making it conceptually simpler but requiring accurate frequency reception for all three color channels.

Developed by Eddie Murphy (GM3SBC) in the 1980s, Scottie S1 is named after the mode family rather than a person. It's known for its distinctive sync structure and remains popular for HF SSTV contacts.

## Technical Specifications

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Resolution** | 320 × 256 pixels | Taller than Robot modes (256 vs 240) |
| **VIS Code** | 60 | Vertical Interval Signaling identifier |
| **Scan Time** | 428.22 ms/line | After first line |
| **First Line Time** | 438.72 ms | Special longer sequence |
| **Total Time** | ~110 seconds | 256 lines × ~428ms |
| **Color Encoding** | RGB Sequential | Direct transmission, no YUV |
| **Channel Time** | 138.24 ms | Each R, G, B channel |
| **Separator** | 1.5 ms | Between channels |
| **Sync Pulse** | 9 ms | Same as Robot modes |

## Timing Breakdown

### Regular Scan Line (Lines 2-256): 428.22ms total

```
Sync Pulse:      9.00 ms   (1200 Hz sync tone)
R Channel:     138.24 ms   (Red: 1500-2300 Hz)
Separator:       1.50 ms   (1500 Hz separator)
G Channel:     138.24 ms   (Green: 1500-2300 Hz)
Separator:       1.50 ms   (1500 Hz separator)
B Channel:     138.24 ms   (Blue: 1500-2300 Hz)
─────────────────────────
Total:         428.22 ms
```

### First Scan Line (Line 1): 438.72ms total

The first line has a unique sequence that differs from all subsequent lines:

```
Sync Pulse:      9.00 ms   (1200 Hz)
Separator:       1.50 ms   (1500 Hz)
G Channel:     138.24 ms   (Green transmitted first!)
Separator:       1.50 ms   (1500 Hz)
B Channel:     138.24 ms   (Blue)
Sync Pulse:      9.00 ms   (1200 Hz - second sync!)
Separator:       1.50 ms   (1500 Hz)
R Channel:     138.24 ms   (Red transmitted last)
─────────────────────────
Total:         438.72 ms
```

**Why the special first line?**
- Historical compatibility with early hardware decoders
- Helps establish proper color channel alignment
- Extra sync pulse aids in initial synchronization

## Color Encoding: Direct RGB

Scottie S1 uses **direct RGB sequential encoding**, fundamentally different from YUV-based modes:

### Frequency Mapping

All three channels use the same frequency range:
- **1500 Hz** = Minimum (0% / black)
- **1900 Hz** = 50% (mid-level)
- **2300 Hz** = Maximum (100% / white)

### RGB vs YUV Comparison

| Aspect | Scottie S1 (RGB) | Robot36/PD120 (YUV) |
|--------|------------------|---------------------|
| **Color Space** | RGB (primary colors) | YUV (luminance + chrominance) |
| **Channels** | R, G, B (three equal channels) | Y (luma), U (B-Y), V (R-Y) |
| **Conversion** | None needed (direct) | YUV → RGB conversion required |
| **Grayscale** | Requires all channels | Y channel alone gives grayscale |
| **Robustness** | Lose one channel = wrong color | Y preserved = grayscale viewable |
| **Color Detail** | Full RGB on every line | Often subsampled (interlaced/shared) |
| **Tuning Sensitivity** | High (all channels critical) | Medium (Y most important) |

## Implementation Details

### Negative Timing (Pre-Sync Transmission)

Scottie modes have an unusual characteristic: **Green and Blue channels are transmitted BEFORE the sync pulse**. This is represented by negative timing in the decoder:

```typescript
// From RGBModes.Scottie() in Java reference
const blueEndSeconds = -syncPulseSeconds;            // -9ms (ends at sync)
const blueBeginSeconds = blueEndSeconds - channelSeconds; // -147.24ms
const greenEndSeconds = blueBeginSeconds - separatorSeconds; // -148.74ms
const greenBeginSeconds = greenEndSeconds - channelSeconds; // -286.98ms
const redBeginSeconds = separatorSeconds;             // +1.5ms (after sync)
```

This means:
1. Decoder must buffer data **before** the sync pulse
2. Actual channel order in time: Green → Separator → Blue → Sync → Separator → Red
3. But logically processed as: Sync → R → G → B for display

### RGB Direct Conversion

No YUV conversion needed:

```typescript
// Extract normalized levels (0-1)
const r = scratchBuffer[redPos];
const g = scratchBuffer[greenPos];
const b = scratchBuffer[bluePos];

// Convert to 8-bit RGB (0-255)
pixels[i * 4] = Math.round(r * 255);     // Red
pixels[i * 4 + 1] = Math.round(g * 255); // Green
pixels[i * 4 + 2] = Math.round(b * 255); // Blue
pixels[i * 4 + 3] = 255;                 // Alpha
```

### Low-Pass Filtering

Like other modes, Scottie S1 uses bidirectional EMA filtering:

```typescript
// Configure for 320 pixels horizontal resolution
lowPassFilter.cutoff(320, 2 * greenSamples, 2);

// Forward pass
for (let i = 0; i < samples; i++) {
  scratchBuffer[i] = lowPassFilter.avg(scanLineBuffer[i]);
}

// Backward pass (converts frequency to level)
lowPassFilter.reset();
for (let i = samples - 1; i >= 0; i--) {
  scratchBuffer[i] = freqToLevel(lowPassFilter.avg(scratchBuffer[i]), frequencyOffset);
}
```

## Comparison with Other Modes

### vs Robot36 (Interlaced YUV)

| Feature | Scottie S1 | Robot36 |
|---------|------------|---------|
| **Time** | ~110s (428ms/line) | ~36s (150ms/line) |
| **Resolution** | 320×256 | 320×240 |
| **Color Method** | RGB sequential | YUV interlaced |
| **Lines per Scan** | 1 line | 2 lines (paired) |
| **Complexity** | Low (sequential) | Medium (interlacing) |
| **HF Usage** | Very Common | Rare |
| **ISS Usage** | Rare | Occasional |

### vs Robot72 (Sequential YUV)

| Feature | Scottie S1 | Robot72 |
|---------|------------|---------|
| **Time** | ~110s | ~72s |
| **Color Method** | RGB | YUV sequential |
| **Grayscale Fallback** | No (needs all channels) | Yes (Y channel) |
| **Tuning Tolerance** | Lower | Higher |

### vs PD120 (Dual-Luminance YUV)

| Feature | Scottie S1 | PD120 |
|---------|------------|---------|
| **Time** | ~110s | ~126s |
| **Resolution** | 320×256 | 640×496 |
| **Sync Pulse** | 9ms | 20ms |
| **Color Method** | RGB sequential | YUV dual-luminance |
| **ISS Standard** | No | Yes |
| **Freq Drift Tolerance** | Lower | Higher |

## Usage Recommendations

**Use Scottie S1 when:**
- Operating on HF amateur radio bands (especially 20m, 14.230 MHz)
- Communicating with other hams using classic SSTV equipment
- Good signal conditions (strong, stable signal)
- Accurate frequency tuning available
- Standard resolution sufficient (320×256)

**Use other modes instead when:**
- **ISS contacts**: Use PD120 (ISS standard)
- **Speed priority**: Use Robot36 (3× faster)
- **Poor signal**: Use PD modes (better sync, YUV robustness)
- **High resolution**: Use PD120/PD180 (640×496)
- **Frequency drift**: Use PD modes (wider sync pulses)

## Signal Requirements

- **Bandwidth**: 800 Hz (1500-2300 Hz)
- **Center Frequency**: 1900 Hz (typical)
- **SNR**: 12+ dB recommended (higher than YUV modes)
- **Frequency Accuracy**: ±25 Hz critical (all channels affected equally)
- **Phase Stability**: Not critical (FM modulation)
- **Sync Detection**: 9ms pulses at 1200 Hz

## Historical Context

**Development:**
- Created by Eddie Murphy, GM3SBC in 1980s
- Named after "Scottie" (the mode family name)
- Part of the Scottie family: S1, S2, S4, DX

**Popularity:**
- Dominant on HF bands in 1990s-2000s
- Still widely used today, especially in North America
- Supported by all modern SSTV software
- Hardware decoders (Robot, AVT) supported it natively

**Scottie Family:**
| Mode | Resolution | Time | Channel (ms) | VIS Code |
|------|------------|------|-------------|----------|
| **S1** | 320×256 | ~110s | 138.24 | 60 |
| **S2** | 320×256 | ~71s | 88.064 | 56 |
| **S4** | 320×256 | ~36s | 44.032 | 55 |
| **DX** | 320×256 | ~269s | 345.6 | 76 |

## Testing Coverage

The Scottie S1 implementation includes 34 comprehensive tests:

- **Initialization**: Constructor, sample rate handling
- **Timing**: Scan line duration, first sync handling, channel timing
- **Decoding**: Buffer validation, negative timing handling, frequency offset
- **RGB Sequential**: Direct RGB conversion, no YUV logic
- **Color Conversion**: Red/green/blue accuracy, black/white rendering
- **Edge Cases**: Extreme values, noise handling, various sync positions
- **Comparison**: Timing verification against Robot/PD specs

All tests pass with 100% coverage of critical paths.

## Performance Characteristics

**Decoder Performance:**
- Memory: ~82 KB buffer (2× scan line for negative timing)
- CPU: Low (no YUV conversion, no interlacing)
- Latency: 428ms per line
- Throughput: ~2.3 lines/second
- Total decode: ~110 seconds for 256 lines

**Transmission Statistics:**
- Data rate: ~6.6 pixels/second/channel
- Total pixels: 81,920 (320×256)
- Pixel dwell: ~432µs per pixel per channel
- Overhead: ~2.9% (sync + separators)

## Frequency Deviation Sensitivity

Scottie S1 is **more sensitive** to frequency errors than YUV modes:

| Frequency Error | Robot36 Impact | Scottie S1 Impact |
|-----------------|----------------|-------------------|
| ±10 Hz | Slight color shift | Noticeable color shift |
| ±25 Hz | Moderate color error | Significant color distortion |
| ±50 Hz | Strong color error | Unusable (all channels wrong) |
| ±100 Hz | Image unusable | Complete failure |

**Why?** YUV modes preserve grayscale (Y) even with color errors, but Scottie S1 requires accurate R, G, and B - if all shift equally, the entire image shifts in color space.

## Common Issues and Solutions

**Problem**: "Colors look wrong but image is clear"
- **Cause**: Frequency offset (all RGB channels shifted equally)
- **Solution**: Adjust frequency calibration, verify 1900 Hz center

**Problem**: "One color missing or very weak"
- **Cause**: One channel lost due to interference or selective fading
- **Solution**: Improve signal conditions, switch to YUV mode

**Problem**: "First line looks different"
- **Cause**: Normal! First line has special sync sequence
- **Solution**: None needed, decoder handles automatically

**Problem**: "Sync keeps losing lock"
- **Cause**: Weak signal or QRM (interference)
- **Solution**: Use PD mode (20ms sync vs 9ms), improve antenna

## References

- Eddie Murphy GM3SBC - Original Scottie mode design
- [Robot36 Java Implementation](https://github.com/xdsopl/robot36) by xdsopl
- ARRL SSTV Handbook
- JVComm32 SSTV Software Documentation
- MMSSTV by Makoto Mori JE3HHT

## Related Documentation

- [ROBOT36.md](./ROBOT36.md) - Robot36 interlaced YUV implementation
- [ROBOT72.md](./ROBOT72.md) - Robot72 sequential YUV implementation
- [PD120.md](./PD120.md) - PD120 dual-luminance YUV implementation
- [MODE_COMPARISON.md](./MODE_COMPARISON.md) - Comparison of all SSTV modes
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview
