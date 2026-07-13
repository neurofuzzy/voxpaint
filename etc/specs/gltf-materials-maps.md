# Technical Specification: Migration from Lambert to Palette-Based PBR Render Pipeline

## 1. Overview & Objective

This document outlines the technical requirements for migrating our custom WebGPU-based authoring tool from a legacy flat-Lambert shading model to a curated, high-performance, **Palette-Based Physically Based Rendering (PBR)** pipeline.

The objective is to preserve our core geometric workflow (3D color overlaps via unique geometry/material IDs and grayscale overlay texture modulation) while drastically elevating visual fidelity through realistic material properties, metal reflections, and screen-space transmissive refraction (frosted glass).

---

## 2. Architecture & Geometry Workflow Archetype

To maintain the tool's performance and resolution-independent edges, the responsibilities of geometry versus textures are explicitly separated:

* **Geometry / Vertex Attributes:** Own color identity, material categorization, structural overlaps, and emissive states.
* **Textures:** Regulated strictly to grayscale maps handling surface micro-details, tactile noise, and volumetric light attenuation.

### Coordinate Systems & Dual-UV Mapping

Meshes must support a dual-UV configuration to accommodate complex tiling alongside unique volume bakes:

1. **`TEXCOORD_0` (UV Channel 1):** Utilizes cubic/triplanar or overlapping tiling mapping. Applies high-resolution tiling grayscale micro-noise (Roughness modifications or surface normals) to break up flat lighting.
2. **`TEXCOORD_1` (UV Channel 2):** A strict, non-overlapping unwrap flattened entirely within the 0–1 texture space. This is dedicated exclusively to **Baked Ambient Occlusion (AO)** and large-scale volumetric shadow attenuation.

---

## 3. Unified Material Palette Specs

The pipeline will discard arbitrary color assignments in favor of a rigid, performance-optimized, uniform array or vertex-attributed palette system.

```
+---------------------------------------------------------------------------------+
|                                  PRIMARY PIPELINE                               |
|                                                                                 |
|  [Default Matte]               [Polished Metals]              [Emissive Neon]   |
|  - Roughness: 0.4 - 0.8        - Roughness: 0.1 - 0.3         - Emissive > 1.0  |
|  - Metallic: 0.0               - Metallic: 1.0                - Metallic: 0.0   |
+---------------------------------------------------------------------------------+
                                         |
                            (Executes Texture-to-Texture Copy)
                                         v
+---------------------------------------------------------------------------------+
|                               TRANSMISSION PASS                                 |
|                                                                                 |
|  [Frosted Glass]                                                                |
|  - Roughness: 0.4 - 0.6                                                         |
|  - Transmission: 1.0                                                            |
|  - Samples Mip-Chain of Opaque Render Target                                    |
+---------------------------------------------------------------------------------+

```

### Material Parameter Reference

| Material Class | Color Palette / Hex (`RGB`) | Roughness | Metallic | Transmission | Extra Attributes |
| --- | --- | --- | --- | --- | --- |
| **Default Matte** | Multi-color Custom Palette | `0.4` to `0.8` | `0.0` | `0.0` | Replaces legacy Lambert shading. |
| **Polished Metals** | **Silver:** `#F0F0F0`<br>

<br>**Gold:** `#FFE17D`<br>

<br>**Bronze:** `#C69269`<br>

<br>**Copper:** `#F1967A` | `0.1` to `0.3` | `1.0` | `0.0` | Base color strictly acts as specular reflection tint. |
| **Emissive Neon** | Multi-color Custom Palette | `0.5` | `0.0` | `0.0` | **Emissive Intensity:** $> 1.0$ (Feeds bloom render target). |
| **Frosted Glass** | Gray, Blue, Amber, Green | `0.4` to `0.6` | `0.0` | `1.0` | Requires execution of the **Screen-Space Refraction Pass** below. |

---

## 4. WebGPU Execution Pipeline

### Pass 1: The Opaque Pass (Main Render Pipeline)

* **Target:** Render all Matte, Metal, and Emissive geometry.
* **Texture Bindings:** High-resolution grayscale noise map (via `TEXCOORD_0`), Baked AO map (via `TEXCOORD_1`).
* **Texture Usage Configuration:** The main `ColorTexture` attachment must be initialized with explicit usage flags: `GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC`.

### Pass 2: The Transmission Intermediate "Grab" Pass

Before rendering the Frosted Glass geometries, the command encoder must intercept the pipeline to clone and downsample the current frame buffer:

1. **Blit:** Call `commandEncoder.copyTextureToTexture` to copy `mainColorTexture` into a separate `backgroundOpaqueTexture` initialized with `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT`.
2. **Downsample / Mip Generation:** Run a compute shader dispatch pass or an ultra-fast intermediate render pass chain to populate the mipmap levels of `backgroundOpaqueTexture`.

### Pass 3: The Transmission Render Pass

* **Target:** Render transparent/frosted glass geometries.
* **State:** Depth testing active, depth writing disabled, alpha blending enabled.
* **Bind Groups:** Binds the `backgroundOpaqueTexture` alongside a standard bilinear sampler.

---

## 5. WGSL Shader Implementation Details

The fragment shader for the Frosted Glass pipeline must perform automated screen-space coordinate mapping and manual level-of-detail (LOD) mip-sampling to achieve high-performance refraction blur.

```wgsl
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv_tiling: vec2<f32>,
    @location(1) uv_baked: vec2<f32>,
    @location(2) normal: vec3<f32>,
    @location(3) view_dir: vec3<f32>,
};

@group(0) @binding(0) var bgSampler: sampler;
@group(0) @binding(1) var bgTexture: texture_2d<f32>;
@group(0) @binding(2) var textureAO: texture_2d<f32>;

struct MaterialUniforms {
    baseColor: vec4<f32>,
    roughness: f32,
    maxMipLevels: f32,
    viewDimensions: vec2<f32>,
};
@group(1) @binding(0) var<uniform> material: MaterialUniforms;

@fragment
fn fs_glass_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // 1. Compute normalized screen space coordinates
    let screenUV = input.clip_position.xy / material.viewDimensions;
    
    // 2. Sample micro-surface detail or apply normal refraction offset
    let refractionOffset = input.normal.xy * 0.02;
    let distortedUV = clamp(screenUV + refractionOffset, vec2<f32>(0.0), vec2<f32>(1.0));
    
    // 3. Map roughness directly to explicit texture sample mip level
    let targetMip = material.roughness * material.maxMipLevels;
    
    // 4. Extract blurred background fragment using hardware texture units
    let refractedBackground = textureSampleLevel(bgTexture, bgSampler, distortedUV, targetMip);
    
    // 5. Integrate volumetric AO from TEXCOORD_1 
    let aoValue = textureSample(textureAO, bgSampler, input.uv_baked).r;
    
    // 6. Final composite blending tint color with blurred background
    let finalRGB = mix(refractedBackground.rgb, material.baseColor.rgb, material.baseColor.a) * aoValue;
    
    return vec4<f32>(finalRGB, 1.0);
}

```

---

## 6. Verification & Implementation Checklist for Agent

* [ ] Modify vertex structure to support both `uv_tiling` (`TEXCOORD_0`) and `uv_baked` (`TEXCOORD_1`).
* [ ] Build multi-channel texture packaging compatibility: map Baked AO strictly to the **Red channel** of the packed material map when reading from `TEXCOORD_1`.
* [ ] Verify that the `mainColorTexture` descriptor includes `GPUTextureUsage.COPY_SRC`.
* [ ] Write the orchestration logic to end the Opaque pass, issue `copyTextureToTexture`, generate mipmaps, and spin up the translucent pass.
* [ ] Implement the `textureSampleLevel` logic inside the glass shading pass to ensure roughness translates natively to blurred mip levels.
