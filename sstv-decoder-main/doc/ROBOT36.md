# Robot36 Color Mode - Technical Specification

## Overview

Robot36 is a fast SSTV mode designed for quick amateur radio transmissions. It uses interlaced YUV encoding with a transmission time of approximately 36 seconds.

## Image Specifications

| Parameter | Value |
|-----------|-------|
| **Resolution** | 320×240 pixels |
| **Aspect Ratio** | 4:3 |
| **Total Lines** | 240 (120 even + 120 odd) |
| **Line Time** | ~150ms per scan line |
| **Total Duration** | ~36 seconds |
| **VIS Code** | 8 |

## Frequency Mapping

| Signal | Frequency | Purpose |
|--------|-----------|---------|
| **Sync Pulse** | 1200 Hz | Line boundary marker (9ms) |
| **Black Level** | 1500 Hz | Minimum brightness |
| **Gray Level** | 1900 Hz | Center frequency |
| **White Level** | 2300 Hz | Maximum brightness |

**Frequency Range**: 800 Hz (1500-2300 Hz) represents 0-255 pixel values

## Scan Line Structure

```
Total: 150ms per line

|--9ms--|--3ms--|--------88ms--------|--4.5ms--|1.5ms|-------44ms-------|
  Sync   S.Porch   Luminance (Y)      Separator Porch  Chrominance
 1200Hz  1500Hz    320 pixels         Even/Odd  1900Hz  320 pixels
                   1500-2300Hz        indicator         1500-2300Hz
```

### Timing Breakdown

1. **Sync Pulse**: 9ms @ 1200 Hz
   - Purpose: Line boundary detection
   - Used by decoder to identify start of new line

2. **Sync Porch**: 3ms @ 1500 Hz
   - Purpose: Transition period after sync
   - Gives receiver time to stabilize

3. **Luminance (Y) Channel**: 88ms
   - 320 pixels of brightness information
   - Frequency range: 1500-2300 Hz (black to white)
   - Transmitted every line (even and odd)

4. **Separator Pulse**: 4.5ms
   - **Even lines**: Negative frequency (< 1900 Hz)
   - **Odd lines**: Positive frequency (> 1900 Hz)
   - Purpose: Tells decoder which chrominance component follows

5. **Porch**: 1.5ms @ 1900 Hz
   - Transition period before chrominance

6. **Chrominance Channel**: 44ms
   - 320 pixels of color information
   - **Even lines**: R-Y (red color difference)
   - **Odd lines**: B-Y (blue color difference)

## Color Encoding: Interlaced YUV

Robot36 uses an interlaced color scheme to reduce transmission time while maintaining reasonable color quality.

### Interlacing Strategy

```
Line 0 (even): Y₀ + (R-Y)₀    ← Store in buffer
Line 1 (odd):  Y₁ + (B-Y)₁    ← Combine with line 0, output 2 RGB rows

Line 2 (even): Y₂ + (R-Y)₂    ← Store in buffer
Line 3 (odd):  Y₃ + (B-Y)₃    ← Combine with line 2, output 2 RGB rows

...continues for 240 lines
```

### Decoding Process

1. **Even Line** (line 0, 2, 4, ...):
   - Store 320 Y (luminance) values
   - Store 320 R-Y (red difference) values
   - Wait for next line

2. **Odd Line** (line 1, 3, 5, ...):
   - Receive 320 new Y values
   - Receive 320 B-Y (blue difference) values
   - Combine with stored even line data:
     - Even row: `RGB = YUV_to_RGB(Y_even, R-Y_even, B-Y_odd)`
     - Odd row: `RGB = YUV_to_RGB(Y_odd, R-Y_even, B-Y_odd)`

### YUV to RGB Conversion (ITU-R BT.601)

```typescript
// Input:
//   Y:  Luminance (0-255)
//   RY: R-Y color difference (0-255, centered at 128)
//   BY: B-Y color difference (0-255, centered at 128)

// Convert to difference signals
const ryDiff = RY - 128;  // -128 to +127
const byDiff = BY - 128;  // -128 to +127

// ITU-R BT.601 conversion
R = Y + 1.402 × ryDiff
G = Y - 0.344136 × byDiff - 0.714136 × ryDiff
B = Y + 1.772 × byDiff

// Clamp to valid range
R = clamp(R, 0, 255)
G = clamp(G, 0, 255)
B = clamp(B, 0, 255)
```

## Signal Processing Pipeline

### 1. Sync Detection
- Monitor for 1200 Hz tone
- Measure pulse width (must be 9ms ±2ms)
- Calculate frequency offset for calibration

### 2. Line Extraction
- Extract audio samples between consecutive sync pulses
- Should contain ~150ms of audio data
- Pass to line decoder

### 3. Bidirectional Filtering
```typescript
// Forward pass (left to right)
for (i = 0; i < lineLength; i++) {
  filtered[i] = EMA.average(samples[i]);
}

// Backward pass (right to left)
EMA.reset();
for (i = lineLength - 1; i >= 0; i--) {
  filtered[i] = EMA.average(filtered[i]);
}
```

### 4. Separator Detection
```typescript
// Average separator pulse frequency
separatorFreq = average(samples[separatorStart:separatorEnd]);

// Determine line type
if (separatorFreq < 0) {
  lineType = EVEN;  // R-Y chrominance
} else {
  lineType = ODD;   // B-Y chrominance
}
```

### 5. Pixel Sampling
```typescript
// Sample 320 pixels from 88ms Y channel
for (x = 0; x < 320; x++) {
  sampleIndex = yStart + (x * ySamples) / 320;
  Y[x] = frequencyToLevel(samples[sampleIndex]);
}

// Sample 320 pixels from 44ms chrominance channel
for (x = 0; x < 320; x++) {
  sampleIndex = chromaStart + (x * chromaSamples) / 320;
  Chroma[x] = frequencyToLevel(samples[sampleIndex]);
}
```

## Chroma Noise Reduction

To improve color quality, a 5-pixel median filter is applied to chrominance channels:

```typescript
// For each pixel position
const window = [chroma[x-2], chroma[x-1], chroma[x], chroma[x+1], chroma[x+2]];
window.sort();
filteredChroma[x] = window[2];  // Median value
```

Additionally, chroma saturation is reduced by 30% to suppress color noise:

```typescript
const CHROMA_REDUCTION = 0.7;
chromaFiltered = 128 + (chroma - 128) * CHROMA_REDUCTION;
```

## Implementation Notes

### Sample Rate Handling
- Supports 44.1 kHz and 48 kHz sample rates
- All timing calculations scale proportionally
- Frequency calibration compensates for drift

### Buffer Management
- 7-second circular buffer for audio samples
- Separate buffer for FM demodulated values
- Line extraction uses buffer wrap-around logic

### Error Handling
- Validate separator frequency (reject if out of range)
- Check line length (should be ~150ms ±10%)
- Skip lines with invalid sync pulse width
- Fall back to alternating even/odd if separator ambiguous

## Performance Characteristics

| Metric | Value |
|--------|-------|
| **Processing Time** | Real-time (36 seconds) |
| **Memory Usage** | ~30 MB (buffers + image) |
| **CPU Usage** | 5-10% (single core) |
| **Minimum SNR** | 15 dB for reliable sync |

## Common Issues & Solutions

### Issue: Purple/Red Color Cast
**Cause**: Incorrect YUV to RGB conversion or wrong chroma channel assignment
**Solution**: Ensure R-Y and B-Y channels are correctly identified via separator

### Issue: Missing Lines
**Cause**: Sync pulses not detected or incorrect timing
**Solution**: Verify 1200 Hz sync detection, check pulse width classification

### Issue: Horizontal Banding
**Cause**: Insufficient filtering or frequency calibration drift
**Solution**: Apply bidirectional EMA filtering, track frequency offset

### Issue: Interlacing Artifacts
**Cause**: Even/odd line pairing mismatch
**Solution**: Validate separator frequency, implement fallback logic

## Testing Recommendations

1. **Sync Detection Test**: Verify 9ms pulses at 1200 Hz are detected
2. **Timing Test**: Confirm ~150ms between sync pulses
3. **Separator Test**: Validate even/odd line classification
4. **Color Test**: Use test patterns with known colors (red, green, blue, white)
5. **Interlacing Test**: Verify consecutive even/odd lines produce correct RGB output

## References

- Original implementation: [Robot36 Android App](https://github.com/xdsopl/robot36) by xdsopl
- SSTV specification: Amateur Radio magazines and ARRL documentation
- Color space: ITU-R BT.601 standard
- DSP techniques: Lyons, "Understanding Digital Signal Processing"
