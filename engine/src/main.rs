// CLI entry point.
// Usage: cargo run -- path/to/file.wav
//
// Reads a WAV file, runs YIN pitch detection on 50ms chunks,
// and prints the detected note name for each chunk.

// Bring our library functions into scope.
// `engine` is the name of our crate (set in Cargo.toml).
use engine::{frequency_to_note, yin_pitch};

fn main() {
    // --- Parse command-line arguments ---
    // std::env::args() gives us an iterator over the CLI arguments.
    // args[0] is always the program name itself, so we skip it.
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-wav-file>", args[0]);
        std::process::exit(1);
    }
    let wav_path = &args[1];

    // --- Open the WAV file ---
    // hound::WavReader parses the WAV header and lets us iterate over samples.
    let mut reader = match hound::WavReader::open(wav_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to open {}: {}", wav_path, e);
            std::process::exit(1);
        }
    };

    let spec = reader.spec();
    let sample_rate = spec.sample_rate;

    println!("File:        {}", wav_path);
    println!("Sample rate: {} Hz", sample_rate);
    println!("Channels:    {}", spec.channels);
    println!("Bit depth:   {}-bit", spec.bits_per_sample);
    println!("---");

    // --- Read all samples and normalise to [-1.0, 1.0] ---
    //
    // WAV files store samples as integers (e.g. i16 for 16-bit audio).
    // YIN expects floats in the range [-1.0, 1.0], so we divide by the max i16 value.
    //
    // If the file is stereo, we only use the left channel (every other sample).
    // Guitar is usually recorded mono, but this handles stereo files gracefully.
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .enumerate()
        .filter_map(|(i, s)| {
            // Keep only left-channel samples (index 0, 2, 4, ... for stereo; all for mono)
            if i % spec.channels as usize == 0 {
                s.ok().map(|v| v as f32 / i16::MAX as f32)
            } else {
                None
            }
        })
        .collect();

    println!("Total samples read: {}", samples.len());
    println!(
        "Duration: {:.2} seconds",
        samples.len() as f32 / sample_rate as f32
    );
    println!("---");

    // --- Process in overlapping chunks ---
    //
    // We analyse the audio in 50ms windows, stepping forward 25ms each time.
    // This gives us a new pitch reading 40 times per second.
    //
    // Why overlap? If a note starts in the middle of a window, an overlapping
    // window will catch it cleanly rather than splitting it between two chunks.
    let window_samples = (sample_rate as f32 * 0.050) as usize; // 50ms window
    let hop_samples = (sample_rate as f32 * 0.025) as usize;    // 25ms step

    let mut chunk_index = 0;
    let mut pos = 0;
    let mut last_note = String::new();

    while pos + window_samples <= samples.len() {
        let chunk = &samples[pos..pos + window_samples];
        let time_secs = pos as f32 / sample_rate as f32;

        match yin_pitch(chunk, sample_rate) {
            Some(freq) => {
                let note = frequency_to_note(freq);
                // Only print when the note changes — avoids flooding the terminal
                // with identical readings for a held note
                if note != last_note {
                    println!("[{:.3}s] {:>4}  ({:.1} Hz)", time_secs, note, freq);
                    last_note = note;
                }
            }
            None => {
                // No confident pitch in this window — likely silence or noise
                if last_note != "—" {
                    println!("[{:.3}s]  — (no pitch detected)", time_secs);
                    last_note = "—".to_string();
                }
            }
        }

        pos += hop_samples;
        chunk_index += 1;
    }

    println!("---");
    println!("Processed {} chunks.", chunk_index);
}
