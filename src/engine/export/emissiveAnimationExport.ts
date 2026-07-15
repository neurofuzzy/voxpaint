import * as THREE from 'three'
import type { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { EmissiveAnimMode } from '@/engine/palette/types'
import { EMISSIVE_ANIM_CYCLE_SECONDS } from '@/engine/palette/emissiveAnimation'

export type EmissiveAnimExportTarget = { material: THREE.Material; mode: EmissiveAnimMode }

type ScalarSampler = { times: Float32Array; values: Float32Array; interpolation: 'STEP' | 'CUBICSPLINE' }

function buildBlinkSampler(peak: number): ScalarSampler {
  // Hard on/off: two states per cycle, STEP interpolation holds each value until the next keyframe.
  // The trailing keyframe (equal to the first) exists only for a byte-for-byte inspectable JSON —
  // playback loops back to t=0 immediately after t=duration regardless.
  const times = new Float32Array([0, EMISSIVE_ANIM_CYCLE_SECONDS / 2, EMISSIVE_ANIM_CYCLE_SECONDS])
  const values = new Float32Array([peak, 0, peak])
  return { times, values, interpolation: 'STEP' }
}

function buildPulseSampler(peak: number): ScalarSampler {
  // Raised-cosine "breathing" curve: value(t) = peak · (1 − cos(ωt)) / 2 — zero derivative at both
  // the trough (t=0) and peak (t=T/2), so a CUBICSPLINE loop has no visible seam. Same analytic-
  // tangent technique as buildTranslationClip in animationGLTF.ts, adapted to a scalar output.
  // CUBICSPLINE keyframes are laid out as [inTangent, value, outTangent] triples (glTF spec appx C).
  const omega = (2 * Math.PI) / EMISSIVE_ANIM_CYCLE_SECONDS
  const sampleTimes = [0, EMISSIVE_ANIM_CYCLE_SECONDS / 4, EMISSIVE_ANIM_CYCLE_SECONDS / 2, (EMISSIVE_ANIM_CYCLE_SECONDS * 3) / 4, EMISSIVE_ANIM_CYCLE_SECONDS]
  const times = new Float32Array(sampleTimes)
  const values = new Float32Array(sampleTimes.length * 3)
  sampleTimes.forEach((t, i) => {
    const value = (peak * (1 - Math.cos(omega * t))) / 2
    const tangent = (peak * omega * Math.sin(omega * t)) / 2
    values[i * 3 + 0] = tangent
    values[i * 3 + 1] = value
    values[i * 3 + 2] = tangent
  })
  return { times, values, interpolation: 'CUBICSPLINE' }
}

/**
 * Registers a `GLTFExporter` plugin that bakes each flagged material's emissive blink/pulse into the
 * exported glTF via `KHR_animation_pointer`, targeting
 * `/materials/{n}/extensions/KHR_materials_emissive_strength/emissiveStrength`.
 *
 * glTF's core animation channels can only target a node's TRS/morph weights — there's no channel type
 * for material properties — so `three`'s `GLTFExporter` (as of r185) has no built-in support for this,
 * and `processAnimation`'s track-name parsing can't be reused (it resolves tracks to nodes via
 * `PropertyBinding`, which materials aren't part of). Instead this hooks `afterParse`, which runs after
 * every material has been written (so `writer.cache.materials` — keyed by `material.uuid`, the same key
 * `processMaterialAsync` caches under — already holds each material's final index) but before the
 * exporter serializes its buffer, so accessors created here via `writer.processAccessor` still land in
 * the output. The scalar strength target (rather than animating `emissiveFactor` directly) piggybacks on
 * `KHR_materials_emissive_strength`, which the exporter already writes by default whenever
 * `emissiveIntensity !== 1` — true for every emissive-class material here (`materialParamsFor('emissive')`
 * sets 1.5) — so no extra per-material setup is needed beyond that existing default.
 */
export function registerEmissiveAnimationExtension(exporter: GLTFExporter, targets: EmissiveAnimExportTarget[]): void {
  const active = targets.filter((t) => t.mode !== 'none')
  if (active.length === 0) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exporter.register((writer: any) => ({
    afterParse() {
      const channels: object[] = []
      const samplers: object[] = []

      for (const { material, mode } of active) {
        const materialIndex = writer.cache.materials.get(material.uuid)
        if (materialIndex === undefined) continue
        const materialDef = writer.json.materials?.[materialIndex]
        const peak: number = materialDef?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1
        const sample = mode === 'blink' ? buildBlinkSampler(peak) : buildPulseSampler(peak)

        const input = writer.processAccessor(new THREE.BufferAttribute(sample.times, 1))
        const output = writer.processAccessor(new THREE.BufferAttribute(sample.values, 1))
        samplers.push({ input, output, interpolation: sample.interpolation })
        channels.push({
          sampler: samplers.length - 1,
          target: {
            path: 'pointer',
            extensions: {
              KHR_animation_pointer: { pointer: `/materials/${materialIndex}/extensions/KHR_materials_emissive_strength/emissiveStrength` },
            },
          },
        })
      }

      if (channels.length === 0) return
      writer.extensionsUsed['KHR_animation_pointer'] = true
      if (!writer.json.animations) writer.json.animations = []
      writer.json.animations.push({ name: 'EmissiveGlow', channels, samplers })
    },
  }))
}
