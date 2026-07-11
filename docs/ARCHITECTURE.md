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
  `convexCornerGeometry`, `concaveCornerGeometry`), all in a shared local prefab space `[0,1]^3`
  (x=u, y=v, z=outward extent; z=1 is flush with the construction plane).

**Painting a chamfer cell always succeeds**, even when it can't resolve a shape yet — there's no
paint-blocking validation (an earlier design gated the paint itself on `classify` succeeding,
which meant the very first chamfer cell painted anywhere — always 0 filled neighbors — could never
succeed; nothing could ever be painted). `ChamferCell` (`engine/grid/types.ts`) is
`{planeAxis, planeOrientation, resolvedTo}`, where `resolvedTo: ChamferClassification | null`.
`store/paintActions.ts`'s `paintChamferCell` always writes the cell (`resolvedTo` set to whatever
`classify` currently returns, possibly `null`), then calls `chamferResolver.ts`'s
`resolveChamferCellsOnPlane(model, plane)`, which re-attempts resolution for every other
still-unresolved chamfer cell on that exact (axis, offset) slice — the newly-painted cell may be
the missing neighbor they were waiting on. This is cheap (scans one plane's worth of already-
chamfered cells, not the whole model) and is the only place re-resolution happens: erasing a
neighbor can only ever reduce a fill count, never newly satisfy one, so erase never needs to
trigger it. **Once `resolvedTo` is set, it's frozen forever** — matching the original "resolved
once, never reclassified" invariant, just deferred until a cell actually has enough neighbors
rather than blocking the paint that couldn't yet resolve it. `cloneStampCell`
(`store/toolActionsSlice.ts`) and `applyClipboardAt` (`engine/tools/clipboard.ts`, paste/re-stamp)
follow the identical pattern: always write, classify fresh against the destination's current
neighbors, then `resolveChamferCellsOnPlane`.

Cells with `resolvedTo: null` render as a plain cube in both the 2D editor (flat fill, not the
diagonal-stripe chamfer marker — see below) and the 3D view (`InstancingManager.sync()` buckets a
cell into the `cube` pool unless `chamfer?.resolvedTo` is set) until they resolve.
`engine/instancing/basis.ts`'s `chamferInstanceMatrix` turns a resolved cell's baked
`{planeAxis, planeOrientation, resolvedTo.rotation}` into a world-space transform for the shared
instanced geometry (rotation applied via the instance matrix, not separate geometries per
rotation).

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

- **Instancing**: `engine/instancing/InstancingManager.ts` owns 4 `InstancedMesh` pools (cube,
  ramp, convex, concave) outside React — `components/viewport3d/VoxelInstancedMeshes.tsx` just
  mounts `.group` and calls `sync(model, palette)` / `tick(elapsedSeconds)` from `useEffect`/
  `useFrame`. `sync()` does a full rebuild per pool (diffing is a v2 optimization, not implemented),
  populating per-instance transforms (`basis.ts`'s `cubeInstanceMatrix`/`chamferInstanceMatrix`),
  base colors, a `cellKey ⇄ instance` reverse lookup, and the animated-instance list.
- **Material/lighting** (deviates from `SPEC.md` §3 — see below): one shared `MeshLambertMaterial`,
  base color pinned to white (`0xffffff`) — three.js multiplies `instanceColor` against
  `material.color` in the shader regardless of `vertexColors`, so any non-white base color would
  tint every painted color. Blink/pulse animation (`emissiveClassFor` in `engine/palette/palette.ts`)
  and the hover blink are both driven from plain JS in `tick()`, recoloring just the affected
  instances via `setColorAt` every frame — not a GPU shader. `SceneLighting.tsx`'s lights live in a
  rig `<group>` synced to the camera's transform every frame (so the key light stays fixed relative
  to the view as you orbit) — note this rig must stay a normal child of the scene graph, not
  reparented onto the camera object itself, or three.js's light-collection pass silently drops it.
- **Hover blink**: `InstancingManager.setHoveredCell(key)` pulses the given instance's color
  between ~0.78x and ~1.22x its base brightness (sine wave in `tick()`), restoring the previous
  target's color when hover moves elsewhere.
- **Raycasting**: `Viewport3D.tsx`'s `VoxelInteractionHandler` does its own manual raycasting
  (native `pointerdown`/`move`/`up`/`leave` listeners on `gl.domElement`, not R3F's synthetic event
  system) against `InstancingManager.meshList`, resolving hits back to a `CellKey` via
  `cellKeyForHit`.
- **Construction plane visuals**: `ConstructionPlaneVisual.tsx` (the plane-aligned grid + draggable
  offset arrow), `ConstructionPlaneGizmo.tsx` (axis-select spheres), `VoxelFaceHighlight.tsx`
  (live hovered-face quad), `VoxelGhostPreview.tsx` (empty-cell paint preview).

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

**Undo/redo**: atomic whole-`VoxelModel` snapshots (cheap — Immer structural sharing means a
snapshot only allocates for touched keys), one per completed gesture, not per intermediate edit.
Every mutating action calls `beginStroke()` first and `commitStroke()` on pointer-up; a pending
floating selection (`floatContent`) holds a stroke open until `bakeFloatIfAny()` closes it, so a
whole lift→move→rotate→mirror→bake sequence is one undo step. Capped at 100 steps
(`historySlice.ts`'s `MAX_HISTORY`); does not persist across reload.

---

## Persistence

`engine/persistence/`:

- `schema.ts` — `VoxPaintProjectFileV1` (`schemaVersion`, `meta`, `palette`, sparse
  `colorCells`/`chamferCells` arrays). `serialize.ts` converts to/from the in-memory `VoxelModel`.
- `migrations.ts` — registry keyed by `schemaVersion`, identity-only today (`CURRENT_SCHEMA_VERSION
  = 1`), in place so future bumps don't require retrofitting.
- `autosave.ts` — debounced (800ms, `store/wireAutosave.ts`) `localStorage` read/write, one
  serialize/deserialize path shared with explicit export/import (`projectFile.ts`'s
  `downloadProjectFile`/`readProjectFile`) so autosave and file I/O can never diverge.
  `QuotaExceededError` surfaces as a toast (`components/ui/toastBus.ts`) rather than failing
  silently.
- `store/wireAutosave.ts` — `restoreAutosave()` runs once at startup (`App.tsx`); `wireAutosave()`
  subscribes to `dirty` transitions and debounce-flushes.

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

`App.tsx` (wires autosave + a global error-toast subscription) → `MainLayout.tsx` → `TopToolbar`,
`LeftPanel` (tools + options), a 2-column split (`Editor2D` | `Viewport3D`), `BottomBar`
(undo/redo + contextual hint text) — plus `FloatingPalette` and toast region
(`components/ui/ToastRegion.tsx`) via Radix primitives.

---

## Deviations from SPEC.md

The spec was written before implementation began; several things changed along the way. This repo
is the source of truth — treat the spec as historical context, not a contract:

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
  full rebuild of all 4 pools on every model change — correct but not the described optimization.
  Not yet a measured problem at current grid sizes.
- **§5 GLTF export**: `engine/csg/` exists as an empty directory. `three-bvh-csg`-based export
  (`CsgExporter.ts` in the spec's module breakdown) is not implemented.
- **Hover/preview system** (`hoverCell`, `hoveredFace`, `VoxelFaceHighlight`, `VoxelGhostPreview`,
  the two-click "object mode" plane-advance interaction): not in the original spec at all — added
  after the initial build to make 3D face-picking and cross-view hover feedback discoverable.
- **§1.2 face-click plane offset for chamfer**: the spec's plane math (and this codebase's
  `gridCoordFromPixel`/`toDisplayU`) uses a `-1` correction for mirroring/offsetting
  corner-anchored cell indices that the spec's prose doesn't call out explicitly — see
  [the corner-anchoring note](#cells-are-corner-anchored--the-recurring--1-correction) above.
