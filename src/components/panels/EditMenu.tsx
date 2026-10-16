import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, ClipboardPaste, Copy, Expand } from 'lucide-react'
import { useState } from 'react'
import { MAX_GRID_EXTENT } from '@/engine/grid/GridStore'
import { rescaleTargetExtent } from '@/engine/grid/rescale'
import { isIPad } from '@/engine/input/isIPad'
import { useAppStore } from '@/store/useAppStore'
import { modKey } from '@/components/onboarding/shortcuts'
import { RescaleProjectDialog } from './RescaleProjectDialog'

const ITEM = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-neutral-800 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[disabled]:hover:bg-transparent'

/**
 * Edit menu: touch/mouse path for the selection clipboard (the keyboard Cmd/Ctrl+C/X/V path in
 * `useKeyboardShortcuts.ts` has no iPad equivalent) plus project rescale. Copy needs a
 * selection, Paste needs clipboard content — each enables independently per the active
 * authoring mode (Texture mode drives its parallel texel clipboard; Animate mode has no
 * clipboard, so both stay disabled there). Rescale opens a confirm dialog; it disables past
 * the 64-cell cap.
 */
export function EditMenu() {
  const [rescaleOpen, setRescaleOpen] = useState(false)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const isTexture = useAppStore((s) => s.mode === 'texture')
  const hasSelection = useAppStore((s) => (s.mode === 'texture' ? s.textureSelection : s.selection) !== null)
  const hasClipboard = useAppStore((s) => (s.mode === 'texture' ? s.textureClipboard : s.clipboard) !== null)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)

  const copy = useAppStore((s) => (isTexture ? s.textureCopy : s.copySelection))
  const pasteInPlace = useAppStore((s) => s.pasteClipboardInPlace)
  const texturePasteAt = useAppStore((s) => s.texturePasteAt)
  const textureClipboard = useAppStore((s) => s.textureClipboard)

  function paste() {
    // Same origins as the Cmd+V path: voxel paste re-anchors to the same spot on screen (the
    // active plane may have changed since the copy); texel paste lands at the copied origin.
    if (isTexture) texturePasteAt(textureClipboard?.originU ?? 0, textureClipboard?.originV ?? 0)
    else pasteInPlace()
  }

  const overCap = rescaleTargetExtent(gridExtent) > MAX_GRID_EXTENT
  const mod = modKey()

  return (
    <>
      <DropdownMenu.Root modal={!isIPad() /* non-modal on iPad: modal Radix overlays swallow Apple Pencil taps */}>
        <DropdownMenu.Trigger asChild>
          <button
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            onPointerEnter={() => setStatusMessage('Open the edit menu')}
            onPointerLeave={() => setStatusMessage(null)}
          >
            Edit
            <ChevronDown size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-48 rounded-md border border-neutral-800 bg-neutral-900 p-1 text-sm text-neutral-200 shadow-xl"
          >
            <DropdownMenu.Item
              disabled={!hasSelection}
              onSelect={copy}
              className={ITEM}
              onPointerEnter={() => setStatusMessage('Copy the selection')}
              onPointerLeave={() => setStatusMessage(null)}
            >
              <Copy size={14} /> Copy
              <span className="ml-auto pl-4 font-mono text-xs text-neutral-500">{mod}C</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              disabled={!hasClipboard}
              onSelect={paste}
              className={ITEM}
              onPointerEnter={() => setStatusMessage('Paste in place — drag inside the pasted selection to move it')}
              onPointerLeave={() => setStatusMessage(null)}
            >
              <ClipboardPaste size={14} /> Paste
              <span className="ml-auto pl-4 font-mono text-xs text-neutral-500">{mod}V</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-neutral-800" />
            <DropdownMenu.Item
              disabled={overCap}
              title={overCap ? `Doubling ${gridExtent}³ would exceed the ${MAX_GRID_EXTENT}-cell cap` : undefined}
              onSelect={() => setRescaleOpen(true)}
              className={ITEM}
              onPointerEnter={() => setStatusMessage('Double the working cube and every voxel in it')}
              onPointerLeave={() => setStatusMessage(null)}
            >
              <Expand size={14} /> Rescale Project…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <RescaleProjectDialog open={rescaleOpen} onOpenChange={setRescaleOpen} />
    </>
  )
}
