/** Screen-space marquee rectangle, in client pixels relative to the viewport container. */
export type MarqueeRect = { x0: number; y0: number; x1: number; y1: number }

/**
 * Live feedback for the 3D select tool's marquee drag: a screen-space box from drag start to the
 * current pointer, in the selection cyan. Commit (plane-slice `SelectionRegion` + cyan voxel
 * cast) happens on release — this overlay is pointer-transparent and purely visual.
 */
export function SelectMarqueeOverlay({ rect }: { rect: MarqueeRect }) {
  const left = Math.min(rect.x0, rect.x1)
  const top = Math.min(rect.y0, rect.y1)
  const width = Math.abs(rect.x1 - rect.x0)
  const height = Math.abs(rect.y1 - rect.y0)
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div
        className="absolute rounded-[2px] border border-cyan-400/90 bg-cyan-400/10"
        style={{ left, top, width, height }}
      />
    </div>
  )
}
