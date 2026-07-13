# Handoff — AO rework (next session)

> Replaces an older handoff about a since-resolved instance-color bug (see git history if needed).

## Where we are
The Palette-Based PBR pipeline, ≤4 material-class meshes, material-aware shell culling, export
options modal, and the analytical voxel AO are all landed and documented (see `docs/ARCHITECTURE.md`
and the 2026-07-12 entry in `docs/SESSION_NOTES.md`). Everything compiles: `tsc -b` + `oxlint` clean,
132 tests pass, `vite build` succeeds. Work is uncommitted on `develop`.

**The one open problem: ambient occlusion still looks wrong.** It's currently **off by default** in
both the viewport toggle (`ViewOptionsOverlay`) and the GLTF export modal (`ExportGltfDialog`), so it's
safely parked. The next session's job is to replace the AO implementation.

## Why the current AO is wrong
Current approach (`src/engine/ao/bakeAO.ts` → `bakeAOAtlas`) bakes AO into a **2D box-map atlas** at
`TEXEL_SCALE` resolution and applies it as a `MeshPhysicalMaterial.map` multiply. The box atlas has an
inherent **depth ambiguity**: stacked/overhang surfaces sharing a face-column collapse to one
"frontmost" AO value, so hidden/overlapping surfaces get the wrong shadow. Same limitation the paint
atlas has, and it's the root of the "very wrong" shadows.

## The fix: 3D occupancy field sampled per-fragment in the shader
Reference code (from the `zanpo` project, `/Users/geoff/dev/zanpo`, the `getOcclusionFactor` shader)
samples a **3D occupancy texture in world space per fragment** and averages occupancy over the
hemisphere facing the surface normal. That is depth-correct (each fragment reads its true 3D position),
needs no UVs, and is immune to mesh merging — it directly fixes our problem. It's the "3D occlusion
field sampled in-shader" alternative already noted in `docs/ARCHITECTURE.md`'s AO limitations.

### Reference behavior (zanpo `getOcclusionFactor`)
- Samples `occupancyTexture` (a 48³ = 16-grid × 3 `Data3DTexture`) at `worldPos / gridSize`.
- Offsets into the hemisphere along the world normal, samples a 3×3 tangent grid, distance-weighted.
- Clamps the offset on the normal axis to the face edge; keeps the tangent gradient smooth.

### TAKE
- The **3D occupancy `Data3DTexture`** + **shader-sampled hemisphere occlusion** (binary occupancy,
  distance-weighted neighbor average — simpler and more robust than our analytical falloff).

### DROP from the reference
- All `worldOffset` / instance-rotation math (`gridPos`, `aoLocalOffset`, "account for instance
  rotation"). That's for their *instanced, rotatable* voxels. Our optimized mesh is a **static merged
  mesh**, so just use a `vWorldPosition` varying directly — much simpler.
- Their 3× texture resolution is a choice; we can use grid res or `TEXEL_SCALE` (4×). Start simple.

## Migration plan (≈ half a day)
1. **Replace `bakeAOAtlas`** with `bakeOccupancyField(model): THREE.Data3DTexture` in
   `src/engine/ao/bakeAO.ts` — one byte per cell, `1` = occupied (from `model.color` via `encodeKey`).
   Fast and trivial. (`computeVoxelAO`/`voxelAO.ts` may become unused since the shader does the
   occlusion math — decide whether to retire it then.)
2. **Plumb it into the optimized-mesh materials** in `OptimizedMeshView.tsx`: set the occupancy texture
   + grid-size uniforms, and add a `vWorldPosition` varying via `onBeforeCompile`. (We already patch
   these materials for the emissive glow, so the `onBeforeCompile` pattern is established there.)
3. **Fragment patch**: sample the hemisphere around `vWorldPosition` + geometric normal, compute the
   occlusion factor, multiply it into `diffuseColor` (or fold into ambient). Replaces the current
   `material.map`-based AO application.
4. **Keep** the `ambientOcclusion` view-slice toggle and the export-modal option — just swap the
   implementation behind them. Note the two AO tracks below are **separate**: the 3D-field shader fixes
   the *preview*; a real UV unwrap is what makes *export* correct.

## Two separate AO tracks — don't conflate them
- **Preview** → 3D occupancy field sampled in-shader (above). No UVs, depth-correct, disposable per
  frame. This is the quick win. **NOT glTF-compatible** — glTF is declarative PBR with no per-fragment
  3D-volume sampling, and GLTFExporter ignores `onBeforeCompile`, so this produces nothing in the `.glb`.
- **Export** → must produce a real **AO texture on `TEXCOORD_1`** (glTF `occlusionTexture` / three's
  `aoMap`). The current box-map atlas is overlapping/depth-ambiguous, so **the model needs a proper
  non-overlapping UV unwrap** first.

### Decision — DECIDED: bake AO (and grime) into the export
We **do** want a baked map in the exported glTF, so the UV-unwrap + baked texture (below) is the
committed path. It is not preview-only. The 3D-field shader is still worth doing for live preview, but
it must reuse the **same occupancy sampling** as the bake so preview == export.

The baked atlas is an **AO + grime** map, not just AO:
- **AO** = the occupancy-hemisphere occlusion (darker in crevices / under overhangs).
- **Grime** = procedural weathering derived from the same geometry: more dirt in cavities (AO-driven),
  plus orientation terms (dust on up-faces, streaks/drips on down-faces) and optionally world height.
  Same unwrap, same per-texel loop — just add the grime term when writing each texel.
- **Channel caveat:** glTF `occlusionTexture` only attenuates *indirect/ambient* light. If AO should
  read that way, put AO in the occlusion (R) channel. Grime that must **dirty the albedo under all
  lighting** belongs multiplied into the **baseColorTexture** instead — so consider baking a combined
  baseColor map (baseColor × grime) on TEXCOORD_0 and pure AO on the occlusion map (TEXCOORD_1), rather
  than forcing both into one channel. Decide based on how strong/lighting-independent grime should look.

## Export baking plan (UV unwrap → AO texture → TEXCOORD_1)
This is what the gltf-materials spec's §2.2 actually wants (`TEXCOORD_1` = a strict, non-overlapping
0–1 unwrap dedicated to baked AO).
1. **Unwrap the optimized mesh** into a non-overlapping atlas. The geometry is axis-aligned voxel
   quads (merged coplanar rectangles), so this is a rectangle-packing / lightmap-style unwrap:
   pack each surviving optimized quad into the atlas at a chosen texel density, no overlaps. (Roll our
   own rect-packer over the quads, or evaluate a lib like `xatlas`/`potpack` — the quads are simple
   rectangles so a hand-rolled packer is very feasible.)
2. **Write those UVs as the second UV set** (`geometry.setAttribute('uv1', …)`; three's `aoMap` reads
   `uv1`). Keep the existing box-map `uv` (TEXCOORD_0) for the paint/overlay map.
3. **Bake AO into the atlas**: for each atlas texel, map back to its world-space surface point + normal
   (from the unwrap) and evaluate occlusion — reuse the **same 3D occupancy sampling** as the preview
   (or `computeVoxelAO`) so preview == export. Write grayscale AO into the atlas (R channel; G/B free
   for a packed ORM map later, per the spec).
4. **Assign on export** (`gltfExport.ts`): `material.aoMap = <baked atlas>`, `aoMap` uses `uv1` →
   GLTFExporter emits `TEXCOORD_1` + `occlusionTexture`. Gate on the export-modal `ambientOcclusion`
   option.

Interim fallback if the unwrap is too much for one session: bake **per-vertex AO into `COLOR_0`**
(coarse, but exports and needs no unwrap) and keep the real TEXCOORD_1 unwrap as the follow-up.

## Gotchas
- **World position isn't available by default** in `MeshPhysicalMaterial`. Add a `vWorldPosition`
  varying yourself (vertex patch: `vWorldPosition = (modelMatrix * vec4(position,1.0)).xyz;`). This is
  the only real plumbing wrinkle.
- **`varying vec4 vColor`** — three declares vertex colours as vec4 even for RGB; use `.rgb` in any
  patch. (This already bit us: a bare `vColor` is a `vec3 += vec4` error that silently drops the whole
  mesh — see the emissive patch in `OptimizedMeshView.tsx`.)
- `Data3DTexture` needs `NearestFilter` (or linear for smoothing), `unpackAlignment = 1` for a
  single-channel R8 texture, and `needsUpdate = true`.

## Files in play
- `src/engine/ao/bakeAO.ts` — replace atlas bake with occupancy field.
- `src/engine/ao/voxelAO.ts` / `aoConstants.ts` — analytical solver + tunables (may retire).
- `src/components/viewport3d/OptimizedMeshView.tsx` — material plumbing + shader patch.
- `src/components/viewport3d/ViewOptionsOverlay.tsx` — AO toggle (keep).
- `src/components/panels/ExportGltfDialog.tsx` + `src/engine/export/gltfExport.ts` — export AO option.
- Reference: `/Users/geoff/dev/zanpo` (the `getOcclusionFactor` shader).
