import { useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { EnvironmentChoice } from '@/engine/persistence/schema'

/** Model-mode settings: ambient occlusion, glass roughness, preview environment. (Exposure lives
 * in its own always-on floating slider — ExposureSlider.tsx — since tone-mapping applies across
 * every mode. Surface-material assignment lives in the palette pill's material row.) */
export function ModelSettings() {
  const ambientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const setAmbientOcclusion = useAppStore((s) => s.setAmbientOcclusion)
  const aoStrength = useAppStore((s) => s.aoStrength)
  const setAoStrength = useAppStore((s) => s.setAoStrength)
  const glassRoughnessLevel = useAppStore((s) => s.glassRoughnessLevel)
  const setGlassRoughnessLevel = useAppStore((s) => s.setGlassRoughnessLevel)
  const environment = useAppStore((s) => s.environment)
  const setEnvironment = useAppStore((s) => s.setEnvironment)
  const customEnvUrl = useAppStore((s) => s.customEnvUrl)
  const customEnvName = useAppStore((s) => s.customEnvName)
  const setCustomEnvUrl = useAppStore((s) => s.setCustomEnvUrl)
  const fileRef = useRef<HTMLInputElement>(null)

  const onSelectEnvironment = (v: EnvironmentChoice) => {
    if (v === 'custom' && !customEnvUrl) {
      // No file loaded yet this session — open the picker; the choice commits on file select.
      fileRef.current?.click()
      return
    }
    setEnvironment(v)
  }

  const onPickFile = (file: File | undefined) => {
    if (!file) return
    if (customEnvUrl) URL.revokeObjectURL(customEnvUrl)
    setCustomEnvUrl(URL.createObjectURL(file), file.name)
    setEnvironment('custom')
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-3.5" />
        <label htmlFor="env-select" className="text-xs font-medium text-neutral-400 select-none w-16">
          Environ
        </label>
        <select
          id="env-select"
          value={environment}
          onChange={(e) => onSelectEnvironment(e.target.value as EnvironmentChoice)}
          title="Preview-only lighting environment (never exported)"
          className="h-6 w-28 cursor-pointer rounded-md border border-neutral-700 bg-neutral-800 px-1
            text-xs text-neutral-200 outline-none hover:border-neutral-600"
        >
          <option value="neutral">Neutral</option>
          <option value="studio">Studio</option>
          <option value="outdoor">Outdoor</option>
          <option value="custom">Custom HDR…</option>
        </select>
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-neutral-400" />
      </div>
      {environment === 'custom' && (
        <div className="flex items-center gap-2">
          <div className="w-3.5" />
          <div className="w-16" />
          <button
            onClick={() => fileRef.current?.click()}
            title="Load a .hdr or .exr file (session-only, e.g. Poly Haven CC0)"
            className="h-6 w-28 truncate rounded-md border border-neutral-700 bg-neutral-800 px-1 text-left
              text-[11px] text-neutral-300 outline-none hover:border-neutral-600"
          >
            {customEnvName ?? 'Choose file…'}
          </button>
          <span className="w-8" />
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".hdr,.exr"
        className="hidden"
        onChange={(e) => {
          onPickFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
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
