# Scottie S2 Mode Implementation

## Overview

Scottie S2 is a faster variant of the Scottie S1 mode, designed for quicker image transmission while maintaining the same resolution. Like S1, it uses RGB-based encoding and is popular on HF (shortwave) amateur radio bands. The key difference is transmission speed: S2 completes an image in approximately **71 seconds** versus S1's **110 seconds**, making it **36% faster**.

Scottie S2 maintains the same negative timing structure as S1 (Green → Blue → Sync → Red) but with significantly shorter channel durations (88.064ms vs 138.24ms per channel).

## Technical Specifications

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Resolution** | 320 × 256 pixels | Same as Scottie S1 |
| **VIS Code** | 56 | Vertical Interval Signaling identifier |
| **Scan Time** | 277.692 ms/line | 36% faster than S1 |
| **Total Time** | ~71 seconds | 256 lines × ~278ms |
| **Color Encoding** | RGB Sequential | Direct transmission, no YUV |
| **Channel Time** | 88.064 ms | Each R, G, B channel |
| **Separator** | 1.5 ms | Between channels |
| **Sync Pulse** | 9 ms | Same as S1 and Robot modes |

## Timing Breakdown

### Regular Scan Line (Lines 2-256): 277.692ms total

```
Sync Pulse:      9.00 ms   (1200 Hz sync tone)
R Channel:      88.064 ms  (Red: 1500-2300 Hz)
Separator:       1.50 ms   (1500 Hz separator)
G Channel:      88.064 ms  (Green: 1500-2300 Hz)
Separator:       1.50 ms   (1500 Hz separator)
B Channel:      88.064 ms  (Blue: 1500-2300 Hz)
─────────────────────────
Total:         277.692 ms
```

### Actual Transmission Order (Negative Timing)

The channels are transmitted in this order in real-time:

```
Time Relative to Sync Pulse (t=0):

Green:     -186.628 to -98.564 ms  (BEFORE sync)
Separator:  -98.564 to -97.064 ms
Blue:       -97.064 to  -9.000 ms  (BEFORE sync)
SYNC:        -9.000 to   0.000 ms
Separator:    0.000 to   1.500 ms  (AFTER sync)
Red:          1.500 to  89.564 ms  (AFTER sync)
```

## Comparison: Scottie S2 vs S1

### Speed Difference

| Aspect | Scottie S1 | Scottie S2 | Ratio |
|--------|------------|------------|-------|
| **Channel Time** | 138.24 ms | 88.064 ms | **64%** |
| **Scan Line Time** | 428.22 ms | 277.692 ms | **65%** |
| **Total Time** | ~110 seconds | ~71 seconds | **65%** |
| **Pixel Dwell Time** | 0.432 ms | 0.275 ms | **64%** |

Scottie S2 achieves its 35% time savings by reducing each channel duration by 36%, maintaining the same resolution but with faster pixel scanning.

### Quality Trade-offs

**Scottie S1 Advantages:**
- Longer pixel dwell time = better SNR (~1.5 dB advantage)
- More robust in weak signal conditions
- Better horizontal detail preservation
- Preferred for weak/noisy HF conditions

**Scottie S2 Advantages:**
- 36% faster transmission (71s vs 110s)
- Less susceptible to fading (shorter duration)
- Better for rapidly changing propagation
- Preferred for good signal conditions

### Technical Comparison

| Feature | Scottie S1 | Scottie S2 | Notes |
|---------|------------|------------|-------|
| **Resolution** | 320×256 | 320×256 | Identical |
| **Color Encoding** | RGB Sequential | RGB Sequential | Identical |
| **Negative Timing** | Yes | Yes | Identical structure |
| **Color Order** | G-B-[SYNC]-R | G-B-[SYNC]-R | Identical |
| **Sync Pulse** | 9ms | 9ms | Identical |
| **Separator** | 1.5ms | 1.5ms | Identical |
| **SNR vs S1** | 0 dB (baseline) | -1.5 dB | S2 is noisier |
| **ISS Usage** | Rare | Occasional | Both uncommon |

## Implementation Details

### Negative Timing (Pre-Sync Transmission)

Scottie S2 inherits the same "negative timing" structure from S1:

```typescript
// From RGBModes.Scottie() in Java reference
const blueEndSeconds = -syncPulseSeconds;            // -9ms (ends at sync)
const blueBeginSeconds = blueEndSeconds - channelSeconds; // -97.064ms
const greenEndSeconds = blueBeginSeconds - separatorSeconds; // -98.564ms
const greenBeginSeconds = greenEndSeconds - channelSeconds; // -186.628ms
const redBeginSeconds = separatorSeconds;             // +1.5ms (after sync)
const redEndSeconds = redBeginSeconds + channelSeconds; // +89.564ms
```

This means:
1. Decoder must buffer data **~187ms before** the sync pulse
2. Actual channel order in time: Green → Separator → Blue → Sync → Separator → Red
3. Total buffered data span: 186.628ms (before) + 89.564ms (after) = **276.192ms**

### RGB Direct Conversion

Same as S1 - no YUV conversion needed:

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

Bidirectional EMA filtering adapted for faster scan rate:

```typescript
// Configure for 320 pixels horizontal resolution
// S2 channels are shorter, so filter cutoff adjusts accordingly
lowPassFilter.cutoff(320, 2 * greenSamples, 2);

// Forward pass
for (let i = 0; i < samples; i++) {
  scratchBuffer[i] = lowPassFilter.avg(scanLineBuffer[i]);
}

// Backward pass with frequency-to-level conversion
for (let i = samples - 1; i >= 0; i--) {
  scratchBuffer[i] = freqToLevel(lowPassFilter.avg(scratchBuffer[i]), frequencyOffset);
}
```

The shorter channel duration in S2 (88.064ms vs 138.24ms) means:
- Faster horizontal scanning
- Higher cutoff frequency for lowpass filter
- Slightly reduced horizontal detail compared to S1

## Frequency Mapping

All three channels use the same frequency range (identical to S1):

| Level | Frequency | Color Intensity |
|-------|-----------|-----------------|
| **Black** | 1500 Hz | 0% (minimum) |
| **Mid-gray** | 1900 Hz | 50% (middle) |
| **White** | 2300 Hz | 100% (maximum) |

Linear mapping: `intensity = (frequency - 1500) / 800`

## Usage Recommendations

### When to Use Scottie S2

**Best For:**
- ✅ Good signal conditions (strong, stable propagation)
- ✅ Time-constrained QSOs (limited transmission window)
- ✅ Rapidly fading channels (shorter transmission = less fading)
- ✅ Good SNR situations (>15 dB)
- ✅ Avoiding QRM/interference (shorter on-air time)

**Avoid When:**
- ❌ Weak signals (use S1 for better SNR)
- ❌ Deep QSB/fading (longer transmissions can integrate fades better)
- ❌ Poor propagation conditions
- ❌ High noise environments

### Scottie Mode Comparison

| Situation | Recommended Mode | Reason |
|-----------|------------------|---------|
| Weak HF signal | **Scottie S1** | +1.5 dB SNR advantage |
| Good HF signal | **Scottie S2** | 36% faster, adequate quality |
| Time limited | **Scottie S2** | Completes in 71s vs 110s |
| Very high quality | **Scottie DX** | 4× slower but best RGB quality |
| ISS SSTV | **Robot36** or **PD120** | Standard modes used by ISS |

## Historical Context

The Scottie family of modes was developed by Eddie Murphy (GM3SBC) in Scotland during the 1980s. The S2 variant was created to address the need for faster transmissions when signal conditions were good, allowing more QSOs in a given operating period.

**Scottie Family:**
- **S1**: Original, high-quality mode (110 seconds)
- **S2**: Fast mode for good conditions (71 seconds) - **THIS MODE**
- **DX**: Highest quality variant (269 seconds)

## Decoder Implementation Notes

### Key Differences from S1

The Scottie S2 decoder is nearly identical to S1 with these changes:

```typescript
// S1 timing
const channelSeconds = 0.13824; // 138.24ms

// S2 timing (FASTER)
const channelSeconds = 0.088064; // 88.064ms

// Everything else remains the same:
// - Same negative timing structure
// - Same RGB sequential encoding
// - Same sync/separator durations
// - Same resolution (320×256)
```

### Buffer Requirements

Due to negative timing, the decoder requires:
- **Pre-sync buffer**: ~187ms (8976 samples @ 48kHz)
- **Post-sync buffer**: ~90ms (4320 samples @ 48kHz)
- **Total line buffer**: ~277ms (13296 samples @ 48kHz)
- **Recommended buffer**: 15000+ samples for safety margin

### Sample Rate Adaptation

The decoder automatically adapts to different sample rates:

| Sample Rate | Scan Line Samples | Pre-sync Samples | Post-sync Samples |
|-------------|-------------------|------------------|-------------------|
| **44.1 kHz** | 12,250 | -8,230 | +3,952 |
| **48.0 kHz** | 13,329 | -8,958 | +4,300 |
| **96.0 kHz** | 26,658 | -17,916 | +8,601 |

## Example Transmission Timeline

For a complete 320×256 Scottie S2 image:

```
VIS Header:          ~5 seconds
First Line:          ~287ms (special sync sequence)
Lines 2-256:         255 × 277.692ms = 70.8 seconds
─────────────────────────────────────
Total:               ~76 seconds (including VIS)
```

Compare to Scottie S1: ~115 seconds total (**34% faster**)

## Testing

The implementation includes 35 comprehensive unit tests covering:

### Timing Tests
- ✅ Scan line duration calculation
- ✅ First sync pulse handling
- ✅ Multiple sample rate support (44.1, 48, 96 kHz)
- ✅ Comparison with S1 timing

### Decoding Tests
- ✅ Buffer boundary validation
- ✅ Negative timing handling
- ✅ Frequency offset compensation
- ✅ RGB sequential output

### Quality Tests
- ✅ Black/white level decoding
- ✅ RGB value range validation
- ✅ Alpha channel verification
- ✅ Noise handling

### Edge Cases
- ✅ Zero/one/negative buffers
- ✅ Random noise resilience
- ✅ Various sync positions
- ✅ Reset functionality

## Performance Characteristics

### Computational Cost

Compared to YUV modes, Scottie S2 offers:
- **No YUV→RGB conversion**: Direct RGB values (simpler)
- **Sequential processing**: No interlacing logic
- **Shorter scan time**: Less CPU time per image (~35% reduction vs S1)

### Memory Requirements

- **Line buffer**: ~13-27KB (depending on sample rate)
- **Scratch buffer**: ~13-27KB (same as line buffer)
- **Pixel output**: 1.3KB per line (320 × 4 bytes RGBA)
- **Total per line**: ~27-55KB working memory

## References

### Java Reference Implementation
- Based on `xdsopl/robot36` RGBDecoder.java
- Factory method: `RGBModes.Scottie("2", 56, 0.088064, sampleRate)`
- VIS code: 56 (decimal), 0111000 (binary)

### SSTV Specification
- Martin Emmerson's SSTV Handbook
- DARC SSTV Handbook (German Amateur Radio Club)
- Robot Research SSTV Handbook

## See Also

- [Scottie S1 Documentation](./SCOTTIE_S1.md) - Original, slower variant
- [Robot36 Documentation](./ROBOT36.md) - Interlaced YUV mode
- [Robot72 Documentation](./ROBOT72.md) - Sequential YUV mode
- [Mode Comparison](./MODE_COMPARISON.md) - Detailed mode comparison
- [Architecture Documentation](./ARCHITECTURE.md) - System overview
