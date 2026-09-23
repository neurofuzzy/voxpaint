import { markerColorHex } from '@/engine/markers/markers'
import { useAppStore } from '@/store/useAppStore'

const MARKER_SELECTED = '#ffffff'

/**
 * 3D view of design markers: one small octahedron per marker at its cell center, parented under
 * the Y-scale group (like every other working-volume content) so positions stay in unit-cube
 * grid coordinates. Each renders in its own marker color. Click selects; hover shows the
 * marker's color and position in the status bar. The markers list panel handles recoloring —
 * no drei `<Html>` here (see Compass.tsx for why `<Html>` content is avoided inside the Canvas).
 */
export function MarkersView() {
  const markers = useAppStore((s) => s.markers)
  const selectedMarkerId = useAppStore((s) => s.selectedMarkerId)
  const selectMarker = useAppStore((s) => s.selectMarker)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  if (markers.length === 0) return null

  return (
    <group>
      {markers.map((m) => {
        const selected = m.id === selectedMarkerId
        const hex = markerColorHex(m.color)
        return (
          <mesh
            key={m.id}
            position={[m.position[0] + 0.5, m.position[1] + 0.5, m.position[2] + 0.5]}
            onClick={(e) => {
              e.stopPropagation()
              selectMarker(m.id)
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              setStatusMessage(`Marker ${hex} (${m.position[0]}, ${m.position[1]}, ${m.position[2]})`)
            }}
            onPointerOut={() => setStatusMessage(null)}
          >
            <octahedronGeometry args={[selected ? 0.34 : 0.26]} />
            <meshBasicMaterial color={selected ? MARKER_SELECTED : hex} />
          </mesh>
        )
      })}
    </group>
  )
}
