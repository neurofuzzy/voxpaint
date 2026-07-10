import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Brush, Copy, Move, Pipette, SquareDashedMousePointer, PaintBucket } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { ToolId } from '@/store/types'

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Brush }> = [
  { id: 'paint', label: 'Paint', icon: Brush },
  { id: 'eyedropper', label: 'Eyedropper', icon: Pipette },
  { id: 'select', label: 'Select', icon: SquareDashedMousePointer },
  { id: 'fill', label: 'Fill', icon: PaintBucket },
  { id: 'clone', label: 'Clone', icon: Copy },
  { id: 'move', label: 'Move / Transform', icon: Move },
]

export function ToolPalette() {
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveTool = useAppStore((s) => s.setActiveTool)

  return (
    <Tooltip.Provider delayDuration={300}>
      <ToggleGroup.Root
        type="single"
        value={activeTool}
        onValueChange={(v) => v && setActiveTool(v as ToolId)}
        className="flex flex-col gap-1 p-2"
      >
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <Tooltip.Root key={id}>
            <Tooltip.Trigger asChild>
              <ToggleGroup.Item
                value={id}
                aria-label={label}
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
