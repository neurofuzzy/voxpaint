import { Orbit, Pencil } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const BTN_BASE = 'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
const BTN_ON = 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'

/**
 * Viewport mode switch (top-left, next to the compass): Orbit vs 3D Edit. The two modes are
 * mutually exclusive — Orbit is the classic navigate/set-plane viewport, Edit dispatches the
 * active paint/erase/eyedropper/material tool straight onto voxel faces. Thin wrapper over the
 * `edit3D` view flag.
 */
export function ViewportModeToggle() {
  const edit3D = useAppStore((s) => s.edit3D)
  const setEdit3D = useAppStore((s) => s.setEdit3D)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900/80 p-1.5 shadow-2xl backdrop-blur-lg">
      <button
        onClick={() => setEdit3D(false)}
        aria-label="Orbit mode"
        aria-pressed={!edit3D}
        title="Orbit mode — navigate and set the construction plane"
        onPointerEnter={() => setStatusMessage('Orbit mode: left-drag to rotate, click faces to set the plane')}
        onPointerLeave={() => setStatusMessage(null)}
        className={`${BTN_BASE} ${!edit3D ? BTN_ON : ''}`}
      >
        <Orbit size={16} />
      </button>
      <button
        onClick={() => setEdit3D(true)}
        aria-label="3D Edit mode"
        aria-pressed={edit3D}
        title="3D Edit mode — paint, erase and eyedrop directly on voxel faces"
        onPointerEnter={() => setStatusMessage('3D Edit mode: taps apply the active tool on voxel faces (material drags)')}
        onPointerLeave={() => setStatusMessage(null)}
        className={`${BTN_BASE} ${edit3D ? BTN_ON : ''}`}
      >
        <Pencil size={16} />
      </button>
    </div>
  )
}
