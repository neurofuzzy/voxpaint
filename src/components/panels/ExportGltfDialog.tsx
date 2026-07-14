import * as Dialog from '@radix-ui/react-dialog'
import { Package } from 'lucide-react'
import { useEffect, useState } from 'react'
import { downloadGlb, exportModelToGlb } from '@/engine/export/gltfExport'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'

/**
 * Export-options modal for the GLTF exporter. Keeps export choices out of the immediate menu action so
 * work-in-progress toggles (currently just ambient occlusion, off by default while the AO bake is being
 * refined) can be surfaced without changing default behaviour. Reads the model straight from the store
 * on export.
 */
export function ExportGltfDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const storeAmbientOcclusion = useAppStore((s) => s.ambientOcclusion)
  const [ambientOcclusion, setAmbientOcclusion] = useState(false)
  const [busy, setBusy] = useState(false)

  // When the dialog opens, pick up the current viewport AO toggle as the default.
  useEffect(() => {
    if (open) setAmbientOcclusion(storeAmbientOcclusion)
  }, [open, storeAmbientOcclusion])

  async function run() {
    const { model, palette, meta, texture, noiseLevel, aoStrength } = useAppStore.getState()
    if (model.color.size === 0) {
      showToast('Nothing to export — the model is empty.')
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      showToast('Exporting GLTF…')
      const glb = await exportModelToGlb(model, palette, texture, { ambientOcclusion, noiseLevel, aoStrength })
      downloadGlb(glb, meta.name || 'voxpaint-model')
      showToast('GLTF exported.')
      onOpenChange(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'GLTF export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-5 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
            <Package size={18} /> Export GLTF
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-400">
            Exports up to four optimized meshes — one per material class (matte, emissive, metal, glass).
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-800/40 px-3 py-2">
              <span>
                <span className="block text-sm">Ambient occlusion</span>
                <span className="block text-xs text-neutral-500">Bake AO into the materials (experimental).</span>
              </span>
              <input
                type="checkbox"
                checked={ambientOcclusion}
                onChange={(e) => setAmbientOcclusion(e.target.checked)}
                className="h-4 w-4 accent-violet-500"
              />
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
