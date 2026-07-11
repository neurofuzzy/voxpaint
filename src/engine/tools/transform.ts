import type { ClipboardData } from '@/store/types'

/** Rotates clipboard content 90° clockwise around its own bounding box (width/height swap). */
export function rotateClipboard90(clipboard: ClipboardData): ClipboardData {
  const { height } = clipboard
  return {
    width: clipboard.height,
    height: clipboard.width,
    cells: clipboard.cells.map((cell) => ({
      ...cell,
      du: height - 1 - cell.dv,
      dv: cell.du,
    })),
  }
}

export function mirrorClipboard(clipboard: ClipboardData, axis: 'horizontal' | 'vertical'): ClipboardData {
  const { width, height } = clipboard
  return {
    width,
    height,
    cells: clipboard.cells.map((cell) => ({
      ...cell,
      du: axis === 'horizontal' ? width - 1 - cell.du : cell.du,
      dv: axis === 'vertical' ? height - 1 - cell.dv : cell.dv,
    })),
  }
}
