# VoxPaint Session Notes

## Overview

Session focused on mesh optimization, GLTF export, chamfer resolution behavior, tool/interaction redesign, and UI improvements. Six major work areas completed.

---

## 1. Mesh Optimizer — Chamfer Interior-Face Fix

**File**: `src/engine/instancing/voxelMeshBuilder.ts` (`emitChamfer`).

**Problem**: The optimized-mesh preview (used by the live wireframe and GLTF export) left "X-pattern" straggler faces on the backside of ramp and concave chamfers. Root cause: plain cubes emit every face via `pushQuad`, splitting each quad on a canonical min→max-corner diagonal; coincident neighbor faces split identically and cancel in the shell pass. But chamfers used the prefab's own triangulation, so a chamfer's flat wall and a neighbor cube's coincident face split on different diagonals and couldn't cancel.

**Fix**: `emitChamfer` now detects coplanar edge-adjacent prefab triangle pairs (the flat quads: bottom walls, back walls, single-facet ramp roof) and re-triangulates them through the same `pushQuad` canonical diagonal, so they cancel correctly. Genuinely triangular/folded faces (sloped sides, hip/folded roofs) remain unchanged. This ensures the shell pass produces a clean, watertight boundary.

---

## 2. GLTF Export (Replaces Specced CSG Pipeline)

**Files**: `src/engine/export/gltfExport.ts` (new), `src/engine/instancing/voxelMeshBuilder.ts`, `src/components/panels/FileMenu.tsx`, `package.json`.

**Design decision**: The mesh optimizer already performs union (interior cell culling), shell closure (interior-face culling), and coplanar-quad welding — exactly what CSG was specced to do. CSG is redundant. Removed the `three-bvh-csg` dependency.

**Implementation**:
- **Main thread only**: Spec called for a Web Worker, but the grid caps at 64³ and geometry builds synchronously for the live preview, so a worker is unwarranted.
- **Binary glTF**: Exports `.glb` via three's `GLTFExporter`.
- **Materials per (color, emissiveClass)**: New `buildOptimizedVoxelGeometryByColor(model, palette)` groups shell-culled faces by `(color, emissiveClass)` and optimizes each group. Exports one named `MeshStandardMaterial` + mesh per pair (not a single vertex-colored blob), so DCC tools like Blender import each color under its own material by default.
- **Emissive handling**: Each face carries an `emissiveClass` (0=none, 1=emissive, 2=blink, 3=pulse, from palette slot kind). Materials split by class; emissive/blink/pulse materials get `material.emissive` set to a steady glow color. Limitation: static glTF cannot animate, so blink/pulse export as static emissive (their animation is live-preview-only).
- **Naming**: Materials/objects named `voxel_rrggbb[_emissive|_blink|_pulse]` (hex color + optional kind suffix).
- **Menu integration**: Wired the existing File → "Export GLTF…" menu item.

---

## 3. GLOBAL RULE: Chamfers Only Resolve on Direct Edit

**Files**: `src/store/paintActions.ts`, `src/store/toolActionsSlice.ts`, `src/engine/tools/clipboard.ts`, `src/store/types.ts`.

**Override**: SPEC §1.3 & §2 called for chamfers to auto-resolve when neighbors appear. **New rule**: a chamfer cell's shape is classified ONLY when the user directly paints/edits that specific voxel. Nothing else changes it.

**Changes**:
- **Removed** `resolveChamferCellsOnPlane` from paint's neighbor-propagation path. It's now dead runtime code (only its tests reference it); **do NOT re-wire**.
- **Flood-fill, copy/paste, clone/stamp** no longer trigger chamfer resolution. Consequence: a chamfer painted before its neighbors exist stays a plain cube until re-clicked.
- **Copy/paste and clone/stamp** now preserve the source chamfer's data **verbatim** (deep-copied `planeAxis`/`planeOrientation`/`resolvedTo`) instead of reclassifying. `ClipboardCell.chamfer` changed from a `true` flag to a full `ChamferCell`. This fixed a reported bug where pasting garbled chamfer facings and swapped cubes↔chamfers.
- **Rotate/mirror open consequence**: transforms keep chamfer orientations verbatim (shapes don't rotate). A proper transform would require rotating `resolvedTo.rotation`/`planeOrientation` in the instance matrix; not implemented.

---

## 4. Editing Behavior Changes

**Files**: `src/store/types.ts`, `src/engine/tools/clipboard.ts`, `src/components/editor2d/useKeyboardShortcuts.ts`, `src/store/paintActions.ts`, `src/store/toolActionsSlice.ts`, `src/engine/tools/eyedropperTool.ts`, `src/engine/tools/types.ts`, `src/components/editor2d/usePixelCanvasTools.ts`.

**Paste-in-place**: `ClipboardData` now stores the copy's top-left (`originU`/`originV`). Cmd+V pastes there (same canvas coords), not at the cursor.

**Selection-constrained editing**: When a selection is active, paint / erase / flood-fill are clipped to its mask (bake-float-first resolves any pending float). Deleting selection contents is unaffected.

**Eyedropper → paint**: After sampling a color, the active tool switches to paint. Added `setActiveTool` to the tool context. Verified safe mid-gesture (paintTool guards on its own drag state).

---

## 5. Move Tool — Full Rewrite to Direct Translation

**New file**: `src/store/moveActions.ts` (`beginMove`/`updateMove`/`endMove`, module-level gesture snapshot).

**Modified files**: `src/engine/tools/moveTool.ts` (rewritten), `src/store/types.ts` (new `MoveActionsSlice`, `moveGrid` drag kind), `src/store/useAppStore.ts`, `src/engine/tools/types.ts`, `src/components/editor2d/usePixelCanvasTools.ts`, `src/engine/tools/selectionMask.ts` (removed now-dead `fullCanvasRegion`).

**Behavior**: Move is now a **direct, live translation of voxels — no selection, no float**.
- Plain drag: moves all voxels on the current plane slice.
- **Alt-drag**: moves the entire model.
- Both translate along the plane's u/v world axes (via `planeLogicalBasis`), live during the drag, as one undo stroke.
- Out-of-bounds cells aren't re-placed but stay in the snapshot so they return if dragged back.
- Repositioning a partial selection remains the Select tool's job (unchanged).

---

## 6. UI Changes

### Left Toolbar Voxel-Kind Toggle

**Files**: `src/components/panels/LayerToggle.tsx` (new), `src/components/panels/voxelKindIcons.tsx` (new), `src/components/layout/LeftPanel.tsx`, `src/components/panels/FloatingPalette.tsx`.

Moved the Cube/Chamfer voxel-kind toggle out of the floating palette to the bottom of the left toolbar (below Move), as a bordered vertical segmented toggle. Uses inlined SVG icons (`CubeIcon`/`ChamferIcon`, copied from `assets/cube.svg`/`assets/chamfer.svg` since those assets are outside the TS `src` include and there's no svgr plugin). Active state driven by explicit conditional classes from `activeVoxelKind` (not Radix data-state) for reliable highlight.

### 2D/3D Plane Controls

**Files**: `src/components/editor2d/Editor2D.tsx`, `src/components/editor2d/PlaneControlsOverlay.tsx` (new), `src/components/viewport3d/ViewOptionsOverlay.tsx`.

- **2D changes**: Removed the secondary header. The 2D panel now has a floating top-right overlay with plane-offset up/down stepper.
- **3D changes**: The 3D overlay gained a plane axis-cycle button and the flip-orientation button (moved from 2D), plus a new **Reset camera** button (rightmost, calls `OrbitControls.reset()` via `orbitControlsRef` in `Viewport3D.tsx`).

### Shift+Wheel Layer Scrubbing

**New file**: `src/components/usePlaneLayerScroll.ts`, used by `Viewport3D.tsx` and `Editor2D.tsx`.

Shift + mouse wheel steps the construction-plane offset on either panel. Capture-phase, non-passive listener that suppresses the panel's own wheel behavior (OrbitControls zoom / 2D canvas zoom-pan). Reads deltaY or deltaX (browsers remap the wheel axis while Shift is held).

### 2D Chamfer Fill Marker

**File**: `src/components/editor2d/PixelCanvas.tsx`.

Every chamfer cell on the active plane now shows the diagonal-stripe marker (previously only shape-resolved chamfers did). Condition changed from `chamfer.resolvedTo` to `chamfer.has(key)`, matching the float-render path. Freshly-painted unresolved chamfers are now visually distinct from cubes.

---

## Verification

- `tsc -b` — no type errors.
- `oxlint` — no lint errors.
- `vitest` — 102 tests passing.
- `vite build` — clean production build.
- `npm run map` — regenerated CODEMAP.md.
- Browser testing — deferred to user.

---

## Open Questions / Follow-ups

1. **Rotate/mirror of chamfer selections**: Shapes are kept verbatim (don't rotate). A proper implementation would rotate `resolvedTo.rotation`/`planeOrientation` in the instance matrix. Future feature.
2. **SPEC.md reconciliation**: The spec still documents the CSG-based GLTF export and auto-resolve chamfer workflow. Not updated (out of scope).
3. **Dead code**: `resolveChamferCellsOnPlane` retained only for its tests. Can be removed if/when those tests are rewritten or deemed unnecessary.

---

## Updated Documentation

- **`docs/ARCHITECTURE.md`** — Added two SPEC deviations (chamfer resolution rule, GLTF export). Updated chamfer system and 2D editor sections. Added mesh optimization and GLTF export subsection.
