import { useState } from 'react'
import { ChevronDown, Crosshair, MapPin, Trash2 } from 'lucide-react'
import { markerColorHex } from '@/engine/markers/markers'
import { MARKER_COLORS } from '@/engine/markers/types'
import { axisIndex } from '@/engine/plane/planeGeometry'
import { useAppStore } from '@/store/useAppStore'

function MarkerRow({ id }: { id: string }) {
  const marker = useAppStore((s) => s.markers.find((m) => m.id === id))
  const selectedMarkerId = useAppStore((s) => s.selectedMarkerId)
  const selectMarker = useAppStore((s) => s.selectMarker)
  const setMarkerColor = useAppStore((s) => s.setMarkerColor)
  const deleteMarker = useAppStore((s) => s.deleteMarker)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  if (!marker) return null
  const selected = marker.id === selectedMarkerId
  const hex = markerColorHex(marker.color)

  const focusSlice = () => {
    const s = useAppStore.getState()
    s.setPlaneOffset(marker.position[axisIndex(s.plane.axis)])
    s.selectMarker(marker.id)
  }

  // Clicking the swatch cycles to the next marker color (one undo step per click).
  const cycleColor = () => {
    setMarkerColor(marker.id, (marker.color + 1) % MARKER_COLORS.length)
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${selected ? 'bg-white/10' : 'hover:bg-neutral-800'}`}
      onClick={() => selectMarker(marker.id)}
    >
      <button
        onClick={(e) => { e.stopPropagation(); cycleColor() }}
        aria-label="Cycle marker color"
        title="Click to cycle this marker's color"
        onPointerEnter={() => setStatusMessage('Click to cycle this marker’s color')}
        onPointerLeave={() => setStatusMessage(null)}
        className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white/20 transition-transform hover:scale-110"
        style={{ backgroundColor: hex }}
      />
      <span className="min-w-0 flex-1 font-mono text-[10px] tabular-nums text-neutral-400">
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
 * PlaneControlsOverlay). Model mode + marker tool only. Recolor (click the swatch to cycle),
 * jump the construction plane to a marker's slice, or delete. Collapsible like the viewport's
 * SettingsPalette: an icon button when minimized, a ChevronDown minimize in the header when open.
 */
export function MarkersPanel() {
  const mode = useAppStore((s) => s.mode)
  const activeTool = useAppStore((s) => s.activeTool)
  const markers = useAppStore((s) => s.markers)
  const [minimized, setMinimized] = useState(false)

  if (mode !== 'model' || activeTool !== 'marker') return null

  if (minimized) {
    return (
      <div className="absolute left-3 top-3 z-40">
        <button
          onClick={() => setMinimized(false)}
          title="Markers"
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-800
            bg-neutral-900/80 text-neutral-400 shadow-2xl backdrop-blur-lg hover:text-neutral-200"
        >
          <MapPin size={16} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="absolute left-3 top-3 z-40 w-56 rounded-xl border border-neutral-800 bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-1.5 pb-1 pt-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 select-none">
          Markers ({markers.length})
        </span>
        <button
          onClick={() => setMinimized(true)}
          title="Minimize"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-neutral-200"
        >
          <ChevronDown size={14} />
        </button>
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
