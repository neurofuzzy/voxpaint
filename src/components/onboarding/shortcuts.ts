/**
 * Human-readable keyboard-shortcut reference for the Help dialog.
 *
 * This is a hand-maintained MIRROR of the real bindings — keep it in sync with
 * `components/editor2d/useKeyboardShortcuts.ts` (global keys) and the pointer hints in
 * `components/layout/BottomBar.tsx`. When you add or change a binding there, update this list too.
 */

export type Shortcut = { keys: string[]; label: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

/** The Cmd/Ctrl modifier, shown per-platform in the Help dialog. */
export const modKey = (): string =>
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl'

export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: 'Tools',
      shortcuts: [
        { keys: ['P'], label: 'Paint' },
        { keys: ['E'], label: 'Erase' },
        { keys: ['I'], label: 'Eyedropper' },
        { keys: ['S'], label: 'Select' },
        { keys: ['F'], label: 'Fill' },
        { keys: ['C'], label: 'Clone' },
        { keys: ['M'], label: 'Move' },
      ],
    },
    {
      title: 'History',
      shortcuts: [
        { keys: [mod, 'Z'], label: 'Undo' },
        { keys: [mod, 'Shift', 'Z'], label: 'Redo' },
      ],
    },
    {
      title: 'Selection & clipboard',
      shortcuts: [
        { keys: [mod, 'C'], label: 'Copy selection' },
        { keys: [mod, 'X'], label: 'Cut selection' },
        { keys: [mod, 'V'], label: 'Paste in place' },
        { keys: ['Delete'], label: 'Delete selection contents' },
        { keys: ['R'], label: 'Rotate selection 90°' },
        { keys: ['H'], label: 'Mirror selection horizontally' },
        { keys: ['V'], label: 'Mirror selection vertically' },
      ],
    },
    {
      title: 'Construction plane',
      shortcuts: [
        { keys: ['Alt', '↑'], label: 'Move plane forward' },
        { keys: ['Alt', '↓'], label: 'Move plane back' },
        { keys: ['Alt', '←'], label: 'Cycle plane orientation' },
        { keys: ['Alt', '→'], label: 'Cycle plane orientation' },
        { keys: ['Shift', 'Wheel'], label: 'Step plane through slices' },
      ],
    },
    {
      title: 'General',
      shortcuts: [
        { keys: ['Esc'], label: 'Commit float & deselect' },
        { keys: ['Shift', 'Drag'], label: 'Draw a straight line' },
        { keys: ['?'], label: 'Open this shortcuts help' },
      ],
    },
  ]
}
