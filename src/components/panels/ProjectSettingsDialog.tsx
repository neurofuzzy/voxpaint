import * as Dialog from '@radix-ui/react-dialog'
import { Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { countCellsOutsideBounds } from '@/engine/grid/GridStore'
import type { GridExtent, VoxelScaleY } from '@/engine/grid/types'
import { faceSizeFor, TEXEL_SCALE } from '@/engine/texture/types'
import type { TexelScale } from '@/engine/texture/types'
import { hasTextureContent, normalizeTexelScale } from '@/engine/texture/TextureStore'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'
import { ProjectSizePicker } from './ProjectSizePicker'
import { SIZE_OPTIONS, parseCustomSize } from './projectSizeOptions'

const SCALE_OPTIONS: Array<{ k: VoxelScaleY; label: string }> = [
  { k: 0.5, label: 'Flat' },
  { k: 1, label: 'Cubic' },
  { k: 2, label: 'Tall' },
]

const TEXEL_OPTIONS: TexelScale[] = [1, 2, 4]

/**
 * Project Settings modal: rename the project, resize its working cube, set the Y voxel scale,
 * and/or set the texture detail (texels per voxel). Mirrors the New Project dialog's name + size
 * controls, prefilled with the current values. Growing keeps everything; shrinking deletes voxels
 * outside the new bounds (warned with an exact count, and reported on save) and center-crops the
 * texture faces, and any resize clears undo history. The voxel-height scale (flat/cubic/tall) is
 * freely changeable — it touches no grid or texture data, only how tall cells render and export.
 * Texture detail resamples the painted faces with nearest-neighbor (quantized, never blurred)
 * as one texture-undo step; lowering it on a painted texture loses fine detail.
 */
export function ProjectSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const currentName = useAppStore((s) => s.meta.name)
  const currentExtent = useAppStore((s) => s.meta.gridExtent)
  const currentScale = useAppStore((s) => s.meta.voxelScaleY)
  const currentTexelScale = useAppStore((s) => normalizeTexelScale(s.meta.texelScale ?? TEXEL_SCALE))
  const model = useAppStore((s) => s.model)
  const texture = useAppStore((s) => s.texture)

  const [name, setName] = useState(currentName)
  const [selected, setSelected] = useState<GridExtent | 'custom'>(currentExtent)
  const [customText, setCustomText] = useState('')
  const [scale, setScale] = useState<VoxelScaleY>(currentScale)
  const [texelScale, setTexelScale] = useState<TexelScale>(currentTexelScale)

  useEffect(() => {
    if (open) {
      const state = useAppStore.getState()
      setName(state.meta.name)
      setScale(state.meta.voxelScaleY)
      setTexelScale(normalizeTexelScale(state.meta.texelScale ?? TEXEL_SCALE))
      if (SIZE_OPTIONS.some(({ extent }) => extent === state.meta.gridExtent)) {
        setSelected(state.meta.gridExtent)
        setCustomText('')
      } else {
        setSelected('custom')
        setCustomText(String(state.meta.gridExtent))
      }
    }
  }, [open])

  const customExtent = parseCustomSize(customText)
  const isCustom = selected === 'custom'
  const nextExtent: GridExtent | null = isCustom ? customExtent : selected
  const trimmedName = name.trim() || 'Untitled Project'
  const nameChanged = trimmedName !== currentName
  const sizeChanged = nextExtent !== null && nextExtent !== currentExtent
  const scaleChanged = scale !== currentScale
  const texelChanged = texelScale !== currentTexelScale
  const canSave = nextExtent !== null && (nameChanged || sizeChanged || scaleChanged || texelChanged)

  // Voxels the new size would delete. Only meaningful when shrinking.
  const doomed =
    nextExtent !== null && nextExtent < currentExtent ? countCellsOutsideBounds(model, nextExtent) : 0
  const detailLoss = texelChanged && texelScale < currentTexelScale && hasTextureContent(texture)

  function save() {
    if (nextExtent === null || !canSave) return
    const { updateProjectSettings, setVoxelScaleY, setTexelScale: applyTexelScale } = useAppStore.getState()
    if (nameChanged || sizeChanged) updateProjectSettings(trimmedName, nextExtent)
    else useAppStore.getState().setProjectName(trimmedName)
    if (scaleChanged) setVoxelScaleY(scale)
    // Resize first (crop/pad at the old scale), then resample to the new one.
    if (texelChanged) applyTexelScale(texelScale)
    if (doomed > 0) {
      showToast(`Project resized to ${nextExtent}³ — ${doomed} voxel${doomed === 1 ? '' : 's'} removed.`)
    }
    onOpenChange(false)
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
            <Settings size={22} /> Project Settings
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-400">
            Currently {currentExtent}³. Growing keeps everything; shrinking deletes voxels outside
            the new bounds and clears undo history.
          </Dialog.Description>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <label htmlFor="settings-name" className="w-18 text-sm font-medium text-neutral-400 select-none">
                Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                placeholder="Untitled Project"
                autoFocus
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5
                  text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>

            <ProjectSizePicker
              selected={selected}
              customText={customText}
              onSelect={setSelected}
              onCustomTextChange={setCustomText}
              onCommit={save}
            />

            <div className="flex items-start gap-2.5">
              <span className="mt-2 w-18 text-sm font-medium text-neutral-400 select-none">Height</span>
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex gap-2">
                  {SCALE_OPTIONS.map(({ k, label }) => {
                    const active = scale === k
                    return (
                      <button
                        key={k}
                        onClick={() => setScale(k)}
                        className={
                          'flex-1 rounded-md px-3 py-2 text-center transition ' +
                          (active
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
                        }
                      >
                        <div className="text-sm font-medium">{label}</div>
                        <div className="font-mono text-xs tabular-nums opacity-70">{k}×</div>
                      </button>
                    )
                  })}
                </div>
                <span className="text-xs text-neutral-500">
                  voxel height (flat/cubic/tall) — paint stays per-voxel, freely changeable
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="mt-2 w-18 text-sm font-medium text-neutral-400 select-none">Detail</span>
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex gap-2">
                  {TEXEL_OPTIONS.map((k) => {
                    const active = texelScale === k
                    const face = nextExtent !== null ? faceSizeFor(nextExtent, k) : null
                    return (
                      <button
                        key={k}
                        onClick={() => setTexelScale(k)}
                        className={
                          'flex-1 rounded-md px-3 py-2 text-center transition ' +
                          (active
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
                        }
                      >
                        <div className="text-sm font-medium">{k}×</div>
                        <div className="font-mono text-xs tabular-nums opacity-70">{face !== null ? `${face}²` : ''}</div>
                      </button>
                    )
                  })}
                </div>
                <span className="text-xs text-neutral-500">
                  texels per voxel — faces resample with nearest-neighbor (quantized, never blurred)
                </span>
              </div>
            </div>

            {sizeChanged && (
              <p className="text-xs text-neutral-500">
                Texture faces are center-{nextExtent! < currentExtent ? 'cropped' : 'padded'} to the new size.
              </p>
            )}
            {detailLoss && (
              <p className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                Lowering texture detail resamples the painted faces — fine detail will be lost.
                Undo restores the previous scale and paint.
              </p>
            )}
            {doomed > 0 && (
              <p className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                Shrinking to {nextExtent}³ will permanently delete {doomed} voxel{doomed === 1 ? '' : 's'} outside
                the new bounds. This can't be undone.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </Dialog.Close>
            <button
              onClick={save}
              disabled={!canSave}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
