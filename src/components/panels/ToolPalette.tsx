import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Brush, Copy, Eraser, Move, Pipette, SquareDashedMousePointer, PaintBucket } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Brush; hint: string }> = [
  { id: 'paint', label: 'Paint', icon: Brush, hint: 'click or drag to paint · shift+drag: straight line' },
  { id: 'erase', label: 'Erase', icon: Eraser, hint: 'click or drag to erase · shift+drag: straight line' },
  { id: 'eyedropper', label: 'Eyedropper', icon: Pipette, hint: 'click to pick a color from the model' },
  { id: 'select', label: 'Select', icon: SquareDashedMousePointer, hint: 'drag to select · alt+drag: lasso' },
  { id: 'fill', label: 'Fill', icon: PaintBucket, hint: 'click to flood-fill connected cells' },
  { id: 'clone', label: 'Clone', icon: Copy, hint: 'alt+click to set a clone source, then drag to stamp' },
  { id: 'move', label: 'Move / Transform', icon: Move, hint: 'drag to shift the current slice · r/h/v: rotate/mirror' },
]

export function ToolPalette() {
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const mode = useAppStore((s) => s.mode)

  if (mode === 'animate') return null

  return (
    <Tooltip.Provider delayDuration={300}>
      <ToggleGroup.Root
        type="single"
        value={activeTool}
        onValueChange={(v) => v && setActiveTool(v as ToolId)}
        className="flex flex-col gap-1 p-2"
      >
        {TOOLS.map(({ id, label, icon: Icon, hint }) => (
          <Tooltip.Root key={id}>
            <Tooltip.Trigger asChild>
              <ToggleGroup.Item
                value={id}
                aria-label={label}
                onPointerEnter={() => setStatusMessage(hint)}
                onPointerLeave={() => setStatusMessage(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300"
              >
                <Icon size={17} />
              </ToggleGroup.Item>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={8} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 shadow-lg">
                {label}
                <Tooltip.Arrow className="fill-neutral-800" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </ToggleGroup.Root>
    </Tooltip.Provider>
  )
}
