import chamferUrl from '@/assets/chamfer.svg'
import concaveUrl from '@/assets/concave.svg'
import cubeUrl from '@/assets/cube.svg'
import flatUrl from '@/assets/flat.svg'
import flatwedgeUrl from '@/assets/flatwedge.svg'
import halfUrl from '@/assets/half.svg'
import postUrl from '@/assets/post.svg'
import quarterUrl from '@/assets/quarter.svg'
import thinUrl from '@/assets/thin.svg'
import wedgeUrl from '@/assets/wedge.svg'

/**
 * Voxel-kind toolbar icons — served from `src/assets/*.svg` as images (not inlined) so they
 * stay directly editable files; the dev server picks up changes. The baked light-grey face
 * shading is intentional, so fills are literal, not currentColor.
 *
 * `width` + `height` both set keeps today's exact letterboxed rendering for the square-ish
 * frames; HalfIcon's taller frame keeps its explicit aspect height so its slab stays at full
 * size next to the others.
 */

type IconProps = { size?: number }

function FileIcon({ url, size = 18, height }: IconProps & { url: string; height?: number }) {
  return (
    <img src={url} width={size} height={height ?? size} alt="" style={{ display: 'block' }} />
  )
}

export function CubeIcon({ size = 18 }: IconProps) {
  return <FileIcon url={cubeUrl} size={size} />
}

export function ChamferIcon({ size = 18 }: IconProps) {
  return <FileIcon url={chamferUrl} size={size} />
}

export function ConcaveIcon({ size = 18 }: IconProps) {
  return <FileIcon url={concaveUrl} size={size} />
}

export function WedgeIcon({ size = 18 }: IconProps) {
  return <FileIcon url={wedgeUrl} size={size} />
}

export function ThinIcon({ size = 18 }: IconProps) {
  return <FileIcon url={thinUrl} size={size} />
}

export function HalfIcon({ size = 18 }: IconProps) {
  return <FileIcon url={halfUrl} size={size} height={size * (147 / 83)} />
}

export function PostIcon({ size = 18 }: IconProps) {
  return <FileIcon url={postUrl} size={size} />
}

export function QuarterIcon({ size = 18 }: IconProps) {
  return <FileIcon url={quarterUrl} size={size} />
}

export function FlatIcon({ size = 18 }: IconProps) {
  return <FileIcon url={flatUrl} size={size} />
}

export function FlatWedgeIcon({ size = 18 }: IconProps) {
  return <FileIcon url={flatwedgeUrl} size={size} />
}
