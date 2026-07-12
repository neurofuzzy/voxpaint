# CLAUDE.md

> See `CODEMAP.md` for an auto-generated source map of all modules and exports. Run `npm run map` to regenerate.
> See `docs/ARCHITECTURE.md` for the full architecture writeup (data model, construction plane, chamfer system, 3D instancing/rendering, state slices, persistence) with file references, plus known deviations from `SPEC.md`.

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

## Behavior Rules
- NEVER stop a process you did not start (no running dev servers yourself)
- NEVER browser-test. That is the human's job
- IF you need to use an explore agent to find code and it's difficult to locate, make sure you update the function's JSDoc so that it appears in CODEMAP.md
- BEFORE updating docs, run `npm run map` to update the code map.
- ONLY update the docs (`./docs` folder md files and CLAUDE.md) when the user requests it.
- When a task or session is complete and documentation should be updated, compile a structured summary (files changed, decisions made, why, and any open questions) and delegate to the documenter subagent to write it into the project's docs. Don't delegate without first synthesizing the summary yourself — the documenter has no visibility into this conversation.
