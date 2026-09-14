import { Environment, Lightformer } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { useAppStore } from '@/store/useAppStore'
import { showToast } from '@/components/ui/toastBus'

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

/** The default IBL: procedural RoomEnvironment PMREM'd once. Unchanged from before — this is the
 * baseline every existing project was authored against. */
function NeutralEnvironment() {
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

/** High-contrast procedural softbox rig for crisp coat reflections (carpaint, metal, glass).
 * Rendered by drei into a PMREM env map — IBL only, the visible background stays the gradient
 * skysphere below. Zero bytes shipped, no network fetch. */
function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#101014']} />
      {/* overhead softbox */}
      <Lightformer intensity={4} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} color="#ffffff" />
      {/* cool strip camera-left, warm strip camera-right */}
      <Lightformer intensity={2} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#dfe8ff" />
      <Lightformer intensity={2} position={[5, 1, 0]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color="#fff2df" />
      {/* front fill */}
      <Lightformer intensity={1} position={[0, 2, 6]} scale={[6, 2, 1]} color="#ffffff" />
    </Environment>
  )
}

/** Seeded RNG so the PMREM env scene and the visible backdrop share the same cloud layout. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Soft puffy-cloud sprite: layered white radial blobs with a cool blue-gray underside. */
const cloudTexture = (() => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rand = mulberry32(42)
  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color.replace('A', String(alpha)))
    g.addColorStop(0.7, color.replace('A', String(alpha * 0.45)))
    g.addColorStop(1, color.replace('A', '0'))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // cool underside first, then the lit white puffs on top
  for (let i = 0; i < 10; i++) {
    blob(size * (0.25 + rand() * 0.5), size * (0.55 + rand() * 0.25), 24 + rand() * 30, 'rgba(178,196,216,A)', 0.5)
  }
  for (let i = 0; i < 22; i++) {
    blob(size * (0.2 + rand() * 0.6), size * (0.3 + rand() * 0.35), 18 + rand() * 34, 'rgba(255,255,255,A)', 0.75)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

/**
 * Happy-midday outdoor sky: three.js physical `Sky` sun/atmosphere + billboard puffy clouds +
 * a green ground disc for meadow bounce in the lower hemisphere. Built at unit scale (fits
 * PMREM's default near/far); the visible instance is scaled up to surround the working volume.
 */
function createOutdoorGroup(): THREE.Group {
  const group = new THREE.Group()
  const sky = new Sky()
  sky.scale.setScalar(1.8)
  const uniforms = (sky.material as THREE.ShaderMaterial).uniforms
  uniforms.turbidity.value = 6
  uniforms.rayleigh.value = 2.2
  uniforms.mieCoefficient.value = 0.003
  uniforms.mieDirectionalG.value = 0.8
  uniforms.sunPosition.value.copy(
    new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(135)),
  )
  group.add(sky)

  const rand = mulberry32(7)
  for (let i = 0; i < 14; i++) {
    const az = rand() * Math.PI * 2
    const el = THREE.MathUtils.degToRad(8 + rand() * 47)
    const r = 0.7
    const mat = new THREE.SpriteMaterial({
      map: cloudTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.85 + rand() * 0.15,
      rotation: (rand() - 0.5) * 0.3,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(Math.cos(el) * Math.cos(az) * r, Math.sin(el) * r, Math.cos(el) * Math.sin(az) * r)
    const w = 0.12 + rand() * 0.18
    sprite.scale.set(w, w * (0.45 + rand() * 0.2), 1)
    group.add(sprite)
  }

  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), new THREE.MeshBasicMaterial({ color: '#5f8f4e' }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.3
  group.add(ground)
  return group
}

/** Disposes a backdrop group without touching the shared module-level textures. */
function disposeOutdoorGroup(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      for (const m of material) m.dispose()
    } else {
      material?.dispose()
    }
  })
}

/** Outdoor IBL + visible backdrop: the env scene is PMREM'd for lighting/reflections while a
 * scaled-up twin of the same layout renders behind the model. Baked once — the sun is fixed. */
function OutdoorEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const visible = useMemo(() => {
    const g = createOutdoorGroup()
    g.scale.setScalar(400)
    return g
  }, [])
  useEffect(() => () => disposeOutdoorGroup(visible), [visible])

  useEffect(() => {
    const envScene = new THREE.Scene()
    const envGroup = createOutdoorGroup()
    envScene.add(envGroup)
    const pmrem = new THREE.PMREMGenerator(gl)
    const envTexture = pmrem.fromScene(envScene, 0.04).texture
    const previous = scene.environment
    scene.environment = envTexture
    return () => {
      scene.environment = previous
      envTexture.dispose()
      pmrem.dispose()
      disposeOutdoorGroup(envGroup)
    }
  }, [gl, scene])

  return <primitive object={visible} />
}

/** User-supplied .hdr/.exr via blob URL: loaded with the matching three loader (picked by the
 * original filename — a blob URL carries no extension for drei to sniff) and PMREM'd by hand,
 * the same documented HDR workflow as the neutral path. Failures toast and leave the previous
 * environment in place. */
function CustomEnvironment({ url, fileName }: { url: string; fileName: string }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    let cancelled = false
    let previous: THREE.Texture | null = null
    let source: THREE.Texture | null = null
    let envTexture: THREE.Texture | null = null
    const pmrem = new THREE.PMREMGenerator(gl)
    const Loader = fileName.toLowerCase().endsWith('.exr') ? EXRLoader : RGBELoader
    new Loader()
      .loadAsync(url)
      .then((tex) => {
        if (cancelled) {
          tex.dispose()
          pmrem.dispose()
          return
        }
        tex.mapping = THREE.EquirectangularReflectionMapping
        source = tex
        envTexture = pmrem.fromEquirectangular(tex).texture
        previous = scene.environment
        scene.environment = envTexture
      })
      .catch(() => {
        if (!cancelled) showToast(`Could not load "${fileName}" as an HDR environment.`)
        pmrem.dispose()
      })
    return () => {
      cancelled = true
      if (envTexture) {
        if (scene.environment === envTexture) scene.environment = previous
        envTexture.dispose()
      }
      source?.dispose()
      pmrem.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, url, fileName])

  return null
}

export function SceneEnvironment() {
  const environment = useAppStore((s) => s.environment)
  const customEnvUrl = useAppStore((s) => s.customEnvUrl)
  const customEnvName = useAppStore((s) => s.customEnvName)

  const sphereMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: gradientTexture,
      side: THREE.BackSide,
      depthWrite: false,
    })
    return m
  }, [])

  // A custom choice without a (session-only) file falls back to neutral — the blob URL can't
  // survive a reload, so a restored project may reference a file that is no longer loaded.
  // Outdoor brings its own sky backdrop, so the gradient sphere hides while it's active.
  const effective = environment === 'custom' && (!customEnvUrl || !customEnvName) ? 'neutral' : environment

  return (
    <>
      <Suspense fallback={null}>
        {effective === 'studio' ? (
          <StudioEnvironment />
        ) : effective === 'outdoor' ? (
          <OutdoorEnvironment />
        ) : effective === 'custom' ? (
          <CustomEnvironment url={customEnvUrl!} fileName={customEnvName!} />
        ) : (
          <NeutralEnvironment />
        )}
      </Suspense>
      {effective !== 'outdoor' && (
        <mesh renderOrder={-1} material={sphereMat}>
          <sphereGeometry args={[64, 32, 32]} />
        </mesh>
      )}
    </>
  )
}
