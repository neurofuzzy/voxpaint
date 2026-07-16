import { invoke } from '@tauri-apps/api/core'
import { isTauri, readProjectFromPath } from '@/engine/persistence/platformFile'
import { showToast } from '@/components/ui/toastBus'
import { loadProject } from './loadProject'

async function openPath(path: string): Promise<void> {
  try {
    const file = await readProjectFromPath(path)
    loadProject(file, path)
    showToast('Project opened.')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Failed to open project.')
  }
}

/**
 * Desktop only: listens for the Rust side's `"open-file"` event (double-click / "Open With" on a
 * `.voxpaint` file while the app is already running) and drains any paths the OS delivered before
 * this listener was registered — the cold-launch race between the OS opening a file and React
 * mounting (see `get_pending_open_files` in `src-tauri/src/lib.rs`). Call once at app startup;
 * a no-op that returns an empty unsubscribe function on the web build.
 */
export async function wireDesktopFileOpen(): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<string>('open-file', (event) => void openPath(event.payload))
  const pending = await invoke<string[]>('get_pending_open_files')
  for (const path of pending) void openPath(path)
  return unlisten
}
