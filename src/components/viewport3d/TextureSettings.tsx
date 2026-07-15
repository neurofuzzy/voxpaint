import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'

/** Texture-mode settings: baked noise (AO texture grain) and metal specular noise. */
export function TextureSettings() {
  const noiseLevel = useAppStore((s) => s.noiseLevel)
  const setNoiseLevel = useAppStore((s) => s.setNoiseLevel)
  const specularNoiseLevel = useAppStore((s) => s.specularNoiseLevel)
  const setSpecularNoiseLevel = useAppStore((s) => s.setSpecularNoiseLevel)

  const [noiseChecked, setNoiseChecked] = useState(noiseLevel > 0)
  const [metalChecked, setMetalChecked] = useState(specularNoiseLevel > 0)

  useEffect(() => { if (noiseLevel > 0) setNoiseChecked(true) }, [noiseLevel])
  useEffect(() => { if (specularNoiseLevel > 0) setMetalChecked(true) }, [specularNoiseLevel])

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          id="noise-toggle"
          type="checkbox"
          checked={noiseChecked}
          onChange={(e) => {
            setNoiseChecked(e.target.checked)
            setNoiseLevel(e.target.checked ? Math.max(noiseLevel, 0.01) : 0)
          }}
          className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
        />
        <label htmlFor="noise-level" className="text-xs font-medium text-neutral-400 select-none w-12">
          Noise
        </label>
        <input
          id="noise-level"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={noiseLevel}
          onChange={(e) => setNoiseLevel(parseFloat(e.target.value))}
          disabled={!noiseChecked}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500
            disabled:cursor-not-allowed disabled:opacity-30"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {Math.round(noiseLevel * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="specular-toggle"
          type="checkbox"
          checked={metalChecked}
          onChange={(e) => {
            setMetalChecked(e.target.checked)
            setSpecularNoiseLevel(e.target.checked ? Math.max(specularNoiseLevel, 0.01) : 0)
          }}
          className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
        />
        <label htmlFor="specular-level" className="text-xs font-medium text-neutral-400 select-none w-12">
          Metal
        </label>
        <input
          id="specular-level"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={specularNoiseLevel}
          onChange={(e) => setSpecularNoiseLevel(parseFloat(e.target.value))}
          disabled={!metalChecked}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500
            disabled:cursor-not-allowed disabled:opacity-30"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {Math.round(specularNoiseLevel * 100)}%
        </span>
      </div>
    </>
  )
}
