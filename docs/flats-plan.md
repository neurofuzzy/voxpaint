# Plan: flats (zero-thickness quads)

Status: **DRAFT, not started.** Written 2026-10-16 while another agent has the
`post` / `quarter` shape kinds uncommitted on `scaling`; this lands **after**
that work is committed, because it touches the same files.

## What the user asked for

> "we'd want a central square like thin voxel but just a quad, and a wedge
> shaped quad. that's it."

Context: a Godot game that loads VoxPaint GLBs needs glass side panels and a
45° glass back on a bus shelter. A modelled panel is a voxel thick, which is
too heavy, so the user wants true planes. **Two shapes, nothing else.**

| kind | what it is | prefab space (`[-0.5, 0.5]^3`, z = outward) |
|---|---|---|
| `flat` | `thin`'s centre plane as a bare quad | the square at `z = 0`, `u, v ∈ [-0.5, 0.5]`, normal +z |
| `flatWedge` | `wedge`'s diagonal cut face as a bare quad | the diagonal through the cell centre, full depth: `b(3), b(1), t(1), t(3)` (NW to SE, `z ∈ [-0.5, 0.5]`), 1 × √2 |

"Wedge shaped quad" is read as the wedge's diagonal face, not a triangle (a
triangle is not a quad). Several of them in a row make a 45° pane, which is the
shelter's sloped back. Confirm this reading before step 1.

Names (`flat`, `flatWedge`) are open. Shape kinds today are single words
(`ramp`, `post`, `quarter`).

## Behaviour

- **`flat` paints like `thin`.** It records the plane's axis and orientation,
  rotation 0, and never auto-resolves. Re-clicking spins it 90° about V
  (`spinSlabAboutLocalY`, thin's escape hatch), so one click picks any of the
  three axes. Same stroke-revisit rule as thin (`strokeSlabKeys`).
- **`flatWedge` paints like `wedge`.** Re-clicking advances `rotation`
  (wedge's manual-rotate path). Rotations 0/2 and 1/3 are the same two
  diagonals facing opposite ways; keep all four so texture and front/back
  follow the wedge's existing convention (`rotation` = the open corner).
  It is never resolver-created.
- **Mirrored pools.** `flatM` and `flatWedgeM` through `mirrorVGeometry`, as
  every other shape does, so reflected-plane instances stay det = +1.

## Two-sided, and the traps that come with it

The editor already renders chamfer pools `DoubleSide` (InstancingManager), so
a single quad shows from both sides there with no extra work.

**Export emits both windings**, as two coincident quads with opposite normals.
That way the GLB reads from both sides in any engine, with no reliance on the
glTF `doubleSided` flag (the game's loader ignores material flags).

Three places would currently break a two-sided quad:

1. **The shell pass deletes it.** `removeInteriorFaces` drops any two
   coincident faces with opposing normals, which is exactly what a two-sided
   flat is. Tag flat faces on `Face` (e.g. `twoSided: true`, set in
   `emitChamfer` for these pools) and never pair a tagged face. A flat sits
   at a cell's centre or on its diagonal, so it is never coincident with a
   neighbour's face; the only pair to protect is its own.
2. **The CSG union assumes closed solids.** `optimizeGroupsByCSG` feeds every
   group geometry to ThreeBSP. An open quad there is undefined behaviour.
   Route flat faces around the union: collect them separately per material
   group, and append them to the group's output after the union and before
   the coplanar merge (merge only like-facing faces, as now).
3. **Occupancy says "solid".** AO (`voxelAO.ts` takes `cubes` = every
   coordinate of `model.color`) and the glass-occlusion strip
   (`isOccupied` → `removeOccludedGlassFaces`) both count a painted cell as a
   cube. A flat must count as **empty** for both, or it darkens its
   neighbours' AO and cuts the glass faces behind it.

## Textures and AO bake

- `boxMapping.ts`: a `flat` takes the mapping of the cell face it faces (as
  thin's front face does); `flatWedge` takes the wedge diagonal face's
  mapping. Both windings share the same texels: the back face mirrors them,
  so painted art reads correctly from the front and mirrored from behind.
- `uvUnwrap.ts` (AO bake): one atlas rect per flat, shared by both faces.
  A flat gets no occlusion of its own (it is not solid), so its AO can be
  constant. Check that it doesn't come out black.

## Rescale (`grid/rescale.ts`)

- **×2 `flatWedge`:** the diagonal of the 2×2 (×2 in depth) block becomes
  `flatWedge` in the new cells on that diagonal (2 of the 4 in each layer),
  same rotation. Exact.
- **×2 `flat`:** the centre plane of a doubled cell lies on the boundary
  between two new layers, where no cell centre is. Put it in the layer on the
  +normal side as `flat` (it moves half a new voxel, a quarter of an old one),
  and record that in the rescale summary. The alternative is refusing to
  rescale a model with flats; the user picks.
- Down-scales follow whatever thin does today.

## STL

A zero-thickness quad is not printable. `stlExport` skips flats (log the
count), as it would any non-manifold piece.

## Files (all touched by the in-flight post/quarter work too)

`engine/chamfer/chamferGeometry.ts` (two geometry functions),
`engine/grid/types.ts` (`ChamferShapeKind`), `store/types.ts` (`VoxelKind`),
`engine/instancing/pools.ts` and `voxelMeshBuilder.ts` (pools, base table,
the `twoSided` tag, the shell-pass exemption, the CSG bypass),
`engine/instancing/meshOptimizer.ts` (the bypass), `store/paintActions.ts`
(two branches), `engine/ao/voxelAO.ts` and the glass `isOccupied` (not solid),
`engine/texture/boxMapping.ts`, `engine/grid/rescale.ts`,
`engine/export/stlExport.ts`, `components/panels/LayerToggle.tsx` and
`voxelKindIcons.tsx` plus two icons (`src/assets/flat.svg`,
`flatwedge.svg`). Docs: `gltf-export-contract.md` (flats export as two
opposite-wound coincident quads), `ARCHITECTURE.md`, and `npm run map`.

## Steps

1. **Geometry and pools.** Both functions plus mirrors in the pool and base
   tables. Vitest: one quad each (2 triangles), the expected corners, normal
   +z / the diagonal's normal, `mirrorVGeometry` det.
2. **Paint.** The two branches, spin and rotate, stroke revisits. Vitest on
   `paintActions` as thin's and wedge's are tested.
3. **Export.** The `twoSided` tag, shell-pass exemption, CSG bypass,
   occupancy (AO and glass) treating flats as empty. Vitest: a flat
   alone exports 4 triangles in 2 opposite pairs; a flat between two cubes
   leaves both cubes' faces intact; a glass cube behind a flat keeps its face;
   a flat's neighbours' AO matches the empty-cell AO.
4. **Textures, AO bake, rescale, STL.** As above, each with a test.
5. **UI.** Kind picker entries, icons, hints ("Flat: a bare square through the
   middle of the voxel, re-click to turn it"; "Flat wedge: a bare diagonal
   pane, re-click to turn it").

The human browser-tests; agents do not (CLAUDE.md).

## On the game side (not this repo)

The Godot loader (`bright-lanes-big-city`, `GlbKit.glb_assets`) draws every
non-emissive mesh opaque and ignores `KHR_materials_transmission`. Flats
need nothing there: both windings export, and the game's GLB shader derives
each face's normal toward the viewer. **Glass** flats need a see-through
material keyed on the mesh name, the way emissive is. That's a small, separate
change in the game, once a model with glass flats exists.
