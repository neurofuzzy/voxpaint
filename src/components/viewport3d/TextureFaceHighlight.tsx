import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildTexturedFaceHighlightGeometry } from '@/engine/texture/texturedGeometry'
import { useAppStore } from '@/store/useAppStore'

export function TextureFaceHighlight() {
  const enabled = useAppStore((s) => s.textureFaceMap)
  const activeBoxFace = useAppStore((s) => s.activeBoxFace)
  const model = useAppStore((s) => s.model)
  const palette = useAppStore((s) => s.palette)

  const geometry = useMemo(
    () => enabled && activeBoxFace ? buildTexturedFaceHighlightGeometry(model, palette, activeBoxFace) : null,
    [enabled, activeBoxFace, model, palette],
  )
  useEffect(() => () => {
    if (geometry) geometry.dispose()
  }, [geometry])

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
    }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.5)
    material.opacity = 0.12 + pulse * 0.38
  })

  if (!geometry) return null

  return (
    <mesh geometry={geometry} raycast={() => null}>
      <primitive object={material} attach="material" />
    </mesh>
  )
}
