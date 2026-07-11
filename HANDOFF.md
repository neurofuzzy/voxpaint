# HANDOFF — VoxPaint session end (out of tokens)

## ACTIVE BUG: 3D voxel materials render wrong

**Symptom history:** non-emissive voxels rendered "dark gray"/black regardless of assigned
palette color (only emissive-class cells showed correct color). Tried and ruled out, in order:

1. Point-light photometric units, ACES tone mapping, ambient/directional intensity tuning —
   none of it fixed it. (Left in place: `flat` on `<Canvas>`, ambient + 2 directional lights in
   `SceneLighting.tsx` — these are fine/reasonable but were NOT the actual bug.)
2. Suspected `MeshStandardMaterial` + custom `onBeforeCompile` shader (emissive glow injection)
   breaking the `USE_COLOR`/instance-color path. Switched to `MeshBasicMaterial` (unlit) — still
   broken, all black.
3. **Removed all custom shader code entirely.** `InstancingManager` now uses plain
   `MeshBasicMaterial` + `mesh.setColorAt()`, blink/pulse animation driven from JS in `tick()`
   (recolors just those instances per-frame, no GPU shader). Still reported black.
4. Suspected fog (`near=15,far=95`, color == background, `OrbitControls` had no zoom limit —
   zooming out past 95 units fogs everything to background color = looks black). **Removed fog
   entirely**, added `minDistance={2} maxDistance={150}` to OrbitControls. Still reported black.
5. **Current diagnostic (live in code right now):** hard-coded the shared material to
   `new THREE.MeshBasicMaterial({ color: 0xff0000 })` — no vertexColors, no instanceColor at all,
   every voxel should be flat solid red. Result: **renders red, but NOT a uniform shade** —
   varies across faces/instances. This is the new, unexplained clue — a truly unlit
   `MeshBasicMaterial` with a hard-coded color should be pixel-identical everywhere, no lighting
   can affect it. Something is still modulating per-fragment/per-instance brightness.

**Hypotheses for next session, untested:**
- Antialiasing edge-blending against the dark background on small on-screen cubes (optical
  illusion, not a real bug) — check on a large/zoomed-in cube first, cheapest thing to rule out.
- `ConstructionPlaneVisual.tsx`'s translucent plane (opacity 0.035, cyan) or its two stacked
  `gridHelper`s blending over the voxels depending on transparency sort order/depth.
- Leftover per-instance state from the old shader-attribute era (`instanceEmissiveClass`/
  `instanceEmissiveColor` buffers) — should be fully removed, but verify no stale attribute is
  still bound/interpolating into color.
- Screenshot/compression artifact — ask user to sample exact pixel values, not eyeball it.

**File to un-revert once root cause is found:** `src/engine/instancing/InstancingManager.ts`
constructor — swap the hard-coded red `material` back to
`new THREE.MeshBasicMaterial({ vertexColors: true })`.

---

## Everything else this session (stable, not in question)

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
