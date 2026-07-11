import { DEFAULT_GRID_EXTENT } from '@/engine/grid/GridStore'
import { useAppStore } from '@/store/useAppStore'

export function ModelStats() {
  const model = useAppStore((s) => s.model)
  const dirty = useAppStore((s) => s.dirty)
  const lastSavedAt = useAppStore((s) => s.lastSavedAt)

  const cellCount = model.color.size
  const bounds = model.bounds
  const span = bounds
    ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) + 1
    : 0
  const nearCap = span >= DEFAULT_GRID_EXTENT - 4

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-500">
      <span>
        {cellCount} cell{cellCount === 1 ? '' : 's'}
      </span>
      <span className="text-neutral-700">·</span>
      <span className={nearCap ? 'text-amber-400' : undefined}>
        {span}/{DEFAULT_GRID_EXTENT}
      </span>
      <span className="text-neutral-700">·</span>
      <span>{dirty ? 'unsaved changes…' : lastSavedAt ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'not saved yet'}</span>
    </div>
  )
}
