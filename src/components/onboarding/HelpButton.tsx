import { HelpCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

/** Top-toolbar button that opens the keyboard-shortcuts help dialog. Also the tour's final anchor
 * (`data-tour="help"`). Styled to match the neighboring FullscreenToggle. */
export function HelpButton() {
  const openHelp = useAppStore((s) => s.openHelp)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <button
      data-tour="help"
      onClick={openHelp}
      aria-label="Help & keyboard shortcuts"
      onPointerEnter={() => setStatusMessage('Keyboard shortcuts & interface tour')}
      onPointerLeave={() => setStatusMessage(null)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
    >
      <HelpCircle size={16} />
    </button>
  )
}
