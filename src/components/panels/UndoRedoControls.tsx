import { Redo2, Undo2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

export function UndoRedoControls() {
  const past = useAppStore((s) => s.past)
  const future = useAppStore((s) => s.future)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)

  return (
    <div className="flex items-center gap-1">
      <button
        disabled={past.length === 0}
        onClick={undo}
        aria-label="Undo"
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Undo2 size={16} />
      </button>
      <button
        disabled={future.length === 0}
        onClick={redo}
        aria-label="Redo"
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Redo2 size={16} />
      </button>
    </div>
  )
}
