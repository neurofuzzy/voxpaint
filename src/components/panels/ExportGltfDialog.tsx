import * as Dialog from '@radix-ui/react-dialog'
import { Package } from 'lucide-react'
import { useState } from 'react'
import type { GltfExportAnchor } from '@/engine/export/gltfExport'
import { downloadGlb, exportModelToGlb } from '@/engine/export/gltfExport'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'

const ANCHOR_LABELS: Record<GltfExportAnchor, string> = {
  center: 'Center',
  bottom: 'Bottom',
  back: 'Back',
}

export function ExportGltfDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [scaleInput, setScaleInput] = useState('100')
  const [anchor, setAnchor] = useState<GltfExportAnchor>('center')

  const scaleFactor = Math.max(1, Math.min(1000, parseInt(scaleInput) || 100))

  function clampScale(next: string) {
    if (next === '') {
      setScaleInput('')
      return
    }
    const n = parseInt(next)
    if (isNaN(n)) return
    setScaleInput(String(Math.max(1, Math.min(1000, n))))
  }

  async function run() {
    const { model, palette, meta, texture, noiseLevel, specularNoiseLevel, aoStrength, glassRoughnessLevel } = useAppStore.getState()
    if (model.color.size === 0) {
      showToast('Nothing to export — the model is empty.')
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      showToast('Exporting GLTF…')
      const glb = await exportModelToGlb(model, palette, texture, {
        ambientOcclusion: true,
        noiseLevel,
        specularNoiseLevel,
        aoStrength,
        glassRoughnessLevel,
        scaleFactor,
        anchor,
      })
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
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-5 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
            <Package size={18} /> Export GLTF
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-400">
            Exports optimized meshes — one per material class (matte, emissive, metal, glass) — with
            baked ambient occlusion.
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="gltf-scale" className="w-16 text-xs font-medium text-neutral-400 select-none">
                Scale
              </label>
              <input
                id="gltf-scale"
                type="text"
                inputMode="numeric"
                value={scaleInput}
                onChange={(e) => clampScale(e.target.value)}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1
                  font-mono text-xs tabular-nums text-neutral-200 focus:outline-none focus:ring-1
                  focus:ring-violet-500"
              />
              <span className="text-xs font-medium text-neutral-400">%</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-16 text-xs font-medium text-neutral-400 select-none">Anchor</span>
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value as GltfExportAnchor)}
                className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200
                  focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
              >
                {(Object.keys(ANCHOR_LABELS) as GltfExportAnchor[]).map((a) => (
                  <option key={a} value={a}>{ANCHOR_LABELS[a]}</option>
                ))}
              </select>
            </div>
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
