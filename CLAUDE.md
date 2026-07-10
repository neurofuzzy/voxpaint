# CLAUDE.md

## Build / Run
```bash
npm run dev       # dev server (HMR)
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```

## Architecture
- `src/engine/` — pure logic (no React/JSX). Grid, chamfer, plane math, instancing, persistence.
- `src/store/` — Zustand + Immer. Single root store, typed slices. `@/` path alias = `src/`.
- `src/components/` — thin React components, read store, forward to engine.

## Critical Conventions
- `verbatimModuleSyntax` is on — always use `import type` for type-only imports.
- VoxelModel uses `Map`, not `ReadonlyMap`. Treat as immutable outside Immer producers.
- CellKey = `"x,y,z"` string (encodeKey/decodeKey in `engine/grid/GridStore.ts`).
- Chamfer shapes are baked at paint time, frozen forever. 3-piece autotile: ramp/convex/concave.
- Chamfer paint always also writes color layer. Invalid neighbor configs are blocked.
- InstancingManager lives outside React (no R3F state management on paint).
- Undo: call `beginStroke()` before painting, `commitStroke()` on pointer up.
- Palette is indexed (28 slots, cells store slot refs not hex).
- 64×64×64 hard cap (`MAX_GRID_EXTENT`).
- Dark-mode only, Tailwind v4 (plugin-based, no config file).
