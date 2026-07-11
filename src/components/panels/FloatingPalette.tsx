import { useAppStore } from '@/store/useAppStore'
import type { PaletteSlotKind } from '@/engine/palette/types'
import { VoxelKindToggle } from './LayerToggle'

const SWATCH = 'h-6 w-6 shrink-0'

function Swatch({ kind, index, hex }: { kind: PaletteSlotKind; index: number; hex: string }) {
  const activeSlot = useAppStore((s) => s.activePaletteSlot)
  const setActivePaletteSlot = useAppStore((s) => s.setActivePaletteSlot)
  const active = activeSlot.kind === kind && activeSlot.index === index

  return (
    <button
      aria-label={`${kind} ${index}`}
      onClick={() => setActivePaletteSlot({ kind, index })}
      className={
        `${SWATCH} rounded-full border-2 transition-transform hover:scale-110 ` +
        (active ? 'scale-125 border-white shadow-lg' : 'border-white/10')
      }
      style={{ backgroundColor: hex }}
    />
  )
}

/**
 * Bottom-center frosted palette pill (trixelart-style ColorPalette.tsx compact/mobile layout —
 * deliberately not its desktop left-edge vertical variant). Scoped to the 2D editor pane, since
 * color-picking only applies there.
 *
 * The special-color row (emissive/blink/pulse) is laid out as spacer + 4 + spacer + 4 + spacer +
 * 4 + spacer — 4 spacer slots + 12 swatches = 16 slots, exactly matching the 16-wide base row
 * above, so both rows share the same total width and center perfectly on top of each other.
 */
export function FloatingPalette() {
  const palette = useAppStore((s) => s.palette)

  return (
    <div
      className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-3xl
        border border-neutral-800 bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <VoxelKindToggle compact />
      <div className="h-8 w-px bg-neutral-700" />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          {palette.base.map((hex, index) => (
            <Swatch key={index} kind="base" index={index} hex={hex} />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <div className={SWATCH} />
          {palette.emissive.map((hex, index) => (
            <Swatch key={index} kind="emissive" index={index} hex={hex} />
          ))}
          <div className={SWATCH} />
          {palette.blink.map((hex, index) => (
            <Swatch key={index} kind="blink" index={index} hex={hex} />
          ))}
          <div className={SWATCH} />
          {palette.pulse.map((hex, index) => (
            <Swatch key={index} kind="pulse" index={index} hex={hex} />
          ))}
          <div className={SWATCH} />
        </div>
      </div>
    </div>
  )
}
