import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo } from 'react'
import { encodeKey } from '@/engine/grid/GridStore'
import { InstancingManager } from '@/engine/instancing/InstancingManager'
import { useAppStore } from '@/store/useAppStore'

export const VoxelInstancedMeshes = forwardRef<InstancingManager>((_props, ref) => {
  const manager = useMemo(() => new InstancingManager(), [])
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const hoverCell = useAppStore((s) => s.hoverCell)
  const wireframe = useAppStore((s) => s.wireframe)
  const optimizedMesh = useAppStore((s) => s.optimizedMesh)

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
    manager.setHoveredCell(hoverCell ? encodeKey(...hoverCell) : null)
  }, [manager, hoverCell])

  // Wireframe applies to the instanced view; when the optimized mesh is shown, hide the instanced
  // render pools (the invisible pick mesh stays active so plane-picking still works).
  useEffect(() => {
    manager.setWireframe(wireframe)
  }, [manager, wireframe])

  useEffect(() => {
    manager.setRenderVisible(!optimizedMesh)
  }, [manager, optimizedMesh])

  useFrame((state) => {
    manager.tick(state.clock.elapsedTime)
  })

  return <primitive object={manager.group} />
})
VoxelInstancedMeshes.displayName = 'VoxelInstancedMeshes'
