# Spec: Wireframe + Optimized-Mesh toggles on the 3D preview

## Context

The voxpaint 3D preview (`src/components/viewport3d/Viewport3D.tsx`) renders the model as
`InstancedMesh` pools (cube + chamfer prefabs). The user wants two view toggles **on the 3D
preview**:

1. **Wireframe** — show the rendered mesh as wireframe.
2. **Optimized mesh** — replace the instanced voxels with a single merged mesh whose coplanar,
   connected, same-color faces are welded into larger polygons (real triangle-count reduction),
   using a port of the referenced optimizer at
   `../zanpo-brick-designer/packages/solidify-3d-engine/src/utils/mesh-optimizer.ts`.

Together they let you preview/verify the optimized export geometry (wireframe makes the triangle
reduction visible).

### Confirmed decisions (from the user)
- **Full optimizer port** (coplanar-merge) + add the small `earcut` dependency it needs. Surface a
  before/after triangle count.
- **Preserve per-voxel palette colors** in the optimized mesh (coplanar faces merge only when they
  share a color).

---

## Key facts from codebase exploration (ground truth for execution)

**Layout / where toggles go**
- `src/components/layout/MainLayout.tsx`: `grid-cols-2` → `<Editor2D />` + `<Viewport3D />`. No
  right-panel chrome; Viewport3D is a bare `<div className="h-full min-w-0 bg-neutral-900">` wrapping
  an R3F `<Canvas>`. Toggles go as an **absolute overlay inside that div** (make the div `relative`).
- Overlay precedent: `src/components/panels/FloatingPalette.tsx` — `absolute … z-40 … rounded-…
  border border-neutral-800 bg-neutral-900/80 … backdrop-blur-lg`, with `onPointerDown/Move`
  `stopPropagation` so the canvas/orbit controls don't grab the events.
- Toggle style precedent: `src/components/panels/FullscreenToggle.tsx` (icon button:
  `flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800
  hover:text-neutral-100`) and `ToolPalette.tsx`/`LayerToggle.tsx` (Radix ToggleGroup active state:
  `data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-300`). Icons from `lucide-react`.

**Store**
- `src/store/viewSlice.ts` already holds ephemeral view flags (`fullscreen: false` + `setFullscreen`
  is the exact precedent). Slice type in `src/store/types.ts` (`ViewSlice`, ~lines 95–103); already
  included in `AppState` and composed in `src/store/useAppStore.ts`. Immer setters:
  `set((state) => { state.x = v })`. ViewSlice state is **not persisted** (fine — these are ephemeral).

**3D rendering internals**
- `src/engine/instancing/InstancingManager.ts`: single shared `this.material =
  new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })` used by all 7 render
  pools; a separate invisible `pickMesh` (AABB unit cubes) drives plane-picking. `POOL_IDS =
  ['cube','ramp','convex','concave','rampM','convexM','concaveM']`, meshes in `this.meshes[id]`.
  Per-cell color: `resolveSlotColor(palette, colorCell.paletteSlot)` → `new THREE.Color(hex)` →
  `setColorAt`. `poolIdFor(chamfer)` (private) maps a cell to plain vs `…M` (v-mirrored) pool.
- `src/engine/chamfer/chamferGeometry.ts` exports `unitCubeGeometry()` (**BoxGeometry — INDEXED**),
  `rampGeometry(0)`, `convexCornerGeometry(0)`, `concaveCornerGeometry(0)` (**non-indexed**, centered
  `[-0.5,0.5]³`), `mirrorVGeometry(g)`.
- `src/engine/instancing/basis.ts` exports `cubeInstanceMatrix(coord, out)`,
  `chamferInstanceMatrix(coord, axis, orientation, rotation, out)` (always det=+1),
  `chamferBasisIsReflected(axis, orientation)`. Reflected planes require the `…M` geometry (mirrors
  `poolIdFor`). Instance matrices are rigid (rotation+translation), so normals transform by the
  matrix's upper-3×3 directly.
- `resolveSlotColor` in `src/engine/palette/palette.ts` → `#rrggbb`; `PaletteState` on `store.palette`.
- Model: `src/engine/grid/GridStore.ts` `decodeKey`/`encodeKey`; iterate `model.color.keys()`
  (authoritative occupied set). `ChamferCell = { planeAxis, planeOrientation, resolvedTo:
  {shapeKind:'ramp'|'convex'|'concave', rotation:0|1|2|3} | null }`.
- Lighting: `src/components/viewport3d/SceneLighting.tsx` (ambient + 2 directional) — a merged mesh
  reusing a lit `MeshLambertMaterial(vertexColors, DoubleSide)` will shade correctly.

**Deps**: `three ^0.185.1`; `earcut` is **NOT** present → must add `earcut` + `@types/earcut`.
`three/addons/utils/BufferGeometryUtils.js` is available but not needed (we accumulate arrays directly).

**Architecture rule**: `src/engine/` = pure logic, no React. Optimizer + builder live there; the
React glue lives in `src/components/viewport3d/`. Do **not** touch docs (CLAUDE.md rule).

---

## Implementation

### 1. Dependencies
Add `earcut` + `@types/earcut` (`npm install earcut && npm install -D @types/earcut`).

### 2. Store — `src/store/types.ts` + `src/store/viewSlice.ts`
Extend `ViewSlice` with `wireframe: boolean; optimizedMesh: boolean` and
`setWireframe(v)/setOptimizedMesh(v)`. Init both `false` in `viewSlice.ts`, mirroring `fullscreen`.

### 3. Mesh optimizer — new `src/engine/instancing/meshOptimizer.ts`
Port the referenced `mesh-optimizer.ts`, adapted for voxpaint:
- Replace the `brushColorSlot/brushTexture/brushMetallic` triple with a **single numeric `colorKey`**
  attribute (packed `THREE.Color.getHex()`), used as the material-match key so faces of different
  colors never merge. Carry a `color` (r,g,b) vertex attribute for rendering.
- Keep the algorithm: group coplanar (`NORMAL_THRESHOLD`/`COPLANAR_THRESHOLD`) + edge-connected +
  same-`colorKey` triangles → extract boundary loops → simplify collinear → `earcut` re-triangulate
  → rebuild with the group's reference normal + color. `import earcut from 'earcut'`.
- Output geometry attributes: `position`, `normal`, `color` (drop UVs/brush attrs). Provide
  `optimizeGeometry(geom)` and a `triangleCount(geom)` helper.
- Strip the `console.log` spam; satisfy oxlint + `verbatimModuleSyntax` (`import type` where needed;
  avoid stray `any` where the linter objects — the reference uses `any` liberally, tighten as needed).

### 4. Merged-geometry builder — new `src/engine/instancing/voxelMeshBuilder.ts` (pure)
`buildOptimizedVoxelGeometry(model, palette): THREE.BufferGeometry`. Pipeline: accumulate faces →
**shell pass (interior-face cull)** → assemble geometry → coplanar-merge optimizer.
- Accumulate a `Face[]` (each `{a,b,c:Vec3, normal:Vec3, colorKey:number}`), iterating
  `model.color.keys()`; `coord=decodeKey`, `chamfer=model.chamfer.get(key)`; color via
  `resolveSlotColor`→hex→`colorKey` (packed int).
  - **Plain cube**: emit its 6 faces via a canonical `pushQuad(worldCorners4, outwardNormal,
    colorKey)` — split along the diagonal connecting the lexicographically **min & max** corner
    (`s0–s3`), winding fixed to the outward normal. This makes a cube's `+X` face and the neighbour
    cube's coincident `−X` face produce *identical* vertex-triples (opposite normals), so the shell
    pass can cancel them. (Do NOT use `BoxGeometry` here — its opposite faces triangulate on
    mismatched diagonals.) Cube world corners come from `coord`/`coord+1`.
  - **Chamfer**: transform the prefab geometry (non-indexed ramp/convex/concave + `…M` variant per
    `chamferBasisIsReflected`) by `chamferInstanceMatrix(coord, axis, orientation, rotation)`;
    position by the matrix, normal by its upper-3×3 (rigid, det+1). One `Face` per prefab triangle.
- **Shell pass** `removeInteriorFaces(faces)`: key each face by its sorted, quantized vertex-triple;
  drop any key that has exactly 2 faces with opposing normals (`dot < ~-0.9`). Removes back-to-back
  interior faces (cube–cube reliably via the canonical quad; chamfer interior faces cull when their
  triangulation coincides, else remain hidden — acceptable, note it). Export it for testing.
- Assemble one non-indexed `BufferGeometry` (`position/normal/color/colorKey`) from the surviving
  faces, run `optimizeGeometry`, return it. Guard empty model (return empty geometry). Return/derive
  raw vs optimized triangle counts for the overlay stat.

### 5. InstancingManager — two methods
- `setWireframe(v)`: `this.material.wireframe = v` (flips all render pools; pick material untouched).
- `setRenderVisible(v)`: `for (const id of POOL_IDS) this.meshes[id].visible = v`. Leaves the
  invisible `pickMesh` alone so **construction-plane picking keeps working while the optimized mesh
  is shown**.

### 6. React glue (`src/components/viewport3d/`)
- **`OptimizedMeshView.tsx`** (new): reads `model`, `palette`, `wireframe`; `useMemo` →
  `buildOptimizedVoxelGeometry(model, palette)` (dispose previous on change); renders
  `<mesh geometry={geom}><meshLambertMaterial vertexColors side={THREE.DoubleSide}
  wireframe={wireframe} /></mesh>`.
- **`VoxelInstancedMeshes.tsx`**: read `wireframe` + `optimizedMesh`; `useEffect` →
  `manager.setWireframe(wireframe)` and `manager.setRenderVisible(!optimizedMesh)`. Manager stays
  mounted (owns picking).
- **`Viewport3D.tsx`**: make outer div `relative`; read `optimizedMesh`; render `<OptimizedMeshView />`
  inside the Canvas when on; mount the overlay UI (below) inside the div.
- **`ViewOptionsOverlay.tsx`** (new): absolute overlay (top-right) matching FloatingPalette frosted
  style; two toggle buttons (lucide icons — e.g. `Grid3x3` wireframe, `Boxes`/`Combine` optimized)
  with the violet active state; `stopPropagation` on pointer events. Wire to `setWireframe` /
  `setOptimizedMesh`. Optionally show `optimizedTris / rawTris` when optimized is on.

---

## Verification
- `npm install` (earcut), then `npx tsc -b`, `npm run lint`, `npx vitest run` — all clean.
- **New tests**: `meshOptimizer.test.ts` — a flat N×N wall of same-color cube faces optimizes to far
  fewer triangles; different colors don't merge across the boundary. `voxelMeshBuilder.test.ts` —
  builds a non-indexed geometry with a `color` attribute and >0 vertices for a small model; empty
  model → empty geometry.
- **Manual (human — I can't browser-test)**: toggle Wireframe → mesh renders as wireframe; toggle
  Optimized → single merged mesh, colors preserved, visibly fewer tris in wireframe; orbit still
  works; construction-plane click/hover still works with the optimized mesh shown; toggles read as
  native to the app's dark/violet styling.

## Notes / risks
- The optimizer merges only *connected coplanar same-color* faces; internal faces between adjacent
  solid cubes remain (hidden) — expected, matches the reference.
- Optimization is on-demand + memoized on `model`/`palette`; models are small
  (`DEFAULT_GRID_EXTENT=16`), so the O(n²) grouping is acceptable.
- Keep `material.color` white `0xffffff` (instanced path); the optimized mesh uses `vertexColors`
  instead of instanceColor.
