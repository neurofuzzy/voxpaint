# Technical Specification: Analytical Volumetric Ambient Occlusion Solver

## 1. Overview & Core Philosophy

This specification outlines the integration of our custom **Analytical Volumetric AO Solver** into the application's preprocessing/baking architecture.

Unlike standard neighbor-lookup voxel illumination (which only evaluates immediate cell borders), this method functions as a **volumetric proximity scanner**. It projects a directional bounding search volume along the dominant face normal to capture nearby geometry clusters, generating deep, stylized, highly customizable gradient shadows.

The output must compute a single normalized floating-point scalar ($0.0$ to $1.0$, where $0.0$ represents maximum occlusion/shadow and $1.0$ represents fully unoccluded light) mapped cleanly to our **glTF PBR asset pipeline (`TEXCOORD_1`)**.

---

## 2. Mathematical Model & Falloff Architecture

```
                 [Occluding Cube] (c)
                     /       |
                    /        | dz (Direct Axis)
    (Indirect Axis) /         |
                  /           v
        [Sample Point] (p) ----------> DX/DY (Indirect Plane)
           (Normal Vector: +Z / "top")

```

The shader-ready analytical distance formula isolates the primary projection axis from the orthogonal tracking plane to offer separate adjustments for sharp contact shadows and ambient decay:

$$\text{Distance} = \sqrt{\max(\epsilon, \Delta_{\text{ind1}}^2) \cdot \Delta_{\text{dir}} \cdot k_{\text{ind}} + \max(\epsilon, \Delta_{\text{ind2}}^2) \cdot \Delta_{\text{dir}} \cdot k_{\text{ind}} + \Delta_{\text{dir}}^2 \cdot k_{\text{dir}}} \cdot 2.0$$

Where:

* $\Delta_{\text{dir}}$ is the linear distance component along the dominant face normal axis.
* $\Delta_{\text{ind1}}, \Delta_{\text{ind2}}$ are the linear distance components along the two orthogonal plane axes.
* $\epsilon$ is the `edgeBias` parameter, preventing division-by-zero errors at sharp corners.
* $k_{\text{ind}}$ is the `indirectFalloff` weight coefficient.
* $k_{\text{dir}}$ is the `directFalloff` weight coefficient.

---

## 3. Solver Execution Specifications

The solver accepts a set of sample points (which can be derived from vertex arrays for structural vertex baking or UV-to-world space raster positions for canvas texture baking) and tests them against the collection of active scene volumes.

### Dominant Axis Alignment Routing

To handle fully enclosed 3D shapes, the algorithm computes orientation targeting dynamically by identifying the absolute maximum component of the sample's surface normal:

```
IF |nx| > |ny| AND |nx| > |nz| -> (nx > 0 ? "right" : "left")
IF |ny| > |nx| AND |ny| > |nz| -> (ny > 0 ? "front" : "back")
ELSE                           -> (nz > 0 ? "top"   : "bottom")

```

### Search Range & Volume Clipping

To prevent execution time scaling linearly to infinity ($O(N \cdot M)$ complexity), the calculation loop for each sample point must apply tight bounding spatial cuts:

* **Bounding Constraint:** Reject any candidate volume that falls outside the immediate search boundary or sits behind the plane of the sample point (e.g., for a `"top"` facing normal, filter only elements where $p.z < c.z \le p.z + \text{searchRadius}$).

---

## 4. Parameter Defaults & API Interface

The system exposed to the authoring tool must support real-time adjustments via the following configurable parameters:

```json
{
  "searchRadius": 7.0,
  "edgeBias": 0.5,
  "indirectFalloff": 2.0,
  "directFalloff": 4.0,
  "intensity": 1.0
}

```

* **`searchRadius` (float):** Depth of the volumetric tracking cone projection. Higher values produce larger shadow silhouettes.
* **`edgeBias` (float):** Clamps minimum distance deltas to soften pixel stepping on intersecting edges.
* **`indirectFalloff` (float):** Controls the shadow bleed and softness across the surface plane.
* **`directFalloff` (float):** Controls the shadow compression and contact darkness directly beneath overhanging structures.
* **`intensity` (float):** Global scaler to amplify or dim the final accumulated occlusion value.

---

## 5. Channel Mapping & Pipeline Compilation Strategy

The floating-point array returned by the volumetric solver must be channeled directly into the assets matching the requirements of the WebGPU PBR spec:

1. **If Baking to Vertex Buffers (Low-Poly Archetype):**
* Map the scalar output directly to a 1-component vertex buffer attribute array (`GPUVertexFormat.Float32`).
* Bind this attribute to `@location(4)` inside the pipeline's vertex buffer layout.


2. **If Baking to Image Textures (Canvas Atlas Archetype):**
* Initialize an `OffscreenCanvas` rendering context matching the target texture atlas resolution.
* Map the computed AO scalar strictly into the **Red (`R`) Channel** of the image texture data buffer.
* The Green (`G`) and Blue (`B`) channels remain free to hold Roughness and Metallic details, forming the complete glTF standard packed ORM map.

## 6. Example Code

```js
/**
 * Computes analytical voxel-based ambient occlusion for a collection of sample points.
 * @param {Array<{position: {x:number, y:number, z:number}, normal: {x:number, y:number, z:number}}>} samplePoints - Coordinates requiring AO.
 * @param {Array<{x:number, y:number, z:number}>} cubes - Voxel elements blocking light.
 * @param {Object} options
 * @returns {Float32Array} Normalized AO values (0.0 = dark, 1.0 = bright)
 */
computeVoxelAO(samplePoints, cubes, options = {}) {
  const {
    searchRadius = 7.0,
    edgeBias = 0.5,
    indirectFalloff = 2.0,
    directFalloff = 4.0,
    intensity = 1.0
  } = options;

  // Filter out any invalid cubes ahead of time for performance
  const activeCubes = cubes.filter(c => !!c);
  const aoResults = new Float32Array(samplePoints.length);

  for (let i = 0; i < samplePoints.length; i++) {
    const p = samplePoints[i].position;
    const n = samplePoints[i].normal;

    // Determine dominate primary facing axis based on normal vector
    let axis = "top";
    if (Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z)) {
      axis = n.x > 0 ? "right" : "left";
    } else if (Math.abs(n.y) > Math.abs(n.x) && Math.abs(n.y) > Math.abs(n.z)) {
      axis = n.y > 0 ? "front" : "back"; // Added missing axis orientations
    } else {
      axis = n.z > 0 ? "top" : "bottom";
    }

    let totalShadow = 0.0;
    let facingCubes = [];

    // Gather occluding geometry within the forward spatial hemisphere volume
    switch (axis) {
      case "top":
        facingCubes = activeCubes.filter(c => c.z > p.z && c.z <= p.z + searchRadius);
        facingCubes.forEach(c => {
          const dx = (c.x - p.x) * (c.x - p.x);
          const dy = (c.y - p.y) * (c.y - p.y);
          const dz = c.z - p.z;
          const dist = Math.sqrt(Math.max(edgeBias, dx) * dz * indirectFalloff + Math.max(edgeBias, dy) * dz * indirectFalloff + (dz * dz) * directFalloff);
          totalShadow += (1.0 / (dist + 0.001));
        });
        break;

      case "bottom":
        facingCubes = activeCubes.filter(c => c.z < p.z && c.z >= p.z - searchRadius);
        facingCubes.forEach(c => {
          const dx = (c.x - p.x) * (c.x - p.x);
          const dy = (c.y - p.y) * (c.y - p.y);
          const dz = p.z - c.z;
          const dist = Math.sqrt(Math.max(edgeBias, dx) * dz * indirectFalloff + Math.max(edgeBias, dy) * dz * indirectFalloff + (dz * dz) * directFalloff);
          totalShadow += (1.0 / (dist + 0.001));
        });
        break;

      case "right":
        facingCubes = activeCubes.filter(c => c.x > p.x && c.x <= p.x + searchRadius);
        facingCubes.forEach(c => {
          const dy = (c.y - p.y) * (c.y - p.y);
          const dz = (c.z - p.z) * (c.z - p.z);
          const dx = c.x - p.x;
          const dist = Math.sqrt((dx * dx) * directFalloff + Math.max(edgeBias, dy) * dx * indirectFalloff + Math.max(edgeBias, dz) * dx * indirectFalloff);
          totalShadow += (1.0 / (dist + 0.001));
        });
        break;

      case "left":
        facingCubes = activeCubes.filter(c => c.x < p.x && c.x >= p.x - searchRadius);
        facingCubes.forEach(c => {
          const dy = (c.y - p.y) * (c.y - p.y);
          const dz = (c.z - p.z) * (c.z - p.z);
          const dx = p.x - c.x;
          const dist = Math.sqrt((dx * dx) * directFalloff + Math.max(edgeBias, dy) * dx * indirectFalloff + Math.max(edgeBias, dz) * dx * indirectFalloff);
          totalShadow += (1.0 / (dist + 0.001));
        });
        break;
        
      // Extend similarly for front/back if your canvas setup demands it...
    }

    // Convert accumulated shadow into a clean normalized occlusion factor
    let aoFactor = 1.0 - (totalShadow * intensity);
    aoResults[i] = Math.max(0.0, Math.min(1.0, aoFactor));
  }

  return aoResults;
}
```

---

## 6. Implementation Checklist for Agent

* [ ] Implement 6-axis surface normal routing to cover all possible voxel alignments (`top`, `bottom`, `left`, `right`, `front`, `back`).
* [ ] Isolate spatial volume checking inside the switch block to ensure lookups scale efficiently within large environments.
* [ ] Ensure the final accumulated shadow calculation returns a normalized value clamped strictly between `0.0` and `1.0`.
* [ ] Interface the data wrapper directly with the pipeline loader to guarantee error-free injection into WebGPU resources.
