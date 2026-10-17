# Plan: flats (zero-thickness quads)

Status: **APPROVED 2026-10-17, implementing.** Written 2026-10-16 while another agent has the
`post` / `quarter` shape kinds uncommitted on `scaling`; this lands **after**
that work is committed, because it touches the same files. Reviewed against the
post/quarter implementation 2026-10-17 (review findings folded in below).

Decisions (human, 2026-10-17):
1. Shape reading confirmed: the wedge diagonal quad (1 × √2, full depth); the
   shelter back runs diagonally so pane continuity holds.
2. Rescale with `flat`s: option (a) — shift into the +normal-side layer as
   `flat`, recorded in the rescale summary.
3. Names: `flat` + `flatwedge`, labels "Flat" / "Flat wedge".

Follow-up (human, 2026-10-17 — implemented same day):
- Flats get their OWN optimization pass and only optimize with flats: the CSG
  path merges flat quads separately from solids (`optimizeGroupsByCSG`
  carries them alongside and welds them post-union), and the textured-merged
  path merges flat faces separately too. Same-facing-only welding in both, so
  panes weld across cells while each flat's opposite-winding pair survives.
  (This caught a real bug: the CSG back-winding clone left vertex 0's normal
  un-negated, which grouped backs with fronts and broke the weld — fixed, with
  winding-balance assertions so it can't regress silently.)
- Flats neither cast nor receive AO: casting was already impossible (chamfer
  cells are absent from the occupancy grid), locked in with a regression test;
  receiving is now explicit too — `bakeAOToAtlas` bakes texels lying on a
  flat's quad plane constant white (glass panes must not catch contact
  shadows). The white test requires all three of: back-off lands in a flat
  cell, texel on the quad plane, normals parallel — so solid faces on cell
  boundaries or continuing the pane's plane keep their shading.

## What the user asked for

> "we'd want a central square like thin voxel but just a quad, and a wedge
> shaped quad. that's it."

Context: a Godot game that loads VoxPaint GLBs needs glass side panels and a
45° glass back on a bus shelter. A modelled panel is a voxel thick, which is
too heavy, so the user wants true planes. **Two shapes, nothing else.**

| kind | what it is | prefab space (`[-0.5, 0.5]^3`, z = outward) |
|---|---|---|
| `flat` | `thin`'s centre plane as a bare quad | the square at `z = 0`, `u, v ∈ [-0.5, 0.5]`, normal +z |
| `flatwedge` | `wedge`'s diagonal cut face as a bare quad | the diagonal through the cell centre, full depth: `b(3), b(1), t(1), t(3)` (NW to SE, `z ∈ [-0.5, 0.5]`), 1 × √2 |

"Wedge shaped quad" is read as the wedge's diagonal face, not a triangle (a
triangle is not a quad). Several of them stepping along the diagonal direction
make a 45° pane, which is the shelter's sloped back — **continuity follows the
diagonal**: the quad spans the prefab NW-SE diagonal, which lands on the world
(1,−1) direction for z-authored cells, so the pane continues in cells stepping
du = −dv (even rotations; odd rotations run the other diagonal family,
du = dv). Stepping along ±u or ±v alone gives a zigzag, not a pane. Confirm
this reading (and that the shelter back runs diagonally) before step 1.

Names: kinds are all-lowercase single words (`ramp`, `post`, `quarter`), so
the kinds are `flat` and `flatwedge` (display labels "Flat" and "Flat wedge").

## Behaviour

- **`flat` paints like `thin`.** It records the plane's axis and orientation,
  rotation 0, and never auto-resolves. Re-clicking spins it 90° about V
  (`spinSlabAboutLocalY`, thin's escape hatch), so one click picks any of the
  three axes. Same stroke-revisit rule as thin (`strokeSlabKeys`).
- **`flatwedge` paints like `wedge`.** Re-clicking advances `rotation`
  (wedge's manual-rotate path). Rotations 0/2 and 1/3 are the same two
  diagonals facing opposite ways; keep all four so texture and front/back
  follow the wedge's existing convention (`rotation` = the open corner).
  It is never resolver-created.
- **Mirrored pools.** `flatM` and `flatwedgeM` through `mirrorVGeometry`, as
  every other shape does, so reflected-plane instances stay det = +1.
- **Rigid transforms (clipboard rotate/mirror, float transforms,
  paste-across-planes).** `flat` joins the slab branch: basis-track-only in
  `chamferTransform.ts`'s `applyMotion`, a `spinSlabAboutLocalY` arm, and
  passthroughs in `transform.ts` (`mirrorClassification`,
  `rotateClassification90`). `flatwedge` gets a 4-corner solid set
  (`b3, b1, t1, t3` — the diagonal's vertical edges) in `SHAPE_CORNERS` for
  exact re-basing, and flows through the corner-table renumbering (do NOT pass
  it through). `clipboard.ts:162` (`transformClipboardToPlane`) is on the prod
  path via `mirrorClassification` — both kinds need arms there. Reface tools
  (`faceBasis.ts`, `rebaseRampCell`) refuse both automatically by falling
  through; update the doc comments only.

## Two-sided, and the traps that come with it

The editor already renders chamfer pools `DoubleSide` (InstancingManager), so
a single quad shows from both sides there with no extra work.

**Export emits both windings**, as two coincident quads with opposite normals.
That way the GLB reads from both sides in any engine, with no reliance on the
glTF `doubleSided` flag (the game's loader ignores material flags).

Two places would currently break a two-sided quad (a third suspected trap
turned out not to be one — see trap 3):

1. **The shell pass deletes it.** `removeInteriorFaces` (run by
   `buildShellFaces`, `voxelMeshBuilder.ts:241-271`, shared by every textured
   export path) drops any two coincident faces with opposing normals, which is
   exactly what a two-sided flat is. Tag flat faces on `Face` (e.g.
   `twoSided: true`, set in `emitChamfer` for these pools) and never pair a
   tagged face. A flat sits at a cell's centre or on its diagonal, so it is
   never coincident with a neighbour's face; the only pair to protect is its
   own. Verify the textured-merged path (`buildTexturedShellGeometryByColorMerged`)
   shares this pass — if it has its own shell logic, tag there too. (Its
   coplanar merge keys on the box-face tag with same-facing-only merging, so
   both windings survive it once the shell pass lets them through.)
2. **The CSG union assumes closed solids.** `optimizeGroupsByCSG` feeds every
   group geometry to ThreeBSP (`meshOptimizer.ts:90-135`). An open quad there
   is undefined behaviour — and this path serves the 3D preview
   (`csgUnionGroups`) as well as export, so the fix must live inside
   `optimizeGroupsByCSG`, not in an export wrapper. Route flat faces around
   the union: collect them separately per material group, and append them to
   the group's output after the union and before the coplanar merge (which is
   same-facing-only, so the pair survives and same-facing neighbours still
   weld).
3. **Occupancy and AO: NOT a trap (verified 2026-10-17).** `isCellOccupied`
   (`voxelMeshBuilder.ts:288-292`) already returns false for *every* resolved
   chamfer cell, so a resolved flat counts as empty for
   `removeOccludedGlassFaces` with no change. The live AO bake
   (`bakeAO.ts:135-136`) already skips all chamfer cells in its occupancy
   grid, and `computeVoxelAO` (`voxelAO.ts:78`) has no production caller
   (tests only). Expect zero implementation here; keep an AO test as a guard
   (a flat's neighbours' AO equals the empty-cell AO).

**Do not "fix" the pair later.** The codebase once deliberately eliminated
coincident opposite-normal quads (`cullCoincidentOpaqueInterfaces`) because
they z-fight in some engines. Flats reintroduce the pattern on purpose, and it
is safe as long as `gltfExport` writes **single-sided** materials: with face
culling, exactly one winding renders per viewpoint, so standard viewers show
no fighting, and the game's shader derives each face's normal toward the
viewer. State this in `gltf-export-contract.md`, and check sidedness during
implementation — `doubleSided: true` would reintroduce the fight outside
Godot.

## Textures and AO bake

- `boxMapping.ts`: a `flat` takes the authoring page (as thin's front face
  does); a `flatwedge` takes the authoring page (as every wedge face does).
  Both windings share the same texels via the position-based UV projection:
  the back face reads them mirrored, so painted art reads correctly from the
  front and mirrored from behind. No call-site changes.
- `uvUnwrap.ts` (AO bake) operates on baked geometries, not the model, so
  flat quads flow through it generically — but as *separate* atlas rects (the
  two windings are disconnected components; don't promise one shared rect,
  just accept 2× atlas space). A flat gets no occlusion of its own (it is not
  solid). Open point: check what `bakeAO`'s receiver loop does with chamfer
  cells — if flats receive no AO attribute at all, the exporter/shader path
  must default to white, not black.

## Rescale (`grid/rescale.ts`)

- **×2 `flatwedge`:** the diagonal of the doubled block becomes `flatwedge`
  in the new cells on that diagonal (2 of the 4 in each W layer — 4 children
  total), same rotation, verbatim basis. Exact.
- **×2 `flat`:** the centre plane of a doubled cell lies on the boundary
  between two new layers, where no cell centre is — no exact representation
  exists. Three options, user picks: (a) shift into the +normal-side layer as
  `flat` (moves the pane half a new voxel — a quarter of an old one — and
  record that in the rescale summary); (b) double-pane (one `flat` in each
  layer — two parallel panes, changes the look); (c) refuse to rescale a
  model containing flats.
- Both flats have volume 0: extend the volume-conservation test map (holds
  trivially) rather than skipping them.
- There is no voxel downscale path (only texture downscaling and
  out-of-bounds deletion on shrink), so nothing to do there.

## STL

A zero-thickness quad is not printable. `stlExport` skips flats (log the
count). Filter flat cells out of the model copy *before* the group build —
post-union groups have lost shape identity, so they can't be filtered after.
(`stlExport.ts` builds via `buildOptimizedVoxelGeometryByMaterial`.)

## Persistence

New shape kinds need a schema-version stamp so older apps reject newer files
instead of crashing in the render pools — the `half` precedent is the v9→v10
migration (`migrations.ts:78-81`, reshape-free). Add v10→v11 the same way.
(Note: post/quarter did not stamp — still at v10 — consider whether they
should have before this lands on top.)

## Files (all touched by the in-flight post/quarter work too)

`engine/chamfer/chamferGeometry.ts` (two geometry functions),
`engine/grid/types.ts` (`ChamferShapeKind`), `store/types.ts` (`VoxelKind`),
`engine/instancing/pools.ts`, `voxelMeshBuilder.ts` (pools, base table, the
`twoSided` tag, the shell-pass exemption) and `InstancingManager.ts`
(`Record<PoolId, number>` capacities — required, tsc enforces it),
`engine/instancing/meshOptimizer.ts` (the CSG bypass),
`engine/chamfer/chamferTransform.ts` + `engine/tools/transform.ts` +
`engine/tools/clipboard.ts` (transform arms),
`store/paintActions.ts` (two branches), `engine/texture/boxMapping.ts`
(authoring page for both — small), `engine/grid/rescale.ts`,
`engine/export/stlExport.ts` (pre-build filter + count log),
`engine/persistence/migrations.ts` + `schema.ts` (v11 stamp),
`components/panels/LayerToggle.tsx` (7 → 9 entries) and
`voxelKindIcons.tsx` plus two icons (`src/assets/flat.svg`,
`flatwedge.svg`, same isometric language as thin/half/post/quarter).
Test records that tsc keeps honest: `chamferResolver.test.ts` `SHAPE_LETTER`,
`rescale.test.ts` volume map.
Docs: `gltf-export-contract.md` (flats export as two opposite-wound
coincident quads; materials MUST stay single-sided — see above),
`ARCHITECTURE.md`, and `npm run map`.

## Steps

1. **Geometry and pools.** Both functions plus mirrors in the pool and base
   tables, plus `InstancingManager` capacities. Vitest: one quad each
   (2 triangles), the expected corners, normal +z / the diagonal's normal,
   `mirrorVGeometry` det.
2. **Paint + transforms.** The two branches, spin and rotate, stroke
   revisits; slab-branch vs corner-set arms; clipboard round-trips. Vitest on
   `paintActions` as thin's and wedge's are tested, plus
   `chamferTransform` round-trip/parity over the new kinds.
3. **Export.** The `twoSided` tag, shell-pass exemption, CSG bypass (inside
   `optimizeGroupsByCSG`), single-sided-material check. Vitest: a flat
   alone exports 4 triangles in 2 opposite pairs; a flat between two cubes
   leaves both cubes' faces intact; a glass cube behind a flat keeps its
   face; a flat's neighbours' AO matches the empty-cell AO (guard — expect
   no implementation).
4. **Textures, AO bake, rescale, STL, migration stamp.** As above, each with
   a test. AO-bake item is the receiver-loop default (white, not black).
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
