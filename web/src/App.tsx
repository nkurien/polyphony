import { useState, useRef, useCallback } from 'react'

// The WASM package exports a single async init function plus our detect_note function.
// We must call init() before detect_note() is usable - it loads and compiles the .wasm binary.
import init, { detect_note } from 'engine'

// How many audio samples to collect before running detection.
// 4096 samples at 44100 Hz = ~93ms of audio per analysis frame.
// Larger = more stable detection but higher latency.
const BUFFER_SIZE = 4096

type Status = 'idle' | 'loading' | 'listening' | 'error'

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [note, setNote] = useState<string>('--')
  const [errorMsg, setErrorMsg] = useState<string>('')

  // We store the AudioContext in a ref rather than state because:
  // - We need to close it on stop
  // - We don't want React to re-render when it changes
  const audioCtxRef = useRef<AudioContext | null>(null)

  // TODO: Migrate from ScriptProcessorNode to AudioWorklet.
  // ScriptProcessorNode runs on the main thread and is deprecated.
  // AudioWorklet runs audio processing in a dedicated thread (much lower latency).
  // Migration steps when ready:
  //   1. Move the WASM init + detect_note call into a worklet processor file
  //   2. Use a SharedArrayBuffer ring buffer to pass samples from the worklet to the main thread
  //   3. Replace the ScriptProcessorNode below with:
  //        const worklet = new AudioWorkletNode(ctx, 'pitch-detector')
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const startListening = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')

    try {
      // Step 1: initialise the WASM module.
      // This fetches and compiles engine_bg.wasm - must complete before detect_note() works.
      await init()

      // Step 2: request microphone access.
      // The browser will prompt the user for permission here.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

      // Step 3: create an AudioContext.
      // This is the root of the Web Audio API graph. All nodes live inside it.
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      // Step 4: build the audio graph.
      //
      //   microphone stream
      //       -> MediaStreamSourceNode  (wraps the mic stream as a Web Audio node)
      //       -> ScriptProcessorNode    (gives us raw PCM samples to process)
      //       -> ctx.destination        (we connect here to keep the graph active, but no audible output)
      //
      const source = ctx.createMediaStreamSource(stream)

      // ScriptProcessorNode fires onaudioprocess whenever it has BUFFER_SIZE new samples ready.
      // The second and third args are input and output channel counts.
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        // getChannelData(0) returns the left (or mono) channel as a Float32Array.
        // Values are already in [-1.0, 1.0] - exactly what our Rust function expects.
        const samples = event.inputBuffer.getChannelData(0)

        // Call our Rust function compiled to WASM.
        // Returns a note name like "E2" or "A4", or "—" if no pitch was found.
        const detected = detect_note(samples, ctx.sampleRate)
        setNote(detected)
      }

      source.connect(processor)
      // Must connect to destination or onaudioprocess never fires.
      processor.connect(ctx.destination)

      setStatus('listening')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(msg)
      setStatus('error')
    }
  }, [])

  const stopListening = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    setStatus('idle')
    setNote('--')
  }, [])

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white flex flex-col items-center justify-center gap-12">
      <p className="text-xs tracking-[0.3em] uppercase text-white/20 font-light">
        Polyphonics
      </p>

      {/* Note display */}
      <div className="flex flex-col items-center gap-4">
        <span
          style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
          className="text-[11rem] leading-none font-light text-white/90 select-none tracking-tight"
        >
          {note}
        </span>
        <span className="text-[11px] tracking-[0.25em] uppercase text-white/25">
          {status === 'listening' ? 'Listening' : ' '}
        </span>
      </div>

      {/* Controls */}
      {status === 'idle' || status === 'error' ? (
        <button
          onClick={startListening}
          className="text-xs tracking-[0.2em] uppercase text-white/40 hover:text-white/80 transition-colors duration-300 border-b border-white/10 hover:border-white/40 pb-px"
        >
          Start
        </button>
      ) : status === 'loading' ? (
        <span className="text-xs tracking-[0.2em] uppercase text-white/20">
          Loading
        </span>
      ) : (
        <button
          onClick={stopListening}
          className="text-xs tracking-[0.2em] uppercase text-white/40 hover:text-white/80 transition-colors duration-300 border-b border-white/10 hover:border-white/40 pb-px"
        >
          Stop
        </button>
      )}

      {/* Error message */}
      {status === 'error' && (
        <p className="text-white/30 text-xs max-w-sm text-center tracking-wide">{errorMsg}</p>
      )}
    </div>
  )
}
