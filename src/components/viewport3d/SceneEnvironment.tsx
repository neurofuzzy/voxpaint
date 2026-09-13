import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const gradientTexture = (() => {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, '#8899aa')
  grad.addColorStop(0.3, '#445566')
  grad.addColorStop(0.7, '#1a1a22')
  grad.addColorStop(1, '#0a0a0f')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

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

  const sphereMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: gradientTexture,
      side: THREE.BackSide,
      depthWrite: false,
    })
    return m
  }, [])

  return (
    <mesh renderOrder={-1} material={sphereMat}>
      <sphereGeometry args={[64, 32, 32]} />
    </mesh>
  )
}
