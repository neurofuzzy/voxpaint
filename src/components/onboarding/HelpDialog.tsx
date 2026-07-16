import * as Dialog from '@radix-ui/react-dialog'
import { Keyboard, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { modKey, shortcutGroups } from './shortcuts'

/** A single key rendered as a keycap chip. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200">
      {children}
    </kbd>
  )
}

/**
 * Keyboard-shortcuts reference dialog, opened from the Help button or the `?` shortcut. Content is
 * grouped and sourced from `shortcuts.ts` (a mirror of the real bindings). Also offers a button to
 * replay the spotlight interface tour.
 */
export function HelpDialog() {
  const open = useAppStore((s) => s.helpOpen)
  const closeHelp = useAppStore((s) => s.closeHelp)
  const startTour = useAppStore((s) => s.startTour)
  const groups = shortcutGroups(modKey())

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) closeHelp() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,40rem)] -translate-x-1/2 -translate-y-1/2
            flex-col rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-200 shadow-2xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <Keyboard size={18} /> Keyboard Shortcuts
            </Dialog.Title>
            <button
              onClick={() => startTour()}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-300 hover:bg-neutral-800"
            >
              <Sparkles size={14} /> Replay interface tour
            </button>
          </div>
          <Dialog.Description className="sr-only">
            A reference of all keyboard shortcuts, grouped by category.
          </Dialog.Description>

          <div className="grid grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto p-5 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.title}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase select-none">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {group.shortcuts.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-neutral-300">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((k) => (
                          <Key key={k}>{k}</Key>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex justify-end border-t border-neutral-800 px-5 py-3">
            <Dialog.Close asChild>
              <button className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
