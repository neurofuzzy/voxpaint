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

---

## 2026-07-12 — Texture Authoring (Box-Mapped Surface Texturing)

VoxPaint gained a second top-level authoring mode. The app now has **two modes**: `model` (original voxel modeler) and `texture` (paint a 6-sided, box-mapped grayscale texture onto the whole model).

### Design: Modular, Loosely Coupled

- Single top-level `mode` switch (`store/modeSlice.ts`), whole-subtree gating in components (never `if (texture)` sprinkled throughout).
- Separate undo/redo history for texturing (`store/textureSlice.ts`'s `texturePast`/`textureFuture`).
- Reuse of only pure leaf helpers between stacks (e.g., `bresenhamLine`, `selectionMask`, voxelMeshBuilder UV injection).

### Key Technical Decisions

- **Texture resolution**: 4× the voxel resolution (each texel = 0.25 voxel). At the default 16³ working volume: 64×64 texel grid per face.
- **Grayscale palette**: 8 evenly-spaced values (indices 0–7 map to `index/7`, deliberately skipping 0.5 so no neutral no-op swatch).
- **Blend mode**: OVERLAY (not multiply) — chosen specifically because multiply can only darken, whereas overlay can lighten. Computed in sRGB space (neutral pivot at 0.5).
- **Chamfer projection**: sloped normals disambiguated by projecting along the axis the chamfer was authored in (`ChamferCell.planeAxis`/`planeOrientation`).
- **Box-map wrapping**: opposite faces mirror one in-plane axis (standard box-map wrap). Per-face flips (`nx`/`nz` flip U, `py` flip V) ensure the texture reads correctly viewed from outside.
- **Immer + Uint8Array**: every texel edit builds the next model outside the producer via copy-on-write (`cloneTextureModel`), since Immer treats typed arrays as opaque.

### Files Added

**Engine** (`src/engine/texture/`):
- `types.ts` — `BoxFace`, `TextureModel`, `TEXEL_SCALE`, `GRAYSCALE`, `EMPTY` sentinel.
- `TextureStore.ts` — helpers (`getTexel`, `cloneTextureModel`, `hasTextureContent`).
- `boxMapping.ts` — core: `worldToTexel`, `boxFaceForCell`, `buildBlendAtlas`, `FLIP_U`/`FLIP_V` per-face corrections.
- `overlay.ts` — `overlayChannel` (JS) + GLSL fragments (`OVERLAY_MAP_FRAGMENT`/`OVERLAY_COLOR_FRAGMENT`, inlined to avoid compiler issues).
- `textureTools.ts` — parallel tool set (`textureToolMap`), reusing pure leaf helpers, over `TextureToolContext`.
- `texelOps.ts` — flat-grid ops (flood fill, copy/paste, rotate/mirror).
- `texturedGeometry.ts` — `buildTexturedGeometry` / `buildTexturedGeometryByColor` (voxel mesh with box-map UVs).
- `projection.ts` — `projectModelToFace` (render model silhouette onto texture face as paint-alignment guide).
- Tests: `boxMapping.test.ts`, `overlay.test.ts`, `store/textureSlice.test.ts`, `serialize.test.ts`.

**Store** (`src/store/`):
- `modeSlice.ts` — `mode: 'model'|'texture'`, `setMode`.
- `textureSlice.ts` — full parallel texture stack: `texture`, `activeBoxFace`, `activeGrayIndex`, own history (`texturePast`/`textureFuture`), selection/float/clipboard, all texture-editing actions.

**Components** (`src/components/`):
- `editor2d/TextureCanvas.tsx` — 2D drawing surface (texels + projection guide, no grid).
- `editor2d/useTextureCanvasTools.ts` — pointer adapter, texel-scaled camera.
- `editor2d/textureCanvasConstants.ts` — texel coordinate math.
- `viewport3d/TexturedModelView.tsx` — 3D preview with overlay shader (patched via `onBeforeCompile`).
- `viewport3d/BoundingBoxFaceSelector.tsx` — clickable emissive wireframe box for face selection.
- `panels/ModeTabs.tsx` — Model/Texture mode tabs (TopToolbar).

### Files Modified

- **`engine/instancing/voxelMeshBuilder.ts`** — `Face.chamfer` optional ref, new `buildTexturedShellGeometry` / `buildTexturedShellGeometryByColor` (shell faces, per-vertex UVs via injected callback, per-vertex color). Coplanar-merge optimizer intentionally skipped for textured output.
- **`engine/export/gltfExport.ts`** — `exportModelToGlb(model, palette, texture?)` bakes overlay into per-(color, emissiveClass) texture atlases (192×128 RGBA each) when texture present. Export uses standard glTF `baseColor × map`, so preview matches export exactly.
- **`engine/persistence/schema.ts`** — `CURRENT_SCHEMA_VERSION` bumped 1 → 2. `VoxPaintProjectFileV2` adds optional `texture: SerializedTexture` (base64 per face).
- **`engine/persistence/serialize.ts`** — `serializeProject` / `deserializeProject` now include texture (base64 serialization, faceSize validation).
- **`engine/persistence/migrations.ts`** — `MIGRATIONS[1]` (v1 → v2 sets schemaVersion; optional texture loads empty).
- **`store/types.ts`** — added `EditorMode`, `ModeSlice`, `TextureSlice` types; `AppState` now intersects both.
- **`store/useAppStore.ts`** — composes `createModeSlice` + `createTextureSlice`.
- **`store/projectSlice.ts`** — `newProject` resets texture stack.
- **`store/wireAutosave.ts`** — serialize/restore include texture; autosave flushes on `state.texture` change.
- **`components/panels/FileMenu.tsx`** — export/import/GLTF pass texture through.
- **`components/editor2d/Editor2D.tsx`** — branches `mode === 'texture' ? <TextureCanvas/> : <PixelCanvas/> + <PlaneControlsOverlay/>`.
- **`components/editor2d/useKeyboardShortcuts.ts`** — mode-aware (texture history/selection/clipboard if texture mode; `hoverCellRef` made optional).
- **`components/editor2d/PixelCanvas.tsx`** — unchanged behavior; still calls `useKeyboardShortcuts`.
- **`components/viewport3d/Viewport3D.tsx`** — gates whole subtrees on mode: model = existing scene; texture = `<TexturedModelView/>` + `<BoundingBoxFaceSelector/>`.
- **`components/layout/TopToolbar.tsx`** — added `<ModeTabs/>` right of FileMenu.
- **`components/panels/FloatingPalette.tsx`** — branches on mode: texture shows 8 grayscale swatches (dark/light split); model shows 28-slot palette.
- **`components/panels/LayerToggle.tsx`** — disabled/greyed in texture mode.
- **`components/panels/UndoRedoControls.tsx`** — mode-aware (texture history vs voxel history).

### Verification

- tsc clean, oxlint clean, 116 unit tests pass, production build succeeds.
- NOT browser-verified (per project rule — user verifies in browser).

### Open Items / Known Limitations

- Browser verification pending: confirm all 6 face orientations read right-side-up, overlay levels look right across the 8 grays, projection guide aligns with model, exported .glb matches preview in Blender.
- Perf note: each texel stroke rebuilds blend DataTexture in preview (geometry cached). Fine at current scale; later could update only changed atlas sub-rect.
- Existing projects load with empty texture (backwards-compatible v1 → v2 migration).

---

## 2026-07-12 — Palette-Based PBR Render Pipeline, Material-Aware Shell Culling, and Analytical Ambient Occlusion

Large multi-part session migrating the renderer and export pipeline from flat Lambert + animation classes to a Palette-Based PBR model with analytical ambient occlusion baking.

### 1. Palette Material Model Refactor (Breaking Change)

**Files**: `src/engine/palette/types.ts`, `src/engine/palette/defaultPalette.ts`, `src/engine/palette/palette.ts`, `src/components/panels/FloatingPalette.tsx`, `src/engine/persistence/schema.ts`, `src/engine/persistence/migrations.ts`.

The palette's animation-oriented slot kinds `blink` and `pulse` were **removed** and replaced with material kinds `metal` and `glass`. Palette remains 28 slots but is now structured: base[16], emissive[4], metal[4], glass[4]. Metal swatches: silver/gold/bronze/copper. Glass: gray/blue/amber/green.

New API: `materialClassFor(kind): MaterialClass` (`'matte'|'emissive'|'metal'|'glass'`) and `materialParamsFor(class): {metalness, roughness, transmission, emissiveIntensity}`. Parameters: matte {0, 0.6, 0, 0}; emissive {0, 0.5, 0, 1.5}; metal {1, 0.2, 0, 0}; glass {0, 0.5, 1, 0}.

The flat instanced editing view (`InstancingManager`) no longer animates blink/pulse — only the hover highlight is animated. Material classes take visual effect only in the optimized-mesh PBR path and export (static glTF cannot animate).

**Persistence**: Schema bumped to v3 (`CURRENT_SCHEMA_VERSION = 3`). Migration `MIGRATIONS[2]` (v2→v3) reshapes the palette (drops blink/pulse hex, seeds metal/glass from defaults) and remaps cell refs from blink/pulse slots to emissive (index 0–3, lossy for animation). **Open caveat**: old projects lose their animation styling on import.

### 2. PBR Rendering — Optimized-Mesh Preview + Export

**Files**: `src/components/viewport3d/OptimizedMeshView.tsx` (new), `src/components/viewport3d/SceneEnvironment.tsx` (new), `src/engine/instancing/voxelMeshBuilder.ts`, `src/engine/export/gltfExport.ts`.

The optimized-mesh preview and glTF export now render the model as **at most FOUR meshes — one per material class** (matte/emissive/metal/glass). Different material classes are never merged. Each class mesh uses one `MeshPhysicalMaterial` with `vertexColors: true` and the class's PBR params; per-vertex colours ride the `color` vertex attribute.

Mesh builder carries `materialClass` on face geometry (not the old numeric emissive class). New functions: `buildOptimizedVoxelGroups()` for preview, `buildOptimizedVoxelGeometryByMaterial()` for export.

**Emissive per-vertex glow**: three's `emissive` is a single uniform, so emissive-class materials use an `onBeforeCompile` patch appending `totalEmissiveRadiance += vColor.rgb * <intensity>` after `#include <emissivemap_fragment>`. **Important gotcha**: three declares `varying vec4 vColor` even for RGB vertex colours, so `.rgb` is required (a bare `vColor` is a vec3+=vec4 type error that silently drops the mesh).

**Environment map**: metals and glass need `scene.environment` or they render black/have nothing to refract. New `SceneEnvironment.tsx` installs a PMREM-prefiltered `RoomEnvironment` (no network fetch, built-in), mounted in `Viewport3D.tsx` only when the optimized mesh is active. `MeshLambertMaterial` (flat view) ignores it.

**glTF export** (`gltfExport.ts`): untextured PBR path exports ≤4 vertex-coloured (`COLOR_0`) meshes named `voxel_<class>`, glass gets `transmission`/`ior`/`thickness` (three emits `KHR_materials_transmission`). **Emissive glow is not exported** — glTF cannot hold per-vertex emissive colour in one material (base colour is correct, but no glow; would need an emissive texture). Textured path unchanged (per-colour baked overlay baseColorTexture). New `GltfExportOptions { ambientOcclusion?: boolean }` param.

### 3. Material-Aware Shell Pass

**File**: `src/engine/instancing/voxelMeshBuilder.ts` (`removeInteriorFaces`).

Back-to-back coincident interior face pairs are culled by material class: (a) same class → drop both (hidden); (b) glass↔non-glass → drop **only the glass face**, keep the solid (so solid shows through transmission without z-fighting); (c) two different opaque classes (e.g. matte↔metal) → keep both (interior, unseen). Covered by `src/engine/instancing/voxelMeshBuilder.test.ts`.

### 4. Analytical Voxel Ambient Occlusion (New `src/engine/ao/`)

**Files**: `src/engine/ao/voxelAO.ts`, `src/engine/ao/bakeAO.ts`, `src/engine/ao/aoConstants.ts`, updated `src/engine/texture/boxMapping.ts`.

- `voxelAO.ts`: Pure `computeVoxelAO(samplePoints, cubes, options): Float32Array` (0=occluded, 1=lit), a renderer-agnostic port of the AO spec's directional analytical solver with all 6 axis cases and per-axis bounding cuts. Unit-tested in `voxelAO.test.ts`. Falloff is deliberately stylized (dimensionally loose), not a physical occlusion integral.
- `bakeAO.ts`: `bakeAOAtlas(model): {data, width, height}` bakes AO into a grayscale atlas at the same resolution/layout as the paint box-map atlas (`TEXEL_SCALE`, each texel = 0.25 voxel; 3×2 face packing). Per face, keeps the frontmost voxel per texel (same rule as texture projection) and samples AO on that voxel's outer surface plane. Occluders use voxel centres. Tested in `bakeAO.test.ts`.
- `aoConstants.ts`: Centralizes AO config — `AO_SEARCH_RADIUS`, `AO_EDGE_BIAS`, `AO_INDIRECT_FALLOFF`, `AO_DIRECT_FALLOFF`, `AO_INTENSITY`, `AO_STRENGTH` (final darken amount), `AO_DEFAULT_ENABLED` (false), assembled `AO_OPTIONS`.
- **Application**: AO is applied as a `MeshPhysicalMaterial.map` (grayscale, `NoColorSpace`) so it **multiplies the base colour** (`baseColour × COLOR_0 × ao`). Preview toggle lives in `viewSlice.ts` (`ambientOcclusion`, default off) with a button in `ViewOptionsOverlay.tsx` (shown only when optimized mesh is on). Export AO is opt-in via the export modal.
- **Helpers**: New `atlasUVForVertex(normal, x, y, z)` and `texelCenterToWorld(face, tu, tv, depth)` in `boxMapping.ts` for mesh UV ↔ world coord conversions; `FACE_ATLAS_CELL` exported.
- **Known limitation**: AO rides the box-map atlas, so stacked/overhang surfaces sharing a face-column share one AO value (frontmost wins) — the same depth ambiguity the paint atlas has. The AO algorithm is still being refined; it's off by default in both preview and export. A future depth-correct option would be a 3D occlusion field sampled in-shader.

### 5. Export Options Modal

**File**: `src/components/panels/ExportGltfDialog.tsx` (new).

New Radix `@radix-ui/react-dialog` modal (first dialog in the app). File ▸ "Export GLTF…" (`src/components/panels/FileMenu.tsx`) opens this modal instead of exporting immediately. Currently exposes one option: "Ambient occlusion" (default off). Calls `exportModelToGlb(model, palette, texture, { ambientOcclusion })`.

### 6. WebGPU Spec Reconciliation

The `gltf-materials-maps.md` and `ambient-occlusion.md` specs were written for raw WebGPU/WGSL. VoxPaint is three.js + R3F (WebGL). The intent was realized with stock `MeshPhysicalMaterial` (metalness/roughness/emissive/transmission) rather than literal WGSL passes. The analytical AO solver is renderer-agnostic (pure math), baked to a grayscale atlas in the box-map layout.

### Verification

- tsc clean, oxlint clean, 132 tests pass, `vite build` succeeds.
- NOT browser-verified (per project rule).

### Open Questions / Known Limitations

1. **Lossy v2→v3 migration**: Blink/pulse cells are remapped to emissive on import; animation is lost. Old projects will need manual re-styling.
2. **AO box-map depth ambiguity**: Stacked/overhang surfaces sharing a face-column share one AO value (frontmost wins). Same limitation as the paint atlas. AO is off by default and still WIP.
3. **Emissive glow not exported**: glTF has no way to express per-vertex emissive colour in a single material. Would need an emissive texture as a future optimization.
4. **Gotcha**: three declares `varying vec4 vColor` even for RGB colours, so emissive-class shader patches must use `.rgb` (bare `vColor` drops the mesh).
