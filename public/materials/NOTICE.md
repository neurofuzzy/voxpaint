# Vendored PBR texture maps — provenance and licensing

The PNG/JPG files under `public/materials/*/` are texture maps downloaded from the
AMD GPUOpen MaterialX Library (`https://matlib.gpuopen.com`), downsampled to 512px
masters with macOS `sips` (runtime downscales further to the project's face size).

## License

All materials below are **© Advanced Micro Devices, Inc.**, provided under the
**MIT License** (the library API returns `license="MIT Public Domain"` on every record).
The MIT license requires this attribution notice to be preserved — do not remove it.

## Materials

| Slug | Library title | Library UUID | Maps vendored |
|---|---|---|---|
| stainless-steel-brushed | Stainless Steel Brushed | 01ca2bda-f072-4349-8ee0-353ed5f9f555 | albedo, roughness |
| aluminum-brushed | Aluminum Brushed | c12edfda-a5bd-4469-8147-4a6540a0a213 | albedo, roughness |
| copper-brushed | Copper Brushed | fff5176e-fdf5-4503-aab1-cb2de56b6fe0 | albedo, roughness |
| brass-brushed | Brass Brushed | 78c066dd-defa-4d49-9489-f1a1a9a0390c | albedo, roughness |
| cast-iron | Cast Iron Damaged | c2099189-5d5d-4b38-b663-b20c22c63eac | albedo, roughness, metallic |
| concrete-plain | Concrete Plain | 7ed0daf7-d43f-4bff-a720-b4abff1d8851 | albedo, roughness |
| asphalt | TH: Aerial Asphalt | cb4944e4-3c67-4f7d-b0fc-96702ec10e23 | albedo, roughness |
| leather-brown | TH: Brown Leather | 2f568489-6b81-43ab-aa33-cc4f7e32fdce | albedo, roughness |
| oak-pale | Pale Oak Solid Wood | ca0978cd-367c-4ee8-9527-ace8bf030f99 | albedo |
| fleece-midnite | Midnite Fleece Fabric | 22d5975e-934c-4ea2-ab44-62b2ec8617ce | albedo |

Each folder also holds `thumb.jpg` (the library's own sphere render, 256px) for future UI use.

Deliberately omitted: rubber and plastic. Their packages are procedural-only (noise normals,
no baked color/roughness maps) — and both are just the plain matte recipe at different
roughnesses, which is what unassigned base slots already are.

Normal maps are intentionally **not** vendored (see `docs/gltf-export-contract.md` —
the box-map mirror flips break tangent handedness on some faces).
