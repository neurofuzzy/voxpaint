import { describe, expect, it } from 'vitest'
import { isValidSlotRef, materialClassFor, materialParamsFor, PALETTE_SLOT_COUNTS } from './palette'

describe('carpaint material class', () => {
  it('maps the carpaint slot kind to the carpaint material class', () => {
    expect(materialClassFor('carpaint')).toBe('carpaint')
  })

  it('gives carpaint a metallic base coat under a full-strength clearcoat', () => {
    const params = materialParamsFor('carpaint')
    expect(params.metalness).toBeGreaterThanOrEqual(0.8)
    expect(params.metalness).toBeLessThanOrEqual(1)
    expect(params.roughness).toBeGreaterThanOrEqual(0.1)
    expect(params.roughness).toBeLessThanOrEqual(0.3)
    expect(params.clearcoat).toBe(1)
    expect(params.clearcoatRoughness).toBeGreaterThan(0)
    expect(params.transmission).toBe(0)
    expect(params.emissiveIntensity).toBe(0)
  })

  it('keeps every other class clearcoat-free', () => {
    for (const cls of ['matte', 'emissive', 'metal', 'glass'] as const) {
      expect(materialParamsFor(cls).clearcoat).toBe(0)
    }
  })

  it('has 4 carpaint slots (32 slots total)', () => {
    expect(PALETTE_SLOT_COUNTS.carpaint).toBe(4)
    expect(Object.values(PALETTE_SLOT_COUNTS).reduce((a, b) => a + b, 0)).toBe(32)
    expect(isValidSlotRef({ kind: 'carpaint', index: 3 })).toBe(true)
    expect(isValidSlotRef({ kind: 'carpaint', index: 4 })).toBe(false)
  })
})
