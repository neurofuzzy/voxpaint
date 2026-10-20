import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { decodeKey, withinWorkingBounds } from '@/engine/grid/GridStore'
import { placedFloatCoords } from '@/engine/instancing/ghostBatches'
import { bboxOfCoords, windowSlabBounds } from '@/engine/tools/cellSetOps'
import { useAppStore } from '@/store/useAppStore'

/** Matches the 2D canvas tint and SelectionHighlight cast (cyan-400). */
const SELECTION_CYAN = 0x22d3ee
/** Hover highlight with the fill tool armed (yellow-400) — the selection is the fill target. */
const HOVER_YELLOW = 0xfacc15
/** Subtle volume tint — additive blending keeps it glowy on the dark background. */
const FILL_OPACITY = 0.08
/** Faint solid frame under the marching dashes so the box reads when dashes gap out. */
const FRAME_OPACITY = 0.25
/** Padding per axis so the box floats just off the voxel surfaces (no z-fighting). */
const PAD = 0.04
const DASH_SIZE = 0.3
const GAP_SIZE = 0.18
/** March speed in world units per second. */
const MARCH_SPEED = 1.2

const EDGE_VERTEX_SHADER = /* glsl */ `
attribute float lineDistance;
varying float vLineDistance;
void main() {
  vLineDistance = lineDistance;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const EDGE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uDashSize;
uniform float uGapSize;
uniform float uSpeed;
uniform float uOpacity;
varying float vLineDistance;
void main() {
  float totalSize = uDashSize + uGapSize;
  float d = mod(vLineDistance - uTime * uSpeed, totalSize);
  if (d > uDashSize) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
`

/**
 * Draws the selection's axis-aligned bounding box: a faint additive cyan fill plus marching-ants
 * dashed edges (a custom line shader — `LineDashedMaterial` exposes no dash offset to animate,
 * so the march is driven by a `uTime` uniform over `lineDistance`).
 *
 * Covers both selection models, at the same opacity throughout every gesture:
 * - The 3D-only `selectedCells` exact set: boxed directly, empties included (a window selection
 *   covers its full slice rect, not just occupied voxels). A marquee drag previews the live
 *   window through `selectedCellsPreview`, and a move drag tracks the float's live
 *   footprint instead (the lifted set is stale in the model), landing back on the static set
 *   when the drop bakes. No flat 2D window is ever drawn for an exact-set drag.
 * - The windowed (2D region) selection: the plane-frame window as a one-slice slab lying on the
 *   construction plane — the 3D analog of the 2D canvas's marching-ants rect, including empty
 *   windows. The live marquee preview wins while a window is being dragged, so the box grows
 *   with it; a floating window tracks its float the same way the 3D set does.
 *
 * Hidden while empty, while a non-selection float (e.g. paste with nothing selected) is pending,
 * and outside Model mode — mirroring `SelectionHighlight`'s gating. Lives under Viewport3D's
 * Y-scale group, so it speaks unit-cube grid coordinates like every other overlay. Raycasting is
 * disabled on the wireframes so they never intercept voxel picking; the fill volume raycasts
 * (cheap single-box test) purely to drive the hover highlight below.
 *
 * With the fill tool active in 3D-only layout, hovering the box turns it yellow: a tap then fills
 * the whole selection with the brush (voxel type + color) in one undo stroke — the 3D-view
 * answer to the 2D bucket. Only committed selections arm this: marquee previews and floating
 * drags stay purely visual. The tap itself is handled by the viewport interaction handler
 * (same deterministic order as every fill tap: fill first, then land the plane), so the box
 * carries no click logic of its own.
 */
export function SelectionBox3D() {
  const selectedCells = useAppStore((s) => s.selectedCells)
  const selectedCellsPreview = useAppStore((s) => s.selectedCellsPreview)
  const selection = useAppStore((s) => s.selection)
  const selectPreview = useAppStore((s) => s.selectPreview)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const floatContent = useAppStore((s) => s.floatContent)
  const floatOrigin = useAppStore((s) => s.floatOrigin)
  const plane = useAppStore((s) => s.plane)
  const isModelMode = useAppStore((s) => s.mode === 'model')
  const is3DOnly = useAppStore((s) => s.layoutMode === '3d-only')
  const activeTool = useAppStore((s) => s.activeTool)
  const [hovered, setHovered] = useState(false)

  const bbox = useMemo(() => {
    if (!isModelMode) return null
    // In-flight move — 3D lift or floating window: box the float's live footprint. A non-empty
    // set marks a 3D-originated float, a window a 2D one (2D lifts and pastes leave the set
    // empty, 3D lifts never touch the window).
    if (floatContent && floatOrigin && (selectedCells.size > 0 || selection)) {
      return bboxOfCoords(placedFloatCoords(floatContent, floatOrigin, plane, gridExtent))
    }
    if (floatContent) return null
    // Window selections span the full slice rect, occupied or empty — only out-of-grid
    // keys are dropped, so the box reads the dragged window even over empty space.
    // Live 3D-only marquee: the provisional window wins over the stale old set.
    if (selectedCellsPreview && selectedCellsPreview.size > 0) {
      const coords = []
      for (const key of selectedCellsPreview) {
        const coord = decodeKey(key)
        if (!withinWorkingBounds(coord, gridExtent)) continue
        coords.push(coord)
      }
      return bboxOfCoords(coords)
    }
    if (selectedCells.size > 0) {
      const coords = []
      for (const key of selectedCells) {
        const coord = decodeKey(key)
        if (!withinWorkingBounds(coord, gridExtent)) continue
        coords.push(coord)
      }
      return bboxOfCoords(coords)
    }
    const window = selectPreview ?? selection
    if (!window) return null
    return windowSlabBounds(window, plane)
  }, [floatContent, floatOrigin, isModelMode, selectedCells, selectedCellsPreview, selection, selectPreview, gridExtent, plane])

  // The yellow hover arms only over a committed selection with the fill tool active:
  // transient boxes (marquee preview, float drag) and other tools keep it passive. Taps
  // themselves are handled by the viewport interaction (fill first, then land the plane).
  const interactive =
    is3DOnly &&
    activeTool === 'fill' &&
    isModelMode &&
    !floatContent &&
    !selectPreview &&
    !selectedCellsPreview &&
    (selectedCells.size > 0 || selection !== null)
  const boxColor = hovered && interactive ? HOVER_YELLOW : SELECTION_CYAN

  const shapes = useMemo(() => {
    if (!bbox) return null
    const size: [number, number, number] = [
      bbox.max[0] - bbox.min[0] + 1 + PAD * 2,
      bbox.max[1] - bbox.min[1] + 1 + PAD * 2,
      bbox.max[2] - bbox.min[2] + 1 + PAD * 2,
    ]
    // Cells are corner-anchored [n, n+1); the centered geometry's middle is (min + max + 1) / 2.
    const center: [number, number, number] = [
      (bbox.min[0] + bbox.max[0] + 1) / 2,
      (bbox.min[1] + bbox.max[1] + 1) / 2,
      (bbox.min[2] + bbox.max[2] + 1) / 2,
    ]
    const box = new THREE.BoxGeometry(...size)
    const edges = new THREE.EdgesGeometry(box)
    return { box, edges, center }
  }, [bbox])
  useEffect(
    () => () => {
      shapes?.box.dispose()
      shapes?.edges.dispose()
    },
    [shapes],
  )

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(SELECTION_CYAN) },
      uTime: { value: 0 },
      uDashSize: { value: DASH_SIZE },
      uGapSize: { value: GAP_SIZE },
      uSpeed: { value: MARCH_SPEED },
      uOpacity: { value: 1 },
    }),
    [],
  )

  const linesRef = useRef<THREE.LineSegments>(null)
  const marchRef = useRef<THREE.ShaderMaterial>(null)
  // Line distances back the dash pattern — recompute whenever the box is rebuilt.
  useEffect(() => {
    linesRef.current?.computeLineDistances()
  }, [shapes])
  useFrame((state) => {
    if (marchRef.current) marchRef.current.uniforms.uTime.value = state.clock.elapsedTime
  })
  // Hover re-tints the whole box (fill, frame, and marching dashes) through the shared color.
  useEffect(() => {
    uniforms.uColor.value.set(boxColor)
  }, [boxColor, uniforms])
  // Pointer cursor while the fill target is hot; always cleaned up.
  useEffect(() => {
    if (!hovered || !interactive) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = prev
    }
  }, [hovered, interactive])

  if (!shapes) return null

  return (
    <group position={shapes.center}>
      <mesh
        geometry={shapes.box}
        onPointerOver={(e) => {
          if (!interactive) return
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <meshBasicMaterial
          color={boxColor}
          toneMapped={false}
          transparent
          opacity={FILL_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Faint solid frame for constant readability … */}
      <lineSegments geometry={shapes.edges} raycast={() => null}>
        <lineBasicMaterial
          color={boxColor}
          toneMapped={false}
          transparent
          opacity={FRAME_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
      {/* … plus the animated marching-ants overlay. */}
      <lineSegments ref={linesRef} geometry={shapes.edges} raycast={() => null}>
        <shaderMaterial
          ref={marchRef}
          vertexShader={EDGE_VERTEX_SHADER}
          fragmentShader={EDGE_FRAGMENT_SHADER}
          uniforms={uniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  )
}
