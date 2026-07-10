import { useAppStore } from '@/store/useAppStore'
import type { PaletteSlotKind } from '@/engine/palette/types'

const SECTIONS: Array<{ kind: PaletteSlotKind; label: string }> = [
  { kind: 'base', label: 'Base' },
  { kind: 'emissive', label: 'Emissive' },
  { kind: 'blink', label: 'Blink' },
  { kind: 'pulse', label: 'Pulse' },
]

export function PaletteGrid() {
  const palette = useAppStore((s) => s.palette)
  const activeSlot = useAppStore((s) => s.activePaletteSlot)
  const setActivePaletteSlot = useAppStore((s) => s.setActivePaletteSlot)

  return (
    <div className="flex flex-col gap-3 p-3">
      {SECTIONS.map(({ kind, label }) => (
        <div key={kind}>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
          <div className="grid grid-cols-8 gap-1">
            {palette[kind].map((hex, index) => {
              const active = activeSlot.kind === kind && activeSlot.index === index
              return (
                <button
                  key={index}
                  aria-label={`${label} ${index}`}
                  onClick={() => setActivePaletteSlot({ kind, index })}
                  className="aspect-square rounded-sm ring-offset-1 ring-offset-neutral-950 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: hex,
                    outline: active ? '2px solid white' : '1px solid rgba(255,255,255,0.08)',
                    outlineOffset: active ? '1px' : 0,
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
