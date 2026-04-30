# Polyphonic

A web-based guitar tuner and chord identifier, built to learn Rust, WebAssembly, and audio DSP.

**[tuner.nathankurien.com](https://tuner.nathankurien.com)**

---

## What it does

Play a note on your guitar and the app detects the note, shows how in tune you are, and tracks your volume in real time. The goal is to eventually identify full chords - strum a G major and see "G Major" on screen.

Runs entirely in the browser. No server, no data sent anywhere.

---

## Why I built this

I'm a backend developer who wanted to learn Rust properly. I also wanted to understand how audio DSP actually works under the hood.

Things I'm working through:

- **Rust** - ownership, borrowing, the type system, Cargo
- **WebAssembly** - compiling Rust to WASM with `wasm-pack`, calling it from JavaScript
- **Audio DSP** - PCM audio, the YIN pitch detection algorithm, FFT fundamentals
- **Web Audio API** - `AudioContext`, `ScriptProcessorNode`, real-time audio in the browser
- **React + TypeScript** - I'm primarily backend, so the frontend is new territory too

---

## How it works

Pitch detection runs in Rust, compiled to WebAssembly. A 50ms window of audio comes in from the microphone via the Web Audio API, gets passed to the WASM module, and the YIN algorithm figures out the fundamental frequency. That frequency maps to a note name, and React renders the result.

The Rust engine is also a standalone CLI tool - you can point it at a `.wav` file and it prints detected notes to the terminal. That made it much easier to develop and test the algorithm before touching the browser at all.

```
polyphonic/
├── engine/        Rust - YIN pitch detection, compiled to CLI and WASM
├── web/           React + TypeScript frontend
├── notes/         Running notes on concepts as I learn them
└── test-samples/  Synthetic WAV files for testing the CLI
```

---

## Roadmap

- [x] Level 1 - Monophonic tuner: play a note, see the name and tuning
- [ ] Level 2 - Polyphonic chord identifier: strum a chord, see "C Major" / "Am7"
- [ ] AudioWorklet migration - move audio processing off the main thread

---

## Tech stack

| Layer | Technology |
|---|---|
| Audio engine | Rust, compiled to WebAssembly via `wasm-pack` |
| Pitch detection | YIN algorithm |
| Web audio | Web Audio API, `ScriptProcessorNode` |
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS |
| Deployment | Cloudflare Pages |

---

## Running locally

Requires Rust, `wasm-pack`, and Node.js.

```bash
# Build the WASM package
cd engine
wasm-pack build --target web --out-dir pkg

# Start the frontend
cd ../web
npm install
npm run dev
```

To test the pitch detector from the command line:

```bash
cd engine
cargo run -- ../test-samples/E2.wav
```

---

The `notes/` folder has writeups of concepts as I've learned them. Written for my own reference but readable if you're covering the same ground.
