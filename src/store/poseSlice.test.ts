import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

/** The pose slice is pure keyframe state: every edit lands in the selected key — no
 * staging, no scratch, nothing ephemeral but transport. */
describe('pose selection', () => {
  beforeEach(() => {
    useAppStore.getState().newProject('Test', 16)
  })

  function addBox(id: string, parentId: string | null = null) {
    useAppStore.getState().addRigBox({ id, name: id, min: [0, 0, 0], max: [2, 2, 2], parentId, pivot: null })
  }

  it('selects the anchor key on clip select and repairs selection on remove', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const anchor = useAppStore.getState().selectedKeyId!
    // Deselect, then re-select the clip: the first key is under edit again.
    s.setSelectedKey(null)
    s.setActiveClip(clipId)
    expect(useAppStore.getState().selectedKeyId).toBe(anchor)
    // Removing the selected non-anchor key re-points at the nearest survivor.
    const k1 = s.addKeyframe(clipId, 1)!
    s.setSelectedKey(k1)
    s.removeKey(clipId, k1)
    expect(useAppStore.getState().selectedKeyId).toBe(anchor)
    // The anchor itself refuses deletion.
    s.removeKey(clipId, anchor)
    expect(useAppStore.getState().clips[0].keys).toHaveLength(1)
  })

  it('joint edits address keys explicitly and ignore unknown joints', () => {
    addBox('arm')
    const s = useAppStore.getState()
    s.setAnimationMode('poses')
    const clipId = s.addClip()
    const anchor = useAppStore.getState().selectedKeyId!
    s.setKeyJoint(clipId, anchor, 'arm', [0.5, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0.5, 0, 0] })
    // Unknown joints are a no-op.
    s.setKeyJoint(clipId, anchor, 'ghost', [0.5, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({ arm: [0.5, 0, 0] })
    // Near-zero collapses back to bind.
    s.setKeyJoint(clipId, anchor, 'arm', [1e-12, 0, 0])
    expect(useAppStore.getState().clips[0].keys[0].joints).toEqual({})
  })

  it('tracks the gizmo drag latch', () => {
    expect(useAppStore.getState().poseDragging).toBe(false)
    useAppStore.getState().setPoseDragging(true)
    expect(useAppStore.getState().poseDragging).toBe(true)
    useAppStore.getState().setPoseDragging(false)
    expect(useAppStore.getState().poseDragging).toBe(false)
  })

  it('entering Pose mode lifts a hidden model view to Ghost', () => {
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setAnimateModelView('hidden')
    s.setActiveTool('pose')
    // Posing an invisible model shows nothing — Ghost keeps rigs readable through it.
    expect(useAppStore.getState().animateModelView).toBe('ghost')
  })

  it('leaves other view modes alone on Pose entry', () => {
    const s = useAppStore.getState()
    s.setMode('animate')
    s.setAnimateModelView('full')
    s.setActiveTool('pose')
    expect(useAppStore.getState().animateModelView).toBe('full')
  })
})
