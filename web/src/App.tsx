import { useState } from 'react'
import TunerPage from './TunerPage'
import ChordPage from './ChordPage'

type Page = 'tuner' | 'chord'

export default function App() {
  const [page, setPage] = useState<Page>('tuner')

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white flex">
      {/* Left-side dot navigation */}
      <nav className="fixed left-6 top-1/2 -translate-y-1/2 flex flex-col z-10">
        <button
          onClick={() => setPage('tuner')}
          className="p-3 flex items-center gap-3 group"
        >
          <span
            className="block w-[6px] h-[6px] rounded-full transition-all duration-300"
            style={{
              backgroundColor: page === 'tuner' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)',
            }}
          />
          <span
            className="text-[10px] tracking-[0.2em] uppercase transition-all duration-300"
            style={{
              color: page === 'tuner' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
            }}
          >
            Tuner
          </span>
        </button>
        <button
          onClick={() => setPage('chord')}
          className="p-3 flex items-center gap-3 group"
        >
          <span
            className="block w-[6px] h-[6px] rounded-full transition-all duration-300"
            style={{
              backgroundColor: page === 'chord' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)',
            }}
          />
          <span
            className="text-[10px] tracking-[0.2em] uppercase transition-all duration-300"
            style={{
              color: page === 'chord' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
            }}
          >
            Chord
          </span>
        </button>
      </nav>

      {/* Page content */}
      <div className="flex-1 flex items-center justify-center">
        {page === 'tuner' ? <TunerPage /> : <ChordPage />}
      </div>
    </div>
  )
}
