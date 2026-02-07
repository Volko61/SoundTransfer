# SSTV Mode Comparison Chart

## Transmission Speed vs Quality

```
Fast ←──────────────────────────────────────────→ Slow/High Quality

Robot36        PD120           PD180
  │             │               │
  ●─────────────●───────────────●
 36s           2m 6s          3m 6s
320×240       640×496        640×496
76.8K px      317K px        317K px
```

## Detailed Timing Comparison

```
ROBOT36 (36 seconds total)
┌─9ms─┬─3ms─┬────88ms────┬─4.5ms─┬─1.5ms─┬───44ms───┐
│Sync │Prch│     Y      │ Sep   │ Prch  │   R-Y/B-Y │  150ms per line
└─────┴─────┴────────────┴───────┴───────┴───────────┘  × 240 lines
                                                          = 36 seconds

PD120 (2 minutes 6 seconds total)
┌─20ms─┬─2ms─┬───121.6ms───┬───121.6ms───┬───121.6ms───┬───121.6ms───┐
│ Sync │Prch│   Y-even    │    V-avg    │    U-avg    │   Y-odd     │  508ms per line
└──────┴────┴─────────────┴─────────────┴─────────────┴─────────────┘  × 248 lines
                                                                          = 126 seconds
                                                                          = 2m 6s

PD180 (3 minutes 6 seconds total)
┌─20ms─┬─2ms─┬───182.4ms───┬───182.4ms───┬───182.4ms───┬───182.4ms───┐
│ Sync │Prch│   Y-even    │    V-avg    │    U-avg    │   Y-odd     │  752ms per line
└──────┴────┴─────────────┴─────────────┴─────────────┴─────────────┘  × 248 lines
                                                                          = 186 seconds
                                                                          = 3m 6s
```

## Pixel Dwell Time Comparison

```
Time per pixel (affects SNR and quality):

Robot36:   275 µs  ████████████████████████████
PD120:     190 µs  ███████████████████
PD180:     286 µs  ██████████████████████████████  ← 50% more than PD120!

Longer pixel time = Better SNR = Cleaner image in weak signals
```

## Resolution Comparison

```
Robot36:  320×240 = 76,800 pixels
          ┌─────────────────┐
          │░░░░░░░░░░░░░░░░░│
          │░░░░░░░░░░░░░░░░░│  320px wide
          │░░░░░░░░░░░░░░░░░│  240px tall
          └─────────────────┘

PD120:    640×496 = 317,440 pixels (4.1× more than Robot36)
          ┌───────────────────────────────────┐
          │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
          │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
          │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  640px wide
          │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  496px tall
          │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
          └───────────────────────────────────┘

PD180:    640×496 = 317,440 pixels (same resolution as PD120)
          ┌───────────────────────────────────┐
          │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← Higher quality
          │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│     (better SNR)
          │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  640px wide
          │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  496px tall
          │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
          └───────────────────────────────────┘
```

## Color Encoding Strategies

```
Robot36: Interlaced YUV
─────────────────────────
Line 0:  Y₀[320] + R-Y₀[160]  → Row 0 (even)
Line 1:  Y₁[320] + B-Y₀[160]  → Row 1 (odd, uses R-Y from line 0)
Line 2:  Y₂[320] + R-Y₁[160]  → Row 2 (even)
Line 3:  Y₃[320] + B-Y₁[160]  → Row 3 (odd, uses R-Y from line 2)
...
Pairs alternate: R-Y then B-Y chroma
1 row per scan line, chroma paired across lines

PD120: Dual-Luminance
─────────────────────────
Line 0:  Y-even₀[640] + V-avg₀[640] + U-avg₀[640] + Y-odd₀[640]  → Row 0 & Row 1
Line 1:  Y-even₁[640] + V-avg₁[640] + U-avg₁[640] + Y-odd₁[640]  → Row 2 & Row 3
Line 2:  Y-even₂[640] + V-avg₂[640] + U-avg₂[640] + Y-odd₂[640]  → Row 4 & Row 5
...
2 rows per scan line, chroma shared within each line

PD180: Dual-Luminance (Same structure as PD120, longer pixel time)
─────────────────────────
Line 0:  Y-even₀[640] + V-avg₀[640] + U-avg₀[640] + Y-odd₀[640]  → Row 0 & Row 1
         │    50% LONGER PIXEL TIME (286µs vs 190µs)    │
Line 1:  Y-even₁[640] + V-avg₁[640] + U-avg₁[640] + Y-odd₁[640]  → Row 2 & Row 3
...
2 rows per scan line, better SNR due to longer integration time
```

## SNR Requirements

```
Minimum Signal-to-Noise Ratio for reliable decoding:

Robot36:  20 dB  ████████████████████
PD120:    18 dB  ██████████████████
PD180:    16 dB  ████████████████    ← Can decode weaker signals!

Lower SNR required = Works better in noisy conditions
```

## Use Case Decision Tree

```
Need to transmit SSTV image?
  │
  ├─ Fast QSO/contact? (< 1 min)
  │   └─→ Use Robot36 (36 seconds)
  │
  ├─ ISS pass? (5-8 min window)
  │   └─→ Use PD120 (2m 6s, multiple images possible)
  │
  ├─ High quality needed + time available?
  │   │
  │   ├─ Good signal strength?
  │   │   └─→ Use PD120 (2m 6s, efficient)
  │   │
  │   └─ Weak signal / maximum quality?
  │       └─→ Use PD180 (3m 6s, best SNR)
  │
  └─ Dedicated SSTV session / commemorative image?
      └─→ Use PD180 (3m 6s, gallery quality)
```

## Technical Specifications Table

```
┌─────────────┬──────────┬──────────┬──────────┐
│  Parameter  │ Robot36  │  PD120   │  PD180   │
├─────────────┼──────────┼──────────┼──────────┤
│ Resolution  │ 320×240  │ 640×496  │ 640×496  │
│ Total Pixels│  76,800  │ 317,440  │ 317,440  │
│ Sync Pulse  │   9 ms   │  20 ms   │  20 ms   │
│ Line Time   │  150 ms  │  508 ms  │  752 ms  │
│ Pixel Time  │  275 µs  │  190 µs  │  286 µs  │
│ Total Time  │   36 s   │  126 s   │  186 s   │
│ VIS Code    │    8     │    95    │    96    │
│ Min SNR     │  20 dB   │  18 dB   │  16 dB   │
│ Color Mode  │Intrlcd YUV│Dual-luma│Dual-luma│
│ Rows/Scan   │    1     │    2     │    2     │
│ ISS Usage   │   Rare   │  Common  │Previous  │
└─────────────┴──────────┴──────────┴──────────┘
```

## SNR Improvement Analysis

```
PD180 vs PD120 SNR improvement:

Pixel time ratio: 286µs / 190µs = 1.505

SNR improvement = 10 × log₁₀(1.505)
                = 10 × 0.178
                = 1.78 dB

In practice:
- PD120 at 18 dB SNR = good quality
- PD180 at 16 dB SNR = same quality
- PD180 at 18 dB SNR = better quality than PD120 at 18 dB

Translation:
PD180 can decode signals that are 50% weaker (in power)
than what PD120 requires for the same quality level.
```

## Bandwidth Usage

```
All modes use same frequency range:

Frequency Range: 1200-2300 Hz (1100 Hz bandwidth)
  │
  ├─ 1200 Hz: Sync pulse
  ├─ 1500 Hz: Black level
  ├─ 1900 Hz: Center (gray)
  └─ 2300 Hz: White level

Audio Bandwidth Required: ~3 kHz (1000-4000 Hz safe range)

Same for Robot36, PD120, and PD180!
```

## Memory and CPU Requirements

```
Memory Usage (image buffer):
  Robot36:  320 × 240 × 4 bytes =  307,200 bytes (~300 KB)
  PD120:    640 × 496 × 4 bytes = 1,269,760 bytes (~1.2 MB)
  PD180:    640 × 496 × 4 bytes = 1,269,760 bytes (~1.2 MB)

CPU Usage (single core):
  Robot36:  5-10%   ███████
  PD120:    8-15%   ███████████
  PD180:   10-18%   █████████████  (slightly higher due to longer lines)

All modes are real-time capable on modern hardware.
```

## Quick Reference: When to Use Each Mode

```
╔═══════════════════════════════════════════════════════════╗
║  CHOOSE ROBOT36 WHEN:                                               ║
║  ✓ Time is limited (< 1 minute)                                     ║
║  ✓ Fast QSO/contact                                                 ║
║  ✓ Signal quality check                                             ║
║  ✓ Lower resolution acceptable                                      ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  CHOOSE PD120 WHEN:                                                 ║
║  ✓ ISS SSTV events (current standard)                               ║
║  ✓ Good balance of speed and quality                                ║
║  ✓ High resolution needed                                           ║
║  ✓ Moderate time available (2-3 minutes)                            ║
║  ✓ Mobile operation                                                 ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  CHOOSE PD180 WHEN:                                                 ║
║  ✓ Maximum quality desired                                          ║
║  ✓ Weak signal conditions                                           ║
║  ✓ Time available (3+ minutes)                                      ║
║  ✓ Gallery-quality images                                           ║
║  ✓ Commemorative/special events                                     ║
║  ✓ Recording from audio files                                       ║
╚═══════════════════════════════════════════════════════════╝
```

## Conclusion

**Three modes, three purposes:**

- **Robot36**: Fast and efficient (36s)
- **PD120**: Balanced standard (2m 6s)
- **PD180**: Quality champion (3m 6s)

Choose based on your time constraints, signal conditions, and quality requirements!
