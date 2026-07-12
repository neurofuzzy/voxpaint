import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildAtlas } from '@/engine/texture/boxMapping'
import { buildTexturedGeometry } from '@/engine/texture/texturedGeometry'
import { useAppStore } from '@/store/useAppStore'

/**
 * Texture-mode 3D preview: the whole model as one box-mapped, shell-culled mesh with the texture
 * atlas applied as `map`. `vertexColors` carries each voxel's palette color and three multiplies it
 * by the (grayscale) atlas texel — the shade/multiply semantics. Geometry rebuilds when the model
 * changes; the atlas `DataTexture` re-uploads when the texture changes (cheap relative to geometry).
 */
export function TexturedModelView() {
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)
  const texture = useAppStore((s) => s.texture)

  const geometry = useMemo(() => buildTexturedGeometry(model, palette), [model, palette])
  useEffect(() => () => geometry.dispose(), [geometry])

  const atlasTexture = useMemo(() => {
    const { data, width, height } = buildAtlas(texture)
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.flipY = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  }, [texture])
  useEffect(() => () => atlasTexture.dispose(), [atlasTexture])

  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial map={atlasTexture} vertexColors side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
    </mesh>
  )
}
