import type { EmissiveAnimMode } from '@/engine/palette/types'
import { useAppStore } from '@/store/useAppStore'

const MODES: Array<{ id: EmissiveAnimMode; label: string }> = [
  { id: 'none', label: 'Off' },
  { id: 'blink', label: 'Blink' },
  { id: 'pulse', label: 'Pulse' },
]

/**
 * Animate mode's `SettingsPalette` content: per-emissive-slot glow animation (1Hz blink or pulse),
 * live-previewed everywhere and baked into glTF export via `KHR_animation_pointer`
 * (see `engine/export/emissiveAnimationExport.ts`).
 */
export function EmissiveAnimationSettings() {
  const emissive = useAppStore((s) => s.palette.emissive)
  const emissiveAnim = useAppStore((s) => s.palette.emissiveAnim)
  const setEmissiveAnimMode = useAppStore((s) => s.setEmissiveAnimMode)

  return (
    <>
      {emissive.map((hex, index) => {
        const active = emissiveAnim[index] ?? 'none'
        return (
          <div key={index} className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-neutral-700"
              style={{ backgroundColor: hex }}
            />
            <div className="flex flex-1 rounded-md border border-neutral-700 overflow-hidden">
              {MODES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setEmissiveAnimMode(index, id)}
                  className={
                    'flex-1 px-1.5 py-0.5 text-[11px] font-medium transition ' +
                    (active === id
                      ? 'bg-violet-500/60 text-white'
                      : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
