import { Redo2, Undo2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

export function UndoRedoControls() {
  const mode = useAppStore((s) => s.mode)
  const modelPast = useAppStore((s) => s.past)
  const modelFuture = useAppStore((s) => s.future)
  const modelFloat = useAppStore((s) => s.floatContent)
  const texturePast = useAppStore((s) => s.texturePast)
  const textureFuture = useAppStore((s) => s.textureFuture)
  const textureFloat = useAppStore((s) => s.textureFloat)
  const animPast = useAppStore((s) => s.animPast)
  const animFuture = useAppStore((s) => s.animFuture)

  const isTexture = mode === 'texture'
  const isAnimate = mode === 'animate'
  const past = isTexture ? texturePast : isAnimate ? animPast : modelPast
  const future = isTexture ? textureFuture : isAnimate ? animFuture : modelFuture
  // Animate undo/redo only rewinds animSettings/sliceMasks — it can't revert a voxel-model float,
  // so a pending modelFloat must never factor into Animate mode's Undo enablement.
  const floatContent = isTexture ? textureFloat : isAnimate ? null : modelFloat
  const undo = useAppStore((s) => (isTexture ? s.textureUndo : isAnimate ? s.animUndo : s.undo))
  const redo = useAppStore((s) => (isTexture ? s.textureRedo : isAnimate ? s.animRedo : s.redo))

  return (
    <div className="flex gap-1">
      <button
        disabled={past.length === 0 && !floatContent}
        onClick={undo}
        aria-label="Undo"
        className="flex h-8 w-8 py-1.5 justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Undo2 size={16} />
      </button>
      <button
        disabled={future.length === 0}
        onClick={redo}
        aria-label="Redo"
        className="flex h-8 w-8 py-1.5 justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Redo2 size={16} />
      </button>
    </div>
  )
}
