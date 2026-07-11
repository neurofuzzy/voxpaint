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
corner, not its center. This one fact is the source of a correction that shows up in three
independent places, all solving the same underlying problem (mirroring or offsetting a
corner-anchored index is not a bare negation/addition):

- `engine/plane/constructionPlane.ts`'s `gridCoordFromPixel`/`pixelFromGridCoord` — flipping 2D
  canvas-row `v` into world-Y uses `-v - 1`, not `-v` (mirroring continuous range `[v, v+1)` about
  0 lands on cell index `-v-1`).
- `engine/plane/constructionPlane.ts`'s `toDisplayU`/`toDisplayV` — same correction, `-u - 1` /
  `-v - 1`, for mirroring the on-screen axis that flips with a construction plane's orientation
  (`toDisplayU` at orientation `-1` for x/z-axis planes; `toDisplayV` at orientation `+1` for the
  y-axis plane instead — see the "Construction plane" section below for why it's the other axis and
  the other orientation sign there). Both are involutory (their own inverse), which is what lets
  `components/editor2d/usePixelCanvasTools.ts`'s `pixelToCell` reuse them to convert a displayed
  (mirrored) screen cell back to the logical model cell.
- `components/viewport3d/ConstructionPlaneVisual.tsx` and `components/viewport3d/VoxelFaceHighlight.tsx`
  both add `+1` to a layer's offset when orientation is `+1` (and leave it unchanged for `-1`) to
  find which physical face of that layer to render flush against — matching
  `engine/instancing/basis.ts`'s `chamferInstanceMatrix`, which independently derives the same
  "flush with the construction plane" face from its own translation math.

---

## Construction plane

`engine/plane/types.ts`: `{ axis: 'x'|'y'|'z', orientation: 1|-1, offset: number }`, stored at
`store.plane` (`store/planeSlice.ts`). Determines which 2D (u,v) slice the pixel canvas shows, via
a fixed cyclic basis (`gridCoordFromPixel`): `x → u=-z-ish,v=-y-ish` / `y → u=-x,v=z` / `z → u=x,v=-y-ish`
(see the corner-anchoring note above for the exact `-v-1`/`-u-1` form). The x-axis case negates u
(not just v) because a naive `u=z` assignment has the opposite handedness from the z-axis case's
`u=x` — without the negation, east/west-facing planes render as a mirror image of the model along
the u-axis (colors and chamfer geometry both), even though north/south is correct.

The y-axis case is structurally different from x/z, not just a different constant: x and z relate
to each other by a yaw around world-Y (spinning 180° to face the opposite wall), which is why
flipping exactly one in-plane axis (`toDisplayU`, triggered at orientation `-1`) makes both of
their orientations correct. Top and bottom don't relate that way — they're two views of a
*horizontal* sheet, and empirically (confirmed by fixing an inverted top-facing plane against a
correct bottom-facing one) it's `v`, not `u`, that needs to flip between them, and it flips at
orientation `+1`, not `-1`. So the y-axis plane fixes `u` at a constant `-x` (`toDisplayU` is
identity for it) and instead flips `v` via a separate `toDisplayV` (identity for x/z, since their v
never flips). `basis.ts`'s `WORLD_U`/`WORLD_V` mirror these same choices for chamfer instance
placement — `chamferInstanceMatrix` special-cases the y-axis to negate `WORLD_V` at orientation `1`
instead of reading a fixed per-axis table, since the other two axes never need this. `orientation`
never changes which cell a pixel maps to — it only flips the on-screen mirroring axis for display
(`toDisplayU` or `toDisplayV`, depending on the plane's axis) and picks which side is "outward" for
chamfer geometry.

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
  diagonals) around a (u,v) pixel; `classify` resolves that into a `{shapeKind, rotation}` or
  `null` (invalid — 3-of-4 orthogonal → ramp, 2 adjacent → convex corner, 4 orthogonal + exactly
  one empty diagonal → concave corner, everything else blocked). `canPaintChamfer` is the live-gate
  used by the paint cursor.
- `chamferGeometry.ts` — the actual mesh builders (`unitCubeGeometry`, `rampGeometry`,
  `convexCornerGeometry`, `concaveCornerGeometry`), all in a shared local prefab space `[0,1]^3`
  (x=u, y=v, z=outward extent; z=1 is flush with the construction plane).

Classification happens **once, at paint time**, from the chamfer layer only, and is frozen forever
— `store/paintActions.ts`'s `paintChamferCell` bakes `{shapeKind, rotation, planeAxis,
planeOrientation}` into the cell; later edits to neighbors never retroactively reclassify it.
`engine/instancing/basis.ts`'s `chamferInstanceMatrix` turns that baked data into a world-space
transform for the shared instanced geometry (rotation applied via the instance matrix, not
separate geometries per rotation).

---

## 2D editor

`components/editor2d/`:

- `PixelCanvas.tsx` — the actual `<canvas>` (2D context, `imageSmoothingEnabled=false`). Draws, in
  order: checkerboard for empty cells → painted content → grid lines (fine/8-cell/origin tiers,
  colors matching the 3D `gridHelper` exactly) → line-draw preview → floating selection content →
  selection fill/marching-ants outline. Every content-related draw call routes its u-coordinate
  through `toDisplayU` for orientation mirroring; the checkerboard and grid lines don't need it
  (already symmetric about the origin).
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
