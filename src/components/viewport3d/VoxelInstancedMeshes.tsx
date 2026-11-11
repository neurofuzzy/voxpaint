import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo } from 'react'
import { encodeKey } from '@/engine/grid/GridStore'
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
    // Detail hovers blink the specific child (synthetic `parent/index` instance keys);
    // plain-cell hovers resolve as before (subdiv parents have no full-cell instance).
    if (hoveredFace?.childIndex !== undefined && hoveredFace.childIndex !== null) {
      manager.setHoveredCell(`${hoveredFace.cellKey}/${hoveredFace.childIndex}`)
    } else {
      manager.setHoveredCell(hoverCell ? encodeKey(...hoverCell) : null)
    }
  }, [manager, hoverCell, hoveredFace])

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
