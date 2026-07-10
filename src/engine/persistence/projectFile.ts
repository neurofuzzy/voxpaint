import { migrateToCurrent } from './migrations'
import type { VoxPaintProjectFile } from './schema'

export function downloadProjectFile(file: VoxPaintProjectFile, filename = `${file.meta.name || 'voxpaint-project'}.json`): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function readProjectFile(fileHandle: File): Promise<VoxPaintProjectFile> {
  const text = await fileHandle.text()
  return migrateToCurrent(JSON.parse(text))
}
