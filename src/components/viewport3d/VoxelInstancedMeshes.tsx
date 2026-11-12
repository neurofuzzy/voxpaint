import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo } from 'react'
import { decodeKey, encodeKey } from '@/engine/grid/GridStore'
import { childIndex, faceHitBits } from '@/engine/grid/cellBox'
import { InstancingManager } from '@/engine/instancing/InstancingManager'
import { useAppStore } from '@/store/useAppStore'

export const VoxelInstancedMeshes = forwardRef<InstancingManager, { visible: boolean }>((props, ref) => {
  const { visible } = props
  const manager = useMemo(() => new InstancingManager(), [])
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const hoverCell = useAppStore((s) => s.hoverCell)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const wireframe = useAppStore((s) => s.wireframe)

  useEffect(() => {
    if (typeof ref === 'function') ref(manager)
    else if (ref) ref.current = manager
    return () => manager.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager])

  useEffect(() => {
    manager.sync(model, palette)
  }, [manager, model, palette])

  useEffect(() => {
    // Detail hovers blink the child under the hit point (synthetic `parent/index` instance
    // keys); plain-cell hovers resolve as before (subdiv parents have no full-cell instance).
    const sub = hoveredFace?.point ? model.subdiv.get(hoveredFace.cellKey) : undefined
    if (hoveredFace?.point && sub) {
      const bits = faceHitBits(hoveredFace.point, decodeKey(hoveredFace.cellKey), hoveredFace.axis, hoveredFace.orientation)
      manager.setHoveredCell(`${hoveredFace.cellKey}/${childIndex(sub.split, bits)}`)
    } else {
      manager.setHoveredCell(hoverCell ? encodeKey(...hoverCell) : null)
    }
  }, [manager, hoverCell, hoveredFace, model])

  useEffect(() => {
    manager.setWireframe(wireframe)
  }, [manager, wireframe])

  // Always hide the instanced visual render — the optimized CSG mesh is shown instead.
  // The invisible pick mesh stays active for construction-plane picking.
  useEffect(() => {
    manager.setRenderVisible(false)
  }, [manager])

  useFrame((state) => {
    // The manager stays mounted across mode switches (hidden) — skip its per-frame tick there.
    // `sync` needs no gating: the voxel model/palette never change outside Model mode.
    if (!visible) return
    manager.tick(state.clock.elapsedTime)
  })

  return <primitive object={manager.group} visible={visible} />
})
VoxelInstancedMeshes.displayName = 'VoxelInstancedMeshes'
