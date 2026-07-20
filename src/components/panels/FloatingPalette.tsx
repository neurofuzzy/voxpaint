import { useAppStore } from '@/store/useAppStore'
import type { PaletteSlotKind } from '@/engine/palette/types'
import { GRAYSCALE } from '@/engine/texture/types'
import { AnimationPalette } from './AnimationPalette'
import { PaletteThemeMenu } from './PaletteThemeMenu'
import { SelectionPalette } from './SelectionPalette'

const SWATCH = 'h-6 w-6 shrink-0'

function Swatch({ kind, index, hex }: { kind: PaletteSlotKind; index: number; hex: string }) {
  const activeSlot = useAppStore((s) => s.activePaletteSlot)
  const setActivePaletteSlot = useAppStore((s) => s.setActivePaletteSlot)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const active = activeSlot.kind === kind && activeSlot.index === index

  let swatchStyle: React.CSSProperties
  if (kind === 'metal') {
    swatchStyle = {
      background: `linear-gradient(180deg, rgba(255,255,255,0.35) 15%, transparent 50%, rgba(0,0,0,0.2) 85%), ${hex}`,
    }
  } else if (kind === 'glass') {
    swatchStyle = {
      background: `linear-gradient(${hex}9a, ${hex}9a), repeating-conic-gradient(#fff 0% 25%, #d4d4d4 0% 50%) 0 0 / 6px 6px`,
    }
  } else {
    swatchStyle = { backgroundColor: hex }
  }

  return (
    <button
      aria-label={`${kind} ${index}`}
      title={`${kind} ${index + 1}`}
      onClick={() => {
        setActivePaletteSlot({ kind, index })
        setActiveTool('paint')
      }}
      // A `border` clips separately from the rounded gradient background, and the two curves'
      // anti-aliasing don't quite line up — leaves a stray sliver of the gradient's edge color
      // peeking out at the top/bottom of the ring. A `ring` (box-shadow) paints flush against the
      // already-rendered background instead of carving its own box, so it can't seam like that.
      className={
        `${SWATCH} rounded-full ring-2 transition-transform hover:scale-110 ` +
        (active ? 'scale-125 ring-white shadow-lg' : 'ring-white/10')
      }
      style={swatchStyle}
    />
  )
}

/**
 * Bottom-center frosted palette pill (trixelart-style ColorPalette.tsx compact/mobile layout —
 * deliberately not its desktop left-edge vertical variant). Scoped to the 2D editor pane, since
 * color-picking only applies there.
 *
 * The special-material row (emissive/metal/glass) is laid out as spacer + 4 + spacer + 4 + spacer +
 * 4 + spacer — 4 spacer slots + 12 swatches = 16 slots, exactly matching the 16-wide base row
 * above, so both rows share the same total width and center perfectly on top of each other.
 */
/** Texture-mode palette: the (currently 5) grayscale values a texel can hold, bound to
 * `activeGrayIndex`. */
function GrayscalePalette() {
  const activeGrayIndex = useAppStore((s) => s.activeGrayIndex)
  const setActiveGrayIndex = useAppStore((s) => s.setActiveGrayIndex)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  return (
    <div className="flex items-center gap-1.5">
      {GRAYSCALE.map((hex, index) => {
        const active = activeGrayIndex === index
        return (
          <div key={index} className="flex items-center gap-1.5">
            {/* small gap separating the 4 dark swatches from the 4 light ones */}
            {index === GRAYSCALE.length / 2 && <div className="mx-0.5 h-6 w-px bg-neutral-700" />}
            <button
              aria-label={`gray ${index}`}
              onClick={() => {
                setActiveGrayIndex(index)
                setActiveTool('paint')
              }}
              className={
                `${SWATCH} rounded-full ring-2 transition-transform hover:scale-110 ` +
                (active ? 'scale-125 ring-white shadow-lg' : 'ring-white/20')
              }
              style={{ backgroundColor: hex }}
            />
          </div>
        )
      })}
    </div>
  )
}

export function FloatingPalette() {
  const palette = useAppStore((s) => s.palette)
  const mode = useAppStore((s) => s.mode)
  const activeTool = useAppStore((s) => s.activeTool)

  // The Select tool takes over the pill with the selection's own subtools — there's nothing to
  // pick a color for while selecting. Animate mode is exempt: it has no selection to act on.
  const showSelectionTools = activeTool === 'select' && mode !== 'animate'

  return (
    <div
      className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-3xl
        border border-neutral-800 bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {showSelectionTools ? (
        <SelectionPalette />
      ) : mode === 'texture' ? (
        <GrayscalePalette />
      ) : mode === 'animate' ? (
        <AnimationPalette />
      ) : (
      <>
      <PaletteThemeMenu />
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
          {palette.metal.map((hex, index) => (
            <Swatch key={index} kind="metal" index={index} hex={hex} />
          ))}
          <div className={SWATCH} />
          {palette.glass.map((hex, index) => (
            <Swatch key={index} kind="glass" index={index} hex={hex} />
          ))}
          <div className={SWATCH} />
        </div>
      </div>
      </>
      )}
    </div>
  )
}
