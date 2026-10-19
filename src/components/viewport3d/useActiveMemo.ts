import { useMemo, useRef, type DependencyList } from 'react'

/**
 * `useMemo` that freezes while `active` is false: input changes behind a hidden view keep
 * returning the last-built value (no rebuild, no disposal churn), and flipping `active` back
 * on rebuilds once against the then-current inputs. Used by the 3D model views
 * (`OptimizedMeshView`, `TexturedModelView`, `AnimatedModelView`), which stay mounted across
 * mode switches with `visible={false}` instead of unmounting — without this, voxel painting in
 * Model mode would rebuild the hidden textured/animated meshes on every dab (and texture
 * painting would rebuild the hidden CSG shell + re-bake AO), janking the visible tool.
 *
 * `factory` is intentionally not a dep (same contract as `useMemo` with an eslint-disable):
 * it runs with the latest closure whenever `active` or `deps` change.
 */
export function useActiveMemo<T>(active: boolean, factory: () => T, deps: DependencyList): T {
  const cacheRef = useRef<{ value: T } | null>(null)
  return useMemo(() => {
    if (!active && cacheRef.current) return cacheRef.current.value
    const value = factory()
    cacheRef.current = { value }
    return value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}
