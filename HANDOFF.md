# HANDOFF — VoxPaint

## RESOLVED: 3D voxel materials rendered wrong

**Root cause found:** three.js always multiplies `InstancedMesh.instanceColor` (set via
`mesh.setColorAt()`) against the shared `material.color` in the shader. This is gated on whether
`object.instanceColor` is present — **not** on `material.vertexColors` — so turning
`vertexColors` off (as earlier diagnostics did) never actually disabled the multiply. The
diagnostic material was hardcoded to solid red (`0xff0000`); every painted color was therefore
computed as `red * paletteColor`, which zeroes out the G/B channels and explains the "brightness
tracked the red channel" symptom and the "dark gray/black for non-red colors" original bug.

**Fix:** `src/engine/instancing/InstancingManager.ts` — shared material's base `color` is white
(`0xffffff`), making the `material.color * instanceColor` multiply an identity op. Material is
now `MeshLambertMaterial` (intentional choice: real per-face lighting from `SceneLighting.tsx`'s
ambient + 2 directional lights, not flat/unlit). **Base color must stay white** — this is called
out in the class docstring so it doesn't regress.

Ruled out along the way (left in place, all fine): point-light units/ACES tone mapping/intensity
tuning, `onBeforeCompile` shader patching, fog, antialiasing/optical illusion.

---

## Everything else (stable, not in question)

- **Tool-dispatch refactor** (SPEC §8): table-driven `toolMap`/`ToolHandler` in `engine/tools/`,
  `usePixelCanvasTools.ts` adapter hook. Tools: paint, erase, eyedropper, select, fill, clone,
  move. Move = shift whole plane slice; Select = drag-inside-selection also lifts/moves it.
- **Floating selection buffer**: lift/move/rotate/mirror/paste all defer to one `bakeFloatIfAny()`
  commit (Escape, new selection, or any mutating action bakes). Verified: one undo step for a
  whole lift→move→rotate→mirror→bake sequence.
- **Marching ants** (cyan, animated), **pan/zoom** (right-click-drag pans, wheel/pinch zooms,
  clamped to grid bounds + 100px padding), **grid lines** (fine/8-cell-subdivision/origin tiers,
  pixel-snapped for crispness).
- **Global keyboard shortcuts** (`useKeyboardShortcuts.ts`): tool hotkeys P/E/I/S/F/C/M, ⌘Z/⌘⇧Z,
  ⌘C/X/V, Delete clears selection, R/H/V rotate/mirror, Esc deselects.
- **Coordinate fix**: `gridCoordFromPixel`/`pixelFromGridCoord` in `constructionPlane.ts` — v was
  mapping to world-Y with no sign flip, causing upside-down models on x/z-axis planes. Fixed +
  `basis.ts` `WORLD_U/WORLD_V` updated to match. **Caveat**: this changes chamfer shape handedness
  on those planes — existing chamfer geometry may render mirrored left-right. Not yet visually
  confirmed; nobody has reported chamfer specifically broken.
- **3D construction plane**: now a real plane-aligned grid + draggable offset arrow gizmo
  (snapped), replacing the old static ground-only gridHelper. Flip-orientation button added next
  to the 2D editor's offset stepper.
- **Palette/layout**: floating bottom palette pill (no dimming on inactive swatches), BottomBar
  (undo/redo + tool-contextual hint text, height matches header).

## Do NOT re-litigate
- Palette default active swatch (`base[0]`) is intentionally near-black (`#2b2530`) — not a bug.
- Right-click = pan (drag) / quick-erase (click-no-drag) — intentional, replaces old drag-erase.
- Voxel material base color must be white (`0xffffff`) — see resolved bug above.
