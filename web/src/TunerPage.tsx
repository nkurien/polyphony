import { useState, useRef, useCallback } from 'react'
import init, { detect_frequency } from 'engine'

const BUFFER_SIZE = 4096
const CONFIRM_THRESHOLD = 3

type Status = 'idle' | 'loading' | 'listening' | 'error'

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

function frequencyToNote(freq: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const semitones = Math.round(12 * Math.log2(freq / 440))
  const midiNote = 69 + semitones
  const octave = Math.floor(midiNote / 12) - 1
  const noteIndex = ((midiNote % 12) + 12) % 12
  return `${noteNames[noteIndex]}${octave}`
}

function centsDeviation(freq: number): number {
  const midiNote = Math.round(12 * Math.log2(freq / 440) + 69)
  const perfectFreq = 440 * Math.pow(2, (midiNote - 69) / 12)
  return 1200 * Math.log2(freq / perfectFreq)
}

export default function TunerPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [note, setNote] = useState<string>('--')
  const [volume, setVolume] = useState<number>(0)
  const [cents, setCents] = useState<number>(0)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const candidateNoteRef = useRef<string>('')
  const candidateCountRef = useRef<number>(0)

  const smoothedVolumeRef = useRef<number>(0)
  const ATTACK_ALPHA = 0.6
  const RELEASE_ALPHA = 0.05

  const smoothedCentsRef = useRef<number>(0)
  const CENTS_ALPHA = 0.08

  const startListening = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')

    try {
      await init()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)

      const gainNode = ctx.createGain()
      gainNode.gain.value = 6.0
      gainNodeRef.current = gainNode
      source.connect(gainNode)

      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor
      gainNode.connect(processor)

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)

        const raw = rms(samples)
        const prev = smoothedVolumeRef.current
        const alpha = raw > prev ? ATTACK_ALPHA : RELEASE_ALPHA
        smoothedVolumeRef.current = alpha * raw + (1 - alpha) * prev
        setVolume(smoothedVolumeRef.current)

        const freq = detect_frequency(samples, ctx.sampleRate)
        if (freq === 0) return

        const detected = frequencyToNote(freq)

        if (detected === candidateNoteRef.current) {
          candidateCountRef.current += 1
          if (candidateCountRef.current >= CONFIRM_THRESHOLD) {
            setNote(detected)
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

  const absCents = Math.abs(cents)
  const centsBarHalfWidth = `${Math.min(50, absCents)}%`
  const centsBarSide = cents >= 0 ? 'left' : 'right'
  const centsBarOpacity = absCents < 6 ? 0 : Math.min(1, Math.max(0.55, absCents / 30))
  const inTuneOpacity = status === 'listening' ? Math.min(1, Math.max(0, (6 - absCents) / 2)) : 0

  return (
    <div className="flex flex-col items-center justify-center gap-12 w-full h-full">
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

      {/* Cents deviation bar */}
      <div className="w-48 h-px bg-white/5 relative">
        <div className="absolute left-1/2 -top-1 w-px h-[3px] bg-white/20" />
        <div
          className="absolute w-[10px] h-[10px] rounded-full bg-emerald-400"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            opacity: inTuneOpacity,
            boxShadow: `0 0 ${Math.max(0, (2 - absCents) / 2) * 12}px ${Math.max(0, (2 - absCents) / 2) * 8}px rgba(52, 211, 153, ${Math.max(0, (2 - absCents) / 2) * 0.8})`,
            transition: 'opacity 150ms ease-out, box-shadow 150ms ease-out',
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
