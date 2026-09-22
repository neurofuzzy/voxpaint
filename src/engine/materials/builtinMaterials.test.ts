import { describe, expect, it } from 'vitest'
import type { PaletteSlotKind } from '@/engine/palette/types'
import { BUILTIN_MATERIALS, BUILTIN_MATERIAL_BY_ID, CLASS_MATERIAL_IDS, effectiveMaterialClass, isClassMaterialId, slotMaterialKey, type SlotMaterialAssignments } from './builtinMaterials'

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

  it('resolves class-id assignments to their effective class', () => {
    for (const id of CLASS_MATERIAL_IDS) {
      expect(isClassMaterialId(id)).toBe(true)
      expect(effectiveMaterialClass('base' as PaletteSlotKind, 0, { 'base:0': id })).toBe(id)
    }
    expect(isClassMaterialId('cast-iron')).toBe(false)
    expect(isClassMaterialId('unknown-id')).toBe(false)
    // No assignment (or a texture id) → the slot kind's own class.
    expect(effectiveMaterialClass('base' as PaletteSlotKind, 0, {})).toBe('matte')
    expect(effectiveMaterialClass('base' as PaletteSlotKind, 0, { 'base:0': 'cast-iron' })).toBe('matte')
    expect(effectiveMaterialClass('metal' as PaletteSlotKind, 0, {})).toBe('metal')
  })
})
