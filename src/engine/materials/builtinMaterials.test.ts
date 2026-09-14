import { describe, expect, it } from 'vitest'
import { BUILTIN_MATERIALS, BUILTIN_MATERIAL_BY_ID, slotMaterialKey, type SlotMaterialAssignments } from './builtinMaterials'

describe('builtin material manifest', () => {
  it('has unique ids that resolve through the lookup', () => {
    const ids = BUILTIN_MATERIALS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of BUILTIN_MATERIALS) {
      expect(BUILTIN_MATERIAL_BY_ID[m.id]).toBe(m)
    }
  })

  it('declares at least one map plus a thumbnail per material', () => {
    expect(BUILTIN_MATERIALS.length).toBeGreaterThan(0)
    for (const m of BUILTIN_MATERIALS) {
      const maps = [m.files.albedo, m.files.roughness, m.files.metallic].filter((f): f is string => !!f)
      expect(maps.length, `${m.id}: no maps`).toBeGreaterThan(0)
      expect(m.thumb, `${m.id}: no thumbnail`).toMatch(/\.jpg$/)
      for (const f of [...maps, m.thumb]) {
        expect(f.startsWith('materials/'), `${m.id}: ${f}`).toBe(true)
      }
    }
  })

  it('keys slots as "<kind>:<index>"', () => {
    expect(slotMaterialKey('base', 0)).toBe('base:0')
    const assignments: SlotMaterialAssignments = { [slotMaterialKey('metal', 1)]: 'copper-brushed' }
    expect(assignments['metal:1']).toBe('copper-brushed')
  })
})
