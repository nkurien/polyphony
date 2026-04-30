import { useState, useRef, useCallback } from 'react'

import init, { detect_note } from 'engine'

const BUFFER_SIZE = 4096
const CONFIRM_THRESHOLD = 3

type Status = 'idle' | 'loading' | 'listening' | 'error'

// Compute RMS (root mean square) amplitude of a sample buffer.
// RMS gives a perceptually natural measure of loudness - louder than peak amplitude
// for typical audio signals, and much more stable frame-to-frame.
// Returns a value in [0.0, 1.0].
function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [note, setNote] = useState<string>('--')
  const [volume, setVolume] = useState<number>(0)
  const [errorMsg, setErrorMsg] = useState<string>('')

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

  const candidateNoteRef = useRef<string>('')
  const candidateCountRef = useRef<number>(0)

  // Envelope follower for volume smoothing.
  // Raw RMS jumps around too much frame-to-frame, so we apply different
  // smoothing rates for attack (rising) and release (falling).
  // Alpha values are per-frame: higher = faster response, lower = slower decay.
  const smoothedVolumeRef = useRef<number>(0)
  const ATTACK_ALPHA = 0.6   // responds quickly when volume rises
  const RELEASE_ALPHA = 0.05 // decays slowly when volume falls

  const startListening = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')

    try {
      await init()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)

        // Compute RMS then run it through the envelope follower
        const raw = rms(samples)
        const prev = smoothedVolumeRef.current
        const alpha = raw > prev ? ATTACK_ALPHA : RELEASE_ALPHA
        smoothedVolumeRef.current = alpha * raw + (1 - alpha) * prev
        setVolume(smoothedVolumeRef.current)

        const detected = detect_note(samples, ctx.sampleRate)

        if (detected === candidateNoteRef.current) {
          candidateCountRef.current += 1
          if (candidateCountRef.current >= CONFIRM_THRESHOLD) {
            setNote(detected)
          }
        } else {
          candidateNoteRef.current = detected
          candidateCountRef.current = 1
        }
      }

      source.connect(processor)
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
    candidateNoteRef.current = ''
    candidateCountRef.current = 0
    smoothedVolumeRef.current = 0
    setStatus('idle')
    setNote('--')
    setVolume(0)
  }, [])

  // Map RMS volume to note opacity. RMS values for guitar are typically in [0, 0.3],
  // so we scale up aggressively to make quiet playing still register visually.
  // Clamped to [0.1, 0.9] so the note never fully disappears or blinds you.
  const noteOpacity = status === 'listening'
    ? Math.min(0.9, Math.max(0.1, volume * 4))
    : 0.9

  const volumeBarWidth = `${Math.min(100, volume * 350)}%`

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white flex flex-col items-center justify-center gap-12">
      <p className="text-xs tracking-[0.3em] uppercase text-white/20 font-light">
        Polyphonics
      </p>

      {/* Note display */}
      <div className="flex flex-col items-center gap-4">
        <span
          style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            opacity: noteOpacity,
            transition: 'opacity 80ms ease-out',
          }}
          className="text-[11rem] leading-none font-light text-white select-none tracking-tight"
        >
          {note}
        </span>
        <span className="text-[11px] tracking-[0.25em] uppercase text-white/25">
          {status === 'listening' ? 'Listening' : ' '}
        </span>
      </div>

      {/* Volume bar */}
      <div className="w-48 h-px bg-white/5 relative overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full"
          style={{
            width: volumeBarWidth,
            backgroundColor: '#E2622A',
            transition: 'width 60ms ease-out',
          }}
        />
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

      {status === 'error' && (
        <p className="text-white/30 text-xs max-w-sm text-center tracking-wide">{errorMsg}</p>
      )}
    </div>
  )
}
