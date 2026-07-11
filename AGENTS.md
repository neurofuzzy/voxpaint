# AGENTS.md

> See `CODEMAP.md` for an auto-generated source map of all modules and exports. Run `npm run map` to regenerate.

## Commands

```bash
npm run dev          # Vite dev server (HMR)
npm run build        # tsc typecheck then vite build
npm run lint         # oxlint
npm run preview      # Vite preview of production build
```

Build runs `tsc -b && vite build` — typecheck comes first and must pass.

No test command yet. Tests go in `src/` (Vitest expected — Vite-native).

## Architecture

```
src/
  engine/          # Pure logic, framework-agnostic, no React/JSX
    grid/          # CellKey encode/decode, VoxelModel, bounds, 64³ cap
    plane/         # ConstructionPlane math, plane←→grid mapping
    chamfer/       # Autotile classification, validation, mesh geometries
    instancing/    # InstancingManager (4 InstancedMesh pools), shared shader
    csg/           # GLTF export pipeline
    persistence/   # JSON schema, serialize, migrations, autosave
    palette/       # Palette types, default colors, slot resolution
    tools/         # Bresenham line utils, ortho snap

  store/           # Zustand + Immer middleware
    types.ts       # AppState type (union of all slices)
    useAppStore.ts # Root store, composes slices
    *Slice.ts      # One slice per concern
    wireAutosave.ts# Autosave subscriber

  components/
    editor2d/      # PixelCanvas (plain <canvas> 2D context)
    viewport3d/    # R3F Canvas, InstancedMeshes, gizmo, lighting
    layout/        # MainLayout, TopToolbar, LeftPanel, RightPanel
    panels/        # ToolPalette, PaletteGrid, LayerToggle, FileMenu, etc.
    ui/            # Toast system (Radix + pub/sub bus)

  App.tsx          # Root: auto restore, wire autosave, toasts
  main.tsx         # Entry: mounts App
```

Components are thin — they read Zustand slices and forward events to engine modules. No business logic in `.tsx`.

## Key Conventions

### Path aliases
`@/` = `src/`. Configured in both `vite.config.ts` and `tsconfig.app.json`.

### Zustand store
- Single root store with immer middleware (`zustand/middleware/immer`).
- `enableMapSet()` called before store creation (model uses `Map`).
- Slices composed via spread in `useAppStore.ts`.
- `getState()` for non-reactive access (e.g. `paintAt` in PixelCanvas).
- Undo gestures: call `beginStroke()` before painting, `commitStroke()` on pointer up.

### Type imports
`verbatimModuleSyntax` is on. Use `import type` for type-only imports — omitting it will fail the build.

### VoxelModel
- Sparse `Map<CellKey, ColorCell>` and `Map<CellKey, ChamferCell>`.
- `CellKey` = `"x,y,z"` string (encodeKey/decodeKey in GridStore.ts).
- `VoxelModel.bounds` is `BBox | null` — recomputed on removal.
- 64³ hard cap via `MAX_GRID_EXTENT` constant.
- **Treat maps as immutable outside of Immer producers** — direct mutation breaks structural sharing.

### Chamfer system
- 3-shape autotile: ramp / convex corner / concave corner.
- Classified at paint time from 8-neighborhood of chamfer layer only.
- **Baked frozen** — editing neighbors never reclassifies existing cells.
- Invalid configurations blocked (no fallback shape).
- Chamfer paint always also writes the color layer.
- Shared corner/side conventions (clockwise from NE/N): `chamferResolver.ts` and `chamferGeometry.ts` must stay in sync.

### 3D rendering
- `InstancingManager` lives **outside React** — created once via `useMemo`, synced imperatively.
- 4 `InstancedMesh` pools: cube, ramp, convex, concave.
- Single shared `ShaderMaterial` with `uClock` uniform for emissive/blink/pulse.
- Full rebuild on model change (simplified v1 approach, not incremental diffs).

### Palette
- 28 slots: 16 base + 4 emissive + 4 blink + 4 pulse.
- Cells store `{ kind, index }` slot refs, not resolved hex values.
- `resolveSlotColor()` in `engine/palette/palette.ts` resolves ref to hex.

### Persistence
- Single JSON schema for both localStorage autosave and file export/import.
- `schemaVersion` field + migration registry pattern (empty for v1).
- Autosave debounced, wired via `wireAutosave.ts` subscriber.

### Construction plane
- `{ axis, orientation (+1|-1), offset }`.
- Axis widget in 3D view sets axis+orientation, offset unchanged.
- Face-click in 3D: normal → axis+orientation, cell coordinate → offset.
- Cyclic (u,v) basis: x→(y,z), y→(z,x), z→(x,y).

### Styling
- Tailwind CSS v4 (plugin-based, no tailwind.config.js needed).
- Dark-mode only (`class="dark"` on `<html>`, `color-scheme: dark` in CSS).
- `@apply` available in `index.css`.

## Out of Scope for v1
- Touch/stylus and mobile layout
- Coplanar-quad mesh optimization beyond CSG union + weld
- Cross-session undo history
