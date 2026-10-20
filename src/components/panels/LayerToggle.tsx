import * as Tooltip from '@radix-ui/react-tooltip'
import { useAppStore } from '@/store/useAppStore'
import type { VoxelKind } from '@/store/types'
import { ChamferIcon, ConcaveIcon, CubeIcon, FlatIcon, FlatWedgeIcon, HalfIcon, PostIcon, QuarterIcon, ThinIcon, WedgeIcon } from './voxelKindIcons'

const KINDS: Array<{ id: VoxelKind; label: string; Icon: typeof CubeIcon; hint: string }> = [
  { id: 'cube', label: 'Cube', Icon: CubeIcon, hint: 'Cube mode: standard block shapes' },
  { id: 'ramp', label: 'Chamfer', Icon: ChamferIcon, hint: 'Chamfer mode: beveled edges and slopes' },
  { id: 'wedge', label: 'Wedge', Icon: WedgeIcon, hint: 'Wedge mode: quick corner cut, flat diagonal facing you' },
  { id: 'thin', label: 'Thin', Icon: ThinIcon, hint: 'Thin mode: half-thickness panel/fin facing you' },
  { id: 'half', label: 'Half', Icon: HalfIcon, hint: 'Half mode: flush half-slab on the near half of the voxel facing you' },
  { id: 'post', label: 'Post', Icon: PostIcon, hint: 'Post mode: centered square column along the face normal' },
  { id: 'quarter', label: 'Quarter', Icon: QuarterIcon, hint: 'Quarter mode: corner column, re-click to cycle corners' },
  { id: 'flat', label: 'Flat', Icon: FlatIcon, hint: 'Flat mode: a bare square through the middle of the voxel, re-click to turn it' },
  { id: 'flatwedge', label: 'Flat wedge', Icon: FlatWedgeIcon, hint: 'Flat wedge mode: a bare diagonal pane, re-click to turn it' },
]

/** Outer/inner corner bevels, painted explicitly (no autotile) — 3D-only palette entries. The
 * autotiled Chamfer kind is hidden there (nothing auto-resolves in verbatim mode); Outer corner
 * takes over its icon. */
const CORNER_KINDS: Array<{ id: VoxelKind; label: string; Icon: typeof CubeIcon; hint: string }> = [
  { id: 'convex', label: 'Outer corner', Icon: ChamferIcon, hint: 'Outer corner mode: full-height corner post, R rotates it' },
  { id: 'concave', label: 'Inner corner', Icon: ConcaveIcon, hint: 'Inner corner mode: notched pocket corner, R rotates it' },
]

/**
 * Which kind of voxel paint writes — cube vs. chamfer. Rendered as a bordered vertical segmented
 * toggle in the left toolbar (below the tools), so it reads clearly as a two-state switch. The
 * active segment is driven directly from `activeVoxelKind` (explicit classes rather than Radix
 * `data-state`, so the highlight is unambiguous behind the literal-fill SVG icons).
 *
 * In 3D-only layout the autotiled Chamfer entry is replaced by the two explicit corner bevels
 * (outer/inner) — they paint frozen with the brush rotation, unlike the autotiled ramp family.
 * A corner kind picked there stays selected back in split view (same paint path paints them anywhere).
 */
export function VoxelKindToggle() {
  const activeVoxelKind = useAppStore((s) => s.activeVoxelKind)
  const showCorners = useAppStore((s) => s.layoutMode === '3d-only')
  // KINDS[1] is the autotiled Chamfer: hidden in 3D-only, where the corners take its slot.
  const kinds = showCorners ? [...KINDS.slice(0, 1), ...CORNER_KINDS, ...KINDS.slice(2)] : KINDS
  const setActiveVoxelKind = useAppStore((s) => s.setActiveVoxelKind)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  // Voxel kind (cube/chamfer) has no meaning while texturing or animating — disabled in Texture/Animate mode.
  const disabled = useAppStore((s) => s.mode === 'texture' || s.mode === 'animate')

  return (
    <Tooltip.Provider delayDuration={300}>
      <div
        role="group"
        aria-label="Voxel kind"
        aria-disabled={disabled}
        onPointerEnter={() => setStatusMessage(null)}
        onPointerLeave={() => setStatusMessage(null)}
        className={
          'flex flex-col divide-y divide-neutral-700 overflow-hidden rounded-lg border border-neutral-700 ' +
          (disabled ? 'pointer-events-none opacity-40' : '')
        }
      >
        {kinds.map(({ id, label, Icon, hint }) => {
          const active = activeVoxelKind === id
          return (
            <Tooltip.Root key={id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={disabled}
                  onPointerEnter={() => setStatusMessage(hint)}
                  onPointerLeave={() => setStatusMessage(null)}
                  onClick={() => {
                    setActiveVoxelKind(id)
                    // Picking a kind drops into paint (the only tool that writes it), mirroring
                    // how picking a palette color does.
                    setActiveTool('paint')
                  }}
                  className={
                    'flex h-9 w-9 items-center justify-center transition ' +
                    (active
                      ? 'bg-violet-500/70 opacity-100'
                      : 'opacity-50 hover:bg-neutral-800 hover:opacity-100')
                  }
                >
                  <Icon size={18} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={8} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 shadow-lg">
                  {label} voxel
                  <Tooltip.Arrow className="fill-neutral-800" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )
        })}
      </div>
    </Tooltip.Provider>
  )
}
