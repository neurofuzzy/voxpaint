# HANDOFF — Custom (incl. odd) project sizes

_Last session: 2026-07-16. Author: Claude (Opus 4.8). Branch: `enhancements`._

## Goal
Add a **Custom** size option to the New Project modal (integer edge length **2–32**, presets
8/16/24 stay). Motivation: **odd** sizes like 9³ so the model has a single **center pillar** (a
voxel column at the exact middle).

## Current approach (implemented, but NOT visually right yet)
"Odd → even internally, half-cell shift in the views only."
- The engine's coordinate system (the corner-anchored `-v-1` mirror in
  `engine/plane/constructionPlane.ts`, plus instancing/chamfer/texture) is only self-consistent for
  **even** extents (ranges symmetric about −0.5). So an odd size is rounded up to the next even grid
  and the engine works on that — no odd number reaches the coordinate math.
- Helpers in `engine/grid/GridStore.ts`:
  - `effectiveExtent(e)` → `e` if even, else `e+1` (the grid the engine actually uses).
  - `viewOriginShift(e)` → `0` even, `0.5` odd (a **view-only** half-cell nudge).
- `withinWorkingBounds`, `faceSizeFor`, `halfWorldFor` all use `effectiveExtent` (so even sizes are
  byte-for-byte unchanged; odd paints/textures its full even grid).

### Why this was chosen
The alternative — a true centered odd grid — requires making the `-v-1` mirror **extent-aware** and
threading `gridExtent` through ~15 call sites incl. the sensitive 3D `instancing/basis.ts` and
`chamfer/chamferResolver.ts`. We deliberately avoided that. See "Decision point" below — the visual
problems may push us to reconsider.

## What works
- Build, lint (only the pre-existing `AnimatedModelView` warning), and **160/160 tests** pass.
- Custom even sizes (10, 12, 20, …) work correctly and look right — they're just normal even grids.
- Odd sizes are **functional**: no paint off-by-one, bottom row paints, no crash. The earlier
  odd-bounds bug ("draw 1 above, can't draw bottom") is gone because the grid is genuinely even.

## KNOWN BUGS (from user testing a 9³ project — screenshots reviewed)
1. **Both views show 10×10(×10), not 9×9(×9).** By design the padding column is visible. The user
   wants it to *look* 9³. This is the core unresolved UX question (see Decision point).
2. **2D canvas shows two near-center axis lines** (`components/editor2d/PixelCanvas.tsx`).
   Root cause: the bright origin crosshair is drawn at `origin = viewOriginShift = 0.5`
   (`strokeGridLines([origin], '#7ac8ff')`), but the **subdivision** line at world **0**
   (`i % 8 === 0` → `subdivLines` includes 0, color `#3d6d8a`) is still drawn because the skip guard
   `if (i === origin) continue` only skips 0.5, not 0. → two bluish lines side by side.
   Even sizes are fine (origin=0, so the i=0 line is the crosshair and nothing doubles).
3. **3D construction-plane grid is 10×10 and off-center** (`components/viewport3d/ConstructionPlaneVisual.tsx`).
   Root cause: the `gridHelper` is drawn at world **0** (I intentionally did NOT shift it, to keep its
   lines on integer cell boundaries), size = `effectiveExtent` = 10. But the **camera target** and the
   **central axis gizmo** (`ConstructionPlaneGizmo.tsx`) were shifted to **0.5**. So the grid looks
   off-center relative to everything else, and it reads as 10×10.

## Decision point for next session (pick one, then finish)
The even-internal approach inherently *shows* the padding column. Making a 9³ actually **look** 9³
centered has two clean routes:

- **Route A — crop the views to the odd region (keep even engine).** Draw only the 9 centered cells
  and spotlight/frame them; keep the engine on the even grid. Caveat: the `-v-1` mirror means the
  displayed 9-cell window and the paintable world region are offset per-axis, so this needs care to
  keep "what's drawn" == "what's paintable" (gate the draw loop on `withinWorkingBounds` of the
  mapped coord, and center via `viewOriginShift`). Lower risk, but fiddly to get pixel-perfect.
- **Route B — extent-aware mirror (true centered odd, no padding).** Generalize `-v-1` to
  `(cellLo+cellHiExcl-1) - v` (i.e. `-v-1` for even, `-v` for odd) and thread the extent through
  `gridCoordFromPixel`/`pixelFromGridCoord`/`toDisplayU`/`toDisplayV` and their ~15 callers (incl.
  `instancing/basis.ts`, `chamfer/chamferResolver.ts`). Delivers a genuinely 9-wide centered grid
  everywhere with no padding column. Higher effort/risk; add odd-extent tests for basis + chamfer.

**Recommendation:** if the padding column is acceptable, finish Route A + fix bugs 2 & 3 (cheap). If
the user insists a 9³ must truly be 9 wide with a dead-center pillar and no visible padding, do
Route B — it's the only approach that looks fully correct, and budget for the instancing/chamfer
re-verification.

### If we keep the current (even+shift) approach, the immediate fixes are:
- Bug 2: for odd, either draw the origin crosshair at world 0 (drop the +0.5 crosshair) OR remove 0
  from `subdivLines` when `origin !== 0`. Decide whether the "axis" should sit at 0 or 0.5.
- Bug 3: shift the construction-plane `gridHelper` group by `viewOriginShift` in-plane to match the
  gizmo/camera — BUT that puts its lines on half-integers (misaligned with voxels). So instead,
  reconsider: probably the gizmo + camera should target **0** (not 0.5), matching the aligned grid,
  and accept the model is centered on the even grid's true center. i.e. the "+0.5 everywhere" may be
  wrong — align on 0 and let cell 0 be one-off-center, OR go Route B.

## Changeset (all uncommitted on `enhancements`)
```
 M src/engine/grid/types.ts              GridExtent = number
 M src/engine/grid/GridStore.ts          + effectiveExtent, viewOriginShift; withinWorkingBounds uses effective
 M src/engine/texture/types.ts           faceSizeFor/halfWorldFor use effectiveExtent
 M src/store/projectSlice.ts             newProject clamps/rounds to [2, MAX_GRID_EXTENT]
 M src/components/panels/NewProjectDialog.tsx   Presets + Custom numeric field (2–32)
 M src/components/editor2d/PixelCanvas.tsx      half via effectiveExtent; origin crosshair at viewOriginShift  ← bug 2 here
 M src/components/editor2d/usePixelCanvasTools.ts  half/zoom via effectiveExtent; pan = -viewOriginShift
 M src/components/viewport3d/ConstructionPlaneVisual.tsx  grid uses effectiveExtent; integer coarse divisions  ← bug 3 here
 M src/components/viewport3d/ConstructionPlaneGizmo.tsx    group shifted to viewOriginShift
 M src/components/viewport3d/BoundingBoxFaceSelector.tsx   box uses effectiveExtent
 M src/components/viewport3d/Viewport3D.tsx     cameraPosForExtent uses effectiveExtent + shift; target = shift
 M CODEMAP.md
?? src/engine/grid/GridStore.test.ts     tests for effectiveExtent/viewOriginShift/withinWorkingBounds
```

## Stashes (recoverable)
- `git stash list` → `stash@{0}`: **"custom-size: odd-bounds approach (WIP, superseded…)"** — the
  FIRST attempt (a floor-based `cellLo`/`cellHiExcl`/`volumeCenter` true-odd bounds approach). It hit
  the same mirror off-by-one. Contains a useful `boxMapping` odd round-trip test and the flip-aware
  texel-offset analysis (the flipped `-Y` axis needs `ceil`, not `floor`) if Route B is chosen.
  `git stash show -p stash@{0}` to inspect; don't blind-pop (it conflicts with current changes).

## Prior commits this session (already landed, unrelated to the bug)
- `f1fab68` Add onboarding UI: help, tour, splash.
- `f94752f` Frame 2D/3D views by project extent (per-size default zoom + camera framing). The custom-
  size work builds on top of this.

## Key facts / constraints
- Coordinate convention: cells are **corner-anchored** (cell n spans world [n, n+1)); origin (0,0,0)
  is a cell **corner**. The `-v-1` mirror (`constructionPlane.ts`) is the crux of the odd problem.
- `MAX_GRID_EXTENT = 64` (technical cap); Custom UI caps at 32 for perf.
- Persistence needs no schema/migration change — `gridExtent` is already a free numeric field.
- Project rules: **no dev server, no browser testing by the agent** — verify via `npm run build`,
  `npm run lint`, `npm test`, and hand off to the human. Run `npm run map` after adding exports.

## Verify commands
```
npm run build   # tsc -b && vite build
npm run lint    # oxlint (pre-existing AnimatedModelView warning is expected)
npm test        # vitest run — 160 tests currently green
npm run map     # regenerate CODEMAP.md
```
