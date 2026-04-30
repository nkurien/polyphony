// This module is the core DSP library.
// It gets compiled twice: once as a native Rust lib (for the CLI),
// and once as a WASM module (for the browser).

// wasm_bindgen allows us to mark functions as callable from JavaScript.
// The cfg_attr here means "only apply #[wasm_bindgen] when compiling for WASM".
// When building the CLI, this attribute is ignored entirely.
use wasm_bindgen::prelude::*;

// --- YIN PITCH DETECTION ---
//
// YIN estimates the fundamental frequency of a monophonic signal.
// Reference: De Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator"
//
// The algorithm works in the time domain — no FFT needed.
// It finds the period of the signal by measuring self-similarity at different time lags.

/// Runs the YIN algorithm on a slice of audio samples.
///
/// - `samples`: raw PCM audio, normalised to the range [-1.0, 1.0]
/// - `sample_rate`: how many samples per second (e.g. 44100)
///
/// Returns the detected frequency in Hz, or None if no confident pitch was found.
pub fn yin_pitch(samples: &[f32], sample_rate: u32) -> Option<f32> {
    // We only look for pitches in the guitar range: ~70 Hz (low E) to ~1200 Hz (high frets)
    let f_min = 70.0_f32;
    let f_max = 1200.0_f32;

    // Convert frequency bounds to lag bounds.
    // Lag = number of samples in one period. Higher frequency = shorter period = smaller lag.
    let lag_min = (sample_rate as f32 / f_max).floor() as usize;
    let lag_max = (sample_rate as f32 / f_min).ceil() as usize;

    // We need at least lag_max * 2 samples to do the correlation.
    // If the buffer is too short, we can't detect the lowest notes.
    if samples.len() < lag_max * 2 {
        return None;
    }

    // The window is the portion of the signal we analyse.
    // YIN recommends the window be at least 2x the maximum lag.
    let window_size = lag_max;

    // --- STEP 1: Difference function ---
    //
    // For each lag τ, compute: d(τ) = Σ (x[i] - x[i+τ])²
    // This measures how different the signal is from a copy shifted by τ samples.
    // If d(τ) ≈ 0, the signal repeats at lag τ — meaning the period is τ samples.
    let mut diff = vec![0.0_f32; lag_max + 1];
    for tau in 1..=lag_max {
        for i in 0..window_size {
            let delta = samples[i] - samples[i + tau];
            diff[tau] += delta * delta;
        }
    }

    // --- STEP 2: Cumulative mean normalised difference function (CMNDF) ---
    //
    // The raw difference function always has d(0) = 0 (a signal is identical to itself).
    // This creates a false "pitch detected" at lag 0 every time.
    //
    // CMNDF fixes this by normalising each d(τ) against the running mean of all earlier lags:
    //   d'(τ) = d(τ) / [(1/τ) * Σ d(j) for j in 1..τ]
    //
    // After normalisation, d'(1) = 1 by definition, and d'(τ) < 1 only when there's real periodicity.
    let mut cmndf = vec![0.0_f32; lag_max + 1];
    cmndf[0] = 1.0; // Defined as 1 by convention
    let mut running_sum = 0.0_f32;
    for tau in 1..=lag_max {
        running_sum += diff[tau];
        if running_sum == 0.0 {
            cmndf[tau] = 1.0;
        } else {
            // Normalise: divide by the mean of all d(j) up to this lag
            cmndf[tau] = diff[tau] * (tau as f32) / running_sum;
        }
    }

    // --- STEP 3: Absolute threshold search ---
    //
    // Find the first lag τ (within our guitar frequency range) where d'(τ) drops below
    // the threshold. 0.15 is the value recommended in the original YIN paper.
    //
    // We look for a local minimum below the threshold rather than just the first dip,
    // to avoid picking up on noise or a sub-harmonic.
    let threshold = 0.15_f32;
    let mut best_tau = None;

    let mut tau = lag_min;
    while tau <= lag_max {
        if cmndf[tau] < threshold {
            // Found a dip below threshold — now find the local minimum in this region.
            // Keep moving forward while the value keeps falling.
            while tau + 1 <= lag_max && cmndf[tau + 1] < cmndf[tau] {
                tau += 1;
            }
            best_tau = Some(tau);
            break;
        }
        tau += 1;
    }

    // If no lag passed the threshold, fall back to the global minimum in range.
    // This handles cases where the signal is present but noisy.
    let tau = best_tau.unwrap_or_else(|| {
        (lag_min..=lag_max)
            .min_by(|&a, &b| cmndf[a].partial_cmp(&cmndf[b]).unwrap())
            .unwrap()
    });

    // --- STEP 4: Parabolic interpolation ---
    //
    // Our lag estimate is an integer (a sample index), but the true period probably falls
    // between samples. Fitting a parabola through the three points around the minimum
    // gives a sub-sample refined estimate, improving pitch accuracy.
    let refined_tau = if tau > 0 && tau < lag_max {
        let s0 = cmndf[tau - 1];
        let s1 = cmndf[tau];
        let s2 = cmndf[tau + 1];
        // Parabola vertex formula: offset = (s0 - s2) / (2 * (s0 - 2*s1 + s2))
        let denominator = 2.0 * (s0 - 2.0 * s1 + s2);
        if denominator.abs() > 1e-6 {
            tau as f32 + (s0 - s2) / denominator
        } else {
            tau as f32
        }
    } else {
        tau as f32
    };

    // Period in samples → frequency in Hz
    let frequency = sample_rate as f32 / refined_tau;
    Some(frequency)
}

// --- FREQUENCY TO NOTE NAME ---
//
// Musical notes follow a logarithmic scale. Each semitone is a factor of 2^(1/12).
// A4 = 440 Hz is the universal reference pitch.
// Given a frequency, we can compute how many semitones away from A4 it is,
// then map that to a note name + octave number.

/// Converts a frequency in Hz to a note name like "E2" or "A4".
pub fn frequency_to_note(freq: f32) -> String {
    // Note names in order within an octave, starting from C
    let note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    // Compute semitones above or below A4 (440 Hz).
    // log2(freq / 440) gives us octaves; multiplying by 12 gives semitones.
    let semitones_from_a4 = 12.0 * (freq / 440.0_f32).log2();

    // Round to the nearest semitone
    let semitone_index = semitones_from_a4.round() as i32;

    // A4 is semitone 0 in our system.
    // In MIDI terms, A4 = note 69. We use that to compute the absolute note number.
    let midi_note = 69 + semitone_index; // A4 is MIDI note 69

    // Octave number: MIDI note 60 = C4, so octave = (midi_note / 12) - 1
    let octave = (midi_note / 12) - 1;

    // Position within the octave (0 = C, 1 = C#, ..., 11 = B)
    // We use rem_euclid to handle negative numbers correctly
    // (plain % in Rust can return negative results for negative dividends)
    let note_index = midi_note.rem_euclid(12) as usize;

    format!("{}{}", note_names[note_index], octave)
}

// --- WASM ENTRY POINT ---
//
// This function will be callable from JavaScript once compiled to WASM.
// For now it just wraps yin_pitch + frequency_to_note.
// The CLI uses those functions directly instead.
#[wasm_bindgen]
pub fn detect_note(samples: &[f32], sample_rate: u32) -> String {
    match yin_pitch(samples, sample_rate) {
        Some(freq) => frequency_to_note(freq),
        None => "—".to_string(),
    }
}

// --- UNIT TESTS ---
//
// `cargo test` runs these. They live inside the library so they have access to private internals.
// In Rust, #[cfg(test)] means "only compile this block when running tests".
#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    // Helper: generate a pure sine wave at a given frequency
    fn sine_wave(freq: f32, sample_rate: u32, duration_secs: f32) -> Vec<f32> {
        let num_samples = (sample_rate as f32 * duration_secs) as usize;
        (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (2.0 * PI * freq * t).sin()
            })
            .collect()
    }

    #[test]
    fn test_a4_detection() {
        // A4 = 440 Hz — the standard tuning reference
        let samples = sine_wave(440.0, 44100, 0.5);
        let freq = yin_pitch(&samples, 44100).expect("Should detect A4");
        assert!(
            (freq - 440.0).abs() < 5.0,
            "Expected ~440 Hz, got {:.1} Hz",
            freq
        );
    }

    #[test]
    fn test_e2_detection() {
        // E2 = 82.41 Hz — open low E string on a guitar
        let samples = sine_wave(82.41, 44100, 0.5);
        let freq = yin_pitch(&samples, 44100).expect("Should detect E2");
        assert!(
            (freq - 82.41).abs() < 3.0,
            "Expected ~82.41 Hz, got {:.1} Hz",
            freq
        );
    }

    #[test]
    fn test_frequency_to_note() {
        assert_eq!(frequency_to_note(440.0), "A4");
        assert_eq!(frequency_to_note(82.41), "E2");
        assert_eq!(frequency_to_note(261.63), "C4"); // Middle C
        assert_eq!(frequency_to_note(329.63), "E4"); // High E open string
    }
}
