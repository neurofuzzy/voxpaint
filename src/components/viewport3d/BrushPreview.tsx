import { useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RotateCw } from 'lucide-react'
import { chamferBasisIsReflected, chamferInstanceMatrix } from '@/engine/instancing/basis'
import { buildPoolGeometries } from '@/engine/instancing/pools'
import type { PoolId } from '@/engine/instancing/pools'
import { resolveSlotColor } from '@/engine/palette/palette'
import { resolveBrushPreview } from '@/store/brushPreview'
import { resolveGhostPlacement } from '@/store/ghostPlacement'
import { useAppStore } from '@/store/useAppStore'
import { brushViewQuaternion } from './brushViewSync'

/**
 * Keeps the preview camera on the main viewport's viewing angle: same orientation, own
 * distance. Only the rotation is shared (position length is preserved), mirroring zanpo's
 * `cameraMatrix.decompose() → quaternion → (0,0,1).applyQuaternion(q) * dist` follow.
 */
function PreviewCameraRig() {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const dist = camera.position.length() || 3.8
    camera.position.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(brushViewQuaternion).multiplyScalar(dist))
    camera.lookAt(0, 0, 0)
  })
  return null
}

const ORIGIN_CELL: [number, number, number] = [0, 0, 0]

/**
 * 3D-only mode's brush readout (bottom-right HUD, cf. zanpo-builder's `BlockPreview`): a tiny
 * orthographic render of exactly what's loaded in the brush — `activeVoxelKind` shape in
 * `activePaletteSlot` color — plus the `R` rotate control.
 *
 * The mesh renders through the same placement math as real instances (`chamferInstanceMatrix`
 * in the placement's plane frame, mirror-pool aware): while hovering it reuses the ghost's
 * resolved placement (`store/ghostPlacement.ts`) with translation zeroed; off-hover it shows
 * the canonical brush in the active plane's frame. Either way `R` spins about the construction
 * plane's normal, and HUD, ghost, and paint write always agree — including autotile context and
 * reflected planes. An R3F `<Canvas>` instead of zanpo's hand-rolled renderer + RAF loop.
 */
export function BrushPreview() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const mode = useAppStore((s) => s.mode)
  const model = useAppStore((s) => s.model)
  const plane = useAppStore((s) => s.plane)
  const hoverCell = useAppStore((s) => s.hoverCell)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const activeVoxelKind = useAppStore((s) => s.activeVoxelKind)
  const activePaletteSlot = useAppStore((s) => s.activePaletteSlot)
  const brushRotation = useAppStore((s) => s.brushRotation)
  const activeTool = useAppStore((s) => s.activeTool)
  const gridExtent = useAppStore((s) => s.meta.gridExtent)
  const rotateBrush = useAppStore((s) => s.rotateBrush)
  const planeLocked3D = useAppStore((s) => s.planeLocked3D)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const palette = useAppStore((s) => s.palette)

  const pools = useMemo(() => buildPoolGeometries(), [])
  useEffect(() => () => {
    for (const g of Object.values(pools)) g.dispose()
  }, [pools])

  const preview = useMemo(() => {
    const placement = resolveGhostPlacement({ model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, directEdit: layoutMode === '3d-only', gridExtent, layoutMode, planeLocked3D })
    if (placement?.kind === 'chamfer') {
      const matrix = placement.matrix.clone().setPosition(0, 0, 0)
      return { pool: placement.pool, matrix, flat: placement.flat }
    }
    // Off-hover (or cube): canonical brush in the active plane's frame — same basis +
    // reflection the paint write would use there.
    const shape = resolveBrushPreview(
      activeVoxelKind,
      brushRotation,
      activeVoxelKind === 'ramp' ? { shapeKind: 'ramp', rotation: 0 } : null,
    )
    if (!shape) return { pool: 'cube' as PoolId, matrix: new THREE.Matrix4(), flat: false }
    const pool: PoolId = chamferBasisIsReflected(plane.axis, plane.orientation)
      ? (`${shape.shapeKind}M` as PoolId)
      : shape.shapeKind
    const matrix = chamferInstanceMatrix(ORIGIN_CELL, plane.axis, plane.orientation, shape.rotation).setPosition(0, 0, 0)
    return { pool, matrix, flat: shape.shapeKind === 'flat' || shape.shapeKind === 'flatwedge' }
  }, [model, plane, hoverCell, hoveredFace, activeVoxelKind, brushRotation, activeTool, gridExtent, layoutMode, planeLocked3D])

  if (layoutMode !== '3d-only' || mode !== 'model') return null

  const color = resolveSlotColor(palette, activePaletteSlot)

  return (
    <div className="absolute bottom-4 right-4 z-40 flex items-end gap-2">
      <button
        onClick={(e) => rotateBrush(e.shiftKey ? -1 : 1)}
        aria-label="Rotate brush"
        title="Rotate brush (R / Shift+R)"
        onPointerEnter={() => setStatusMessage('Rotate brush about the plane normal: R +90°, Shift+R −90° (ramps, corners, wedges)')}
        onPointerLeave={() => setStatusMessage(null)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/80
          text-neutral-300 shadow-2xl backdrop-blur-lg hover:bg-neutral-800 hover:text-neutral-100"
      >
        <RotateCw size={15} />
      </button>
      <div
        className="h-16 w-16 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80 shadow-2xl backdrop-blur-lg"
        title={`${activeVoxelKind} brush`}
      >
        <Canvas
          orthographic
          camera={{ position: [2.2, 2.2, 2.2], zoom: 32, near: 0.1, far: 100 }}
          gl={{ antialias: true, alpha: true }}
          // Neutral tone mapping (not the default ACES filmic) + hot lights: this is a small
          // color/shape readout, so it renders bright and literal instead of photo-graded.
          onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping }}
        >
          <PreviewCameraRig />
          <ambientLight intensity={1.4} />
          <directionalLight position={[3, 4, 2]} intensity={2.4} />
          <directionalLight position={[-3, -1, -2]} intensity={0.8} />
          <mesh geometry={pools[preview.pool]} matrix={preview.matrix} matrixAutoUpdate={false}>
            <meshStandardMaterial color={new THREE.Color(color)} metalness={0.1} roughness={0.6} side={preview.flat ? THREE.DoubleSide : THREE.FrontSide} />
          </mesh>
        </Canvas>
      </div>
    </div>
  )
}
