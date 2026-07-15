import { useAppStore } from '@/store/useAppStore'

/** Model-mode settings: ambient occlusion, glass roughness. (Exposure lives in its own always-on
 * floating slider — ExposureSlider.tsx — since tone-mapping applies across every mode.) */
export function ModelSettings() {
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const setAmbientOcclusion = useAppStore((s) => s.setAmbientOcclusion)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const setAoStrength = useAppStore((s) => s.setAoStrength)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)
  const setGlassRoughnessLevel = useAppStore((s) => s.setGlassRoughnessLevel)

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          id="ao-toggle"
          type="checkbox"
          checked={ambientOcclusion}
          onChange={(e) => setAmbientOcclusion(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
        />
        <label htmlFor="ao-strength" className="text-xs font-medium text-neutral-400 select-none w-16">
          Ambient
        </label>
        <input
          id="ao-strength"
          type="range"
          min={1}
          max={5}
          step={0.1}
          value={aoStrength}
          onChange={(e) => setAoStrength(parseFloat(e.target.value))}
          disabled={!ambientOcclusion}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500
            disabled:cursor-not-allowed disabled:opacity-30"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {aoStrength.toFixed(1)}x
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3.5" />
        <label htmlFor="glass-roughness" className="text-xs font-medium text-neutral-400 select-none w-16">
          Glass
        </label>
        <input
          id="glass-roughness"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={glassRoughnessLevel}
          onChange={(e) => setGlassRoughnessLevel(parseFloat(e.target.value))}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-neutral-700
            accent-violet-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-500"
        />
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400">
          {Math.round(glassRoughnessLevel * 100)}%
        </span>
      </div>
    </>
  )
}
