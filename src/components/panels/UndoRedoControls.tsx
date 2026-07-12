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

  const texture = mode === 'texture'
  const past = texture ? texturePast : modelPast
  const future = texture ? textureFuture : modelFuture
  const floatContent = texture ? textureFloat : modelFloat
  const undo = useAppStore((s) => (texture ? s.textureUndo : s.undo))
  const redo = useAppStore((s) => (texture ? s.textureRedo : s.redo))

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
