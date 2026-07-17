import * as Dialog from '@radix-ui/react-dialog'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import type { StlExportAnchor } from '@/engine/export/stlExport'
import { downloadStl, exportModelToStl } from '@/engine/export/stlExport'
import { normalizeProjectFilename } from '@/engine/persistence/projectFile'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'

const ANCHOR_LABELS: Record<StlExportAnchor, string> = {
  center: 'Center',
  bottom: 'Bottom',
  back: 'Back',
}

export function ExportStlDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [scaleInput, setScaleInput] = useState('100')
  const [scaleFactor, setScaleFactor] = useState(100)
  const [anchor, setAnchor] = useState<StlExportAnchor>('bottom')
  const [orientForPrinting, setOrientForPrinting] = useState(false)
  const [skipGlass, setSkipGlass] = useState(false)

  function clampScale(next: string) {
    if (next === '') {
      setScaleInput('')
      return
    }
    const n = parseInt(next)
    if (isNaN(n)) return
    const v = Math.max(1, Math.min(1000, n))
    setScaleInput(String(v))
    setScaleFactor(v)
  }

  async function run() {
    const { model, palette } = useAppStore.getState()
    if (model.color.size === 0) {
      showToast('Nothing to export — the model is empty.')
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      showToast('Exporting STL…')
      const stl = exportModelToStl(model, palette, { scaleFactor, anchor, orientForPrinting, skipGlass })
      downloadStl(stl, normalizeProjectFilename(useAppStore.getState().meta.name || 'voxpaint-model'))
      showToast('STL exported.')
      onOpenChange(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'STL export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl
            border border-neutral-800 bg-neutral-900 p-7 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
            <Printer size={22} /> Export STL
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-400">
            Exports a single watertight mesh (no color/material — plain solid geometry) for slicing
            or 3D-printing services.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <label htmlFor="stl-scale" className="w-18 text-sm font-medium text-neutral-400 select-none">
                Scale
              </label>
              <input
                id="stl-scale"
                type="text"
                inputMode="numeric"
                value={scaleInput}
                onChange={(e) => clampScale(e.target.value)}
                className="w-24 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5
                  font-mono text-sm tabular-nums text-neutral-200 focus:outline-none focus:ring-1
                  focus:ring-violet-500"
              />
              <span className="text-sm font-medium text-neutral-400">%</span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="w-18 text-sm font-medium text-neutral-400 select-none">Anchor</span>
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value as StlExportAnchor)}
                className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200
                  focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
              >
                {(Object.keys(ANCHOR_LABELS) as StlExportAnchor[]).map((a) => (
                  <option key={a} value={a}>{ANCHOR_LABELS[a]}</option>
                ))}
              </select>
            </div>

            <label className="flex items-start gap-2.5 ml-[4.5rem] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={orientForPrinting}
                onChange={(e) => setOrientForPrinting(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-violet-500"
              />
              <span className="text-sm text-neutral-400">
                Orient for printing
                <span className="block text-xs text-neutral-500">
                  Stands the model up on one corner so no face needs support
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 ml-[4.5rem] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipGlass}
                onChange={(e) => setSkipGlass(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-violet-500"
              />
              <span className="text-sm text-neutral-400">
                Skip glass blocks
                <span className="block text-xs text-neutral-500">
                  Omit glass voxels instead of printing them as solid material
                </span>
              </span>
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
