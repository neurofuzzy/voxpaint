import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/**
 * Installs a neutral studio image-based lighting environment onto `scene.environment`, mounted only
 * in optimized-mesh (PBR) mode. Metals render black and frosted glass has nothing to refract without
 * an environment map; `RoomEnvironment` is a procedurally-lit box (no network fetch, unlike drei's
 * HDR presets), PMREM-prefiltered here for `MeshPhysicalMaterial` IBL. `MeshLambertMaterial` (the
 * default instanced view) ignores `scene.environment`, so this never affects the flat editing view.
 */
export function SceneEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    const previous = scene.environment
    scene.environment = envTexture
    return () => {
      scene.environment = previous
      envTexture.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}
