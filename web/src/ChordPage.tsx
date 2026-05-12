import { useState, useRef, useCallback } from 'react'
import init, { detect_chord } from 'engine'

const BUFFER_SIZE = 4096
// Chord detection is noisier than single-note detection, so we require
// more consecutive matching frames before displaying a result.
const CONFIRM_THRESHOLD = 5

type Status = 'idle' | 'loading' | 'listening' | 'error'

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

export default function ChordPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [chord, setChord] = useState<string>('—')
  const [volume, setVolume] = useState<number>(0)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const candidateChordRef = useRef<string>('')
  const candidateCountRef = useRef<number>(0)

  const smoothedVolumeRef = useRef<number>(0)
  const ATTACK_ALPHA = 0.6
  const RELEASE_ALPHA = 0.05

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

        // Skip analysis when signal is near-silent — avoids spurious chord
        // detections from noise in quiet microphones.
        if (smoothedVolumeRef.current < 0.008) return

        const detected = detect_chord(samples, ctx.sampleRate)

        // Require CONFIRM_THRESHOLD consecutive frames with the same chord
        // before displaying it — reduces flicker on transients.
        if (detected === candidateChordRef.current) {
          candidateCountRef.current += 1
          if (candidateCountRef.current >= CONFIRM_THRESHOLD) {
            setChord(detected)
          }
        } else {
          candidateChordRef.current = detected
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
    candidateChordRef.current = ''
    candidateCountRef.current = 0
    smoothedVolumeRef.current = 0
    setStatus('idle')
    setChord('—')
    setVolume(0)
  }, [])

  const chordOpacity = status === 'listening'
    ? Math.min(0.9, Math.max(0.1, volume * 3))
    : 0.9

  const volumeBarWidth = `${Math.min(100, volume * 200)}%`

  return (
    <div className="flex flex-col items-center justify-center gap-12 w-full h-full">
      {/* Chord display */}
      <div className="flex flex-col items-center gap-4">
        <span
          style={{
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            opacity: chordOpacity,
            transition: 'opacity 80ms ease-out',
          }}
          className="text-[11rem] leading-none font-light text-white select-none tracking-tight"
        >
          {chord}
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
