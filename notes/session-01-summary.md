# Session 01 - Summary

## What we built

A working monophonic guitar tuner running in the browser at [tuner.nathankurien.com](https://tuner.nathankurien.com).

Play a string and the app shows:
- The detected note name (e.g. E2, A4)
- A cents deviation bar — red, stretches left if flat, right if sharp, fades when in tune
- A green dot when you're within 3 cents of perfect pitch
- A volume bar in mandarin orange with envelope smoothing

Runs entirely client-side. The pitch detection is written in Rust, compiled to WebAssembly.

---

## What was covered

### Environment setup
- Installed Rust, added the `wasm32-unknown-unknown` target, installed `wasm-pack`
- Linked a GitHub remote and set up `.gitignore` (CLAUDE.md excluded from repo)

### Rust engine (`engine/`)
- Created a Cargo crate with two targets: a `[lib]` (compiled to WASM) and a `[[bin]]` (CLI tool)
- Implemented the **YIN pitch detection algorithm** from scratch in `lib.rs`
- Implemented `frequency_to_note` (Hz to note name) and `detect_frequency` (WASM export)
- Wrote unit tests for A4, E2, and note name mapping — all passing
- Tested the CLI against synthetic WAV files for all 6 open guitar strings

### WASM build
- `wasm-pack build --target web --out-dir pkg` compiles the Rust lib to a browser-ready package
- Output: `engine_bg.wasm` + auto-generated JS/TS glue in `engine/pkg/`

### React frontend (`web/`)
- Scaffolded with Vite + React + TypeScript + Tailwind CSS
- Configured `vite-plugin-wasm` and `optimizeDeps.exclude` to handle the WASM package correctly
- Fixed a Vite filesystem security issue (`server.fs.allow`) blocking access to `engine/pkg/`
- Built an audio pipeline: `getUserMedia` → `MediaStreamSourceNode` → `GainNode` → `ScriptProcessorNode` → pitch detection
- Disabled `echoCancellation`, `noiseSuppression`, `autoGainControl` on the mic stream
- Added a software `GainNode` (value: 6.0) for mobile sensitivity

### Signal processing (JS)
- RMS amplitude calculation for volume metering
- Envelope follower with separate attack (0.6) and release (0.05) alphas for natural volume feel
- Confirmation filter: note only updates after 3 consecutive matching detections
- Cents deviation with EMA smoothing (alpha: 0.15) to reduce jitter

### UI
- Minimal dark design: near-black background, large Helvetica Neue light note name
- Note opacity scales with volume
- Cents bar with 3-cent dead zone, 0.55 minimum opacity outside it, fades to zero inside
- Green in-tune dot at centre of cents bar
- Mandarin orange volume bar (`#E2622A`)

### Deployment
- Root `package.json` with a single build script that installs Rust, builds WASM, and runs Vite
- Deployed to Cloudflare Pages — required fixing `source` → `.` for POSIX `sh` compatibility

---

## Repo structure

```
polyphonic/
├── README.md
├── CLAUDE.md                        project spec (gitignored)
├── package.json                     root build script for Cloudflare Pages
├── .gitignore
│
├── engine/                          Rust crate
│   ├── Cargo.toml                   dependencies: hound, rustfft, wasm-bindgen
│   ├── src/
│   │   ├── lib.rs                   YIN algorithm, frequency_to_note, detect_frequency (WASM export)
│   │   └── main.rs                  CLI tool - reads a .wav, prints detected notes
│   └── pkg/                         wasm-pack output (gitignored, built in CI)
│
├── web/                             React frontend
│   ├── vite.config.ts               vite-plugin-wasm, fs.allow, optimizeDeps
│   ├── src/
│   │   ├── App.tsx                  audio pipeline, pitch detection, UI
│   │   ├── main.tsx                 React entry point
│   │   └── index.css                Tailwind import
│   └── package.json                 deps include local engine/pkg link
│
├── test-samples/                    synthetic WAV files for CLI testing
│   ├── generate.py                  generates one file per open guitar string
│   └── E2.wav, A2.wav, ...          one per string (E2 through E4)
│
└── notes/                           plain-English concept writeups
    ├── 01-rust-crate-and-yin.md
    └── 02-wasm-and-react-frontend.md
```

---

## Considerations and known limitations

**ScriptProcessorNode is deprecated**
The audio pipeline uses `ScriptProcessorNode`, which runs on the main thread and is deprecated in favour of `AudioWorklet`. It works fine for now but could cause UI jank under load. There's a detailed TODO comment in `App.tsx` with migration steps.

**Logic duplication between Rust and JS**
`frequencyToNote` and `centsDeviation` exist in both `lib.rs` and `App.tsx`. There's a TODO to consolidate these into a single `analyse()` WASM call as part of the Level 2 refactor.

**YIN works on pure tones — polyphonic audio is harder**
YIN is a monophonic algorithm. It finds one fundamental frequency per frame. It works well for single guitar notes but will give unreliable results when multiple strings are ringing. That's expected — polyphonic detection is Level 2.

**Gain value is fixed**
The `GainNode` is set to 6.0 as a static value. Different microphones have very different sensitivities. A proper fix would be an auto-calibration step or a user-adjustable gain control.

**No silence detection**
When there's no guitar input, YIN still tries to find a pitch in the noise floor. This can produce ghost readings. A proper silence gate (discard frames below an RMS threshold) would clean this up.

---

## Next steps (Level 2)

- [ ] Silence gate — ignore frames below a minimum RMS threshold
- [ ] Refactor: single `analyse()` WASM function returning frequency, note name, and cents
- [ ] Polyphonic peak detection in the frequency domain (FFT-based)
- [ ] Chord identification from detected peaks — map sets of notes to chord names
- [ ] Chord display UI
- [ ] AudioWorklet migration
