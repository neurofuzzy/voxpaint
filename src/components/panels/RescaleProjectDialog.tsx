import * as Dialog from '@radix-ui/react-dialog'
import { Expand } from 'lucide-react'
import { MAX_GRID_EXTENT } from '@/engine/grid/GridStore'
import { rescaleTargetExtent } from '@/engine/grid/rescale'
import { isIPad } from '@/engine/input/isIPad'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'

/**
 * Rescale Project dialog: confirms doubling the working cube (extent → twice the even working
 * grid) with every voxel becoming its exact 2×2×2 block. States the new size and voxel count
 * plus what scales along (texture, markers, animation) and what's lost (undo history,
 * selections — rescale snapshots can't span an extent change, like resize). The menu disables
 * the entry past the 64-cell cap; the button guards the same way.
 */
export function RescaleProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  // Subscribe to the model only while open — the counts below scan the whole map per stroke.
  const model = useAppStore((s) => (open ? s.model : null))
  const colorCount = model?.color.size ?? 0
  // Every color cell yields 8 children except concave corners, which drop one zero-volume
  // edge child each — counted here so the projection is exact, not "≈8x".
  let concaveCount = 0
  if (model) {
    for (const cell of model.chamfer.values()) {
      if (cell.resolvedTo?.shapeKind === 'concave') concaveCount++
    }
  }

  const target = rescaleTargetExtent(gridExtent)
  const overCap = target > MAX_GRID_EXTENT
  const projected = colorCount * 8 - concaveCount

  function rescale() {
    if (overCap) return
    useAppStore.getState().rescaleProject()
    showToast(`Rescaled ${gridExtent}³ → ${target}³.`)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!isIPad() /* non-modal on iPad: modal Radix overlays swallow Apple Pencil taps */}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-7 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
            <Expand size={22} /> Rescale Project
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-400">
            {overCap ? (
              <>Doubling {gridExtent}³ would exceed the {MAX_GRID_EXTENT}-cell technical cap.</>
            ) : (
              <>Doubles the working cube and every voxel in it.</>
            )}
          </Dialog.Description>

          {!overCap && (
            <ul className="mt-5 flex flex-col gap-1.5 text-sm text-neutral-300">
              <li>
                <span className="font-mono tabular-nums">{gridExtent}³ → {target}³</span>
                <span className="text-neutral-500"> · </span>
                <span className="font-mono tabular-nums">{colorCount} → {projected} voxels</span>
              </li>
              <li className="text-neutral-400">Ramps and corners become exact staircases; thin slabs become back-to-back half-slabs.</li>
              <li className="text-neutral-400">Texture paint, markers, and animation scale along.</li>
              <li className="text-neutral-400">Undo history and selections are cleared — this can't be undone.</li>
            </ul>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={rescale}
              disabled={overCap}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Rescale
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
