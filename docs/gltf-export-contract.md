# VoxPaint glTF Export Contract

## Purpose

This document specifies exactly which **glTF 2.0 features** are present in `.glb` files exported by VoxPaint, so that a consuming engine's importer knows precisely what to support — rather than implementing the entire glTF spec.

This is **not** a general glTF tutorial, and **not** an internal architecture doc. It is a reference contract for anyone writing an importer or loader in another codebase.

---

## Geometry

### Attributes

- **`POSITION`** — always present. XYZ float coordinates in voxel-grid space.
- **`NORMAL`** — always present. Pre-computed per-vertex outward normals (indexed access), not recomputed at import time.
- **`TEXCOORD_0`** — present only if:
  - The model has painted texture (box-mapped grayscale overlay), **OR**
  - Ambient occlusion baking is enabled, **OR**
  - Specular-noise texturing is enabled on metal materials.
  
  If present, maps to `baseColorTexture` or noise textures via per-geometry UV packing.

- **`TEXCOORD_1`** — present only if ambient occlusion baking is enabled. Maps to `occlusionTexture` via a dedicated unwrapped UV atlas.

- **No `COLOR_0`** — vertex colors are stripped from export. Per-vertex color is a live-preview-only concept; the exported mesh has one solid color per material.

### Mesh structure

- Indexed triangle meshes (no point clouds, no line lists).
- One mesh per `(materialClass, colorKey)` pair when untextured and unanimated; one mesh per `(materialClass, colorKey, animationSlice)` when animated.
- Interior faces between same-color voxels are already culled by the CSG union (watertight, non-overlapping).
- Textured models: one mesh per `(materialClass, colorKey, animationSlice)` with box-mapped UVs.

### Not present

- No morph targets.
- No normal maps or tangents.
- No skinning / skeletal animation attributes.

---

## Materials

All materials use standard glTF 2.0 **metallic-roughness** PBR:

### Base properties (all materials)

- **`pbrMetallicRoughness`**
  - `baseColorFactor` (RGBA) — the voxel's color. RGB driven by palette slot; alpha always 1.0.
  - `baseColorTexture` (optional) — only if texture is painted or specular/noise baking enabled. Otherwise omitted.
  - `metallicFactor` — 0 (matte/emissive/glass) or 1 (metal).
  - `roughnessFactor` — see table below per material class.
  
- **`occlusionTexture`** (optional) — only if ambient occlusion baking is enabled. Uses `TEXCOORD_1`. Alpha channel holds the occlusion value; RGB unused (set to white in `RGBAFormat`).

### Material classes and PBR parameters

| Class | `metallicFactor` | `roughnessFactor` | `transmission` | Extension | Notes |
|-------|------------------|-------------------|----------------|-----------|-------|
| Matte | 0 | 0.6 | 0 | — | Flat diffuse finish. |
| Emissive | 0 | 0.5 | 0 | `KHR_materials_emissive_strength` | Glowing surface. See [Emissive Animation](#emissive-animation-via-khr_animation_pointer) below. |
| Metal | 1 | 0.2 | 0 | — | Polished metal; needs scene environment map. Optional specular-noise texture via metalness/roughness maps. |
| Glass | 0 | 0.5* | 1 | `KHR_materials_transmission` + `KHR_materials_volume` | Frosted transparent. `*` Adjustable per-export via `glassRoughnessLevel` option (default 0.3). |

### Extension support

Exactly **three** KHR material extensions are used, one per non-matte class:

#### `KHR_materials_emissive_strength`

- **When** — emissive-class materials only.
- **Values** — `emissiveStrength: 1.5` (material property, not animation yet; animation is layered by `KHR_animation_pointer` — see below).
- **Why** — explicitly signals glowing material; in three.js, automatically emitted when `material.emissiveIntensity !== 1`.

#### `KHR_materials_transmission` + `KHR_materials_volume`

- **When** — glass-class materials only.
- **Values in `pbrMetallicRoughness`** — `transmission: 1`.
- **Additional** — `ior: 1.5`, `attenuationDistance: ∞` (unset).
- **Volume extension fields** — `thickness: 0.5`.
- **Why** — specifies frosted-glass opacity and refraction.

### Not used

No other KHR material extensions are present (no `KHR_materials_specular`, `KHR_materials_sheen`, `KHR_materials_clearcoat`, `KHR_materials_iridescence`, `KHR_materials_anisotropy`, `KHR_materials_unlit`, `KHR_texture_transform`, etc.). The specular-noise variant on metal is done via texture maps, not the `KHR_materials_specular` extension.

---

## Animation

### Core glTF AnimationClips — Node TRS only

When slice animations are configured (rotate, slide, or pendulum), the export includes one `AnimationClip` per animated slice. **Only standard glTF node transform animations** (`translation`, `rotation`, `scale`) are emitted:

- **Rotation animations** — quaternion SLERP via `interpolation: "LINEAR"`. Rotations are full 2π or -2π per cycle; cycles take 2 seconds at speed 1×.
- **Slide animations** — translation via `interpolation: "CUBICSPLINE"` (Hermite cubic splines with analytically-derived tangents for a smooth sine-wave motion). Cycle duration: 2 seconds at speed 1×.
- **Pendulum animations** — rotation via `interpolation: "CUBICSPLINE"` (same technique as slide). Cycle duration: 2 seconds at speed 1×.

Animated voxels are attached to child nodes (one per slice) positioned at the slice's pivot point. The geometry vertices are positioned relative to the node, so the node's TRS drives the animation.

### Not present

- No skeletal/skinned animation.
- No morph targets.
- No channels targeting anything other than node TRS.

---

## Emissive Animation via `KHR_animation_pointer`

### What it does

Blink/pulse animation on emissive materials is **not** done via standard glTF node channels (impossible — material properties are not nodes). Instead, it uses `KHR_animation_pointer`, which targets material properties directly:

- **`/materials/{n}/extensions/KHR_materials_emissive_strength/emissiveStrength`** — animates the glow on/off.
- **`/materials/{n}/pbrMetallicRoughness/baseColorFactor`** — animates the base color's RGB toward the palette's **darkest base-color swatch** when "off", while holding alpha at 1.0 constant.

Both channels sync to the same 1-second cycle (`EMISSIVE_ANIM_CYCLE_SECONDS = 1`):

- **`blink` mode** — hard on/off via `interpolation: "STEP"`. Keyframes at t=0 (on), t=0.5 (off), t=1.0 (on). Duration 1 second.
- **`pulse` mode** — smooth raised-cosine breathing via `interpolation: "CUBICSPLINE"`. Keyframes at t=0, 0.25, 0.5, 0.75, 1.0 seconds with analytically-derived tangents.

### Why this matters

**If your importer does NOT support `KHR_animation_pointer`**, the material simply imports as static — always-on emissive at full intensity — with **no error or warning required**. This is graceful degradation: the glow still appears; it just doesn't animate. The RGB fade-to-darkest-color layer ensures that when "off", an animated emissive still reads as an ordinary unlit surface (matching VoxPaint's live preview), not pure black.

**If your importer DOES support `KHR_animation_pointer`**, the animation plays as authored in VoxPaint.

---

## Explicitly not used

- Draco mesh compression (`KHR_draco_mesh_compression`).
- Basis Supercompressed Texture (`KHR_texture_basisu`).
- Sparse accessors.
- `EXT_mesh_gpu_instancing` (runtime instancing).
- Multiple primitives per mesh (each material gets its own mesh object).
- Cameras.
- Punctual lights (`KHR_lights_punctual`).
- Scene graphs with non-identity top-level transforms (the root node is used; child animation nodes are present only if animations exist).

---

## Maintenance

This contract should be **revisited whenever**:
- Material parameters change in `src/engine/palette/palette.ts` (specifically `materialParamsFor`).
- New PBR features are added to `src/engine/export/gltfExport.ts` or `src/engine/export/emissiveAnimationExport.ts`.
- Extension support changes (new KHR extensions added, or old ones removed).
- Emissive animation behavior changes (`EMISSIVE_ANIM_CYCLE_SECONDS`, interpolation modes, channel paths, off-color behavior).
- Animation interpolation modes change in `src/engine/animation/animationGLTF.ts`.

Mirror the upkeep expectation stated in `docs/ARCHITECTURE.md`'s opening section.
