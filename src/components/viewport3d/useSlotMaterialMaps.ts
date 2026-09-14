import { useEffect, useState } from 'react'
import { BUILTIN_MATERIAL_BY_ID } from '@/engine/materials/builtinMaterials'
import { loadMaterialMaps, type SlotMaterialMaps } from '@/engine/materials/materialMaps'
import { showToast } from '@/components/ui/toastBus'

/**
 * Resolves a set of builtin material ids to their GPU map sets (loaded once per
 * material+faceSize, then cached session-wide). Missing/failed ids resolve to nothing —
 * the group falls back to its plain class recipe. Failed loads toast once per id.
 */
export function useSlotMaterialMaps(materialIds: readonly string[], faceSize: number): Map<string, SlotMaterialMaps> {
  const [maps, setMaps] = useState<Map<string, SlotMaterialMaps>>(new Map())
  const key = [...materialIds].sort().join(',')

  useEffect(() => {
    let cancelled = false
    const ids = [...new Set(materialIds)].filter((id) => BUILTIN_MATERIAL_BY_ID[id])
    if (ids.length === 0) {
      setMaps(new Map())
      return
    }
    Promise.all(
      ids.map((id) =>
        loadMaterialMaps(BUILTIN_MATERIAL_BY_ID[id], faceSize)
          .then((m): [string, SlotMaterialMaps] => [id, m])
          .catch(() => {
            showToast(`Could not load material "${BUILTIN_MATERIAL_BY_ID[id].name}" — using plain color.`)
            return null
          }),
      ),
    ).then((entries) => {
      if (cancelled) return
      const next = new Map<string, SlotMaterialMaps>()
      for (const e of entries) if (e) next.set(e[0], e[1])
      setMaps(next)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, faceSize])

  return maps
}
