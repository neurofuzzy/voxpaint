import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { EditorMode } from '@/store/types'
import { EmissiveAnimationSettings } from './EmissiveAnimationSettings'
import { ModelSettings } from './ModelSettings'
import { TextureSettings } from './TextureSettings'

const TITLES: Record<EditorMode, string> = {
  model: 'Model Settings',
  animate: 'Emissive Animation',
  texture: 'Texture Settings',
}

/** Contextual per-mode settings palette: each authoring mode (Model/Animate/Texture) gets its own
 * set of controls — see ModelSettings, TextureSettings, EmissiveAnimationSettings. */
export function SettingsPalette() {
  const mode = useAppStore((s) => s.mode)
  const [minimized, setMinimized] = useState(true)

  if (minimized) {
    return (
      <div className="absolute bottom-4 right-3 z-40" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => setMinimized(false)}
          title="View settings"
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-800
            bg-neutral-900/80 text-neutral-400 shadow-2xl backdrop-blur-lg hover:text-neutral-200"
        >
          <SlidersHorizontal size={16} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="absolute bottom-4 right-3 z-40 flex flex-col gap-3 rounded-xl border border-neutral-800
        bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300 select-none">{TITLES[mode]}</span>
        <button
          onClick={() => setMinimized(true)}
          title="Minimize"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-neutral-200"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {mode === 'model' && <ModelSettings />}
      {mode === 'texture' && <TextureSettings />}
      {mode === 'animate' && <EmissiveAnimationSettings />}
    </div>
  )
}
