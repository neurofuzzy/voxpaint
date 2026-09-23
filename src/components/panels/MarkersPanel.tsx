import { useState } from 'react'
import { Crosshair, Trash2 } from 'lucide-react'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'

function MarkerRow({ id }: { id: string }) {
  const marker = useAppStore((s) => s.markers.find((m) => m.id === id))
  const selectedMarkerId = useAppStore((s) => s.selectedMarkerId)
  const selectMarker = useAppStore((s) => s.selectMarker)
  const renameMarker = useAppStore((s) => s.renameMarker)
  const deleteMarker = useAppStore((s) => s.deleteMarker)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const [draft, setDraft] = useState<string | null>(null)

  if (!marker) return null
  const selected = marker.id === selectedMarkerId

  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== marker.label) renameMarker(marker.id, draft)
    setDraft(null)
  }

  const focusSlice = () => {
    const s = useAppStore.getState()
    s.setPlaneOffset(marker.position[axisIndex(s.plane.axis)])
    s.selectMarker(marker.id)
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${selected ? 'bg-amber-500/15' : 'hover:bg-neutral-800'}`}
      onClick={() => selectMarker(marker.id)}
    >
      <span className="h-2 w-2 shrink-0 rotate-45 bg-amber-400" />
      <input
        value={draft ?? marker.label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Marker label"
        className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-amber-500/60 rounded px-0.5"
      />
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500">
        {marker.position[0]},{marker.position[1]},{marker.position[2]}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); focusSlice() }}
        aria-label="Focus marker slice"
        title="Move the construction plane to this marker's slice"
        onPointerEnter={() => setStatusMessage("Move the construction plane to this marker's slice")}
        onPointerLeave={() => setStatusMessage(null)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
      >
        <Crosshair size={12} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); deleteMarker(marker.id) }}
        aria-label="Delete marker"
        title="Delete marker"
        onPointerEnter={() => setStatusMessage('Delete this marker')}
        onPointerLeave={() => setStatusMessage(null)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-red-300"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

/**
 * Floating markers list pinned to the top-left of the 2D editor (the top-right belongs to
 * PlaneControlsOverlay). Model mode only; visible while the marker tool is active or markers
 * exist. Rename inline, jump the construction plane to a marker's slice, or delete.
 */
export function MarkersPanel() {
  const mode = useAppStore((s) => s.mode)
  const activeTool = useAppStore((s) => s.activeTool)
  const markers = useAppStore((s) => s.markers)

  if (mode !== 'model') return null
  if (activeTool !== 'marker' && markers.length === 0) return null

  return (
    <div className="absolute left-3 top-3 z-40 w-56 rounded-xl border border-neutral-800 bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg">
      <div className="px-1.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Markers ({markers.length})
      </div>
      {markers.length === 0 ? (
        <div className="px-1.5 pb-1 text-xs text-neutral-500">Click the canvas to place a marker.</div>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          {markers.map((m) => (
            <MarkerRow key={m.id} id={m.id} />
          ))}
        </div>
      )}
    </div>
  )
}
