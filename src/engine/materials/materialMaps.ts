import * as THREE from 'three'
import type { BuiltinMaterialDef } from './builtinMaterials'

/** Resolved GPU textures for one builtin material at one face size. Any entry may be null
 * when the material vendors no such map (scalar fallbacks apply — see `builtinMaterials.ts`). */
export type SlotMaterialMaps = {
  map: THREE.Texture | null
  roughnessMap: THREE.Texture | null
  metalnessMap: THREE.Texture | null
}

const cache = new Map<string, Promise<SlotMaterialMaps>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load material map ${url}`))
    img.src = url
  })
}

/** Downscales a full-res master to the project's live face size (whole-face stretch = 1:1
 * with the texel grid). Canvas drawImage is the only resampler available (no native
 * image deps) and is more than adequate for 512→64–256 downscales. */
function downscaleTo(img: HTMLImageElement, faceSize: number, srgb: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = faceSize
  canvas.height = faceSize
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, faceSize, faceSize)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Loads (and downscales) a builtin material's maps, cached per material+faceSize so the
 * dozen groups sharing one material share one GPU upload. Never rejects with a partial
 * result — a single failed map fails the whole load and the caller falls back to the
 * unmapped recipe (plus a toast at the UI layer).
 */
export function loadMaterialMaps(def: BuiltinMaterialDef, faceSize: number): Promise<SlotMaterialMaps> {
  const key = `${def.id}:${faceSize}`
  const hit = cache.get(key)
  if (hit) return hit
  const base = import.meta.env.BASE_URL
  const job = (async () => {
    const [albedo, roughness, metallic] = await Promise.all([
      def.files.albedo ? loadImage(`${base}${def.files.albedo}`) : null,
      def.files.roughness ? loadImage(`${base}${def.files.roughness}`) : null,
      def.files.metallic ? loadImage(`${base}${def.files.metallic}`) : null,
    ])
    return {
      map: albedo ? downscaleTo(albedo, faceSize, true) : null,
      roughnessMap: roughness ? downscaleTo(roughness, faceSize, false) : null,
      metalnessMap: metallic ? downscaleTo(metallic, faceSize, false) : null,
    } satisfies SlotMaterialMaps
  })()
  // A failed load must not poison the cache — drop it so a retry can succeed.
  // Loaded textures live for the session (small: ≤9 materials × 3 maps × 256²) and are
  // intentionally never disposed — several groups share each upload, and three.js
  // re-uploads a disposed texture from its retained canvas automatically.
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  return job
}
