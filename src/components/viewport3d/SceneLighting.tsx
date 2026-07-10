export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 12, 6]} intensity={1.1} />
      <directionalLight position={[-6, -4, -8]} intensity={0.25} />
    </>
  )
}
