export function SceneLighting() {
  return (
    <>
      {/* Slight base fill so unlit faces don't go pure black. */}
      <ambientLight color="#6a6a72" intensity={0.9} />
      {/* Directional lights only — no point light. Directional intensity has always been a plain,
          distance-independent multiplier (no falloff, no photometric/candela unit change across
          three.js versions, unlike point/spot lights), so it behaves predictably regardless of
          scene scale or camera distance. Canvas uses `flat` (NoToneMapping) so these numbers map
          linearly to on-screen brightness instead of being rolled off by ACES tone mapping. */}
      <directionalLight color="#ffffff" position={[8, 12, 6]} intensity={2.5} />
      <directionalLight color="#5a5a65" position={[-8, 5, -8]} intensity={1} />
    </>
  )
}
