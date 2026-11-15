# Brief: how rigs animate — tweens for machines, poses for characters

Status: **BRIEF 2026-10-31, for handoff; not yet approved by the human.**
Written from the Bright Lanes Big City (BLBC) session, where the first rigged
character (`../bright-people/assets/models/character.glb`, 15 joints) is about
to become the city's pedestrians. Where the human has already decided
something, it says so; everything else is a recommendation.

## Where it stands (branch `rig-animate`)

- **Rig boxes** (`engine/rigging/types.ts` `RigBox`): joints with pivots,
  nested into a tree; exported as a `Rig` node of joint groups.
- **Tween stacks** (`RigTween`): per-joint looping motions — rotate, pendulum,
  slide — at 1x/2x/3x of the 2 s base cycle (`BASE_CYCLE_SECONDS`), composed
  top-first.
- **Poses** (`Pose`): named, sparse snapshots of joint rotations (Euler XYZ,
  radians), in a pose library.
- **A pose cycle** (`PoseCycle`): from one pose to another, `once` / `loop` /
  `pingpong`, slerped (`engine/rigging/pose.ts`).
- **The bake** (`engine/rigging/rigLoop.ts` `bakeRigClips`, called from
  `gltfExport.ts` when `includeAnimations`): tweens and the pose cycle,
  sampled at 30 fps into LINEAR position + quaternion tracks, **one
  `AnimationClip` per animated joint** (`anim_<joint>`).

## The problem

Animating a character with tweens means tuning one loop per joint and keeping
fifteen phases in step by hand. Tweens are the right tool for machines (one
joint, one motion, forever) and the wrong one for organic motion, where the
whole body moves together and the unit is the whole-body pose.

## Decided (human, 2026-10-31)

**Keep tweens, for machines.** Characters get pose-to-pose animation. The two
are exclusive, and **the choice is per PROJECT, not per joint**: a project
animates with tweens or with poses, never both.

## Recommendations

### 1. One animation mode per project: Tweens or Poses (decided)

- **The project's animation mode** is `'tweens'` or `'poses'`, chosen when
  the project is first rigged (one question: "Machine (tweens)" or "Character
  (poses)") and changeable later from the Animate panel.
- **The Animate panel shows one set of tools:** in a tweens project, the tween
  stacks; in a poses project, the pose library, the clips (section 2) and the
  pose gizmo. Nothing has to explain which joint is driven by what.
- **Switching modes keeps the other mode's data, muted** (tweens already have
  `enabled: false`; poses and clips stay in the file), so switching back loses
  nothing; the export writes only the active mode's motion.
- **Mixed models are out of scope by design.** A rider on a bicycle is two
  projects: the bicycle (tweens) and the rider (poses), put together
  downstream by the engine. That keeps both the tool and the export simple.

Sketch: `animationMode: 'tweens' | 'poses'` on the project, saved and migrated
(existing files with tween stacks default to `'tweens'`, files with a pose
cycle to `'poses'`, files with neither to `'tweens'`).

### 2. Clips: key poses on a timeline (replaces the pose cycle)

A clip is an ordered list of poses from the library, each at a time, with a
loop flag. Playback slerps neighbour to neighbour; a looping clip slerps the
last key back to the first. The pose cycle becomes a special case: from/to
ping-pong is a two-key looping clip.

```ts
type RigClip = {
  id: string
  name: string            // 'walk', 'idle', 'wave' — the exported clip name
  loop: boolean
  duration: number        // seconds
  keys: ClipKey[]         // sorted by time; time 0 first
}
type ClipKey = { poseId: string; time: number; ease: KeyEase }
type KeyEase = 'linear' | 'inOut' | 'in' | 'out' | 'hold'
```

The UI can start as the clip's pose thumbnails in a row with a time under
each (drag poses in from the library), and grow into a scrubbable strip.

### 3. Mirror pose

Poses mode. Joints are already named in pairs (`arm-upper-left` / `arm-upper-right`).
Mirroring a pose across the model's left-right plane:

- swap each `-left` / `-right` pair (also accept `_l`/`_r`, `.L`/`.R`);
- negate the rotations about the two axes in the mirror plane: with left-right
  on X, `(rx, ry, rz) -> (rx, -ry, -rz)` (valid for intrinsic XYZ: each
  elemental rotation reflects on its own);
- unpaired joints (hips, torso, head) mirror in place by the same negation;
- a root offset (section 5) mirrors `x -> -x`.

This assumes a symmetric bind pose; the mirror axis can be a project setting
if a model faces another way. **A walk is then two authored poses (contact,
passing) plus their mirrors: a four-key loop from two poses of work.**

### 4. Easing per key (poses mode)

A few presets — linear, ease in/out, in, out, hold (step) — applied to the
phase between a key and the next. Holds and eases are what make poses read
as weight.

### 5. Poses may move the hips

Poses are rotation-only, but a walk's bob and a crouch are hip height. One
translation offset on ROOT joints (in voxels) is enough. A twice-per-stride
bob then comes from the keys, not from a slide tween.

### 6. Onion skin

The previous and next key pose ghosted while editing one: how animators judge
spacing, and cheap with the existing pose preview.

### 7. Later: per-joint delay (follow-through)

A joint may trail the clip by a fraction of a beat, so forearms lag upper arms
and the head settles after the body. One number per joint, no extra keys. This
is where procedural motion earns its place: as a modifier on a clip, not as
the clip.

### 8. Export: one clip per ACTION, not per joint

glTF players expect one animation per action, with a channel per joint. The
current bake emits one clip per joint (`anim_<joint>`), so a downstream engine
sees fifteen animations for one walk (Godot imports each glTF animation as one
`Animation`; three's `AnimationMixer` would have to play fifteen at once).

- **A tweens project** exports one clip, `loop`, with a channel per tweened
  joint, 2 s. Because speeds are 1x/2x/3x of the base cycle, 2 s loops
  seamlessly for all of them.
- **A poses project** exports one clip per `RigClip`, named by it (`walk`,
  `idle`, `dodge`), each with a channel per posed joint. An engine plays one
  action at a time.
- Sampling stays as it is (30 fps, LINEAR TRS, composed in the parent's
  animated frame). Exporting the keys themselves (CUBICSPLINE) is a later
  size optimisation, not needed.
- The schema migration turns an existing `PoseCycle` into a two-key clip.

## What the downstream game needs (BLBC)

- A looping **walk**, a subtle **idle**, and probably a one-shot **dodge** or
  dive (pending how pedestrians react to the car).
- **One neutral walk.** The game makes the variety per person: cadence from
  speed and leg length (so feet do not slide), amplitude by blending from
  rest toward the clip pose, height and build per part. The tool does not
  need variants.
- The game reads only the GLB (never the `.json`): clips must arrive in the
  GLB, named, stable across re-exports. It packs them into a small texture at
  boot (joints x frames x a quaternion) and plays them in the vertex shader;
  `AnimationPlayer` is not used. See BLBC `docs/pedestrians-brief.md`.

## Suggested order

1. The project's animation mode (1) and clips of keyed poses with looping
   (2), the pose cycle migrated into them.
2. Mirror pose (3).
3. Easing per key (4).
4. Root offset in poses (5).
5. The export (8): `loop` for a tweens project, one clip per action for a
   poses project.
6. Onion skin (6), then follow-through (7).

## Open questions (the human's)

1. Clip time in seconds, or in beats against the 1x/2x/3x speed scale?
2. Does a project hold several clips from the start, or one until the UI
   grows a clip list?
3. The mirror axis: always X, or a project setting?

## Docs to update when this lands

`docs/gltf-export-contract.md` still says the rig exports "no animation
clips" — stale since the pose-cycle bake (2026-10-27); it should describe the
animation mode, the `loop` clip and the per-action clips. `docs/ARCHITECTURE.md` for the new
types; `npm run map` for `CODEMAP.md`.
