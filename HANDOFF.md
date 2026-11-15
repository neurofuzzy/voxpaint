# Handoff: rig animation (tweens vs poses)

Updated 2026-10-31 18:45 by the supervising Claude session. The next session supervises opencode with `/supervise-opencode`. It reviews and gates the work, and does not write code itself.

## Where things are

- **Branch:** `animate-v2`. Never switch branches. `rig-animate` is an older pointer kept as is; do not use it.
- **Plan:** `docs/animation-plan.md`. It has the steps, acceptance lists and the review ledger. Read the ledger before reviewing anything.
- **Brief:** `docs/animation-brief.md`. This is the original problem statement and the human's decisions.
- **Done and committed:**

| Step | Commit | What |
|---|---|---|
| 1 | `aa15c1f` | Engine: `RigClip` / `ClipKey` / `KeyEase` / `AnimationMode` types, `clip.ts` (`evaluateClip`, easing, cycle→clip, mode derivation), `bakeRigAction` |
| 2 | `d509326` | Switch-over: schema v17 (`meta.animationMode`, `clips`, pose cycle migrated), clip store and transport, `previewFrame` choke point (`src/engine/rigging/preview.ts`), mode-gated posing, export of one glTF clip per action, Animate panel mode toggle and clips v1 |
| 3 | `149d346` | Clip editor: key strip (scrub, retime clamped to the clip), key inspector, `editingPoseId` + Update pose, + key and drag-from-library, Machine/Character empty-state cards |
| 4 | `3eaf62c` | Mirror pose: `rigging/mirror.ts` (`mirrorJointName`, `mirrorPose`, mutual name pairing, sparse-aware), `mirrorPose` store action (stages the mirror, clears `clipTime`), Library row Mirror button |

- **Tests at `3eaf62c`:** 68 files, 925 tests, all green. Build is green. Lint shows only 3 pre-existing warnings, in `lighting.worker.ts` and `AnimatedModelView.tsx`.
- **Human browser checks still owed:** Step 2's panel, Step 3's clip editor and Step 4's Mirror button were committed before the human tried them in the app. The Step 3 checklist is in the last report and repeated below. Ask the human for results before or alongside Step 4, and fix anything they find before Step 5.

### Step 3 browser checklist (Character mode, Poses tab)
1. Drag on the strip to scrub.
2. Drag a key: it stays under the pointer and stops at the clip end. The first key is locked at 0.
3. Click a key: the model shows that pose and the inspector opens (pose, time, ease, remove).
4. Gizmo-edit a joint, then "Update ‹pose›": every key using that pose changes.
5. "+ key", or drag a library pose onto the strip, to add a key.
6. In a project with no rig boxes, the Rig tab shows the Machine and Character cards.

Known and accepted: two keys can share the same time, a key's time cannot pass the clip length, and scrubbing or retiming pauses playback.

## Next: Step 5, hip offset (visual gate)

The spec is in `docs/animation-plan.md` › Step 5 and Acceptance › Step 5. Root offsets must flow through scratch, capture, Update pose, compose, clip evaluation and export position tracks. `mirrorPose` already flips offset x (Step 4); check it end to end. The UI is root-joint x/y/z steppers (0.25-voxel step, ±8) in the Poses tab. The human must try it in the app before the commit.

Step 4 browser check (owed): mirror a library pose and check the left and right limbs swap; mirror again while the clip is paused on the timeline and check the viewport shows the mirror.

Steps 6 (onion skin) and 7 (docs) follow. Step 7 runs only when the human asks, per CLAUDE.md.

## How to run each step

1. Start a NEW opencode session per step: `opencode run --attach http://localhost:4096 --title 'Anim step N: …' --format json "$(cat prompt.txt)" < /dev/null`, run in the background.
   - Write the prompt with a quoted heredoc in the scratchpad.
   - Find the new session id from `GET /session` (the newest entry; it can take ~10 s to appear).
   - Arm `watch.sh` on that id, one watcher only.
2. Prompt template (it worked for Steps 1–3):
   - "Work on the CURRENT branch (animate-v2). Never run git checkout or git switch."
   - Read `AGENTS.md`, plus the relevant sections of `docs/animation-plan.md` and the ledger.
   - "Do Step N ONLY", then the concrete bullets.
   - "Finish with npm run build, npm run lint and npm test green, git add only this step's files and STOP. Do not commit. Do not edit docs/ or AGENTS.md. Never browser-test or start a dev server. Report the files changed, judgement calls and the exact test counts."
3. **Review on each wake:**
   - Read the last text part of the run log.
   - Check `git branch --show-current` and `git status`.
   - Read the diff of the core files.
   - Grep the log for `Tests N passed (N)`.
   - Grep the log for `git checkout|switch|commit|reset` (a hit inside a quoted ledger line is harmless).
   - Fixes inside the step's scope go back to the same session (`-s <id>`).
4. **Gate:**
   - Append a ledger entry to `docs/animation-plan.md`.
   - Stop and report to the human. They approve every commit.
   - The supervisor makes the commit with the Claude co-author line, including the ledger change.
   - Steps 5 and 6 are visual, so the human must try them in the app.

## Lessons so far

- A prompt that names a branch makes opencode check it out. Name "the current branch" instead. (The Step 1 run moved off `animate-v2`; fixed by a fast-forward, nothing lost.)
- Watch for flag values doing double duty as sentinels. `clipTime === 0` meant "off the timeline" and broke gizmo edits after a pause. It is now `number | null`.
- Drag interactions must use the scale captured at pointerdown. Retiming past the end grew the duration mid-drag and made the marker run away.
- After any "save" action, check what the preview shows next (`overwritePose` dropped to bind until it staged the saved pose).
- The worker's reports have been accurate so far, but keep checking the numbers in the log.

## Not in scope

Per-joint follow-through (delay), CUBICSPLINE export, mixed-mode projects, and changes to legacy slice loops.
