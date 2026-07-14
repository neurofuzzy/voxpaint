import { useAppStore } from '@/store/useAppStore'

export function SettingsPalette() {
  const noiseLevel = useAppStore((s) => s.noiseLevel)
  const setNoiseLevel = useAppStore((s) => s.setNoiseLevel)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const setAoStrength = useAppStore((s) => s.setAoStrength)

  return (
    <div
      className="absolute bottom-4 left-3 z-40 flex flex-col gap-3 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <label htmlFor="ao-strength" className="text-xs font-medium text-neutral-400 select-none">
          AO
        </label>
        <input
          id="ao-strength"
          type="range"
          min={1}
          max={5}
          step={0.1}
          value={aoStrength}
          onChange={(e) => setAoStrength(parseFloat(e.target.value))}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {aoStrength.toFixed(1)}x
        </span>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="noise-level" className="text-xs font-medium text-neutral-400 select-none">
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
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {Math.round(noiseLevel * 100)}%
        </span>
      </div>
    </div>
  )
}
