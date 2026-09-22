import { Ban } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { PaletteSlotKind } from '@/engine/palette/types'
import { BUILTIN_MATERIALS, BUILTIN_MATERIAL_BY_ID, CLASS_MATERIAL_IDS, CLASS_MATERIAL_NAMES, isClassMaterialId, slotMaterialKey, type ClassMaterialId } from '@/engine/materials/builtinMaterials'
import { resolveSlotColor } from '@/engine/palette/palette'
import { GRAYSCALE } from '@/engine/texture/types'
import { AnimationPalette } from './AnimationPalette'
import { PaletteThemeMenu } from './PaletteThemeMenu'
import { SelectionPalette } from './SelectionPalette'

const SWATCH = 'h-6 w-6 shrink-0'
const SPHERE = 'h-10 w-10 shrink-0'

function Swatch({ kind, index, hex }: { kind: PaletteSlotKind; index: number; hex: string }) {
  const activeSlot = useAppStore((s) => s.activePaletteSlot)
  const activeTool = useAppStore((s) => s.activeTool)
  const setActivePaletteSlot = useAppStore((s) => s.setActivePaletteSlot)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const materialId = useAppStore((s) => s.slotMaterials[slotMaterialKey(kind, index)] ?? null)
  const active = activeSlot.kind === kind && activeSlot.index === index
  const materialName = materialId
    ? (isClassMaterialId(materialId) ? CLASS_MATERIAL_NAMES[materialId] : (BUILTIN_MATERIAL_BY_ID[materialId]?.name ?? null))
    : null

  let swatchStyle: React.CSSProperties
  if (kind === 'metal') {
    swatchStyle = {
      background: `linear-gradient(180deg, rgba(255,255,255,0.35) 15%, transparent 50%, rgba(0,0,0,0.2) 85%), ${hex}`,
    }
  } else if (kind === 'carpaint') {
    swatchStyle = {
      background: `linear-gradient(180deg, rgba(255,255,255,0.55) 8%, transparent 38%, rgba(0,0,0,0.25) 90%), ${hex}`,
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
      title={materialName ? `${kind} ${index + 1} — ${materialName}` : `${kind} ${index + 1}`}
      onClick={() => {
        setActivePaletteSlot({ kind, index })
        // Picking a color drops into paint — except for the material tool, which consumes palette
        // slots itself and must keep focus so sweeping the palette doesn't kick the user out.
        if (activeTool !== 'material') setActiveTool('paint')
      }}
      // A `border` clips separately from the rounded gradient background, and the two curves'
      // anti-aliasing don't quite line up — leaves a stray sliver of the gradient's edge color
      // peeking out at the top/bottom of the ring. A `ring` (box-shadow) paints flush against the
      // already-rendered background instead of carving its own box, so it can't seam like that.
      className={
        `${SWATCH} relative rounded-full ring-2 transition-transform hover:scale-110 ` +
        (active ? 'scale-125 ring-white shadow-lg' : 'ring-white/10')
      }
      style={swatchStyle}
    >
      {materialName && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-neutral-900" />
      )}
    </button>
  )
}

/**
 * Bottom-center frosted palette pill (trixelart-style ColorPalette.tsx compact/mobile layout —
 * deliberately not its desktop left-edge vertical variant). Scoped to the 2D editor pane, since
 * color-picking only applies there.
 *
 * Two pickers: the base color row, then the material row (parametric classes + texture
 * spheres) which assigns a surface to the active color slot — the slot remembers the
 * combination. The old per-kind rows (emissive/metal/glass/carpaint) are gone; those classes
 * are now expressible as material assignments on plain base slots.
 */
/**
 * Parametric class sphere: Emissive / Glass / Carpaint rendered at sphere size in the active
 * slot's own color, so the row previews the actual combination being picked.
 */
function ClassSphere({ id, hex, active, onPick }: { id: ClassMaterialId; hex: string; active: boolean; onPick: () => void }) {
  let style: React.CSSProperties
  if (id === 'glass') {
    style = {
      background: `linear-gradient(${hex}9a, ${hex}9a), repeating-conic-gradient(#fff 0% 25%, #d4d4d4 0% 50%) 0 0 / 10px 10px`,
    }
  } else if (id === 'carpaint') {
    style = {
      background: `linear-gradient(180deg, rgba(255,255,255,0.55) 8%, transparent 38%, rgba(0,0,0,0.25) 90%), ${hex}`,
    }
  } else {
    style = { backgroundColor: hex, boxShadow: `0 0 12px 2px ${hex}` }
  }
  return (
    <button
      aria-label={CLASS_MATERIAL_NAMES[id]}
      title={CLASS_MATERIAL_NAMES[id]}
      onClick={onPick}
      className={
        `${SPHERE} shrink-0 rounded-full ring-2 transition-transform hover:scale-110 ` +
        (active ? 'scale-110 ring-white shadow-lg' : 'ring-white/10')
      }
      style={style}
    />
  )
}

/**
 * Material row: pick a surface for the active color slot — you select two things, a color
 * above and a material here, and the slot remembers the combination (`slotMaterials`).
 * Parametric classes first (rendered live in the slot's color), then texture spheres (the
 * libraries' own renders, vendored with the maps — see `public/materials/NOTICE.md`).
 * Horizontally scrolls; the leading "none" circle clears back to plain matte.
 */
function MaterialRow() {
  const palette = useAppStore((s) => s.palette)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)
  const slotMaterials = useAppStore((s) => s.slotMaterials)
  const setSlotMaterial = useAppStore((s) => s.setSlotMaterial)
  const slotKey = slotMaterialKey(activePaletteSlot.kind, activePaletteSlot.index)
  const assigned = slotMaterials[slotKey] ?? null
  const hex = resolveSlotColor(palette, activePaletteSlot)
  const base = import.meta.env.BASE_URL
  const pick = (id: string) => setSlotMaterial(slotKey, assigned === id ? null : id)

  return (
    <div className="flex max-w-100 items-center gap-2 overflow-x-auto py-1">
      <button
        aria-label="No material"
        title="No material (plain matte)"
        onClick={() => setSlotMaterial(slotKey, null)}
        className={
          `${SPHERE} flex shrink-0 items-center justify-center rounded-full ring-2 transition-transform hover:scale-110 ` +
          (assigned === null ? 'scale-110 ring-white shadow-lg' : 'ring-white/10')
        }
      >
        <Ban size={16} className="text-neutral-500" />
      </button>
      {CLASS_MATERIAL_IDS.map((id) => (
        <ClassSphere key={id} id={id} hex={hex} active={assigned === id} onPick={() => pick(id)} />
      ))}
      <div className="h-10 w-px shrink-0 bg-neutral-800" />
      {BUILTIN_MATERIALS.map((m) => {
        const active = assigned === m.id
        return (
          <button
            key={m.id}
            aria-label={m.name}
            title={m.name}
            onClick={() => pick(m.id)}
            className={
              `${SPHERE} overflow-hidden rounded-full ring-2 transition-transform hover:scale-110 ` +
              (active ? 'scale-110 ring-white shadow-lg' : 'ring-white/10')
            }
          >
            <img src={`${base}${m.thumb}`} alt="" draggable={false} className="h-full w-full object-cover" />
          </button>
        )
      })}
    </div>
  )
}

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
        <div className="my-1 h-px bg-neutral-800" />
        <MaterialRow />
      </div>
      </>
      )}
    </div>
  )
}
