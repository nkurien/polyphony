# 01 - Rust Crate Setup & YIN Pitch Detection

## The Rust project structure

A Rust project is called a **crate**. Every crate has a `Cargo.toml` file at its root,
which is Rust's equivalent of `package.json` in Node. It declares:

- The project name and version
- Which **edition** of Rust to use (2021 is current)
- **Dependencies** - external libraries (also called crates) from crates.io

Our `engine/` crate compiles to two different targets:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[[bin]]
name = "detect"
path = "src/main.rs"
```

- **`[lib]`** - the library. This is what `wasm-pack` compiles to WebAssembly for the browser.
  - `cdylib` = C-compatible dynamic library (required for WASM output)
  - `rlib` = Rust library (lets the CLI binary import from it natively)
- **`[[bin]]`** - the CLI binary. Double brackets because you can have multiple binaries.
  Points at `src/main.rs` as its entry point.

The DSP logic lives in `lib.rs` and is shared by both targets. The CLI calls it directly.
The browser calls it through WASM. The algorithm is written once.

---

## Dependencies

| Crate | Purpose |
|---|---|
| `hound` | Reads `.wav` files and gives us raw PCM sample arrays |
| `rustfft` | Fast Fourier Transform, for frequency analysis (used more in Level 2) |
| `wasm-bindgen` | Generates JavaScript glue code so Rust functions are callable from JS |

---

## Key Rust concepts used

### `Vec<f32>`
A `Vec` is Rust's growable array, like a JavaScript array or Python list.
`f32` is a 32-bit floating-point number. So `Vec<f32>` is a list of floats.

### `&[f32]`
A **slice** - a reference to a contiguous chunk of a `Vec` (or any array) without copying it.
When a function takes `&[f32]`, it's saying "give me a read-only view of some floats".
No data is copied.

### `Option<f32>`
Rust has no `null`. A value that might not exist is wrapped in `Option`.
- `Some(82.4)` - there is a value
- `None` - there isn't

This forces you to handle the missing case explicitly. YIN returns `Option<f32>`
because sometimes there's no detectable pitch (silence, noise).

### `#[cfg(test)]`
This attribute tells the compiler to only include this code when running `cargo test`.
It keeps test helpers out of the production binary.

### `#[wasm_bindgen]`
When compiling to WASM, this attribute tells the compiler to generate JavaScript bindings
for the marked function. When building natively for the CLI, it's ignored.
`cfg_attr` applies it conditionally, only when the target is WASM.

---

## What is PCM audio?

PCM (Pulse Code Modulation) is raw audio - a long list of numbers representing
air pressure at the microphone, sampled thousands of times per second.

- A **sample rate** of 44100 Hz means 44,100 measurements per second.
- Each sample is typically a 16-bit integer (`i16` in Rust): range -32768 to +32767.
- We normalise these to **[-1.0, 1.0]** floats for DSP work by dividing by 32767.

A 1-second recording at 44100 Hz = 44,100 samples = a `Vec<f32>` with 44,100 elements.

---

## The YIN Algorithm

YIN estimates the **fundamental frequency** of a monophonic (single-note) audio signal.

Reference: *De Cheveigné & Kawahara (2002) - "YIN, a fundamental frequency estimator for speech and music"*

### Core idea

> Take a recording of a guitar string vibrating at 82 Hz. Shift it forward in time by exactly
> 1/82nd of a second (one period) and it looks almost identical to the original.
> YIN finds the period by measuring this self-similarity at different time offsets.

### The four steps

#### Step 1 - Difference function
For each possible lag τ (number of samples), compute how different the signal is from
a copy of itself shifted by τ:

```
d(τ) = Σ (x[i] - x[i+τ])²
```

When τ equals the true period, `d(τ)` is near zero - the signal subtracts almost perfectly from itself.

#### Step 2 - Cumulative Mean Normalised Difference (CMNDF)
The raw difference function always has `d(0) = 0` because a signal is identical to itself with zero shift.
Without correction, that's a false detection every time. CMNDF normalises each value against the
running mean of all earlier lags, so `d'(τ) = 1` at τ=0 by definition, and only dips below 1
where there's real periodicity:

```
d'(τ) = d(τ) / [(1/τ) * Σ d(j) for j in 1..τ]
```

#### Step 3 - Absolute threshold
Find the first lag τ (within the guitar frequency range, ~70-1200 Hz) where `d'(τ) < 0.15`.
The threshold 0.15 is from the original paper - below it, there's enough confidence to call it a pitch.

#### Step 4 - Parabolic interpolation
The lag is an integer (a sample index), but the true period probably falls between samples.
Fitting a parabola through the three points around the minimum gives a sub-sample refined estimate,
improving accuracy from roughly ±1 semitone down to a few cents.

---

## Frequency to note name

Musical notes follow a **logarithmic** scale. Each octave is a doubling of frequency,
and each octave has 12 semitones, so each semitone is a factor of `2^(1/12) ≈ 1.0595`.

Formula to find how many semitones a frequency `f` is from A4 (440 Hz):

```
semitones = 12 × log₂(f / 440)
```

Round to the nearest integer, add to MIDI note 69 (A4 in MIDI numbering),
then look up the note name from an array of 12 names starting at C.

**Guitar open string frequencies:**

| String | Note | Frequency |
|---|---|---|
| 6 (thickest) | E2 | 82.41 Hz |
| 5 | A2 | 110.00 Hz |
| 4 | D3 | 146.83 Hz |
| 3 | G3 | 196.00 Hz |
| 2 | B3 | 246.94 Hz |
| 1 (thinnest) | E4 | 329.63 Hz |

---

## How the CLI works

`src/main.rs`:

1. Reads the `.wav` file path from the command line (`std::env::args()`)
2. Opens the file with `hound::WavReader` and reads all samples as `i16`
3. Normalises them to `f32` in [-1.0, 1.0]
4. For stereo files, discards the right channel (keeps every other sample)
5. Loops through the samples in **50ms overlapping windows** (step = 25ms)
6. Calls `yin_pitch()` on each window, then `frequency_to_note()` on the result
7. Prints the note name only when it changes

**Why overlapping windows?**
A note played at the boundary between two windows gets split - each half might be too short
to detect reliably. Overlapping by 50% ensures every moment of audio falls cleanly inside
at least one window.

**To run it:**
```bash
cd engine
cargo run -- ../test-samples/your-file.wav
```

---

## Running the tests

```bash
cd engine
cargo test
```

Tests live inside `lib.rs` in a `#[cfg(test)]` block. They use synthetic sine waves
(pure single frequencies) to verify the algorithm before testing on real audio.

- `test_a4_detection` - detects 440 Hz within ±5 Hz
- `test_e2_detection` - detects 82.41 Hz (low E string) within ±3 Hz
- `test_frequency_to_note` - verifies A4, E2, C4, E4 name mapping
