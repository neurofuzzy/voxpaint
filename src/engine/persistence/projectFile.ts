import { migrateToCurrent } from './migrations'
import type { VoxPaintProjectFile } from './schema'

export function normalizeProjectFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function downloadProjectFile(file: VoxPaintProjectFile, filename?: string): void {
  const fallback = `${normalizeProjectFilename(file.meta.name || 'voxpaint-project')}.json`
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? fallback
  a.click()
  URL.revokeObjectURL(url)
}

export async function readProjectFile(fileHandle: File): Promise<VoxPaintProjectFile> {
  const text = await fileHandle.text()
  return migrateToCurrent(JSON.parse(text))
}
