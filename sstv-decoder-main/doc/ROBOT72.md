# Robot72 Mode Implementation

## Overview

Robot72 is a color SSTV mode developed by Robot Research Inc. that provides superior color fidelity compared to Robot36 while maintaining the same 320×240 resolution. It achieves better color quality by transmitting Y, V (R-Y), and U (B-Y) color components sequentially on each scan line, eliminating the interlacing used in Robot36.

## Technical Specifications

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Resolution** | 320 × 240 pixels | Same as Robot36 |
| **VIS Code** | 12 | Vertical Interval Signaling identifier |
| **Scan Time** | 300 ms/line | Exactly 2× Robot36 (150ms) |
| **Total Time** | 72 seconds | 240 lines × 300ms |
| **Color Encoding** | Sequential YUV | Y, V, U all on same line |
| **Interlacing** | None | Unlike Robot36 |
| **Luminance Time** | 138 ms | Y channel transmission |
| **Chrominance Time** | 69 ms each | V and U channels |

## Timing Breakdown

A complete Robot72 scan line (300ms total):

```
Sync Pulse:      9.0 ms   (1200 Hz sync tone)
Sync Porch:      3.0 ms   (1500 Hz porch)
Y Channel:     138.0 ms   (Luminance - full bandwidth)
Separator:       4.5 ms   (1500 Hz separator)
Porch:           1.5 ms   (1900 Hz porch)
V Channel:      69.0 ms   (R-Y chrominance)
Separator:       4.5 ms   (1500 Hz separator)
Porch:           1.5 ms   (1900 Hz porch)
U Channel:      69.0 ms   (B-Y chrominance)
─────────────────────────
Total:         300.0 ms
```

## Color Space

Robot72 uses YUV color encoding (ITU-R BT.601):

- **Y (Luminance)**: Brightness information (0-1 normalized)
  - 1500 Hz = black (0%)
  - 2300 Hz = white (100%)

- **V (R-Y)**: Red-minus-luminance chrominance
  - 1500 Hz = minimum (-50%)
  - 2300 Hz = maximum (+50%)

- **U (B-Y)**: Blue-minus-luminance chrominance
  - 1500 Hz = minimum (-50%)
  - 2300 Hz = maximum (+50%)

### YUV to RGB Conversion

```typescript
// Adjust values to ITU-R BT.601 ranges
const yAdj = y - 16;
const uAdj = u - 128;  // B-Y
const vAdj = v - 128;  // R-Y

// Convert to RGB (8-bit)
const r = clamp((298 * yAdj + 409 * vAdj + 128) >> 8);
const g = clamp((298 * yAdj - 100 * uAdj - 208 * vAdj + 128) >> 8);
const b = clamp((298 * yAdj + 516 * uAdj + 128) >> 8);
```

## Comparison: Robot72 vs Robot36

### Key Differences

| Feature | Robot36 | Robot72 |
|---------|---------|---------|
| **Scan Time** | 150 ms | 300 ms (2×) |
| **Total Time** | 36 sec | 72 sec (2×) |
| **Color Method** | Interlaced YUV | Sequential YUV |
| **Chrominance** | Alternates V/U per line | Both V+U every line |
| **Even Lines** | Y + V (R-Y) | Y + V + U |
| **Odd Lines** | Y + U (B-Y) | Y + V + U |
| **Interlacing** | Required | None |
| **Color Fidelity** | Good | Excellent |
| **Vertical Resolution** | Reduced by interlacing | Full |

### Why Robot72 Has Better Color

**Robot36 Limitations:**
- Even lines only get R-Y chrominance
- Odd lines only get B-Y chrominance
- Decoder must interpolate missing chroma from adjacent lines
- Vertical color resolution is halved
- Fast motion or high-frequency patterns cause color artifacts

**Robot72 Advantages:**
- Every line gets full Y, V, and U data
- No interpolation needed
- Full vertical color resolution
- No interlacing artifacts
- Better color accuracy at 2× transmission cost

## Implementation Details

### No Interlacing State

Unlike Robot36, Robot72 doesn't need to track even/odd line state:

```typescript
// Robot36: Must store even line and pair with odd line
if (isEvenLine) {
  storeEvenLine();
  return { height: 0 }; // Wait for odd line
} else {
  combineWithStoredEvenLine();
  return { height: 2 }; // Output 2 rows
}

// Robot72: Simply decode and output immediately
decodeLine();
return { height: 1 }; // Always output 1 row
```

### Sequential Channel Processing

Each scan line independently decodes Y, V, and U:

```typescript
for (let x = 0; x < 320; x++) {
  // Calculate sample positions for each channel
  const yPos = yBeginSamples + (x * luminanceSamples) / horizontalPixels;
  const vPos = vBeginSamples + (x * chrominanceSamples) / horizontalPixels;
  const uPos = uBeginSamples + (x * chrominanceSamples) / horizontalPixels;

  // Extract normalized values (0-1 range)
  const y = scratchBuffer[yPos] * 255;
  const v = scratchBuffer[vPos] * 255;
  const u = scratchBuffer[uPos] * 255;

  // Convert YUV to RGB
  const rgb = yuv2rgb(y, u, v);

  // Store pixel (RGBA)
  pixels[x * 4] = rgb.r;
  pixels[x * 4 + 1] = rgb.g;
  pixels[x * 4 + 2] = rgb.b;
  pixels[x * 4 + 3] = 255;
}
```

### Low-Pass Filtering

Robot72 uses the same bidirectional EMA filtering as Robot36:

1. **Forward pass**: Apply exponential moving average from left to right
2. **Backward pass**: Apply EMA from right to left and convert to level
3. **Purpose**: Remove high-frequency noise while preserving edges

Filter configuration:
```typescript
// Use luminance samples as reference (longest channel)
lowPassFilter.cutoff(320, 2 * luminanceSamples, 2);
```

## Sample Rate Scaling

Robot72 timing scales with sample rate:

| Sample Rate | Scan Line Samples | Luminance Samples | Chroma Samples |
|-------------|-------------------|-------------------|----------------|
| 44.1 kHz | 13,230 | 6,084 | 3,042 |
| 48.0 kHz | 14,400 | 6,624 | 3,312 |
| 96.0 kHz | 28,800 | 13,248 | 6,624 |

All timing relationships remain constant across sample rates.

## VIS Code Detection

Robot72 uses VIS code **12** (binary: 0001100):

```
Bit sequence: 1 1 1 1 0 0 1 0 (LSB first, with parity)
- Data bits: 0001100
- Parity: Even (1)
```

VIS transmission (1900 Hz = 1, 1100 Hz = 0):
```
300ms leader tone (1900 Hz)
→ 10ms break (1200 Hz)
→ 300ms leader tone (1900 Hz)
→ 30ms start bit (1200 Hz)
→ 8× 30ms data bits (VIS code + parity)
→ 30ms stop bit (1200 Hz)
```

## Usage Recommendations

**Use Robot72 when:**
- Color fidelity is critical
- Transmission time is not constrained
- Displaying colorful images or artwork
- Fine color gradients are important
- Vertical color detail matters

**Use Robot36 instead when:**
- Speed is priority (2× faster)
- Bandwidth is limited
- Grayscale or low-color content
- Real-time applications (ISS contacts)
- Mobile/portable operations

## Performance Characteristics

**Decoder Performance:**
- Memory: ~56 KB buffer (14,400 samples × 4 bytes)
- CPU: Moderate (no interlacing logic)
- Latency: 300ms per line
- Throughput: 3.33 lines/second
- Total decode: ~72 seconds for 240 lines

**Signal Requirements:**
- Same as Robot36 (1500-2300 Hz bandwidth)
- SNR: 10+ dB recommended
- Frequency accuracy: ±50 Hz tolerance
- Phase stability: Not critical (FM modulation)

## Testing Coverage

The Robot72 implementation includes 32 comprehensive tests:

- **Initialization**: Constructor, sample rate handling
- **Timing**: Scan line duration, channel timing calculations
- **Decoding**: Buffer validation, frequency offset handling
- **Sequential YUV**: No interlacing verification, independence of lines
- **Color Conversion**: YUV to RGB accuracy, black/white/gray rendering
- **Edge Cases**: Extreme values, noise handling, buffer boundaries
- **Comparison**: Timing verification against Robot36 specs

All tests pass with 100% coverage of critical paths.

## References

- [Robot36 Java Implementation](https://github.com/xdsopl/robot36) by xdsopl
- Robot Research Inc. SSTV Specifications
- ITU-R BT.601 Color Space Standard
- SSTV Handbook (ARRL)

## Related Documentation

- [ROBOT36.md](./ROBOT36.md) - Robot36 implementation details
- [MODE_COMPARISON.md](./MODE_COMPARISON.md) - Comparison of all SSTV modes
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview
