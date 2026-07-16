import { invoke, isTauri } from '@tauri-apps/api/core'
import { migrateToCurrent } from './migrations'
import { downloadProjectFile, normalizeProjectFilename, readProjectFile } from './projectFile'
import type { VoxPaintProjectFile } from './schema'

export type SaveOptions = { path?: string | null; suggestedName: string }
export type SaveResult = { path: string | null }
export type OpenResult = { file: VoxPaintProjectFile; path: string | null }

const PROJECT_FILTER = [{ name: 'VoxPaint Project', extensions: ['voxpaint'] }]

export { isTauri }

/**
 * Saves a project file. Desktop (Tauri): writes straight to `opts.path` if given (no dialog);
 * otherwise shows a native save dialog and writes to the chosen path. Web/PWA: falls back to the
 * existing blob-download flow (browsers expose no real filesystem path, so `path` is always null
 * there). Returns the path written to, or null if the user cancelled the dialog (desktop) or on
 * the web build.
 */
export async function saveProjectFile(file: VoxPaintProjectFile, opts: SaveOptions): Promise<SaveResult> {
  const filename = `${normalizeProjectFilename(opts.suggestedName)}.voxpaint`
  if (!isTauri()) {
    downloadProjectFile(file, filename)
    return { path: null }
  }
  let path = opts.path ?? null
  if (!path) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    path = await save({ defaultPath: filename, filters: PROJECT_FILTER })
    if (!path) return { path: null }
  }
  await invoke<void>('write_project_file', { path, contents: JSON.stringify(file, null, 2) })
  return { path }
}

/**
 * Opens a project file. Desktop: native open dialog + a Rust read command. Web/PWA: a programmatic
 * `<input type=file>` (there is no real filesystem path in a browser, so `path` is always null).
 * Returns null if the user cancelled.
 */
export async function openProjectFile(): Promise<OpenResult | null> {
  if (!isTauri()) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.voxpaint,application/json'
      input.onchange = () => {
        const domFile = input.files?.[0]
        if (!domFile) {
          resolve(null)
          return
        }
        readProjectFile(domFile)
          .then((file) => resolve({ file, path: null }))
          .catch(() => resolve(null))
      }
      input.click()
    })
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ multiple: false, directory: false, filters: PROJECT_FILTER })
  if (!path) return null
  const file = await readProjectFromPath(path)
  return { file, path }
}

/**
 * Reads and migrates a project file at a known filesystem path (desktop only) — used for the
 * double-click / "Open With" launch path, where the OS hands us a path directly instead of going
 * through the open dialog.
 */
export async function readProjectFromPath(path: string): Promise<VoxPaintProjectFile> {
  const text = await invoke<string>('read_project_file', { path })
  return migrateToCurrent(JSON.parse(text))
}
