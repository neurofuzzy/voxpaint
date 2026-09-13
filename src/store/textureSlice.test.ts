import { beforeEach, describe, expect, it } from 'vitest'
import { getTexel } from '@/engine/texture/TextureStore'
import { EMPTY, faceSizeFor } from '@/engine/texture/types'
import { useAppStore } from './useAppStore'

const faceSize = faceSizeFor(16)

/** Drives the real store to verify texture edits, the Immer/typed-array assignment path, and — most
 * importantly — that texture history is fully independent of voxel history. */
describe('textureSlice', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
    useAppStore.getState().setActiveBoxFace('pz')
    useAppStore.getState().setActiveGrayIndex(2)
  })

  it('paints a texel inside one stroke and commits to texture history only', () => {
    const s = useAppStore.getState()
    s.textureBeginStroke()
    s.paintTexel(3, 4)
    s.textureCommitStroke()

    const after = useAppStore.getState()
    expect(getTexel(after.texture, 'pz', 3, 4, faceSize)).toBe(2)
    expect(after.texturePast.length).toBe(1)
    // Voxel history untouched.
    expect(after.past.length).toBe(0)
  })

  it('undo/redo on texture leaves voxel history alone (and vice versa)', () => {
    const s = useAppStore.getState()
    s.textureBeginStroke()
    s.paintTexel(1, 1)
    s.textureCommitStroke()

    // A voxel edit lands only in voxel history.
    s.beginStroke()
    s.paintCell(0, 0)
    s.commitStroke()
    expect(useAppStore.getState().past.length).toBe(1)
    expect(useAppStore.getState().texturePast.length).toBe(1)

    // Texture undo reverts the texel, not the voxel.
    useAppStore.getState().textureUndo()
    let st = useAppStore.getState()
    expect(getTexel(st.texture, 'pz', 1, 1, faceSize)).toBe(EMPTY)
    expect(st.textureFuture.length).toBe(1)
    expect(st.past.length).toBe(1) // voxel history unchanged
    expect(st.model.color.size).toBe(1) // voxel still there

    // Texture redo restores it.
    useAppStore.getState().textureRedo()
    st = useAppStore.getState()
    expect(getTexel(st.texture, 'pz', 1, 1, faceSize)).toBe(2)
  })

  it('does not mutate the previous history snapshot (copy-on-write faces)', () => {
    const s = useAppStore.getState()
    s.textureBeginStroke()
    s.paintTexel(2, 2)
    s.textureCommitStroke()
    const snapshot = useAppStore.getState().texturePast[0]

    // A later paint must not retroactively change the first snapshot's face array.
    s.textureBeginStroke()
    s.paintTexel(5, 5)
    s.textureCommitStroke()

    // texturePast[0] is the baseline captured before the FIRST paint — still fully empty.
    expect(getTexel(snapshot, 'pz', 5, 5, faceSize)).toBe(EMPTY)
    expect(getTexel(snapshot, 'pz', 2, 2, faceSize)).toBe(EMPTY)
  })
})
