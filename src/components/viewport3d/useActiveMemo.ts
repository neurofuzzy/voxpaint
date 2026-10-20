import { useRef, type DependencyList } from 'react'

function depsEqual(a: DependencyList, b: DependencyList): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

/**
 * `useMemo` that freezes while `active` is false: input changes behind a hidden view keep
 * returning the last-built value (no rebuild, no disposal churn), and flipping `active` back
 * on rebuilds once against the then-current inputs — but only when those inputs actually
 * changed since the last build (the last-built deps are kept in a ref, so a bare reactivation
 * with identical deps reuses the cached value). Used by the 3D model views
 * (`OptimizedMeshView`, `TexturedModelView`, `AnimatedModelView`), which stay mounted across
 * mode switches with `visible={false}` instead of unmounting — without this, voxel painting in
 * Model mode would rebuild the hidden textured/animated meshes on every dab (and texture
 * painting would rebuild the hidden CSG shell + re-bake AO), janking the visible tool.
 *
 * `factory` is intentionally not a dep (same contract as `useMemo` with an eslint-disable):
 * it runs with the latest closure whenever a build runs.
 */
export function useActiveMemo<T>(active: boolean, factory: () => T, deps: DependencyList): T {
  const cacheRef = useRef<{ value: T; deps: DependencyList } | null>(null)
  if (!active && cacheRef.current) return cacheRef.current.value
  const prev = cacheRef.current
  if (prev && depsEqual(prev.deps, deps)) return prev.value
  const value = factory()
  cacheRef.current = { value, deps: [...deps] }
  return value
}
