import type { StateCreator } from 'zustand'
import type { BoxFace, TextureModel } from '@/engine/texture/types'
import { EMPTY, FACE_SIZE } from '@/engine/texture/types'
import { cloneTextureModel, emptyTextureModel, texelIndex, withinFace } from '@/engine/texture/TextureStore'
import { applyClipAt, clearRegion, copyRegion, floodFillFace, mirrorClip, rotateClip90 } from '@/engine/texture/texelOps'
import { isCellSelected, mirrorRegion, rotateRegion90 } from '@/engine/tools/selectionMask'
import type { AppState, TextureSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/immer', never]], [], TextureSlice>

const MAX_TEXTURE_HISTORY = 100

// Transient (not observable state, not Immer-drafted), mirroring historySlice/moveActions.
let textureBaseline: TextureModel | null = null
let textureMoveGesture: { face: BoxFace; base: Uint8Array } | null = null

const now = () => new Date().toISOString()

/**
 * Texture authoring engine — a fully parallel stack to the voxel one. Face texel arrays are
 * `Uint8Array`, which Immer treats as opaque (never drafts/freezes), so every mutating action
 * builds the next `TextureModel` **outside** the producer (via `cloneTextureModel`, copy-on-write on
 * the active face) and assigns it in — the same discipline `projectSlice.setModel` uses for the
 * voxel `Map`. History snapshots stay valid because the previous face arrays are never mutated in
 * place. All texel edits also flip `dirty`/`modifiedAt` so autosave persists the texture.
 */
export const createTextureSlice: Slice = (set, get) => {
  /** Assign a freshly-built texture, flagging the project dirty. */
  const commit = (next: TextureModel) =>
    set((state) => {
      state.texture = next
      state.dirty = true
      state.meta.modifiedAt = now()
    })

  /** Write texels into the active face (copy-on-write), clipped to the selection mask + face bounds.
   * No-op (returns false) when no face is active or nothing actually changed. */
  const writeTexels = (writes: Array<readonly [number, number, number]>): boolean => {
    const face = get().activeBoxFace
    if (!face) return false
    const next = cloneTextureModel(get().texture, face)
    const arr = next.faces[face]
    const sel = get().textureSelection
    let changed = false
    for (const [u, v, value] of writes) {
      if (!withinFace(u, v)) continue
      if (sel && !isCellSelected(sel, u, v)) continue
      const i = texelIndex(u, v)
      if (arr[i] === value) continue
      arr[i] = value
      changed = true
    }
    if (changed) commit(next)
    return changed
  }

  return {
    texture: emptyTextureModel(),
    activeBoxFace: null,
    activeGrayIndex: 0,
    texturePast: [],
    textureFuture: [],
    textureSelection: null,
    textureFloat: null,
    textureFloatOrigin: null,
    textureClipboard: null,

    setTexture: (texture) => set((state) => { state.texture = texture }),
    setActiveBoxFace: (face) => set((state) => { state.activeBoxFace = face }),
    setActiveGrayIndex: (index) => set((state) => { state.activeGrayIndex = index }),

    // --- separate undo/redo history --------------------------------------------------------------
    textureBeginStroke: () => { textureBaseline = get().texture },

    textureCommitStroke: () => {
      const baseline = textureBaseline
      textureBaseline = null
      if (!baseline || baseline === get().texture) return
      set((state) => {
        state.texturePast.push(baseline)
        if (state.texturePast.length > MAX_TEXTURE_HISTORY) state.texturePast.shift()
        state.textureFuture = []
      })
    },

    textureUndo: () => {
      get().textureBakeFloatIfAny()
      set((state) => {
        const prev = state.texturePast.pop()
        if (!prev) return
        state.textureFuture.unshift(state.texture as TextureModel)
        state.texture = prev
        state.dirty = true
      })
    },

    textureRedo: () => {
      get().textureBakeFloatIfAny()
      set((state) => {
        const next = state.textureFuture.shift()
        if (!next) return
        state.texturePast.push(state.texture as TextureModel)
        state.texture = next
        state.dirty = true
      })
    },

    // --- direct texel edits (stroke wrapping is owned by the tools) ------------------------------
    paintTexel: (u, v) => { writeTexels([[u, v, get().activeGrayIndex]]) },
    eraseTexel: (u, v) => { writeTexels([[u, v, EMPTY]]) },

    floodFillTexel: (u, v) => {
      get().textureBakeFloatIfAny()
      const face = get().activeBoxFace
      if (!face) return
      let cells = floodFillFace(get().texture.faces[face], u, v)
      const sel = get().textureSelection
      if (sel) cells = cells.filter(([cu, cv]) => isCellSelected(sel, cu, cv))
      if (cells.length === 0) return
      get().textureBeginStroke()
      const gray = get().activeGrayIndex
      const next = cloneTextureModel(get().texture, face)
      for (const [cu, cv] of cells) next.faces[face][texelIndex(cu, cv)] = gray
      commit(next)
      get().textureCommitStroke()
    },

    cloneStampTexel: (srcU, srcV, destU, destV) => {
      const face = get().activeBoxFace
      if (!face || !withinFace(destU, destV)) return
      const arr = get().texture.faces[face]
      const value = withinFace(srcU, srcV) ? arr[texelIndex(srcU, srcV)] : EMPTY
      const next = cloneTextureModel(get().texture, face)
      next.faces[face][texelIndex(destU, destV)] = value
      commit(next)
    },

    // --- live Move of the whole active face -----------------------------------------------------
    beginTextureMove: () => {
      get().textureBakeFloatIfAny()
      const face = get().activeBoxFace
      if (!face) return
      textureMoveGesture = { face, base: new Uint8Array(get().texture.faces[face]) }
      get().textureBeginStroke()
    },

    updateTextureMove: (du, dv) => {
      const g = textureMoveGesture
      if (!g) return
      const next = cloneTextureModel(get().texture, g.face)
      const arr = next.faces[g.face]
      arr.fill(EMPTY)
      for (let v = 0; v < FACE_SIZE; v++) {
        for (let u = 0; u < FACE_SIZE; u++) {
          const value = g.base[texelIndex(u, v)]
          if (value === EMPTY) continue
          const nu = u + du
          const nv = v + dv
          if (withinFace(nu, nv)) arr[texelIndex(nu, nv)] = value
        }
      }
      commit(next)
    },

    endTextureMove: () => {
      if (!textureMoveGesture) return
      textureMoveGesture = null
      get().textureCommitStroke()
    },

    // --- selection / float / clipboard ----------------------------------------------------------
    setTextureSelection: (region) => {
      get().textureBakeFloatIfAny()
      set((state) => { state.textureSelection = region })
    },

    textureLiftToFloat: () => {
      const { textureSelection, textureFloat, activeBoxFace, texture } = get()
      if (!textureSelection || textureFloat || !activeBoxFace) return
      const content = copyRegion(texture.faces[activeBoxFace], textureSelection)
      get().textureBeginStroke()
      const next = cloneTextureModel(texture, activeBoxFace)
      clearRegion(next.faces[activeBoxFace], textureSelection)
      set((state) => {
        state.texture = next
        state.textureFloat = content
        state.textureFloatOrigin = { originU: textureSelection.originU, originV: textureSelection.originV }
        state.dirty = true
        state.meta.modifiedAt = now()
      })
      // No commit — stays open until textureBakeFloatIfAny().
    },

    textureMoveFloatTo: (originU, originV) => {
      if (!get().textureFloat) return
      set((state) => {
        state.textureFloatOrigin = { originU, originV }
        state.textureSelection = { ...state.textureSelection!, originU, originV }
      })
    },

    textureTransformFloat: (kind) => {
      get().textureLiftToFloat() // no-op if already floating
      const { textureFloat, textureSelection } = get()
      if (!textureFloat || !textureSelection) return
      const content = kind === 'rotate' ? rotateClip90(textureFloat) : mirrorClip(textureFloat, kind === 'mirror-h' ? 'horizontal' : 'vertical')
      const region = kind === 'rotate' ? rotateRegion90(textureSelection) : mirrorRegion(textureSelection, kind === 'mirror-h' ? 'horizontal' : 'vertical')
      set((state) => {
        state.textureFloat = content
        state.textureFloatOrigin = { originU: region.originU, originV: region.originV }
        state.textureSelection = region
      })
    },

    textureBakeFloatIfAny: () => {
      const { textureFloat, textureFloatOrigin, activeBoxFace, texture } = get()
      if (!textureFloat || !textureFloatOrigin || !activeBoxFace) return
      const next = cloneTextureModel(texture, activeBoxFace)
      applyClipAt(next.faces[activeBoxFace], textureFloat, textureFloatOrigin.originU, textureFloatOrigin.originV)
      set((state) => {
        state.texture = next
        state.dirty = true
        state.meta.modifiedAt = now()
      })
      get().textureCommitStroke()
      set((state) => {
        state.textureFloat = null
        state.textureFloatOrigin = null
      })
    },

    textureCopy: () => {
      get().textureBakeFloatIfAny()
      const { textureSelection, activeBoxFace, texture } = get()
      if (!textureSelection || !activeBoxFace) return
      const clip = copyRegion(texture.faces[activeBoxFace], textureSelection)
      set((state) => { state.textureClipboard = clip })
    },

    textureCut: () => {
      if (!get().textureSelection) return
      get().textureCopy()
      get().textureDelete()
    },

    textureDelete: () => {
      get().textureBakeFloatIfAny()
      const { textureSelection, activeBoxFace } = get()
      if (!textureSelection || !activeBoxFace) return
      get().textureBeginStroke()
      const next = cloneTextureModel(get().texture, activeBoxFace)
      clearRegion(next.faces[activeBoxFace], textureSelection)
      commit(next)
      get().textureCommitStroke()
    },

    texturePasteAt: (u, v) => {
      get().textureBakeFloatIfAny()
      const clip = get().textureClipboard
      if (!clip || !get().activeBoxFace) return
      get().textureBeginStroke()
      set((state) => {
        state.textureFloat = clip
        state.textureFloatOrigin = { originU: u, originV: v }
        state.textureSelection = {
          originU: u,
          originV: v,
          width: clip.width,
          height: clip.height,
          mask: new Uint8Array(clip.width * clip.height).fill(1),
        }
      })
    },
  }
}
