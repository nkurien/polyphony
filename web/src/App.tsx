import { useState, useRef, useCallback } from 'react'

import init, { detect_frequency } from 'engine'

const BUFFER_SIZE = 4096
const CONFIRM_THRESHOLD = 3

type Status = 'idle' | 'loading' | 'listening' | 'error'

// TODO (Level 2 refactor): consolidate music theory logic into Rust.
// Currently frequencyToNote and centsDeviation are duplicated from lib.rs.
// The plan is to expose a single `analyse(samples, sample_rate)` function from
// Rust that returns frequency, note name, and cents in one WASM call, removing
// the duplication and keeping all music logic in one place.
// RMS can stay in JS - it's audio infrastructure rather than music logic.

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

// Mirrors the logic in lib.rs frequency_to_note - see TODO above.
function frequencyToNote(freq: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const semitones = Math.round(12 * Math.log2(freq / 440))
  const midiNote = 69 + semitones
  const octave = Math.floor(midiNote / 12) - 1
  const noteIndex = ((midiNote % 12) + 12) % 12
  return `${noteNames[noteIndex]}${octave}`
}

// Returns how many cents sharp (+) or flat (-) a frequency is from the nearest semitone.
// Range is [-50, +50]. 100 cents = 1 semitone.
function centsDeviation(freq: number): number {
  const midiNote = Math.round(12 * Math.log2(freq / 440) + 69)
  const perfectFreq = 440 * Math.pow(2, (midiNote - 69) / 12)
  return 1200 * Math.log2(freq / perfectFreq)
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [note, setNote] = useState<string>('--')
  const [volume, setVolume] = useState<number>(0)
  const [cents, setCents] = useState<number>(0)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)

  // TODO: Migrate from ScriptProcessorNode to AudioWorklet.
  // ScriptProcessorNode runs on the main thread and is deprecated.
  // AudioWorklet runs audio processing in a dedicated thread (much lower latency).
  // Migration steps when ready:
  //   1. Move the WASM init + detect_frequency call into a worklet processor file
  //   2. Use a SharedArrayBuffer ring buffer to pass samples from the worklet to the main thread
  //   3. Replace the ScriptProcessorNode below with:
  //        const worklet = new AudioWorkletNode(ctx, 'pitch-detector')
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const candidateNoteRef = useRef<string>('')
  const candidateCountRef = useRef<number>(0)

  const smoothedVolumeRef = useRef<number>(0)
  const ATTACK_ALPHA = 0.6
  const RELEASE_ALPHA = 0.05

  // Smooth cents with a gentle EMA to stop it jittering around centre
  const smoothedCentsRef = useRef<number>(0)
  const CENTS_ALPHA = 0.15

  const startListening = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')

    try {
      await init()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Disable browser audio processing that interferes with pitch detection.
          // These are on by default and will duck quiet notes, suppress "noise" that
          // is actually a guitar string, and normalise volume in ways that break our
          // amplitude reading -- particularly aggressive on Android.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)

      // Software gain boost to compensate for low microphone sensitivity on mobile.
      // Applied before the volume meter so the display reflects the boosted signal.
      // We pass the boosted samples to YIN too - YIN works on waveform shape so
      // amplitude doesn't affect pitch accuracy, but boosting helps it clear the
      // silence threshold on quiet devices.
      const gainNode = ctx.createGain()
      gainNode.gain.value = 6.0
      gainNodeRef.current = gainNode
      source.connect(gainNode)

      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor
      gainNode.connect(processor)

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)

        // Volume envelope
        const raw = rms(samples)
        const prev = smoothedVolumeRef.current
        const alpha = raw > prev ? ATTACK_ALPHA : RELEASE_ALPHA
        smoothedVolumeRef.current = alpha * raw + (1 - alpha) * prev
        setVolume(smoothedVolumeRef.current)

        // Single WASM call gives us the raw frequency.
        // We derive note name and cents from it in JS so YIN only runs once per frame.
        const freq = detect_frequency(samples, ctx.sampleRate)

        if (freq === 0) return

        const detected = frequencyToNote(freq)

        if (detected === candidateNoteRef.current) {
          candidateCountRef.current += 1
          if (candidateCountRef.current >= CONFIRM_THRESHOLD) {
            setNote(detected)
            // Smooth the cents value so it doesn't jump frame-to-frame
            smoothedCentsRef.current =
              CENTS_ALPHA * centsDeviation(freq) + (1 - CENTS_ALPHA) * smoothedCentsRef.current
            setCents(smoothedCentsRef.current)
          }
        } else {
          candidateNoteRef.current = detected
          candidateCountRef.current = 1
        }
      }

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
    gainNodeRef.current?.disconnect()
    gainNodeRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    candidateNoteRef.current = ''
    candidateCountRef.current = 0
    smoothedVolumeRef.current = 0
    smoothedCentsRef.current = 0
    setStatus('idle')
    setNote('--')
    setVolume(0)
    setCents(0)
  }, [])

  const noteOpacity = status === 'listening'
    ? Math.min(0.9, Math.max(0.1, volume * 3))
    : 0.9

  const volumeBarWidth = `${Math.min(100, volume * 200)}%`

  // Cents bar: clamp to ±50 cents, map to 0–50% of half the bar width.
  const absCents = Math.abs(cents)
  const centsBarHalfWidth = `${Math.min(50, absCents)}%`
  const centsBarSide = cents >= 0 ? 'left' : 'right'
  // Fade out when close to centre: invisible below 8 cents, fully visible above 25 cents
  const centsBarOpacity = Math.min(1, Math.max(0, (absCents - 8) / 17))
  // In-tune dot: fades in below 8 cents, fully visible below 4 cents
  const inTuneOpacity = status === 'listening' ? Math.min(1, Math.max(0, (8 - absCents) / 4)) : 0

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white flex flex-col items-center justify-center gap-12">
      <p className="text-xs tracking-[0.3em] uppercase text-white/20 font-light">
        Polyphonic
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

      {/* Cents deviation bar — stretches left if flat, right if sharp */}
      <div className="w-48 h-px bg-white/5 relative">
        {/* Centre tick */}
        <div className="absolute left-1/2 -top-1 w-px h-[3px] bg-white/20" />
        {/* In-tune dot — fades in when within 8 cents of perfect pitch */}
        <div
          className="absolute w-[6px] h-[6px] rounded-full bg-emerald-400"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            opacity: inTuneOpacity,
            transition: 'opacity 150ms ease-out',
          }}
        />
        <div
          className="absolute top-0 h-full"
          style={{
            [centsBarSide]: '50%',
            width: centsBarHalfWidth,
            backgroundColor: '#e53935',
            opacity: centsBarOpacity,
            transition: 'width 80ms ease-out, opacity 120ms ease-out',
          }}
        />
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
