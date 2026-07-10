import { migrateToCurrent } from './migrations'
import type { VoxPaintProjectFile } from './schema'

const AUTOSAVE_KEY = 'voxpaint:autosave:v1'

export class QuotaExceededErrorWrapped extends Error {
  constructor() {
    super('Autosave failed: browser storage quota exceeded.')
    this.name = 'QuotaExceededErrorWrapped'
  }
}

export function saveAutosave(file: VoxPaintProjectFile): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file))
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      throw new QuotaExceededErrorWrapped()
    }
    throw err
  }
}

export function loadAutosave(): VoxPaintProjectFile | null {
  const raw = localStorage.getItem(AUTOSAVE_KEY)
  if (!raw) return null
  return migrateToCurrent(JSON.parse(raw))
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY)
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), waitMs)
  }
}
