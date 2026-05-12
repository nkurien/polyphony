# Session 03 — FFT and Chord Detection

## Why YIN Can't Do Chords

YIN works by asking: *"does this signal repeat at lag τ?"* It finds one repeating period — one note. A guitar chord is multiple strings vibrating simultaneously. The waveform is a superposition of several frequencies at once. YIN picks the strongest one and ignores the rest.

---

## What FFT Does

A raw audio buffer is a sequence of air-pressure measurements over time — the **time domain**. FFT (Fast Fourier Transform) converts it to the **frequency domain**: instead of "pressure at time t", you get "amplitude at frequency f".

Imagine freezing a chord mid-ring and asking: "which tuning forks are vibrating right now, and how loudly?" That's what FFT produces — a spectrum of (frequency, magnitude) pairs from 0 Hz up to half the sample rate.

**Key insight — superposition:** Multiple simultaneous frequencies don't cancel each other in the spectrum. They each appear as their own peak. Play E, G, and B at once → three bumps at their respective positions in the spectrum.

---

## Hann Windowing

FFT assumes the audio buffer loops perfectly. It doesn't — there's a discontinuity at the edges. This "edge artefact" leaks energy from each frequency into neighbouring bins, smearing peaks and making them hard to find.

**Fix:** multiply the buffer by a bell-shaped Hann window before the FFT runs. This smoothly fades the edges to zero, preventing the leakage.

```
w[i] = 0.5 * (1 - cos(2π * i / (N - 1)))
```

---

## Frequency Resolution

With a 4096-sample buffer at 44100 Hz:

```
bin width = 44100 / 4096 ≈ 10.8 Hz per bin
```

Each FFT output bin represents a ~10.8 Hz slice of the spectrum. At E4 (330 Hz) that's precise enough. At E2 (82 Hz) consecutive bins span about 1.5 semitones — coarse, but fine for chord ID where we only need the note name, not exact cents.

---

## The Full Chord Detection Pipeline

```
Raw samples
  → Hann window          (reduce edge artefacts)
  → FFT                  (time domain → frequency domain)
  → magnitude spectrum   (how loud is each frequency?)
  → peak picking         (find local maxima above noise floor, 70–1200 Hz)
  → pitch class          (strip octave: E2 and E4 both → "E", value 0–11)
  → deduplication        (remove duplicates from harmonics)
  → chord lookup         (match note set against pattern table)
  → "Em", "C", "G7" …
```

---

## Known Limitation: Harmonics

Guitar strings produce strong overtones. The harmonics of a single note can resemble chord tones:
- E string (82 Hz) → harmonics at 164 Hz (E3), 247 Hz (B3), 329 Hz (E4), 411 Hz (G#4)...
- E, B, G# together = E major triad

So the detector may see a "chord" when only one string is ringing. The detection threshold (fraction of max magnitude required to count a peak) controls this trade-off:
- **Too low:** harmonics trigger false chords
- **Too high:** quiet strings in a chord get missed

Starting value: 15% of the loudest peak in range. Tunable after live testing.

---

## Architecture Decision: Two Separate Pages

The tuner (YIN, monophonic) and chord detector (FFT, polyphonic) serve different use cases and are kept on separate pages:

- **Tuner page** — existing UI: big note name, cents bar, volume bar
- **Chord page** — new: FFT peak detection → pitch classes → chord name display
- **Navigation** — minimal left-side dot nav to switch between pages

The chord page calls a new WASM export `detect_chord(samples, sample_rate) → String`.  
The tuner page continues to call `detect_frequency(samples, sample_rate) → f32`.

Each page manages its own audio context — only the active page listens to the mic.

---

## Chord Pattern Table

Patterns are semitone intervals from the root. All chord tones must be present in the detected set (subset matching):

| Suffix | Intervals | Example |
|--------|-----------|---------|
| (none) | 0, 4, 7 | C major |
| m | 0, 3, 7 | Cm |
| 7 | 0, 4, 7, 10 | C7 |
| maj7 | 0, 4, 7, 11 | Cmaj7 |
| m7 | 0, 3, 7, 10 | Cm7 |
| dim | 0, 3, 6 | Cdim |
| aug | 0, 4, 8 | Caug |
| sus2 | 0, 2, 7 | Csus2 |
| sus4 | 0, 5, 7 | Csus4 |
| 5 | 0, 7 | C5 (power chord) |
| dim7 | 0, 3, 6, 9 | Cdim7 |
| m7b5 | 0, 3, 6, 10 | Cm7b5 |

Scoring: prefer longer patterns (more specific) and penalise extra detected notes not in the chord.
