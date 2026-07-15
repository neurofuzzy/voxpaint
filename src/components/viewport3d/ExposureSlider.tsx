import { Sun } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const TRACK_LENGTH = 110
const TRACK_THICKNESS = 20

/** Always-on floating vertical fader for tone-mapping exposure — pulled out of ModelSettings since
 * exposure applies to the renderer (ToneMappingController) regardless of authoring mode. A standard
 * horizontal `<input type="range">`, rotated -90deg, since native vertical range styling
 * (`writing-mode`/`-webkit-appearance: slider-vertical`) isn't reliably cross-browser. `transform`
 * doesn't shrink an element's layout box though — only its paint — so the un-rotated 110px-wide
 * input would otherwise force its parent (and this whole panel) that wide. Taking it out of flow
 * with `position: absolute` + a centering translate, inside an explicitly `TRACK_THICKNESS`-wide
 * wrapper, decouples the panel's actual footprint from the input's native (pre-rotation) size. */
export function ExposureSlider() {
  const exposure = useAppStore((s) => s.exposure)
  const setExposure = useAppStore((s) => s.setExposure)

  return (
    <div
      title="Exposure"
      className="absolute right-3 top-16 z-40 flex flex-col items-center gap-1.5
        rounded-xl border border-neutral-800 bg-neutral-900/80 px-2 py-2.5 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <Sun size={13} className="text-neutral-500" aria-label="Exposure" />
      <div style={{ width: TRACK_THICKNESS, height: TRACK_LENGTH }} className="relative">
        <input
          id="exposure"
          type="range"
          min={0.1}
          max={4}
          step={0.05}
          value={exposure}
          onChange={(e) => setExposure(parseFloat(e.target.value))}
          style={{ width: TRACK_LENGTH, transform: 'translate(-50%, -50%) rotate(-90deg)' }}
          className="absolute top-1/2 left-1/2 h-1.5 cursor-pointer appearance-none rounded-full
            bg-neutral-700 accent-violet-500 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500"
        />
      </div>
    </div>
  )
}
