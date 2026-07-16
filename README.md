<p align="center">
  <img src="assets/logo.svg" alt="VoxPaint" width="360" />
</p>

A browser-based voxel painting and modeling editor. Build low-poly models by painting
voxels on a construction plane, let chamfers autotile into smooth ramps and corners, and
export clean, optimized meshes to GLTF/GLB.

## Features

- **Voxel painting** in a 2D construction-plane view and a live 3D preview, up to a 64×64×64 grid.
- **Baked chamfer autotiling** — a 3-piece system (ramp / convex / concave) resolves smooth
  edges from neighboring voxels at paint time and freezes the result.
- **Indexed palette** — a 28-slot palette plus a library of curated themed palettes.
- **GLTF / GLB export** with mesh optimization (coplanar merging) and material maps.
- **Local persistence** — automatic autosave to the browser plus JSON project import/export.
- **Dark-mode UI** built on Radix primitives.

## Quick start

Requires Node 20+ (`.nvmrc` provided).

```bash
npm install
npm run dev       # dev server with HMR
npm run build     # tsc -b && vite build → dist/
npm run preview   # preview the production build
npm run lint      # oxlint
npm run test      # vitest
```

## Tech stack

React 19 · three.js + React Three Fiber · Zustand + Immer · Tailwind CSS v4 · Vite · Vitest · oxlint · TypeScript.

## Project layout

- `src/engine/` — pure logic, no React: grid, chamfer, plane math, instancing, persistence, export.
- `src/store/` — Zustand + Immer root store, typed slices (`@/` path alias = `src/`).
- `src/components/` — thin React components that read the store and forward to the engine.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full architecture writeup (data model,
  construction plane, chamfer system, 3D rendering, state slices, persistence).
- [`CODEMAP.md`](CODEMAP.md) — auto-generated map of all modules and exports (`npm run map`).
- [`docs/gltf-export-contract.md`](docs/gltf-export-contract.md) — the GLTF/GLB export contract.

## Desktop app

Native desktop packaging via [Tauri](https://tauri.app/) is planned — the app is a pure
client-side SPA with no backend, so it runs unchanged inside a Tauri shell.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Geoff Gaudreault
