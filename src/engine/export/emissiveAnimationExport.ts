import * as THREE from 'three'
import type { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { EmissiveAnimMode } from '@/engine/palette/types'
import { EMISSIVE_ANIM_CYCLE_SECONDS } from '@/engine/palette/emissiveAnimation'

export type EmissiveAnimExportTarget = { material: THREE.Material; mode: EmissiveAnimMode }

type VectorSampler = { times: Float32Array; values: Float32Array; itemSize: number; interpolation: 'STEP' | 'CUBICSPLINE' }

/**
 * `peak` is the property's value at "on"; `scales[i] === false` pins that component at its peak
 * value for the whole cycle instead of animating it (used to hold `baseColorFactor`'s alpha
 * constant while its RGB drops to black).
 */
function buildBlinkSampler(peak: number[], scales: boolean[]): VectorSampler {
  // Hard on/off: two states per cycle, STEP interpolation holds each value until the next keyframe.
  // The trailing keyframe (equal to the first) exists only for a byte-for-byte inspectable JSON —
  // playback loops back to t=0 immediately after t=duration regardless.
  const n = peak.length
  const times = new Float32Array([0, EMISSIVE_ANIM_CYCLE_SECONDS / 2, EMISSIVE_ANIM_CYCLE_SECONDS])
  const values = new Float32Array(3 * n)
  ;[1, 0, 1].forEach((factor, k) => {
    for (let c = 0; c < n; c++) values[k * n + c] = scales[c] ? peak[c] * factor : peak[c]
  })
  return { times, values, itemSize: n, interpolation: 'STEP' }
}

function buildPulseSampler(peak: number[], scales: boolean[]): VectorSampler {
  // Raised-cosine "breathing" curve: value(t) = peak · (1 − cos(ωt)) / 2 — zero derivative at both
  // the trough (t=0) and peak (t=T/2), so a CUBICSPLINE loop has no visible seam. Same analytic-
  // tangent technique as buildTranslationClip in animationGLTF.ts, generalized to an N-component
  // vector output. CUBICSPLINE keyframes are laid out as [inTangent, value, outTangent] triples per
  // keyframe (glTF spec appx C), each itself an N-component group.
  const n = peak.length
  const omega = (2 * Math.PI) / EMISSIVE_ANIM_CYCLE_SECONDS
  const sampleTimes = [0, EMISSIVE_ANIM_CYCLE_SECONDS / 4, EMISSIVE_ANIM_CYCLE_SECONDS / 2, (EMISSIVE_ANIM_CYCLE_SECONDS * 3) / 4, EMISSIVE_ANIM_CYCLE_SECONDS]
  const times = new Float32Array(sampleTimes)
  const values = new Float32Array(sampleTimes.length * n * 3)
  sampleTimes.forEach((t, i) => {
    const factor = (1 - Math.cos(omega * t)) / 2
    const dFactor = (omega * Math.sin(omega * t)) / 2
    const base = i * n * 3
    for (let c = 0; c < n; c++) {
      const value = scales[c] ? peak[c] * factor : peak[c]
      const tangent = scales[c] ? peak[c] * dFactor : 0
      values[base + c] = tangent // inTangent
      values[base + n + c] = value // value
      values[base + 2 * n + c] = tangent // outTangent
    }
  })
  return { times, values, itemSize: n, interpolation: 'CUBICSPLINE' }
}

/**
 * Registers a `GLTFExporter` plugin that bakes each flagged material's emissive blink/pulse into the
 * exported glTF via `KHR_animation_pointer`, on two synced channels so "off" reads as true black
 * rather than just a non-glowing lit surface:
 *  - `/materials/{n}/extensions/KHR_materials_emissive_strength/emissiveStrength` (the glow)
 *  - `/materials/{n}/pbrMetallicRoughness/baseColorFactor` (the albedo, RGB only — alpha held constant)
 *
 * glTF's core animation channels can only target a node's TRS/morph weights — there's no channel type
 * for material properties — so `three`'s `GLTFExporter` (as of r185) has no built-in support for this,
 * and `processAnimation`'s track-name parsing can't be reused (it resolves tracks to nodes via
 * `PropertyBinding`, which materials aren't part of). Instead this hooks `afterParse`, which runs after
 * every material has been written (so `writer.cache.materials` — keyed by `material.uuid`, the same key
 * `processMaterialAsync` caches under — already holds each material's final index) but before the
 * exporter serializes its buffer, so accessors created here via `writer.processAccessor` still land in
 * the output. `emissiveStrength` piggybacks on `KHR_materials_emissive_strength`, which the exporter
 * already writes by default whenever `emissiveIntensity !== 1` — true for every emissive-class material
 * here (`materialParamsFor('emissive')` sets 1.5). `baseColorFactor` may not have been explicitly
 * written (three skips it when the color is the [1,1,1,1] default, e.g. textured/overlay emissive
 * materials whose actual hue comes from the baked map) — it's force-written here so the pointer target
 * always resolves to a concrete value rather than relying on viewers applying the schema default.
 */
export function registerEmissiveAnimationExtension(exporter: GLTFExporter, targets: EmissiveAnimExportTarget[]): void {
  const active = targets.filter((t) => t.mode !== 'none')
  if (active.length === 0) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exporter.register((writer: any) => ({
    afterParse() {
      const channels: object[] = []
      const samplers: object[] = []

      const addChannel = (peak: number[], scales: boolean[], mode: EmissiveAnimMode, pointer: string) => {
        const sample = mode === 'blink' ? buildBlinkSampler(peak, scales) : buildPulseSampler(peak, scales)
        const input = writer.processAccessor(new THREE.BufferAttribute(sample.times, 1))
        const output = writer.processAccessor(new THREE.BufferAttribute(sample.values, sample.itemSize))
        samplers.push({ input, output, interpolation: sample.interpolation })
        channels.push({
          sampler: samplers.length - 1,
          target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer } } },
        })
      }

      for (const { material, mode } of active) {
        const materialIndex = writer.cache.materials.get(material.uuid)
        if (materialIndex === undefined) continue
        const materialDef = writer.json.materials?.[materialIndex]
        if (!materialDef) continue

        const strengthPeak = materialDef.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1
        addChannel([strengthPeak], [true], mode, `/materials/${materialIndex}/extensions/KHR_materials_emissive_strength/emissiveStrength`)

        materialDef.pbrMetallicRoughness = materialDef.pbrMetallicRoughness || {}
        if (!materialDef.pbrMetallicRoughness.baseColorFactor) materialDef.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]
        const baseColorPeak: number[] = materialDef.pbrMetallicRoughness.baseColorFactor
        addChannel(baseColorPeak, [true, true, true, false], mode, `/materials/${materialIndex}/pbrMetallicRoughness/baseColorFactor`)
      }

      if (channels.length === 0) return
      writer.extensionsUsed['KHR_animation_pointer'] = true
      if (!writer.json.animations) writer.json.animations = []
      writer.json.animations.push({ name: 'EmissiveGlow', channels, samplers })
    },
  }))
}
