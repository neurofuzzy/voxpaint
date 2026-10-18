import * as THREE from 'three'

/**
 * Mutable view-sync channel between the main viewport camera and the brush-preview
 * mini-canvas (cf. zanpo-builder's `cameraMatrix` prop on `BlockPreview`). Written once per
 * frame by `BrushViewSync` inside the main `<Canvas>`, read once per frame by the preview's
 * own camera rig. A module singleton — not store state — so per-frame writes never re-render.
 */
export const brushViewQuaternion = new THREE.Quaternion()
