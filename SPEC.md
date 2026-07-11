# VoxPaint — Product & Technical Spec

## Context

VoxPaint is a new, greenfield web app for creating low-poly 3D models for games. Unlike a typical cubic-voxel editor, it's "voxel plus": it supports plain cubic voxels *and* voxels with a 45° chamfer (ramp/corner bevel), all authored through a familiar 2D pixel-art editing surface rather than direct 3D sculpting. The 2D-first workflow is the key differentiator — the 3D view is a live preview and a navigation tool (pick which slice you're editing), not the primary input surface. The goal is a tool that feels as approachable as a pixel-art editor but outputs clean, exportable low-poly 3D meshes.

The repo is currently empty (README + LICENSE only) — this spec defines the full v1 build from scratch.

---

## 1. Core Concepts

### 1.1 Voxel grid
- Conceptually infinite, centered at the origin; **practical limit is a hard-enforced 64×64×64 bounding box**. Painting outside the box is blocked. The box is user-repositionable/resizable (UI affordance: a visible bounds gizmo in the 3D view + numeric bounds control), but never exceeded — this keeps rendering, undo snapshotting, and CSG export time bounded and predictable.
- Two independent per-cell layers, keyed by the same `(x,y,z)`:
  - **Color layer** — a plain cubic voxel, indexed into the palette.
  - **Chamfer layer** — marks the cell as a chamfered shape instead of a cube (see §2). **Painting a chamfer cell always simultaneously writes the color layer** with the currently active palette slot — one paint gesture produces one fully-colored result. There is no independently-colored or uncolored chamfer state.

### 1.2 Construction plane
- Defined by `{ axis: x|y|z, orientation: +1|-1, offset: integer }`. Origin on the other two axes is always 0,0.
- Determines the 2D (u,v) slice shown in the 2D editor, via a fixed cyclic basis (x→u=-z,v=-y; y→u=x,v=-z; z→u=x,v=-y). Wherever world-Y is one of the two in-plane axes (the x- and z-axis planes), it's assigned to v and negated, since the 2D editor's v increases downward (standard canvas convention) while three.js world-Y increases upward — without the flip, content painted lower on the 2D canvas would render higher in the 3D view. The x-axis case also negates u (not just v): a naive u=z assignment has the opposite handedness from the z-axis case's u=x, which would render east/west-facing planes as a mirror image of the model. `orientation` doesn't change which grid cell a pixel maps to — it only affects which direction is "outward" for chamfer geometry and flips one on-screen axis so painting always feels like looking at the slab from outside: `toDisplayU` for x/z-axis planes (u never flips for the y-axis plane — confirmed empirically that top and bottom are wrong in u the *same* way, not mirrored, so it's a plain constant there, not an orientation-driven flip), `toDisplayV` for the y-axis plane instead (v never flips for x/z).
- **Set via**: (a) the central axis widget/gizmo in the 3D view (click a cap to set axis+orientation, offset unchanged), or (b) clicking a voxel face in the 3D view — this sets axis+orientation from the face normal and **offset = the clicked cell's own coordinate** (you land on the slice that cell lives on, viewed from the side you clicked).
- Click-drag in the 3D view orbits the camera (desktop `OrbitControls`); wheel/trackpad pinch zooms, two-finger trackpad pans. No touch/stylus gesture design in v1 (see §9).

### 1.3 Chamfer shape system
A chamfer cell's 3D shape is a **3-piece autotile system** — ramp, convex corner, or concave corner — resolved **once, at paint time**, from the 8-neighborhood of the chamfer layer only (never the color layer), and then frozen: later edits to neighboring cells never retroactively reclassify an already-painted cell.

Classification, using orthogonal neighbors N/E/S/W and diagonals NE/NW/SE/SW (all within the chamfer layer, at the plane's u/v projection):

- **3 of 4 orthogonal filled, 1 empty** → **ramp**, sloping down toward the empty side.
- **Exactly 2 adjacent orthogonal filled (L-shape)** → **convex corner**, sloping down on both open sides, meeting at a diagonal ridge.
- **All 4 orthogonal filled AND exactly one relevant diagonal empty** → **concave corner**, flat on all 4 straight edges, notched at that diagonal.
- **Any other configuration is invalid** — no pyramid/spike fallback exists. The editor must **prevent** painting a chamfer cell wherever it would resolve to an invalid configuration (live-validated per cell as the user paints/drags, cursor shows a blocked state over invalid cells).

Flipping the construction plane's orientation changes which way *newly painted* ramps/corners slope (their `planeAxis`/`planeOrientation` is baked in at paint time); it never affects already-baked cells.

Each baked chamfer cell stores `{ shapeKind: ramp|convex|concave, rotation: 0-3, planeAxis, planeOrientation }` — exactly 3 shapes × 4 rotations, realized as a small fixed library of mesh prefabs (rotation applied via instance transform, not separate geometries).

---

## 2. 2D Editor

Primary drawing surface: a plain `<canvas>` (2D context, `imageSmoothingEnabled=false`) rendering the current construction plane's (u,v) slice.

**Tools**: paint, eyedropper, rectangular + lasso selection, copy/paste, flood fill (color layer only — chamfer fill is excluded, since wholesale-filling chamfer cells would almost always produce invalid configurations), clone/stamp, selection transforms (move, rotate, mirror), shift-click ortho-constrained line drawing (Bresenham, snapped to 0/45/90°).

- A **layer toggle** (color vs. chamfer) determines what the active tool paints; chamfer paint always writes color too (§1.1).
- Paste and re-stamped transforms re-run live chamfer validation against the destination's neighbors; invalid chamfer cells in the pasted/transformed data are dropped (with a toast) while color-only data still applies.
- All 2D tools address the grid exclusively through the plane's (u,v)→(x,y,z) projection — no tool touches (x,y,z) directly, keeping tool logic plane-agnostic.

---

## 3. 3D View

- Renders via `@react-three/fiber` + `@react-three/drei`, Three.js underneath.
- **Instancing**: 4 `InstancedMesh` pools total — cube, ramp, convex-corner, concave-corner. Each of the 3 chamfer shapes needs only 1 base geometry; all 4 rotations and all 6 (axis, orientation) bases are expressed via each instance's transform matrix, not separate geometries. This keeps draw calls constant (4) regardless of model complexity up to the 64³ cap.
- **Per-instance color/emissive**: built-in `instanceColor` for base RGB; a custom `instanceEmissiveClass` + `instanceEmissiveColor` attribute pair drives emissive/blink/pulse behavior through **one shared custom `ShaderMaterial`** (extending `MeshStandardMaterial` via `onBeforeCompile`) reused across all 4 pools, animated by a single global `uClock` uniform (updated once per frame) — no per-instance material overrides, all animation is GPU-driven.
- **Buffer updates**: an `InstancingManager` class (outside React) maintains dense per-pool arrays + a `CellKey ⇄ instanceIndex` map, applies grid diffs via swap-remove/append, and flushes only dirty instance ranges per frame — never a full-buffer rebuild on every paint stroke, and never routes paint-time updates through React re-renders.
- **Raycasting**: `InstancedMesh`'s built-in `instanceId` resolution + the manager's index→cell map drives both face-click plane selection (§1.2) and future 3D-view interactions.
- **Gizmo**: central axis widget (based on drei's `GizmoHelper`, reskinned) with 6 clickable caps for ±X/±Y/±Z plane selection; a visible bounds box shows the current 64³ working volume.

---

## 4. Undo/Redo

- Atomic, point-in-time whole-model snapshots — one snapshot per completed user gesture (pointer-up ending a stroke/select/fill/transform), not per intermediate cell edit within a drag.
- Backed by Immer-managed persistent structures so snapshots are cheap (structural sharing; a snapshot only allocates for touched keys, not a deep clone of the whole grid).
- History stack capped (e.g. 50–100 steps) and **does not persist across reload** — autosave restores model state only; the undo stack resets on a fresh load.

---

## 5. Persistence & Export

### Project persistence
- Single versioned JSON schema (`schemaVersion`, palette, sparse `colorCells`/`chamferCells` arrays) used identically for **localStorage autosave** and **explicit JSON export/import** (download/upload) — one serialize/deserialize/migrate code path regardless of source, avoiding autosave/import divergence.
- Migration registry pattern is in place from day one (empty/identity for v1) so future schema bumps don't require retrofitting.
- Autosave debounced; `QuotaExceededError` on `localStorage.setItem` surfaces a toast rather than silently failing.

### GLTF export (CSG-optimized)
- **`three-bvh-csg`** unions every occupied cell's resolved geometry (cube or chamfer prefab, same transform-resolution function the renderer uses) into one manifold mesh — this is what removes internal/hidden faces between adjacent voxels.
- Post-union: vertex welding (`BufferGeometryUtils.mergeVertices`) to close CSG seams. Explicit coplanar-quad merging (greedy meshing) is a v1.1 stretch goal, not a v1 blocker — union + weld already gives a clean, non-overlapping mesh far smaller than raw instanced-cube soup.
- Per-cell color is baked as **vertex colors** on the merged geometry (universally supported by GLTF, no material-count bloat).
- Export runs in a **Web Worker** with a progress indicator, since CSG union cost scales with cell count and shouldn't freeze the UI on large models.

---

## 6. Palette

- 16 base "vintage retro" desaturated colors + 4 emissive + 4 blinking-emissive + 4 pulsing-emissive = 28 total slots.
- Cells store a **palette slot reference** (`{kind, index}`), not a resolved hex value — editing a swatch's color recolors every cell using that slot, standard indexed-palette behavior.
- Blink = hard on/off square wave, pulse = smooth sine, both driven by the shared shader clock uniform (§3).

---

## 7. State Management (Zustand)

One root store, typed slices: `project` (the model itself, Immer + persistent-map backed), `history` (undo/redo stacks), `tool` (active tool + options), `plane` (construction plane), `selection` (region + clipboard), `palette`, `view` (ephemeral UI state, not persisted/snapshotted), `persistence` (autosave/dirty state).

---

## 8. Module Breakdown

**Non-UI engine modules** (pure, framework-agnostic, unit-testable):
- `engine/grid/GridStore.ts` — sparse color+chamfer maps, bounds tracking
- `engine/plane/constructionPlane.ts` — plane↔grid mapping, face-hit→plane derivation
- `engine/chamfer/chamferResolver.ts` — classification + live validation
- `engine/instancing/InstancingManager.ts` — dense buffers, diffing, dirty-range flushing
- `engine/csg/CsgExporter.ts` — union/weld/bake/GLTF pipeline, worker wrapper
- `engine/persistence/{schema,migrations,serialize,autosave}.ts`
- `engine/tools/*.ts` — one module per tool, sharing a common `Tool` interface
- `engine/input/PointerInputController.ts` — normalized Pointer Events abstraction (mouse-only behavior in v1, but shaped to add touch/stylus without a rewrite)

**React tree**: `App` → `MainLayout` (`TopToolbar`, `LeftPanel` [tools + options], `CenterSplit` [`Editor2D` + `Viewport3D`], `RightPanel` [palette, layer toggle, model stats]) → dialogs (export progress, etc.) and toast region via Radix primitives. Components stay thin — they read Zustand slices and forward events into engine modules; no business logic lives in `.tsx` files.

**Stack**: Vite, React, TypeScript, Zustand, Tailwind CSS, Radix UI, lucide-react, Three.js + `@react-three/fiber` + `@react-three/drei`, `three-bvh-csg`. Dark-mode only, fullscreen support.

---

## 9. Explicitly Out of Scope for v1

- Touch/stylus input and mobile layout — desktop mouse/trackpad only for now. The pointer-event abstraction (§8) and plane/tool architecture are shaped so this is additive later, not a rewrite.
- Coplanar-quad mesh simplification beyond CSG union + vertex weld (v1.1 stretch).
- Cross-session undo history persistence.

---

## Verification

Since this is a spec (no implementation yet), verification for the *next* phase (implementation) should include:
1. Unit tests for `chamferResolver.classify()` covering every valid case (ramp ×4 rotations, convex ×4, concave ×4) and representative invalid configurations.
2. A manual pass painting a small closed loop of chamfer cells and confirming the 2D editor blocks invalid cells and the 3D view renders the expected ramp/corner shapes with correct rotation.
3. Round-trip test: export project JSON → reload from that JSON → model matches (including palette slot references, not resolved colors).
4. GLTF export of a small (~20-cell) mixed cube+chamfer model, opened in an external viewer, to confirm a clean manifold mesh with correct vertex colors.
