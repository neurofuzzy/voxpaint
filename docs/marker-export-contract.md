# VoxPaint Marker Export Contract

## Purpose

This document tells a consuming application (or agent) exactly where to find VoxPaint's design markers in an exported `.glb` and how to interpret them. Markers are composition locators ("put another GLB here") placed by the designer: a color-coded point plus a facing direction.

This is a companion to `gltf-export-contract.md` (which covers meshes, materials, and animation). It is a reference contract for anyone writing an importer, loader, or composition script in another codebase — not a general glTF tutorial, and not an internal architecture doc.

---

## Finding markers

Marker nodes are children of the `VoxPaintModel` root node. There is exactly one rule — **match on `extras`, never on names**:

> A node is a marker iff `node.extras?.voxpaint?.kind === "marker"`.

Marker nodes carry no `mesh`, no `camera`, and no extensions. Treat them as pure locators and skip them in render loops (in three.js, consider setting `visible = false` defensively — they are empty `Group`s, so they render nothing either way).

---

## Example node

An actual marker node from an export (whitespace added):

```json
{
  "matrix": [2.2e-16, 0, 1, 0,  0, 1, 0, 0,  -1, 0, 2.2e-16, 0,  0.5, 0.5, 0.5, 1],
  "name": "marker_fbbf24_west_aaaaaaaa",
  "extras": {
    "voxpaint": {
      "kind": "marker",
      "id": "aaaaaaaa-0001",
      "color": "#fbbf24",
      "axis": "x",
      "orientation": -1
    }
  }
}
```

## Field semantics

- **`extras.voxpaint.id`** — stable UUID of the marker. Use this to match markers across re-exports of the same project. Names and node indices are not stable keys.
- **`extras.voxpaint.color`** — `#rrggbb` string, one of 5 fixed values: `#f87171`, `#fbbf24`, `#4ade80`, `#60a5fa`, `#e879f9`. This is the composition key — e.g. "amber markers get oak trees, blue markers get streetlights."
- **`extras.voxpaint.axis` / `orientation`** — the draw-time construction-plane basis (`axis` ∈ `x|y|z`, `orientation` ∈ `1|-1`). The marker faces along that basis's outward normal.
- **`name`** — `marker_<hex>_<direction>_<id8>`, e.g. `marker_fbbf24_west_aaaaaaaa`. Human convenience only; direction words are `east|west` (x-axis), `up|down` (y-axis), `south|north` (z-axis). Parse `extras.voxpaint` for data, never the name.
- **Transform** — the node's local **+Z axis points along the facing direction** (the draw-time outward normal), so content instanced onto the node inherits the correct facing automatically. The exporter writes the transform as a column-major **`matrix`**, not TRS: translation is elements `[12,13,14]`, facing is elements `[8,9,10]` (in the example above, `[-1,0,0]` = west ✓).

## Coordinate space

- Transforms are **local to the `VoxPaintModel` root** — compose up the parent chain (or just use world matrices). Never assume markers sit at scene root: export anchor/scale options move the parent.
- Units are voxels × the export scale factor, Y-up, with any Y-voxel-stretch already baked in.
- Markers never affect the export anchor measurement: the anchor is computed from voxel bounds only, so an off-to-the-side marker cannot recenter the model.

---

## Drop-in snippets

**three.js** — `GLTFLoader` maps `extras` onto `object.userData` automatically, so no raw-JSON parsing is needed:

```js
const markerRoots = [];
gltf.scene.traverse((obj) => {
  const m = obj.userData?.voxpaint;
  if (m?.kind !== 'marker') return;
  markerRoots.push(obj); // obj.position/quaternion are composition-ready
  obj.visible = false;   // empty Group; hide defensively
});
// each m = { kind: 'marker', id, color, axis, orientation }
```

**Raw glTF JSON** (any language — read the JSON chunk of the `.glb`):

```js
const markers = (gltf.nodes ?? []).filter((n) => n.extras?.voxpaint?.kind === 'marker');
// Local position (matrix form) = elements [12,13,14]; local facing = elements [8,9,10].
// Compose with ancestors for world space.
```

## Gotchas

- Read the **world matrix**, not the local one — export anchor/scale options move the `VoxPaintModel` parent.
- Parse **`extras.voxpaint`**, not `name` — the name is informational and its format is not versioned.
- Markers are omitted entirely when the export is made with markers excluded (`includeMarkers: false` in `GltfExportOptions`, the "Include markers" checkbox) — an absent marker set is valid, not an error.

---

## Maintenance

This contract should be **revisited whenever**:

- The marker payload changes in `src/engine/export/gltfExport.ts` (the `voxpaint` extras shape, node naming, or node orientation convention).
- The marker model changes in `src/engine/markers/types.ts` (new colors, new facing data).
- Markers gain new export surface (e.g. placeholder geometry, rotation/scale support).
