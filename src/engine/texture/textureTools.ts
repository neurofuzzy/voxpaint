import type { NormalizedPointerEvent } from '@/engine/input/PointerInputController'
import { bresenhamLine, snapToOrtho } from '@/engine/tools/lineUtils'
import { isCellSelected, lassoRegion, rectRegion } from '@/engine/tools/selectionMask'
import type { FloatOrigin, SelectionRegion, ToolId } from '@/store/types'
import type { TexelClip } from './texelOps'
import type { BoxFace, TextureModel } from './types'
import { EMPTY } from './types'
import { getTexel } from './TextureStore'

/**
 * Everything the texture tools need, bundled the same way `ToolContext` is for voxel tools —
 * rebuilt fresh each render by `useTextureCanvasTools` and mirrored into a ref. A deliberately
 * separate context (not a bent voxel `ToolContext`): texel edits are surface-native (no plane / 3D
 * coord), which keeps the two systems cleanly decoupled. Only pure leaf helpers (`bresenhamLine`,
 * `selectionMask`) are shared.
 */
export interface TextureToolContext {
  texture: TextureModel
  activeBoxFace: BoxFace | null
  activeGrayIndex: number
  selection: SelectionRegion | null
  floatContent: TexelClip | null
  floatOrigin: FloatOrigin | null
  clipboard: TexelClip | null

  paintTexel: (u: number, v: number) => void
  eraseTexel: (u: number, v: number) => void
  floodFillTexel: (u: number, v: number) => void
  cloneStampTexel: (srcU: number, srcV: number, destU: number, destV: number) => void
  beginTextureMove: () => void
  updateTextureMove: (du: number, dv: number) => void
  endTextureMove: () => void
  setActiveGrayIndex: (index: number) => void
  setActiveTool: (tool: ToolId) => void
  setSelection: (region: SelectionRegion | null) => void
  liftToFloat: () => void
  moveFloatTo: (originU: number, originV: number) => void
  bakeFloatIfAny: () => void
  beginStroke: () => void
  commitStroke: () => void

  linePreview: { anchor: [number, number]; end: [number, number] } | null
  setLinePreview: (v: { anchor: [number, number]; end: [number, number] } | null) => void
  selectPreview: SelectionRegion | null
  setSelectPreview: (v: SelectionRegion | null) => void
  drag: { current: TextureDragState }
  cloneSourceRef: { current: [number, number] | null }
  cloneOffsetRef: { current: [number, number] | null }
}

export type TextureDragState =
  | { kind: 'idle' }
  | { kind: 'paint'; anchor: [number, number]; last: [number, number] }
  | { kind: 'selectRect'; anchor: [number, number] }
  | { kind: 'selectLasso'; points: Array<[number, number]> }
  | { kind: 'clone'; last: [number, number] }
  | { kind: 'moveFloat'; startU: number; startV: number; originAtStart: FloatOrigin }
  | { kind: 'moveGrid'; startU: number; startV: number; lastU: number; lastV: number }

export interface TextureToolHandler {
  onDown?(ctx: TextureToolContext, e: NormalizedPointerEvent): void
  onMove?(ctx: TextureToolContext, e: NormalizedPointerEvent): void
  onUp?(ctx: TextureToolContext, e: NormalizedPointerEvent): void
}

/** Paint/erase drag-state machine — the texel twin of `engine/tools/editToolFactory.ts`. */
function makeTextureEditTool(apply: (ctx: TextureToolContext, u: number, v: number) => void): TextureToolHandler {
  return {
    onDown(ctx, e) {
      ctx.bakeFloatIfAny()
      ctx.beginStroke()
      ctx.drag.current = { kind: 'paint', anchor: [e.u, e.v], last: [e.u, e.v] }
      if (e.shiftKey) {
        ctx.setLinePreview({ anchor: [e.u, e.v], end: [e.u, e.v] })
        return
      }
      apply(ctx, e.u, e.v)
    },
    onMove(ctx, e) {
      if (ctx.drag.current.kind !== 'paint') return
      if (e.shiftKey) {
        const anchor = ctx.drag.current.anchor
        const [su, sv] = snapToOrtho(anchor[0], anchor[1], e.u, e.v)
        ctx.setLinePreview({ anchor, end: [su, sv] })
        return
      }
      const [lu0, lv0] = ctx.drag.current.last
      if (lu0 === e.u && lv0 === e.v) return
      for (const [lu, lv] of bresenhamLine(lu0, lv0, e.u, e.v)) apply(ctx, lu, lv)
      ctx.drag.current = { ...ctx.drag.current, last: [e.u, e.v] }
    },
    onUp(ctx) {
      if (ctx.drag.current.kind !== 'paint') return
      if (ctx.linePreview) {
        const { anchor, end } = ctx.linePreview
        for (const [lu, lv] of bresenhamLine(anchor[0], anchor[1], end[0], end[1])) apply(ctx, lu, lv)
      }
      ctx.setLinePreview(null)
      ctx.drag.current = { kind: 'idle' }
      ctx.commitStroke()
    },
  }
}

const paintTool: TextureToolHandler = makeTextureEditTool((ctx, u, v) => ctx.paintTexel(u, v))
const eraseTool: TextureToolHandler = makeTextureEditTool((ctx, u, v) => ctx.eraseTexel(u, v))

const eyedropperTool: TextureToolHandler = {
  onDown(ctx, e) {
    if (!ctx.activeBoxFace) return
    const value = getTexel(ctx.texture, ctx.activeBoxFace, e.u, e.v)
    if (value === EMPTY) return
    ctx.setActiveGrayIndex(value)
    ctx.setActiveTool('paint')
  },
}

const fillTool: TextureToolHandler = {
  onDown(ctx, e) {
    if (e.button === 2) return
    ctx.floodFillTexel(e.u, e.v)
  },
}

const selectTool: TextureToolHandler = {
  onDown(ctx, e) {
    const { selection, floatContent, floatOrigin } = ctx
    if (floatContent && selection && isCellSelected(selection, e.u, e.v)) {
      ctx.drag.current = { kind: 'moveFloat', startU: e.u, startV: e.v, originAtStart: floatOrigin! }
      return
    }
    if (floatContent) {
      ctx.bakeFloatIfAny()
    } else if (selection && isCellSelected(selection, e.u, e.v)) {
      ctx.liftToFloat()
      ctx.drag.current = {
        kind: 'moveFloat',
        startU: e.u,
        startV: e.v,
        originAtStart: { originU: selection.originU, originV: selection.originV },
      }
      return
    }
    if (e.altKey) {
      ctx.drag.current = { kind: 'selectLasso', points: [[e.u, e.v]] }
      ctx.setSelectPreview(null)
    } else {
      ctx.drag.current = { kind: 'selectRect', anchor: [e.u, e.v] }
      ctx.setSelectPreview(rectRegion(e.u, e.v, e.u, e.v))
    }
  },
  onMove(ctx, e) {
    const drag = ctx.drag.current
    if (drag.kind === 'moveFloat') {
      const { startU, startV, originAtStart } = drag
      ctx.moveFloatTo(originAtStart.originU + (e.u - startU), originAtStart.originV + (e.v - startV))
      return
    }
    if (drag.kind === 'selectLasso') {
      const points = drag.points
      const last = points[points.length - 1]
      if (last[0] === e.u && last[1] === e.v) return
      for (const p of bresenhamLine(last[0], last[1], e.u, e.v)) points.push(p)
      ctx.setSelectPreview(lassoRegion(points))
      return
    }
    if (drag.kind === 'selectRect') {
      ctx.setSelectPreview(rectRegion(drag.anchor[0], drag.anchor[1], e.u, e.v))
    }
  },
  onUp(ctx) {
    const drag = ctx.drag.current
    if (drag.kind === 'moveFloat') {
      ctx.drag.current = { kind: 'idle' }
      return
    }
    const region = drag.kind === 'selectLasso' ? lassoRegion(drag.points) : ctx.selectPreview
    ctx.setSelection(region)
    ctx.setSelectPreview(null)
    ctx.drag.current = { kind: 'idle' }
  },
}

function stampClone(ctx: TextureToolContext, u: number, v: number): void {
  const offset = ctx.cloneOffsetRef.current
  if (!offset) return
  ctx.cloneStampTexel(u - offset[0], v - offset[1], u, v)
}

const cloneTool: TextureToolHandler = {
  onDown(ctx, e) {
    if (e.altKey) {
      ctx.cloneSourceRef.current = [e.u, e.v]
      ctx.cloneOffsetRef.current = null
      ctx.drag.current = { kind: 'idle' }
      return
    }
    if (!ctx.cloneSourceRef.current) return
    ctx.bakeFloatIfAny()
    ctx.cloneOffsetRef.current = [e.u - ctx.cloneSourceRef.current[0], e.v - ctx.cloneSourceRef.current[1]]
    ctx.beginStroke()
    stampClone(ctx, e.u, e.v)
    ctx.drag.current = { kind: 'clone', last: [e.u, e.v] }
  },
  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'clone') return
    const [lu0, lv0] = ctx.drag.current.last
    if (lu0 === e.u && lv0 === e.v) return
    for (const [lu, lv] of bresenhamLine(lu0, lv0, e.u, e.v)) stampClone(ctx, lu, lv)
    ctx.drag.current = { kind: 'clone', last: [e.u, e.v] }
  },
  onUp(ctx) {
    if (ctx.drag.current.kind !== 'clone') return
    ctx.drag.current = { kind: 'idle' }
    ctx.commitStroke()
  },
}

const moveTool: TextureToolHandler = {
  onDown(ctx, e) {
    ctx.beginTextureMove()
    ctx.drag.current = { kind: 'moveGrid', startU: e.u, startV: e.v, lastU: e.u, lastV: e.v }
  },
  onMove(ctx, e) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    const { startU, startV, lastU, lastV } = ctx.drag.current
    if (e.u === lastU && e.v === lastV) return
    ctx.updateTextureMove(e.u - startU, e.v - startV)
    ctx.drag.current = { ...ctx.drag.current, lastU: e.u, lastV: e.v }
  },
  onUp(ctx) {
    if (ctx.drag.current.kind !== 'moveGrid') return
    ctx.endTextureMove()
    ctx.drag.current = { kind: 'idle' }
  },
}

export const textureToolMap: Record<ToolId, TextureToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  eyedropper: eyedropperTool,
  select: selectTool,
  fill: fillTool,
  clone: cloneTool,
  move: moveTool,
}
