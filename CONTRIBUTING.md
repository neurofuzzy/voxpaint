# Contributing to VoxPaint

Thanks for your interest! This is a small project, so a quick note before you dive in:
**for anything beyond a small fix, please open an issue first** so we can align on the
approach before you invest time.

## Development

Requires Node 20+ (`.nvmrc` provided).

```bash
npm install
npm run dev       # dev server with HMR
npm run build     # tsc -b && vite build (typecheck + production build)
npm run lint      # oxlint
npm run test      # vitest
```

Before opening a PR, make sure `npm run lint`, `npm run build`, and `npm run test` all pass.

## Conventions

- **Architecture:** keep pure logic in `src/engine/` (no React/JSX), state in `src/store/`
  (Zustand + Immer), and thin components in `src/components/`. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Imports:** `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- **Code map:** `CODEMAP.md` is generated. If you add or move exports, run `npm run map`
  to regenerate it.

## Pull requests

Keep PRs focused and describe what changed and why. Reference any related issue.
