/**
 * Built-in PBR surface materials: curated texture sets vendored from the AMD GPUOpen
 * MaterialX Library (see `public/materials/NOTICE.md` for provenance and licensing).
 *
 * A palette slot may reference one of these by id (`slotMaterials` in the project store).
 * Maps are stretched whole-face over the existing box-map UVs and tinted by the slot's own
 * color (`map × color` multiply) — the palette stays meaningful, the maps add micro-surface
 * truth (mostly roughness variation). Scalar `roughness`/`metalness` apply only when the
 * matching map is absent; when a map is present the scalar is pinned to 1.0 so the map
 * reads as authored.
 *
 * Glass slots ignore materials entirely (same rule as the painted overlay — transmissive
 * materials keep their solid tint for viewer compatibility).
 */
export type BuiltinMaterialDef = {
  id: string
  name: string
  /** Relative to the app base (`import.meta.env.BASE_URL`). */
  files: {
    albedo?: string
    roughness?: string
    metallic?: string
  }
  thumb: string
  /** Scalar fallbacks when the matching map is absent. */
  roughness?: number
  metalness?: number
}

const mat = (
  id: string,
  name: string,
  files: BuiltinMaterialDef['files'],
  scalars: { roughness?: number; metalness?: number } = {},
): BuiltinMaterialDef => ({
  id,
  name,
  files,
  thumb: `materials/${id}/thumb.jpg`,
  ...scalars,
})

const dir = (id: string, which: { albedo?: boolean; roughness?: boolean; metallic?: boolean }) => {
  const out: BuiltinMaterialDef['files'] = {}
  if (which.albedo) out.albedo = `materials/${id}/albedo.png`
  if (which.roughness) out.roughness = `materials/${id}/roughness.png`
  if (which.metallic) out.metallic = `materials/${id}/metallic.png`
  return out
}

export const BUILTIN_MATERIALS: BuiltinMaterialDef[] = [
  mat('stainless-steel-brushed', 'Brushed Steel', dir('stainless-steel-brushed', { albedo: true, roughness: true }), { metalness: 1 }),
  mat('aluminum-brushed', 'Brushed Aluminum', dir('aluminum-brushed', { albedo: true, roughness: true }), { metalness: 1 }),
  mat('copper-brushed', 'Brushed Copper', dir('copper-brushed', { albedo: true, roughness: true }), { metalness: 1 }),
  mat('brass-brushed', 'Brushed Brass', dir('brass-brushed', { albedo: true, roughness: true }), { metalness: 1 }),
  mat('cast-iron', 'Cast Iron', dir('cast-iron', { albedo: true, roughness: true, metallic: true })),
  mat('concrete-plain', 'Concrete', dir('concrete-plain', { albedo: true, roughness: true }), { metalness: 0 }),
  mat('asphalt', 'Asphalt', dir('asphalt', { albedo: true, roughness: true }), { metalness: 0 }),
  mat('leather-brown', 'Leather', dir('leather-brown', { albedo: true, roughness: true }), { metalness: 0 }),
  mat('oak-pale', 'Pale Oak', dir('oak-pale', { albedo: true }), { roughness: 0.55, metalness: 0 }),
]

export const BUILTIN_MATERIAL_BY_ID: Record<string, BuiltinMaterialDef> = Object.fromEntries(
  BUILTIN_MATERIALS.map((m) => [m.id, m]),
)

/** `"<kind>:<index>"` key under which a slot's material assignment is stored. */
export function slotMaterialKey(kind: string, index: number): string {
  return `${kind}:${index}`
}

/** Per-slot builtin-material assignments: slot key → material id. Absent key (or unknown id)
 * means "no material" — the slot renders with its plain class recipe. */
export type SlotMaterialAssignments = Record<string, string>
