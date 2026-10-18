import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { MARKER_COLORS } from '@/engine/markers/types'
import type { PaletteSlotKind } from '@/engine/palette/types'
import { GRAYSCALE } from '@/engine/texture/types'
import { AnimationPalette } from './AnimationPalette'
import { MovePalette } from './MovePalette'
import { PaletteThemeMenu } from './PaletteThemeMenu'
import { SelectionPalette } from './SelectionPalette'

/** Layout direction of a palette row: the 2D pane's bottom-center pill is horizontal, the
 * collapsed rail restacks the same content vertically. */
export type PaletteOrientation = 'horizontal' | 'vertical'

const SWATCH = 'h-6 w-6 shrink-0'

function Swatch({ kind, index, hex }: { kind: PaletteSlotKind; index: number; hex: string }) {
  const activeSlot = useAppStore((s) => s.activePaletteSlot)
  const activeTool = useAppStore((s) => s.activeTool)
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
        // Picking a color drops into paint — except for tools that consume palette slots
        // themselves (material repaints, fill floods): they must keep focus so sweeping the
        // palette for a fill color doesn't kick the user back out to the pencil.
        if (activeTool !== 'material' && activeTool !== 'fill') setActiveTool('paint')
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
function GrayscalePalette({ orientation }: { orientation: PaletteOrientation }) {
  const activeGrayIndex = useAppStore((s) => s.activeGrayIndex)
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveGrayIndex = useAppStore((s) => s.setActiveGrayIndex)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const vertical = orientation === 'vertical'
  return (
    <div className={vertical ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1.5'}>
      {GRAYSCALE.map((hex, index) => {
        const active = activeGrayIndex === index
        return (
          <div key={index} className={vertical ? 'contents' : 'flex items-center gap-1.5'}>
            {/* small gap separating the 4 dark swatches from the 4 light ones */}
            {index === GRAYSCALE.length / 2 && (
              vertical
                ? <div className="my-0.5 h-px w-6 bg-neutral-700" />
                : <div className="mx-0.5 h-6 w-px bg-neutral-700" />
            )}
            <button
              aria-label={`gray ${index}`}
              onClick={() => {
                setActiveGrayIndex(index)
                // Same fill exemption as the voxel Swatch above: picking a gray for a flood
                // must not kick the texture fill tool back out to paint.
                if (activeTool !== 'fill') setActiveTool('paint')
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

/** Marker-tool palette: the fixed marker color set new markers are placed with. Separate
 * from the voxel color palette — markers are composition annotations, not paint. */
function MarkerPalette({ orientation }: { orientation: PaletteOrientation }) {
  const activeMarkerColor = useAppStore((s) => s.activeMarkerColor)
  const setActiveMarkerColor = useAppStore((s) => s.setActiveMarkerColor)
  return (
    <div className={orientation === 'vertical' ? 'flex flex-col items-center gap-3 pb-2' : 'flex items-center gap-1.5'}>
      {MARKER_COLORS.map((hex, index) => {
        const active = activeMarkerColor === index
        return (
          <button
            key={index}
            aria-label={`marker color ${index + 1}`}
            title={`Marker color ${index + 1}`}
            onClick={() => setActiveMarkerColor(index)}
            className={
              `${SWATCH} rounded-full ring-2 transition-transform hover:scale-110 ` +
              (active ? 'scale-125 ring-white shadow-lg' : 'ring-white/20')
            }
            style={{ backgroundColor: hex }}
          />
        )
      })}
    </div>
  )
}

export function FloatingPalette({ orientation = 'horizontal' }: { orientation?: PaletteOrientation } = {}) {
  const mode = useAppStore((s) => s.mode)
  const activeTool = useAppStore((s) => s.activeTool)
  const vertical = orientation === 'vertical'

  // The Select tool takes over the pill with the selection's own subtools — there's nothing to
  // pick a color for while selecting. Animate mode is exempt: it has no selection to act on.
  const showSelectionTools = activeTool === 'select' && mode !== 'animate'
  // The Move tool likewise never paints: the pill hosts whole-model rotate/flip instead of
  // colors. Model mode only — in Texture mode Move still translates texels, which takes no color
  // either, but whole-model voxel transforms don't apply there, so the gray palette stays.
  const showMoveTools = activeTool === 'move' && mode === 'model'

  return (
    <div
      className={
        vertical
          ? 'flex w-full flex-col items-center gap-2'
          : 'absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-3xl ' +
            'border border-neutral-800 bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg'
      }
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {showSelectionTools ? (
        <SelectionPalette orientation={orientation} />
      ) : showMoveTools ? (
        <MovePalette orientation={orientation} />
      ) : mode === 'texture' ? (
        <GrayscalePalette orientation={orientation} />
      ) : mode === 'animate' ? (
        <AnimationPalette orientation={orientation} />
      ) : activeTool === 'marker' ? (
        <MarkerPalette orientation={orientation} />
      ) : (
        <ColorSwatches orientation={orientation} />
      )}
    </div>
  )
}

const COLOR_GROUPS: Array<{ id: PaletteSlotKind; label: string }> = [
  { id: 'base', label: 'Base' },
  { id: 'emissive', label: 'Emissive' },
  { id: 'metal', label: 'Metal' },
  { id: 'glass', label: 'Glass' },
]

/**
 * The voxel color section. Horizontally (2D pill) it is the two familiar swatch rows — 16 base
 * over emissive/metal/glass padded with spacers to the same width. Vertically (collapsed rail,
 * w-14) it is tabbed: one group per page, single-file with roomy spacing, group label plus a
 * right chevron at the bottom to advance (wraps; Shift+click goes back).
 */
function ColorSwatches({ orientation }: { orientation: PaletteOrientation }) {
  const palette = useAppStore((s) => s.palette)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const vertical = orientation === 'vertical'
  const [groupIdx, setGroupIdx] = useState(0)
  const rowClass = vertical ? 'flex flex-col items-center gap-3' : 'flex items-center gap-1'

  if (!vertical) {
    return (
      <>
        <PaletteThemeMenu />
        <div className="flex flex-col gap-1">
          <div className={rowClass}>
            {palette.base.map((hex, index) => (
              <Swatch key={index} kind="base" index={index} hex={hex} />
            ))}
          </div>
          <div className={rowClass}>
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
    )
  }

  const group = COLOR_GROUPS[groupIdx % COLOR_GROUPS.length]
  const next = COLOR_GROUPS[(groupIdx + 1) % COLOR_GROUPS.length]
  const prev = COLOR_GROUPS[(groupIdx + COLOR_GROUPS.length - 1) % COLOR_GROUPS.length]
  // Pad short groups with inert placeholders so every tab is the same height as the tallest.
  const padCount = Math.max(palette.base.length, palette.emissive.length, palette.metal.length, palette.glass.length) - palette[group.id].length
  return (
    <>
      <PaletteThemeMenu />
      <div className={rowClass}>
        {palette[group.id].map((hex, index) => (
          <Swatch key={index} kind={group.id} index={index} hex={hex} />
        ))}
        {Array.from({ length: padCount }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden className={`${SWATCH} rounded-full bg-black ring-2 ring-black`} />
        ))}
      </div>
      <div className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">{group.label}</div>
      <button
        onClick={(e) => setGroupIdx((groupIdx + (e.shiftKey ? COLOR_GROUPS.length - 1 : 1)) % COLOR_GROUPS.length)}
        aria-label={`Color group ${group.label} — activate for ${next.label}`}
        title={`Next color group: ${next.label} (Shift+click for ${prev.label})`}
        onPointerEnter={() => setStatusMessage(`Color group ${group.label} — click for ${next.label}, Shift+click for ${prev.label}`)}
        onPointerLeave={() => setStatusMessage(null)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <ArrowRight size={16} />
      </button>
    </>
  )
}
