export function SceneLighting() {
  return (
    <>
      <directionalLight color="#ffffff" position={[8, 12, 6]} intensity={1.4} />
      <pointLight color="#3a3a42" position={[-8, 5, -8]} intensity={0.8} />
    </>
  )
}
