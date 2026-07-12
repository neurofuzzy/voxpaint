# VoxPaint — Architecture

This describes the codebase **as implemented**, not as originally proposed. See `SPEC.md` for the
original product/technical spec; the [Deviations from SPEC.md](#deviations-from-specmd) section
at the bottom tracks where the two have diverged. For a flat list of every exported symbol per
file, see `CODEMAP.md` (regenerate with `npm run map`).

## Layering

Three strict layers, enforced by convention (not a lint rule):

- **`src/engine/`** — pure logic, no React/JSX, no store imports. Grid data, plane math, chamfer
  classification, instancing, persistence, tools. Framework-agnostic and unit-testable in
  isolation; tool modules in particular never import the Zustand store directly (`engine/tools/types.ts`'s
  `ToolContext`) so they stay store-agnostic.
- **`src/store/`** — Zustand + Immer. One root store (`store/useAppStore.ts`) composed from typed
  slices (`store/*Slice.ts`). All mutation goes through slice actions; components never mutate
  engine data directly.
- **`src/components/`** — thin React components. Read store slices, forward events into engine
  modules or store actions, render. No business logic lives in `.tsx` files.

`@/` is a path alias for `src/`. `verbatimModuleSyntax` is on, so all type-only imports use
`import type`.

---

## Data model

### VoxelModel

`engine/grid/types.ts` defines the core shape:

```ts
type VoxelModel = {
  color: Map<CellKey, ColorCell>      // every painted cell, chamfered or not
  chamfer: Map<CellKey, ChamferCell>  // subset of `color`'s keys that are chamfered
  bounds: BBox | null                 // recomputed incrementally as cells are added/removed
}
```

- `CellKey` is the string `"x,y,z"` (`engine/grid/GridStore.ts`'s `encodeKey`/`decodeKey`).
- A chamfer cell **always** has a matching color cell — chamfer paint writes both layers in one
  gesture (`store/paintActions.ts`'s `paintChamferCell`).
- `VoxelModel` is treated as immutable outside Immer producers even though it's built on mutable
  `Map`s (not `ReadonlyMap`) — `InstancingManager.sync()` and the 2D canvas both diff on reference
  equality (`model === lastSyncedModel`), so accidental in-place mutation would silently break
  change detection.

### Grid bounds — two different constants

`engine/grid/GridStore.ts` defines both, and they mean different things:

- `MAX_GRID_EXTENT = 64` — the absolute technical ceiling from `SPEC.md` §1.1. Not itself enforced
  today; reserved for a future per-project sizing feature ("project options").
- `DEFAULT_GRID_EXTENT = 16` — the actual enforced/displayed working span for all projects today.
  `withinWorkingBounds(coord)` checks against this: an absolute box **centered on the origin**
  (`-half <= c < half` per axis), not a sliding growth cap. Every paint/paste/clone/flood-fill path
  calls this before writing a cell. The 2D canvas's visible span (`components/editor2d/canvasConstants.ts`'s
  `GRID_SPAN`) and the 3D construction-plane grid (`components/viewport3d/ConstructionPlaneVisual.tsx`)
  both derive from `DEFAULT_GRID_EXTENT`, so the enforced bound and what's drawn always agree.

### Cells are corner-anchored — the recurring `-1` correction

Cell `n` occupies the continuous span `[n, n+1)` along each axis — its coordinate is its "floor"
corner, not its center. This one fact is the source of a correction that used to show up as three
independently hand-derived copies of the same rule (see "Construction plane geometry mediator"
below for why that was a problem and how it's now consolidated):

- `engine/plane/constructionPlane.ts`'s `gridCoordFromPixel`/`pixelFromGridCoord` — flipping 2D
  canvas-row `v` into world-Y uses `-v - 1`, not `-v` (mirroring continuous range `[v, v+1)` about
  0 lands on cell index `-v-1`).
- `engine/plane/planeDisplay.ts`'s `toDisplayU`/`toDisplayV` — same correction, `-u - 1`/`-v - 1`,
  for mirroring the on-screen axis that flips with a construction plane's orientation (2D-canvas
  display only — see "Construction plane geometry mediator" below for which axis flips for which
  plane). Both are involutory (their own inverse), which is what lets
  `components/editor2d/usePixelCanvasTools.ts`'s `pixelToCell` reuse them to convert a displayed
  (mirrored) screen cell back to the logical model cell.
- `engine/plane/planeGeometry.ts`'s `flushFaceValue`/`flushFaceCoord` — add `+1` to a layer's
  coordinate when orientation is `+1` (leave unchanged for `-1`) to find which physical face of
  that layer is "flush" with the plane. The single shared implementation of what used to be three
  independently hand-derived copies (`ConstructionPlaneVisual.tsx`, `VoxelFaceHighlight.tsx`,
  `engine/instancing/basis.ts`'s `chamferInstanceMatrix`).

---

## Construction plane geometry mediator

The construction plane's axis/orientation math is needed by both the 2D pixel editor and the 3D
viewport, which used to each hand-derive their own copy — `engine/instancing/basis.ts` hand-copied
a `WORLD_U`/`WORLD_V` table that had to be kept in sync with `gridCoordFromPixel`'s cyclic basis by
eye, and `ConstructionPlaneVisual.tsx`/`VoxelFaceHighlight.tsx` each hand-derived the same
"flush face" rule independently. Every one of these had to be edited in lockstep whenever the
mapping changed, which is exactly what made this system fragile. It's now consolidated:

- **`engine/plane/planeGeometry.ts`** — the single source of axis/orientation geometry, in plain
  `Coord` tuples (no THREE — `engine/` stays render-agnostic). `AXIS_UNIT`, `axisIndex`,
  `outwardNormal`, `flushFaceValue`/`flushFaceCoord`. Both 2D and 3D code derive from this instead
  of hand-copying it.
- **`engine/plane/constructionPlane.ts`** — `gridCoordFromPixel`/`pixelFromGridCoord` (the
  canonical, orientation-independent u/v↔world mapping) and `planeFromFaceHit`. Also
  `planeLogicalBasis(axis)`, which *derives* (rather than hand-maintains) a plane's world-space u/v
  basis vectors by probing `gridCoordFromPixel` itself — `engine/instancing/basis.ts` computes its
  per-axis chamfer-placement basis from this at module load, so it's now structurally impossible
  for the 3D chamfer basis to drift out of sync with the 2D u/v mapping the way the old hand-copied
  `WORLD_U`/`WORLD_V` table repeatedly did.
- **`engine/plane/planeDisplay.ts`** — `toDisplayU`/`toDisplayV`, the 2D-canvas-only
  display-mirroring transforms (see below). Split into its own file specifically so nothing outside
  `components/editor2d/` has a reason to import it — 3D code has no display-mirroring concept.
- **`components/viewport3d/axisVectors.ts`** — the one place `Coord`→`THREE.Vector3` conversion
  happens for 3D view components (`AXIS_UNIT_VECTOR`, `toVector3`, `UP`), consumed by
  `ConstructionPlaneVisual.tsx` and `VoxelFaceHighlight.tsx` instead of each keeping its own
  `AXIS_UNIT` copy.

`engine/plane/types.ts`: `{ axis: 'x'|'y'|'z', orientation: 1|-1, offset: number }`, stored at
`store.plane` (`store/planeSlice.ts`). Determines which 2D (u,v) slice the pixel canvas shows, via
a fixed cyclic basis (`gridCoordFromPixel`): `x → u=-z,v=-y-ish` / `y → u=x,v=-z-ish` /
`z → u=x,v=-y-ish` (see the corner-anchoring note above for the exact `-v-1`/`-u-1` form). The
x-axis case negates u (not just v) because a naive `u=z` assignment has the opposite handedness
from the z-axis case's `u=x` — without the negation, east/west-facing planes render as a mirror
image of the model along the u-axis (colors and chamfer geometry both), even though north/south is
correct.

The y-axis case is the odd one out, and not just by a different constant: x and z relate to each
other by a yaw around world-Y (spinning 180° to face the opposite wall), which is why flipping
exactly one in-plane axis via `toDisplayU` at orientation `-1` is what makes both orientations of a
wall-facing plane read correctly. Top and bottom don't relate that way, and empirically (arrived at
after a couple of physically-derived guesses were each contradicted by what the app actually
showed — see git history if revisiting) it's `u` that stays fixed across both y-axis orientations
(`toDisplayU` is identity for this axis) and `v` that flips instead, via a separate `toDisplayV`
triggered at orientation `1`, not `-1` — the mirror image of `toDisplayU`'s x/z trigger.
`orientation` never changes which cell a pixel maps to — it only flips the on-screen mirroring axis
for display (`toDisplayU` or `toDisplayV`, whichever applies to the plane's axis) and picks which
side is "outward" for chamfer geometry.

**Setting the plane** — three ways, all converging on `store/planeSlice.ts`:

1. `components/viewport3d/ConstructionPlaneGizmo.tsx` — 6 clickable spheres, one per (axis,
   orientation) pair, offset unchanged.
2. `components/editor2d/Editor2D.tsx`'s flip button — toggles orientation in place.
3. **Clicking a voxel face in the 3D view** — `components/viewport3d/Viewport3D.tsx`'s
   `VoxelInteractionHandler` raycasts, resolves the hit into `{axis, orientation, offset}}` via
   `planeFromFaceHit`, and calls `store.handleVoxelFaceClick`. This has two-click semantics:
   - **First click** on a voxel (or a click on a *different* face than the last one) lands the
     plane on that voxel's own slice — "object mode" — and records `store.objectModeTarget`.
   - **Second click on the exact same face** (same `cellKey` **and** same `axis`/`orientation` —
     a different face of the same voxel does *not* count) advances the plane one step forward
     through that face (`offset + orientation`).
   - Any plane change not driven by this flow (gizmo, flip button, arrow-drag) clears
     `objectModeTarget`, so a stale "click again" target never lingers.

**Live hover preview** — independent of the click flow, `VoxelInteractionHandler` also raycasts on
every `pointermove` and writes into two store fields that always reflect whatever's currently under
the cursor: `store.hoverCell` (the whole voxel, drives the 3D hover blink) and `store.hoveredFace`
(the specific face, drives `VoxelFaceHighlight`'s live quad — same corner-anchoring math as above,
offset outward by a small epsilon to avoid z-fighting with the voxel's own face). A click commits
to whichever face is currently shown, via the same `resolveFaceHit` helper both paths share.

**2D → 3D hover** — `components/editor2d/usePixelCanvasTools.ts` forwards the 2D canvas's hovered
cell into the same `store.hoverCell` field (converted through `gridCoordFromPixel`), so hovering
the 2D canvas drives the exact same 3D feedback as hovering the 3D view directly:
- If a voxel already exists there, `InstancingManager`'s hover blink applies (see below).
- If not, `components/viewport3d/VoxelGhostPreview.tsx` renders a translucent placeholder cube
  tinted with the active palette color.

---

## Chamfer system

`engine/chamfer/`:

- `chamferResolver.ts` — `sampleNeighbors` reads the chamfer layer's 8-neighborhood (N/E/S/W +
  diagonals) around a (u,v) pixel (a neighbor counts as "filled" if it's marked as a chamfer cell
  at all, regardless of whether *its own* shape has resolved — see below); `classify` resolves
  that into a `ChamferClassification` (`{shapeKind, rotation}`) or `null` (3-of-4 orthogonal →
  ramp, 2 adjacent → convex corner, 4 orthogonal + exactly one empty diagonal → concave corner,
  everything else — including the 0-or-1-filled case every fresh cell starts at — unresolved, not
  blocked).
- `chamferGeometry.ts` — the actual mesh builders (`unitCubeGeometry`, `rampGeometry`,
  `convexCornerGeometry`, `concaveCornerGeometry`), all in a shared local prefab space **centered on
  the origin**, `[-0.5, 0.5]^3` (x=u, y=v, z=outward extent; z=+0.5 is flush with the construction
  plane, z=-0.5 the inward base). Centering on the voxel's own 3D center (per `etc/chamfer-tests.md`)
  makes the baked rotation a plain rotation about the origin and lands each mesh on its cell with no
  half-unit offset. The four canonical (rotation-0) shapes are: cube (12 tris); ramp — a triangular
  prism opening **east** (full height on the west edge), 8 tris, matching `classify`'s "rotation 0
  slopes toward E"; convex — full height only at the **SW** corner, a 2-triangle hip fan down to the
  other corners, 6 tris; concave — the inverse, a notch at the **NE** corner, 10 tris. Every triangle
  is wound counter-clockwise as seen from outside so `computeVertexNormals()` gives outward normals.
  `mirrorVGeometry` produces a v-mirrored, winding-reversed twin of each chamfer shape, used by the
  reflected-plane instance pools (see 3D viewport below). Triangle topology is validated in
  `chamferGeometry.test.ts` (counts, centered bounds, outward windings, per-model vertex presence).

**Painting a chamfer cell always succeeds**, even when it can't resolve a shape yet — there's no
paint-blocking validation (an earlier design gated the paint itself on `classify` succeeding,
which meant the very first chamfer cell painted anywhere — always 0 filled neighbors — could never
succeed; nothing could ever be painted). `ChamferCell` (`engine/grid/types.ts`) is
`{planeAxis, planeOrientation, resolvedTo}`, where `resolvedTo: ChamferClassification | null`.
`store/paintActions.ts`'s `paintChamferCell` (and **only** direct edits) always writes the cell
and calls `chamferResolver.ts`'s `classify` to resolve the cell's shape. **Direct edits are the
only time resolution happens** — flood-fill, copy/paste, and clone/stamp do not trigger
`resolveChamferCellsOnPlane` (which is now dead runtime code, kept only for its tests). Consequence:
a chamfer painted before its neighbors exist stays a plain cube until re-clicked; pasting a chamfer
copies its `planeAxis`/`planeOrientation`/`resolvedTo` verbatim rather than reclassifying, so the
source shape is reproduced at the destination (fixing a reported bug where pasting garbled chamfer
facings). **Once `resolvedTo` is set, it's frozen forever** — the original "resolved once, never
reclassified" invariant. `cloneStampCell` (`store/toolActionsSlice.ts`) and `applyClipboardAt`
(`engine/tools/clipboard.ts`, paste/re-stamp) now preserve the source chamfer's full cell data via
deep copy instead of reclassifying.

Cells with `resolvedTo: null` render differently in 2D vs 3D. In the 3D view, `InstancingManager.sync()`
buckets a cell into the `cube` pool (not the appropriate chamfer pool) until `resolvedTo` is set.
In the 2D editor, every chamfer cell (regardless of `resolvedTo`) shows the diagonal-stripe marker,
matching the float-render path, so freshly-painted unresolved chamfers are visually distinct from cubes.
`engine/instancing/basis.ts`'s `chamferInstanceMatrix` turns a resolved cell's baked
`{planeAxis, planeOrientation, resolvedTo.rotation}` into a world-space transform for the shared
instanced geometry (rotation applied via the instance matrix, not separate geometries per rotation),
placing the centered model at the cell's own 3D center (`coord + 0.5`). It **always returns a proper
rotation (det = +1)**: on planes where the raw `makeBasis(worldU, worldV, outward)` is a reflection
(negative determinant — exactly the +Z, +X, and -Y planes; see `chamferBasisIsReflected`), it negates
`worldV` and the baked rotation and pairs that with the v-mirrored geometry variant, giving identical
placement (`makeBasis(U,V,W)·Rz(θ) = makeBasis(U,-V,W)·Rz(-θ)·mirror_v`) without the reflection. This
matters because a reflected instance matrix flips triangle winding in screen space, which inverts the
shader's front/back decision and lit those chamfers as if from behind (dark). `basis.test.ts` guards
the det = +1 invariant across every axis/orientation/rotation and that placement is preserved.

---

## 2D editor

`components/editor2d/`:

- `PixelCanvas.tsx` — the actual `<canvas>` (2D context, `imageSmoothingEnabled=false`). Draws, in
  order: checkerboard for empty cells → grid lines (fine/8-cell/origin tiers, colors matching the
  3D `gridHelper` exactly) → the layer immediately behind the active plane (`offset - orientation`
  along the plane's own axis — an architectural-drawing-style reference: a light pixel-level dither
  fill plus a 1px outline per voxel, both in that voxel's own color; never chamfer-striped,
  regardless of the behind cell's own chamfer/resolution status) → the active plane's own content
  (flat fill, or `fillDiagonalStripes` — 2px 45°-diagonal bands alternating a lighter/darker shade
  of the cell's color via `engine/palette/palette.ts`'s `shadeColor` — for a *resolved* chamfer
  cell only) → line-draw preview → floating selection content → selection fill/marching-ants
  outline. The grid is deliberately drawn before all content (not last) so painted cells and
  overlays sit on top of it. Every content-related draw call routes its u-coordinate through
  `toDisplayU` and its v-coordinate through `toDisplayV` (both from `planeDisplay.ts`) for
  orientation mirroring; the checkerboard and grid lines don't need it (already symmetric about
  the origin).
- `usePixelCanvasTools.ts` — pointer-input adapter. Builds a fresh `ToolContext` every render
  (mirrored into a ref so stable pointer callbacks never read a stale closure) and dispatches to
  `engine/tools/index.ts`'s `toolMap[activeTool]`. Also owns pan/zoom camera state and forwards
  hover into the store (see above).
- `cameraTransform.ts` — `worldToScreen`/`screenToWorld`/`clampPan`, pure geometry, no plane
  awareness.
- `canvasConstants.ts` — `BASE_CELL_PX`, zoom bounds, `GRID_SPAN`/`HALF` (from
  `DEFAULT_GRID_EXTENT`).

### Tool architecture

`engine/tools/`: one module per tool (`paintTool.ts`, `eraseTool.ts`, `eyedropperTool.ts`,
`selectTool.ts`, `fillTool.ts`, `cloneTool.ts`, `moveTool.ts`), each a `ToolHandler` (`{onDown?,
onMove?, onUp?}`, `engine/tools/types.ts`) registered in `toolMap`. Paint and erase share a
down→move→up drag-state machine via `editToolFactory.ts`'s `makeEditTool` (shift-click line
preview + Bresenham flush, or a Bresenham-interpolated drag stroke). Tools never touch `(x,y,z)`
directly or import the store — they operate purely in plane-space `(u,v)` through the
`ToolContext` passed in, keeping them plane-agnostic and unit-testable.

Selection/clipboard support lives in `selectionMask.ts` (rect/lasso regions, rotate/mirror,
boundary tracing for the marching-ants outline) and `clipboard.ts`/`transform.ts` (copy/paste with
live chamfer re-validation at the destination, dropping invalid cells with a toast).

---

## 3D viewport

`components/viewport3d/` + `engine/instancing/`:

- **Instancing**: `engine/instancing/InstancingManager.ts` owns **7** `InstancedMesh` pools outside
  React — `cube`, the three chamfer shapes (`ramp`/`convex`/`concave`), and a v-mirrored twin of each
  (`rampM`/`convexM`/`concaveM`) for cells on a reflected-basis plane (see `poolIdFor` +
  `chamferBasisIsReflected`) — plus one **invisible AABB `pickMesh`** used only for raycasting (below).
  `components/viewport3d/VoxelInstancedMeshes.tsx` just mounts `.group` and calls `sync(model, palette)`
  / `tick(elapsedSeconds)` from `useEffect`/`useFrame`. `sync()` does a full rebuild per pool (diffing
  is a v2 optimization, not implemented), populating per-instance transforms (`basis.ts`'s
  `cubeInstanceMatrix`/`chamferInstanceMatrix`), base colors, a `cellKey ⇄ instance` reverse lookup,
  and the animated-instance list.
- **Material/lighting** (deviates from `SPEC.md` §3 — see below): one shared `MeshLambertMaterial`,
  `side: DoubleSide`, base color pinned to white (`0xffffff`) — three.js multiplies `instanceColor`
  against `material.color` in the shader regardless of `vertexColors`, so any non-white base color
  would tint every painted color. (With the proper-rotation instance matrices and mirrored pools above,
  every visible face is now front-facing and correctly lit; `DoubleSide` is retained defensively — the
  inward base face is hidden inside the solid anyway.) Blink/pulse animation (`emissiveClassFor` in
  `engine/palette/palette.ts`)
  and the hover blink are both driven from plain JS in `tick()`, recoloring just the affected
  instances via `setColorAt` every frame — not a GPU shader. `SceneLighting.tsx`'s lights live in a
  rig `<group>` synced to the camera's transform every frame (so the key light stays fixed relative
  to the view as you orbit) — note this rig must stay a normal child of the scene graph, not
  reparented onto the camera object itself, or three.js's light-collection pass silently drops it.
- **Hover blink**: `InstancingManager.setHoveredCell(key)` pulses the given instance's color
  between ~0.78x and ~1.22x its base brightness (sine wave in `tick()`), restoring the previous
  target's color when hover moves elsewhere.
- **Raycasting / picking**: `Viewport3D.tsx`'s `VoxelInteractionHandler` does its own manual
  raycasting (native `pointerdown`/`move`/`up`/`leave` listeners on `gl.domElement`, not R3F's
  synthetic event system) against `InstancingManager.pickObject` — the invisible **full-cell AABB**
  pick mesh (one axis-aligned unit cube per occupied cell), **not** the visible chamfer geometry.
  This is deliberate: raycasting the sloped chamfer faces produced diagonal face normals that confused
  construction-plane selection, so picking treats every voxel as a full cube, always yielding the cell
  (`cellKeyForPick`) and a clean ±axis face normal (fed to `planeFromFaceHit`). The pick mesh is added
  to `.group` with `visible = false` (never rendered) but is still raycastable when passed explicitly
  to the `Raycaster`. `InstancingManager.test.ts` covers this with real raycasts.
- **Construction plane visuals**: `ConstructionPlaneVisual.tsx` (the plane-aligned grid + draggable
  offset arrow), `ConstructionPlaneGizmo.tsx` (axis-select spheres), `VoxelFaceHighlight.tsx`
  (live hovered-face quad), `VoxelGhostPreview.tsx` (empty-cell paint preview). The plane grid renders
  through the **centers** of its layer's voxels (`plane.offset + 0.5` along the axis, for either
  orientation), not flush against a cell face; the drag-snap in `ConstructionPlaneVisual.tsx` mirrors
  that same +0.5 so dragging still lands on whole offsets.

### Mesh optimization and GLTF export

`engine/instancing/voxelMeshBuilder.ts` builds the live preview mesh via `buildOptimizedVoxelGeometry`:
it unions all colored cells (interior cells face-culled if completely surrounded), and welds coplanar
adjacent quads via the shell pass. **Chamfer optimization fix**: when detecting coplanar edge-adjacent
prefab triangle pairs (the flat quads on ramps and concave chamfers), `emitChamfer` now re-triangulates
them through the same `pushQuad` canonical diagonal as plain cubes, so they cancel against neighbors'
coincident faces. Genuinely triangular/folded faces (sloped sides, hip/folded roofs) are left as-is.

**Textured geometry support** (new): `buildTexturedShellGeometry` / `buildTexturedShellGeometryByColor` additively extend the builder with per-vertex box-map UVs via an injected `uvFor` callback (shell faces + per-vertex color, chamfer metadata optional). The coplanar-merge optimizer is intentionally NOT run on textured output (box-map UVs are a pure function of position+face, so leaving faces un-welded keeps UV assignment trivial). Non-textured (model-mode) output is byte-for-byte unchanged; `engine/instancing` has no dependency on `engine/texture`.

`engine/export/gltfExport.ts` exports this optimized geometry to binary `.glb` via three's
`GLTFExporter`. `buildOptimizedVoxelGeometryByColor` groups the shell by `(color, emissiveClass)`
and exports one named material + mesh per pair (rather than a single vertex-colored blob), so DCC
tools like Blender import each color under its own material. Emissive/blink/pulse materials get
`material.emissive` set to a steady glow (static glTF cannot animate, so blink/pulse export as static
emissive color — their animation is live-preview-only). Materials/objects are named
`voxel_rrggbb[_emissive|_blink|_pulse]`.

When a texture is present, `exportModelToGlb(model, palette, texture)` uses the box-mapped textured
geometry (`buildTexturedGeometry` / `buildTexturedGeometryByColor` with per-vertex UVs) and **bakes**
the overlay blend into a per-(color, emissiveClass) `baseColorTexture` via `bakeOverlayTexture`
(one small 192×128 RGBA texture per color group). The resulting `.glb` uses standard glTF
`baseColor × map` so any viewer reproduces the overlay without custom shaders; preview and export
are identical.

---

## State management

`store/useAppStore.ts` composes one root store from slices (all via `zustand/middleware/immer`,
with `enableMapSet()` since `VoxelModel` uses `Map`):

| Slice | File | Owns |
|---|---|---|
| project | `projectSlice.ts` | `model`, `palette`, `meta` |
| history | `historySlice.ts` | `past`/`future` snapshot stacks, `beginStroke`/`commitStroke`/`undo`/`redo` |
| plane | `planeSlice.ts` | `plane`, `objectModeTarget`, plane-setting actions |
| tool | `toolSlice.ts` | `activeTool`, `activeLayer`, `activePaletteSlot` |
| selection | `selectionSlice.ts` | `selection`, `clipboard`, `floatContent`/`floatOrigin` (pending move/paste buffer) |
| view | `viewSlice.ts` | `fullscreen`, `hoverCell`, `hoveredFace`, `chamferHoverValid` (ephemeral, not snapshotted) |
| persistence | `persistenceSlice.ts` | `dirty`, `lastSavedAt`, `lastError` |
| paintActions | `paintActions.ts` | `paintColorCell`, `paintChamferCell`, `eraseCell` |
| toolActions | `toolActionsSlice.ts` | flood fill, clone-stamp, copy/cut/delete, float lift/move/transform/bake |
| mode | `modeSlice.ts` | `mode` (`'model'`\|`'texture'`), `setMode` (the top-level authoring mode switch) |
| texture | `textureSlice.ts` | `texture`, `activeBoxFace`, `activeGrayIndex`, separate `texturePast`/`textureFuture` history, texture-mode selection/float/clipboard, and all texture-editing actions |

**Undo/redo**: atomic whole-`VoxelModel` snapshots (cheap — Immer structural sharing means a
snapshot only allocates for touched keys), one per completed gesture, not per intermediate edit.
Every mutating action calls `beginStroke()` first and `commitStroke()` on pointer-up; a pending
floating selection (`floatContent`) holds a stroke open until `bakeFloatIfAny()` closes it, so a
whole lift→move→rotate→mirror→bake sequence is one undo step. Capped at 100 steps
(`historySlice.ts`'s `MAX_HISTORY`); does not persist across reload.

---

## Persistence

`engine/persistence/`:

- `schema.ts` — `VoxPaintProjectFileV2` (current, `CURRENT_SCHEMA_VERSION = 2`) adds optional `texture?: SerializedTexture` to v1. `VoxPaintProjectFile` now aliases V2. Each texture face is base64-encoded; `faceSize` is validated and falls back to an empty texture on mismatch.
- `serialize.ts` — `serializeProject(model, palette, meta, texture)` and `deserializeProject` now include/restore the texture. Exports per-face as base64 strings. Existing v1 projects load with an empty texture (backwards-compatible).
- `migrations.ts` — `MIGRATIONS[1]` (v1 → v2) sets `schemaVersion = 2`; the optional texture just loads empty on old projects.
- `autosave.ts` — debounced (800ms, `store/wireAutosave.ts`) `localStorage` read/write, one serialize/deserialize path shared with explicit export/import (`projectFile.ts`'s `downloadProjectFile`/`readProjectFile`) so autosave and file I/O can never diverge.
  `QuotaExceededError` surfaces as a toast (`components/ui/toastBus.ts`) rather than failing
  silently.
- `store/wireAutosave.ts` — `restoreAutosave()` runs once at startup (`App.tsx`); `wireAutosave()`
  subscribes to `dirty` transitions and debounce-flushes. Autosave also flushes on `state.texture` change.

---

## Texture authoring

Parallel to the voxel modeler, a second top-level authoring mode applies a 6-sided, box-mapped grayscale texture to the entire model. Texture is **modular and loosely coupled**: a single `mode` switch in `store/modeSlice.ts`, whole-subtree gating in components (never `if (texture)` sprinkled throughout a component), and a separate undo/redo history for texturing. Only pure leaf helpers are shared between the two stacks (e.g., `bresenhamLine`, `selectionMask`, and the voxel mesh builder's UV injection callback).

### Texture data model

`engine/texture/types.ts` defines:
- `BoxFace` — `'px'|'nx'|'py'|'ny'|'pz'|'nz'`, the six outward-facing faces of an axis-aligned bounding box (reusing the construction-plane vocabulary via `boxFaceOf(axis, orientation)`).
- `TextureModel = { faces: Record<BoxFace, Uint8Array> }` — one flat `FACE_SIZE² = 64×64` array of grayscale texel indices (or `EMPTY = 255` sentinel for unpainted). Treated as immutable outside Immer producers, like `VoxelModel`.
- `TEXEL_SCALE = 4` — each texel is 0.25 voxels; at the default 16³ working volume, the texture is 64×64 per face.
- `GRAYSCALE` — 8 evenly-spaced indices (`0–7` map to `index/7` in sRGB, skipping 0.5 so there's no neutral no-op swatch under overlay blend).

`engine/texture/TextureStore.ts` provides helpers: `getTexel`, `texelIndex`, `withinFace`, `cloneTextureModel` (copy-on-write per-face), `hasTextureContent`.

### Box mapping and per-face projections

`engine/texture/boxMapping.ts` is the core. **Opposite faces of each axis must mirror one in-plane axis** so the texture reads correctly viewed from outside (standard box-map wrap). Using the shared `planeLogicalBasis(axis)` (same as 2D-canvas construction planes), the faces needing a flip are: `nx` (flip U), `nz` (flip U), `py` (flip V); their partners `px`/`pz`/`ny` keep the basis. This ensures the 2D canvas u/v coordinates and 3D box-map UVs agree by construction.

- `worldToTexel(face, x, y, z)` — projects a world vertex onto the face's two in-plane axes (derived from `planeLogicalBasis`), clamped to `[0, FACE_SIZE)`.
- `boxFaceForCell(chamfer|null, normal)` — resolves a cube's outward normal or a chamfer's authored `planeAxis`/`planeOrientation` to a box face (chamfers project along the axis they were painted in, disambiguating sloped surfaces).
- `buildBlendAtlas(texture)` — rasterizes all 6 faces into a single `NoColorSpace` RGBA `DataTexture` (3×2 atlas packing), where R=G=B is the overlay blend value (`index/7 * 255`), unpainted = neutral 128. Used by the 3D preview shader.
- `ATLAS_WIDTH/HEIGHT` and `atlasUVFor` — atlas packing constants and per-face UV lookup.

`engine/texture/overlay.ts` defines the overlay blend used by both preview and export:
- `overlayChannel(base, blend)` — JavaScript blend in sRGB space (neutral 0.5 expressed as 128/255): `blend > 0.5` → lighten, `< 0.5` → darken, `= 0.5` → no-op. Used in export bake.
- `OVERLAY_MAP_FRAGMENT` + `OVERLAY_COLOR_FRAGMENT` (GLSL strings) — inlined (not injected via `#include`) into the 3D preview shader's `<map_fragment>` and `<color_fragment>` replacements. Fully inlined to avoid shader-compiler issues with helper-function injection.

### 2D texture editor

`components/editor2d/TextureCanvas.tsx` — draws painted texels (grayscale, colorized for display via `GRAYSCALE` hex values) over a **model projection guide** (the model's silhouette frontmost-voxel per texel, depth-shaded, aligned via shared `worldToTexel` mapping). No grid; just a faint face-extent border. Shows "Click a face of the model to paint its texture" until a box face is active.

`components/editor2d/useTextureCanvasTools.ts` — pointer adapter (twin of `usePixelCanvasTools`), builds `TextureToolContext`, and dispatches to `textureToolMap`. Owns its own texel-scaled pan/zoom camera (`texWorldToScreen`, `texScreenToWorld`, `texClampPan`, `texClampZoom` in `textureCanvasConstants.ts`).

`engine/texture/textureTools.ts` — parallel tool set (`textureToolMap` keyed by the same `ToolId`) over a `TextureToolContext`. Deliberately separate from voxel `ToolContext` (texel edits are 2D surface-native, not 3D-coordinate-aware), reusing only pure helpers (`bresenhamLine`, `snapToOrtho`, `selectionMask`). Includes paint/erase/eyedropper/fill/select/clone/move handlers and a local `makeTextureEditTool` twin.

`engine/texture/texelOps.ts` — flat-grid operations for selection/float/clipboard: `TexelClip` type, `floodFillFace`, `copyRegion`, `clearRegion`, `applyClipAt`, `rotateClip90`, `mirrorClip`.

`engine/texture/projection.ts` — `projectModelToFace(model, palette, face)` renders the voxel model's silhouette onto a face's texel grid (frontmost voxel per texel along the axis, depth-shaded and dimmed) as a paint-alignment reference in the 2D canvas. Uses the same `worldToTexel` mapping as the 3D UVs so the guide aligns with where paint lands.

### 3D texture preview and interaction

`components/viewport3d/TexturedModelView.tsx` — the texture-mode 3D preview. One box-mapped shell mesh (`buildTexturedGeometry` / `buildTexturedGeometryByColor`), per-voxel vertex color, and a blend `DataTexture` from `buildBlendAtlas`. A `MeshLambertMaterial` is patched via `onBeforeCompile` to apply OVERLAY in the shader (same math as the export bake). Preview and export are identical.

`components/viewport3d/BoundingBoxFaceSelector.tsx` — texture-mode 3D interaction: an emissive wireframe box around the working volume whose 6 faces are clickable (drag-threshold guarded) to pick the active box face. Replaces voxel picking and the construction plane in texture mode.

### Texture persistence and export

`engine/texture/types.ts` + `TextureStore.ts` — `TextureModel` is stored as faces indexed by `BoxFace`, each a `Uint8Array`.

**Immer + Uint8Array discipline** — Immer treats `Uint8Array` as opaque (never drafts element contents). Every texel edit builds the next `TextureModel` **outside the Immer producer** via `cloneTextureModel` (copy-on-write on the active face) and assigns it in — same discipline as `projectSlice.setModel` for the voxel `Map`. This keeps history snapshots valid (previous face arrays are never mutated in place). Verified by `store/textureSlice.test.ts`.

See [Persistence](#persistence) below for schema v2 changes (optional texture serialization).

### Texture history and mode branching

`store/textureSlice.ts` — the full parallel texture stack: own `texturePast`/`textureFuture` history (same `beginStroke`/`commitStroke` pattern as `historySlice`), plus selection/float/clipboard state (`textureSelection`, `textureFloat`/`textureFloatOrigin`, `textureClipboard`) and actions (`paintTexel`, `eraseTexel`, `floodFillTexel`, `cloneStampTexel`, `beginTextureMove`/`updateTextureMove`/`endTextureMove`, `setTextureSelection`, transform float, bake float, copy/cut/delete/paste). All texture history is separate from voxel history; undo/redo/shortcuts branch on `mode`.

`components/editor2d/Editor2D.tsx` — `mode === 'texture' ? <TextureCanvas/> : (<PixelCanvas/> + <PlaneControlsOverlay/>)`.

`components/viewport3d/Viewport3D.tsx` — gated on mode: model mode = existing (construction plane + instanced mesh + picking + gizmo + ghost + highlight); texture mode = `<TexturedModelView/>` + `<BoundingBoxFaceSelector/>` (no plane, no voxel picking). Shared: Canvas, SceneLighting, OrbitControls.

`components/editor2d/useKeyboardShortcuts.ts` — mode-aware (texture history/selection/clipboard actions if `mode === 'texture'`, else voxel actions).

---

## Palette

`engine/palette/`: 28 indexed slots (16 base + 4 emissive + 4 blink + 4 pulse,
`PALETTE_SLOT_COUNTS`). Cells store a `{kind, index}` reference (`PaletteSlotRef`), never a
resolved hex value, so recoloring a swatch recolors every cell using that slot.
`resolveSlotColor(palette, slot)` does the lookup (falls back to magenta on a stale/out-of-range
ref). `emissiveClassFor(kind)` maps `blink`/`pulse` to the animation classes `InstancingManager`
drives in `tick()` — see [Deviations](#deviations-from-specmd) for the plain `emissive` kind.

---

## React tree

`App.tsx` (wires autosave + a global error-toast subscription) → `MainLayout.tsx` → `TopToolbar`
(includes `ModeTabs.tsx` for Model/Texture mode switch, right of File menu) → `LeftPanel` (tools + options, disabled/greyed in texture mode), a 2-column split (`Editor2D` | `Viewport3D`), `BottomBar` (undo/redo + contextual hint text) — plus `FloatingPalette` (28-slot voxel palette in model mode; 8-slot grayscale palette in texture mode) and toast region (`components/ui/ToastRegion.tsx`) via Radix primitives.

**Mode branching**: `Editor2D` gates on `mode === 'texture'` to show `TextureCanvas` or `PixelCanvas` + `PlaneControlsOverlay`; `Viewport3D` gates to show `TexturedModelView` + `BoundingBoxFaceSelector` or the voxel-mode 3D scene. All mode-aware components check the store's `mode` field. The left toolbar (`LayerToggle` / voxel-kind buttons) and construction-plane controls are disabled in texture mode.

---

## Deviations from SPEC.md

The spec was written before implementation began; several things changed along the way. This repo
is the source of truth — treat the spec as historical context, not a contract:

- **§1.3 & §2 chamfer resolution rule — GLOBAL RULE**: spec calls for chamfers to auto-resolve when
  neighbors appear (continuous "classify on write" across the layer). Implemented instead as: **a
  chamfer cell's shape is classified ONLY when the user directly paints/edits that specific voxel**.
  Consequence: copy/paste, clone/stamp, and flood-fill do not retro-resolve neighbors' unresolved
  chamfers (see `resolveChamferCellsOnPlane`, now dead runtime code). When a chamfer is painted
  before its neighbors exist, it stays a plain cube until re-clicked. Copy/paste/clone now preserve
  the source chamfer's `planeAxis`/`planeOrientation`/`resolvedTo` verbatim instead of reclassifying,
  fixing a reported bug where pasting garbled chamfer facings. Open consequence: rotate/mirror of
  chamfer selections doesn't rotate the shapes themselves (kept verbatim); a proper transform would
  require rotating `resolvedTo.rotation`/`planeOrientation` in the instance matrix, not attempted.
- **§5 GLTF export**: spec calls for a CSG-based pipeline (`three-bvh-csg`, Web Worker). Implemented
  instead in `engine/export/gltfExport.ts`, which runs on the main thread (grid capped at 64³, and
  the shell/cull optimization already runs synchronously for the live mesh preview, so a worker is
  unwarranted). The mesh optimizer—which already unions cells, culls hidden interior faces, and welds
  coplanar quads—replaces CSG entirely. `buildOptimizedVoxelGeometryByColor(model, palette)` groups
  the optimized shell by `(color, emissiveClass)` and exports one named material + mesh per pair;
  emissive/blink/pulse materials get a steady `material.emissive` glow (blink/pulse animation is
  live-preview-only, static glTF cannot express it). Materials/objects named `voxel_rrggbb[_emissive|_blink|_pulse]`.
  Export via binary `.glb` and three's `GLTFExporter`. The `three-bvh-csg` dependency was removed.
- **§3 material/lighting**: spec called for a single custom `ShaderMaterial` (extending
  `MeshStandardMaterial` via `onBeforeCompile`) with per-instance `instanceEmissiveClass`/
  `instanceEmissiveColor` attributes, animated by a GPU clock uniform. Implemented instead as a
  plain `MeshLambertMaterial` with **all** animation (blink/pulse/hover) driven from JS in
  `InstancingManager.tick()` via `setColorAt` — simpler to reason about and debug, at the cost of
  recoloring on the CPU every frame for animated cells (fine at current scale). One consequence:
  the plain `emissive` palette kind (`emissiveClassFor` → `1`) has no actual visual treatment
  today — only `blink`/`pulse` (classes 2/3) are animated; a real glow would need `material.emissive`
  wired per-instance, which the current shader-free approach doesn't support.
- **§1.1 grid size**: spec describes a single hard-enforced 64³ box. Implemented as two tiers —
  `MAX_GRID_EXTENT` (64, unenforced today) and `DEFAULT_GRID_EXTENT` (16, actually enforced) — see
  [Grid bounds](#grid-bounds--two-different-constants) above. No per-project sizing UI exists yet.
- **§3 instancing diffing**: spec called for dense arrays + swap-remove/append diffing with
  dirty-range flushing, never a full-buffer rebuild per stroke. `InstancingManager.sync()` does a
  full rebuild of all 7 pools (plus the pick mesh) on every model change — correct but not the described optimization.
  Not yet a measured problem at current grid sizes.
- **Hover/preview system** (`hoverCell`, `hoveredFace`, `VoxelFaceHighlight`, `VoxelGhostPreview`,
  the two-click "object mode" plane-advance interaction): not in the original spec at all — added
  after the initial build to make 3D face-picking and cross-view hover feedback discoverable.
- **§1.2 face-click plane offset for chamfer**: the spec's plane math (and this codebase's
  `gridCoordFromPixel`/`toDisplayU`) uses a `-1` correction for mirroring/offsetting
  corner-anchored cell indices that the spec's prose doesn't call out explicitly — see
  [the corner-anchoring note](#cells-are-corner-anchored--the-recurring--1-correction) above.
- **Texture authoring** (`engine/texture/`, `store/modeSlice.ts`, `store/textureSlice.ts`, `components/editor2d/TextureCanvas.tsx`, `components/viewport3d/TexturedModelView.tsx`): an entirely new feature not in the original SPEC. A second top-level authoring mode applies a 6-sided, box-mapped grayscale texture (8-level palette, 4× texel resolution) to the model via OVERLAY blend (chosen over multiply because multiply can only darken). Texture is modular and loosely coupled: whole-subtree gating by `mode`, separate history, separate undo/redo — only pure leaf helpers shared with the voxel stack. See [Texture authoring](#texture-authoring) above.
