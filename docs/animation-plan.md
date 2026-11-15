# Plan: tweens for machines, poses for characters

Status: **APPROVED 2026-10-31, implementing (opencode, supervised).** Worker: do ONE step per run, prepare the commit, do NOT commit. The supervisor (not the worker) edits this file.
Source: `docs/animation-brief.md` (work branch `animate-v2`; never switch branches).

## Context

Rig animation today mixes two systems: per-joint tween stacks and a pose library with one from/to `PoseCycle`. They coexist per joint, guarded by mutual-exclusion code (`chainHasActiveTweens`, `poseRotations.delete` on tween enable), and export bakes **one glTF clip per joint** (`anim_<joint>`). A downstream game (BLBC) needs one animation per action (`walk`, `idle`, `dodge`) with a channel per joint, read straight from the GLB.

Outcome:
- each project animates with **tweens** (machines) or **poses** (characters), never both;
- poses get **clips**: keyed poses with per-key easing, looping;
- tools for mirroring poses, hip offset and onion skin;
- export writes one clip per action.

## Decisions (human, 2026-10-31)

- Mode is per project. Switching keeps the other mode's data but mutes it, and export writes only the active mode.
- Key times are in **seconds**, snapped to 1/30 s (the export frame rate).
- A **clip list** exists from day one, with several named clips.
- **Mirror:** the character faces +Z (south), so left/right runs along X. Mirroring flips X: `(rx,ry,rz)→(rx,−ry,−rz)`, and the offset's x becomes −x. The engine takes the axis as a parameter, but the UI always flips X.
- **Scope** runs through onion skin. Per-joint follow-through stays "later".

## Design (UX calls, approved with the plan)

- **Mode control.** A segmented "Machine · Character" toggle sits at the top of the Animate panel.
  - When there are no rig boxes, the Rig tab's empty state shows it as two explained cards. This is the "one question at first rig" with no modal.
  - Switching shows a toast: "Tweens kept, muted — switch back anytime".
- **Tabs.** The panel shows Rig + Tweens in a tweens project, or Rig + Poses in a poses project. `AnimateTab` keeps `'rig'|'tweens'|'poses'`. `setAnimateTab` / `setMode` map a hidden tab to the visible one.
- **Poses tab:**
  - **Clip** section on top:
    - clip picker with add/rename/delete;
    - loop toggle, duration (s) and play/pause;
    - a key strip, with markers placed by time, a draggable playhead to scrub, and draggable markers to retime (snapped). The first key is locked at 0.
    - the selected key's inspector: pose dropdown, time and ease (Linear / In-out / In / Out / Hold);
    - an onion-skin toggle.
  - **Library** section below:
    - capture, plus a new **Update pose** button that writes the scratch back into the staged pose (every key using it updates);
    - mirror (creates "‹name› mirror");
    - reset;
    - "+ key" adds the staged pose at the playhead. Library rows can also be dragged onto the strip.
  - Clicking a key seeks the playhead there and stages that key's pose for gizmo editing (the existing adopt-on-grab flow).
- **Hip offset:** when the selected joint is a root, the Library shows x/y/z steppers (0.25-voxel step, ±8). This avoids building a translate gizmo.
- **Onion skin:** wire-box ghosts of the previous and next key poses (tinted differently), built from `buildRigBoxWireGeometry`. Voxel ghosts are not needed.
- **Viewport by mode:**
  - Tweens mode: the pose gizmo is hidden and only tweens evaluate.
  - Poses mode: tweens are ignored entirely.
  - This replaces all the per-joint mutual-exclusion code.

## Steps

Each step ends with `npm run build`, `npm run lint` and `npm test` green. Each step is **one commit, which the user approves**.

The supervisor stops at each step end. Steps 3–6 are visual, so the human browser-tests them; the worker never does.

### Step 1: Engine foundations (additive; nothing removed)

- `src/engine/rigging/types.ts`:
  - New types:
    - `AnimationMode = 'tweens'|'poses'`;
    - `KeyEase`;
    - `ClipKey {id, poseId, time, ease}`;
    - `RigClip {id, name, loop, duration, keys}`.
  - New helpers: `newClipId`, `newKeyId`, `sanitizeRigClip(raw, validPoseIds)` (sorts keys, forces first key to 0, clamps duration ≥ last key, snaps times to 1/30).
  - `Pose` gains optional `offsets?: Record<boxId,[x,y,z]>` (used in step 5; sanitized now; roots only).
- New `src/engine/rigging/clip.ts`:
  - `easePhase(ease, u)`;
  - `evaluateClip(poses, boxes, clip, t) → PoseFrame {rot: Map<id,JointEuler>, off: Map<id,Coord>}`:
    - loop wraps last→first over `duration − lastKey.time`;
    - non-loop holds the last key;
    - a missing pose reads as bind;
    - rotations slerp, offsets lerp, both with the key's ease; `hold` is a step.
  - `clipFromPoseCycle(cycle) → RigClip` (two keys, name `cycle`):
    - `once` → no loop, in-out;
    - `loop` and `pingpong` → a seamless loop with in-out keys (the old `loop` pop goes away on purpose).
  - `deriveAnimationMode({rigBoxes, poses, poseCycle})`: a pose cycle or poses with no enabled tween → `'poses'`; otherwise `'tweens'`.
- `rigLoop.ts`: new `bakeRigAction(name, boxes, groups, voxelScaleY, fps, duration, sampleWorlds:(t)=>Map<id,Matrix4>, animatedIds) → AnimationClip`. It returns one clip, with position and quaternion tracks for every animated joint. It reuses the existing per-joint local math in `bakeRigClips` (parent's animated frame, Y scaled on write). `bakeRigClips` stays until step 2.
- Tests, in a new `clip.test.ts` plus additions to `rigLoop.test.ts`:
  - ease curves;
  - loop wrap and seam continuity;
  - hold;
  - non-loop clamp;
  - dangling pose;
  - converting a cycle to a clip matches `evaluatePoseCycle` for pingpong;
  - `bakeRigAction` gives one clip with N tracks.

### Step 2: The switch-over (data, store, viewport, export)

- **Persistence.** Bump `CURRENT_SCHEMA_VERSION` 16→17 (`src/engine/persistence/schema.ts:9`) and document it in the version comment.
  - `MIGRATIONS[16]` (`migrations.ts`):
    - converts `poseCycle` into a `clips[0]` and drops `poseCycle`;
    - sets `meta.animationMode` from `deriveAnimationMode`.
  - `ProjectMeta.animationMode`: a missing value on load defaults to `'tweens'`, following the `voxelScaleY` pattern at `serialize.ts:318`.
  - Serialize and deserialize `clips` (after poses, `sanitizeRigClip`).
  - Turn `serializeProject`'s positional params into an options object while touching it.
- **Store:**
  - `projectSlice`: `setAnimationMode(mode)`, which sets dirty and is not undoable, like `setVoxelScaleY`. It also stops transport and clears the scratch.
  - `poseSlice`:
    - remove `poseCycle`, `cyclePlaying`, `cycleStartedAt`, `setPoseCycle`, `setCyclePlaying`;
    - add `clips`, `activeClipId`, `selectedKeyId`, `clipPlaying`, `clipStartedAt`, `clipTime` (paused playhead);
    - CRUD actions: `addClip`, `renameClip` (unique, glTF-safe via `sanitizeRigName`), `deleteClip`, `patchClip`, `addKey`, `patchKey`, `removeKey`, `overwritePose(id)` (scratch → pose);
    - `deletePose` removes keys that reference it.
  - `animationSlice`: `AnimSnapshot` carries `clips` instead of `poseCycle` (clone and equality).
  - Delete the mutual-exclusion code: `poseRotations.delete` in `riggingSlice` tween actions, and the `chainHasActiveTweens` guard in `setJointRotation`.
- **One choke point.** A new `previewFrame(state, nowSeconds)` (engine function fed from the store) returns `{worlds: Map<id,Matrix4>}`:
  - tweens mode: `composeTweenMatrices(boxes, now)`;
  - poses mode: `composePoseMatrices` of the playing or scrubbed clip frame, else the staged pose, else the scratch.
  - Replace the duplicated `cycleTime` expressions with it in:
    - `RigPoseView.tsx:117-138` (also delete its TEMP-DEBUG console.log);
    - `RigBoxHighlight.tsx`, `RigLinkLines.tsx`, `PoseGizmo.tsx`, `PivotGizmo.tsx`, `Viewport3D.tsx` (~621, ~932, ~1204, ~1624);
    - `AnimatedModelView.tsx`;
    - `grabPoseForEdit`.
  - The pose gizmo only renders and accepts drags in poses mode.
  - Reset sites (`FileMenu.tsx:83`, `wireAutosave.ts:41`, `projectSlice.ts:382`) reset the new transport fields.
- **Export.** In `gltfExport.ts:618-624`, take `animationMode` and `clips` via options (drop the `poseCycle` positional):
  - Tweens mode emits one `bakeRigAction('loop', …, TWEEN_CYCLE_SECONDS, composeTweenMatrices)`.
  - Poses mode emits one action per `RigClip`, named from the sanitized clip name (deduped), with the clip's duration. Channels cover every joint keyed in any of that clip's keys.
  - Delete `bakeRigClips` and `evaluatePoseCycle` / `poseCycleDuration` / the `PoseCycle` types.
  - Legacy slice-loop clips (`anim_<node>`) are unchanged.
  - `ExportGltfDialog.tsx` `RigWinsNote` lists what will export ("1 clip: loop" / "3 clips: walk, idle, dodge").
- **Panel (enough to compile and use):**
  - add the mode toggle;
  - filter tabs by mode;
  - replace `CycleBar` with a plain `ClipsSection` v1: clip select, add/delete, loop, duration, play, and key rows (pose select / time / ease / remove / "+ key from staged").
  - `toolSlice.setAnimateTab` and `modeSlice.setMode` respect the mode.
- **Tests:**
  - update `serialize.test.ts` (v16 file with a cycle → v17 clip + mode `'poses'`; v16 with tweens → `'tweens'`; round-trip of clips; malformed clips dropped);
  - update `poseLibrary.test.ts` (cycle tests become clip CRUD + deletePose cascade), `rigTween.test.ts` (the mutual-exclusion test becomes a mode-gating test) and `poseSlice.test.ts`;
  - update `gltfExport.test.ts` (tweens project → exactly one clip `loop`, 2 s, track per tweened joint; poses project → one clip per RigClip by name; `includeAnimations:false` → none);
  - update `rigLoop.test.ts`.

### Step 3: Clip editor UX (visual gate)

- Replace the key rows with the **key strip** (markers by time, playhead scrub sets `clipTime` and pauses, marker drag retimes snapped to 1/30 s, first key locked) and a **selected-key inspector**.
- Clicking a key seeks there and stages its pose.
- Add the **Update pose** button and the "+ key" button, plus drag from a library row onto the strip.
- Add the Rig tab's empty-state **mode chooser cards**.
- Update the `ToolPalette` hint text for the poses tab.
- Tests: store tests for retime (sorting, first-key lock, snap) and for `overwritePose`.

### Step 4: Mirror pose

- `mirrorJointName(name)` in `rigging/pose.ts` or a new `mirror.ts`. It swaps left/right tokens separated by `-`, `_`, `.` or a space (`left↔right`, `l↔r`, `L↔R`), keeping case. Unpaired joints map to themselves.
- `mirrorPose(pose, boxes, axis='x')`:
  - paired joints swap with negation; with X flipped, `(rx,−ry,−rz)`;
  - unpaired joints are negated in place;
  - offsets flip x → −x.
- A Library row button creates "‹name› mirror" (undoable).
- Tests:
  - name pairs (`arm-upper-left`, `leg_l`, `Hand.L`, and `left-foot` as a prefix);
  - mirroring twice gives the original pose;
  - the rotation matrix of the mirrored joint equals M·R·M for M = diag(−1,1,1).

### Step 5: Hip offset in poses (visual gate)

- Scratch gains a `poseOffsets: Map<id,Coord>` used only for roots.
- `localJointMatrix` and `composePoseMatrices` add the root's `T(offset)`.
- Capture and Update pose write `offsets`, and `evaluateClip` lerps them (already built in step 1).
- Root-joint x/y/z steppers go in the Poses tab.
- Export carries the translation through `bakeRigAction`, since position tracks already exist.
- Tests: compose with an offset, a baked position track bobs, and the mirror flips x.

### Step 6: Onion skin (visual gate)

- Session-only `onionSkin: boolean` in the UI slice.
- When it is on and the clip is paused, render wire-box ghosts of the previous and next keys' poses (relative to the playhead or the selected key) with two tints, beside `RigBoxHighlight`.
- The pose matrices come from `evaluateClip` at those key times.
- No persistence and no export.

### Step 7: Docs (only when the user asks, per CLAUDE.md)

- Run `npm run map`.
- Then I write a structured summary and delegate to the `documenter` agent to update:
  - `docs/gltf-export-contract.md` (the stale "no clips" section at :117-141, the animation mode, the `loop` clip, per-action clips);
  - `docs/ARCHITECTURE.md` (the new types and slices).
- Mark the brief as implemented.

## Verification

- Every step: `npm run build`, `npm run lint` and `npm test` (vitest) are green, and the supervisor reads the actual diff and the test output in the run log.
- Export check: a vitest case loads the produced GLB with `GLTFLoader.parse`.
  - Tweens project → `animations.map(a=>a.name)` equals `['loop']`, with a 2 s duration.
  - Poses project with clips walk/idle → `['walk','idle']`, each with one `.quaternion` track per keyed joint.
- Migration check: a v16 fixture with a poseCycle loads as mode `'poses'` with one `cycle` clip that evaluates the same as the old ping-pong.
- Human browser checks at steps 3, 5 and 6: author a walk from two poses plus mirrors as a four-key loop, export it, and load it in BLBC.

## Worker rules (every step)

- Read `AGENTS.md`, `docs/animation-brief.md` and this file first. Do only the step you were sent.
- Never browser-test and never start or stop a dev server. Verify with `npm run build`, `npm run lint` and `npm test` only.
- `import type` for type-only imports (`verbatimModuleSyntax`).
- Stay inside the step's files. If something outside them must change, stop and say why.
- Finish with all three commands green, then stage the step's changes and stop. Do not commit; report the files changed and the test counts.
- Do not edit this file or the brief, and do not touch other docs (Step 7 is the supervisor's).

## Acceptance

### Step 1
- [ ] New types and sanitizers in `types.ts`; `Pose.offsets` optional and sanitized (roots only).
- [ ] `clip.ts`: `easePhase`, `evaluateClip`, `clipFromPoseCycle`, `deriveAnimationMode`, exported and JSDoc'd.
- [ ] `bakeRigAction` in `rigLoop.ts` returns ONE clip with a position + quaternion track per animated joint.
- [ ] Nothing existing removed or behaviour-changed; existing tests untouched and green.
- [ ] New tests cover: ease curves, loop wrap/seam, hold, non-loop clamp, dangling pose, pingpong cycle parity, one-clip bake.

### Step 2
- [ ] Schema v17 + `MIGRATIONS[16]`; v16 cycle file → `'poses'` + one `cycle` clip; v16 tweens file → `'tweens'`.
- [ ] `PoseCycle`, `evaluatePoseCycle`, `poseCycleDuration`, `bakeRigClips`, cycle transport state and `CycleBar` are gone (grep finds none).
- [ ] Mutual-exclusion code gone (`chainHasActiveTweens` guard in posing, `poseRotations.delete` in tween actions); gating is by mode.
- [ ] One preview choke point used by every viewport consumer; TEMP-DEBUG log in `RigPoseView` removed.
- [ ] Export: tweens project → exactly `['loop']` (2 s); poses project → one animation per clip, named by it; `includeAnimations:false` → none. Verified by parsing the GLB in a test.
- [ ] Panel: mode toggle, mode-filtered tabs, `ClipsSection` v1 usable end to end.

### Step 3
- [ ] Key strip (scrub, retime snapped to 1/30 s, first key locked at 0), key inspector, click-key-to-stage, Update pose, + key, drag pose onto strip.
- [ ] Empty-state mode cards in the Rig tab.
- [ ] Store tests for retime and `overwritePose`.

### Step 4
- [ ] `mirrorJointName` and `mirrorPose(pose, boxes, axis='x')`; Library mirror button (undoable).
- [ ] Tests: name pairs, double mirror = identity, mirrored matrix = M·R·M.

### Step 5
- [ ] Root offsets in scratch, capture, Update pose, compose, clip evaluation, mirror (x → −x) and export position tracks.
- [ ] Root-joint x/y/z steppers in the Poses tab.

### Step 6
- [ ] Session-only onion toggle; prev/next key wire ghosts in two tints when paused.

## Review ledger

(Supervisor appends one entry per review: date, step, tip, verdict, findings ACCEPTED/REJECTED with one line why, known-red tests.)

### 2026-10-31 · Step 1 · staged on rig-animate (tip 5d36c19 + staged) · verdict: ACCEPT
- Checked: diff of types.ts, clip.ts, rigLoop.ts, tests; run log final `Test Files 67 passed (67)`, `Tests 872 passed (872)`; build and lint green (3 pre-existing lint warnings in untouched files).
- `evaluateClip(poses, boxes, clip, t)` takes `boxes` (roots-only offsets): ACCEPTED, matches the plan.
- `bakeRigClips` refactored onto shared `bakeJointTracks` with a parity test: ACCEPTED, behaviour pinned.
- Carry to Step 2: `sanitizeRigClip` returns null for a clip with no keys, so a new empty clip (e.g. "dodge" before keying) would vanish on save/load. Keep empty clips (duration default 1 s).
- Carry to Step 2: a looping clip whose duration equals its last key time pops on the wrap; when `loop` is on, the store and sanitizer should hold duration ≥ last key + 1 frame.
- Known-red tests: none.

### 2026-10-31 · Step 2 · staged on rig-animate (tip aa15c1f + staged, 34 files) · verdict: FIX THEN ACCEPT
- Checked: diff of preview.ts, gltfExport.ts, migrations.ts, types.ts, poseSlice.ts and mode gating in PoseGizmo/Viewport3D/AnimatePanel; run log `Tests 875 passed (875)`; build and lint green.
- Both Step 1 carry-overs fixed (empty clips kept, loop floor at last key + 1 frame): ACCEPTED.
- Per-action export (`loop` / one per clip, deduped names, GLTFLoader round-trip test): ACCEPTED.
- Bug: `clipTime !== 0` used as an "on the timeline" flag. After a pause, gizmo grabs edit an invisible scratch, and scrubbing to 0 shows the scratch. Fix: `clipTime: number | null`. SENT.
- Bug: `overwritePose` drops the view to bind. Fix: stage the saved pose. SENT.
- Deferred to Step 5 by design: offsets are not yet composed in the preview or export.
- Process: the Step 1 run did `git checkout rig-animate` (the prompt named that branch) while the human was on `animate-v2`. Nothing lost; `animate-v2` fast-forwarded to the Step 2 commit and checked out; `rig-animate` left in place.
- Fix run checked: `clipTime: number | null` applied at every reader and reset site; `overwritePose` stages the saved pose; 3 new store tests; run log `Tests 877 passed (877)`; build and lint green. Verdict: ACCEPT, pending human browser check of the panel.

### 2026-10-31 · Step 3 · staged on animate-v2 (tip d509326 + staged, 9 files) · verdict: FIX THEN ACCEPT
- Checked: KeyStrip/KeyInspector code, editingPoseId lifecycle, run log `Tests 882 passed (882)`, build and lint green, no branch switch.
- Judgement calls (marker drag pauses transport; marker click = select + stage + seek; empty strokes dropped as no-ops; overwritePose stages rather than setting editingPoseId): ACCEPTED.
- Bug: retiming past the clip end grows the duration mid-drag, so the track rescales and the marker runs from the pointer. Fix: clamp to the duration captured at pointerdown. SENT.
- Fix run checked: `clampKeyTime` (pure, in poseSlice) used by patchKey and the strip drag with the duration captured at pointerdown; 2 new tests; run log `Tests 884 passed (884)`; build and lint green. Verdict: ACCEPT, pending human browser check.

### 2026-10-31 · Step 4 · staged on animate-v2 (tip 149d346 + staged, 6 files) · verdict: FIX THEN ACCEPT
- Checked: mirror.ts, mirror.test.ts, the mirrorPose store action and the Library button diff; run log `Test Files 68 passed (68)`, `Tests 925 passed (925)`; build and lint green (3 pre-existing warnings); no branch switch or commit.
- Pairing must be mutual, and duplicate names unpair both ends, so mirroring twice always gives back the original: ACCEPTED.
- A sparse pose (absent = bind) mirrors a lone keyed side across, and the source side stays absent. Explicit bind entries are kept for a round trip: ACCEPTED.
- Joints keyed by unknown box ids mirror in place instead of being dropped: ACCEPTED.
- "x mirror" mirrors to "x mirror mirror" (uniquified, no name stripping): ACCEPTED, KISS.
- The mirror is staged for preview, and the scratch and editingPoseId are untouched: ACCEPTED.
- Bug: mirroring while paused or scrubbed on the timeline staged a pose the viewport never showed, because previewFrame shows the clip while clipTime !== null. Fix: clear clipTime as stagePose does. SENT.
- Fix run checked: `clipTime = null` in mirrorPose; the store test asserts it; run log `Tests 925 passed (925)`; build and lint green. Verdict: ACCEPT, pending human approval of the commit.
- Known-red tests: none.
