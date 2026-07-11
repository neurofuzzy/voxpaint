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

  useFrame((state) => {
    manager.tick(state.clock.elapsedTime)
  })

  return <primitive object={manager.group} />
})
VoxelInstancedMeshes.displayName = 'VoxelInstancedMeshes'
