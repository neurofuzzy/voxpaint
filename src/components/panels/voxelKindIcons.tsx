/**
 * Voxel-kind toolbar icons — inlined from `assets/cube.svg` / `assets/chamfer.svg` (kept as JSX
 * rather than imported, since those assets live outside the TS `src` include and there's no svgr
 * plugin). The baked light-grey face shading is intentional, so fills are literal, not currentColor.
 * If the source SVGs change, re-copy the paths here.
 */

type IconProps = { size?: number }

export function CubeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 111 128" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <g transform="matrix(1,0,0,1,-277.128,-512)">
        <path d="M332.554,512L387.979,544L332.554,576L277.128,544L332.554,512Z" fill="rgb(235,235,235)" />
        <path d="M387.979,544L387.979,608L332.554,640L332.554,576L387.979,544Z" fill="rgb(142,141,141)" />
        <path d="M332.554,576L332.554,640L277.128,608L277.128,544L332.554,576Z" fill="rgb(201,201,201)" />
      </g>
    </svg>
  )
}

export function ChamferIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 111 128" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <g transform="matrix(1,0,0,1,-498.831,-512)">
        <path d="M498.831,608L554.256,640L554.256,512L498.831,608Z" fill="rgb(223,223,223)" />
        <path d="M554.256,640L554.256,512L609.682,608L554.256,640Z" fill="rgb(184,184,184)" />
      </g>
    </svg>
  )
}

export function WedgeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 111 107" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <g transform="matrix(1,0,0,1,-277.128,-309.108)">
        <path d="M277.128,416L387.979,416L277.128,309.108L277.128,416Z" fill="rgb(223,223,223)" />
        <path d="M387.979,416L387.979,380.592L314.378,309.506L277.128,309.108L387.979,416Z" fill="rgb(142,141,141)" />
      </g>
    </svg>
  )
}
