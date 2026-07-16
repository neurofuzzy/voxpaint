import { isTauri } from '@/engine/persistence/platformFile'
import { openProject, saveProject, saveProjectAs } from './projectFileActions'
import { useAppStore } from './useAppStore'

/**
 * Desktop only: builds and installs the native OS menu bar (App/File/Window), wiring the File
 * items to the exact same actions the in-app File dropdown uses (`projectFileActions.ts`,
 * `uiSlice.openNewProjectDialog`) so there's only ever one implementation of new/open/save. No-op
 * on the web build.
 *
 * Deliberately has **no Edit menu**. This is a canvas-painting app, not a text editor: the app's
 * own selection clipboard and undo/redo already own Cmd+Z/C/X/V (see
 * `components/editor2d/useKeyboardShortcuts.ts`). Tauri's predefined Cut/Copy/Paste/Undo/Redo menu
 * items always carry the OS's standard accelerator for that action — there's no way to attach one
 * without it — so adding them would install a second, conflicting Cmd+C/X/V/Z at the OS menu
 * level and shadow the app's own canvas shortcuts.
 */
export async function installNativeMenu(): Promise<void> {
  if (!isTauri()) return
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu')

  const appMenu = await Submenu.new({
    text: 'VoxPaint',
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Services' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Hide' }),
      await PredefinedMenuItem.new({ item: 'HideOthers' }),
      await PredefinedMenuItem.new({ item: 'ShowAll' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Quit' }),
    ],
  })

  const fileMenu = await Submenu.new({
    text: 'File',
    items: [
      await MenuItem.new({
        text: 'New Project…',
        accelerator: 'CmdOrCtrl+N',
        action: () => useAppStore.getState().openNewProjectDialog(),
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        text: 'Open Project…',
        accelerator: 'CmdOrCtrl+O',
        action: () => void openProject(),
      }),
      await MenuItem.new({
        text: 'Save Project',
        accelerator: 'CmdOrCtrl+S',
        action: () => void saveProject(),
      }),
      await MenuItem.new({
        text: 'Save Project As…',
        accelerator: 'CmdOrCtrl+Shift+S',
        action: () => void saveProjectAs(),
      }),
    ],
  })

  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [
      await PredefinedMenuItem.new({ item: 'Minimize' }),
      await PredefinedMenuItem.new({ item: 'Fullscreen' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'CloseWindow' }),
    ],
  })

  const menu = await Menu.new({ items: [appMenu, fileMenu, windowMenu] })
  await menu.setAsAppMenu()
}
