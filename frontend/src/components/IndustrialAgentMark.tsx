export function IndustrialAgentMark({ size = 36 }: { size?: number }) {
  return (
    <span className="ia-mark" style={{ width: size, height: size }} aria-hidden="true">
      <span className="ia-mark-core" />
      <span className="ia-mark-ring ia-mark-ring-a" />
      <span className="ia-mark-ring ia-mark-ring-b" />
      <span className="ia-mark-node ia-mark-node-a" />
      <span className="ia-mark-node ia-mark-node-b" />
      <span className="ia-mark-node ia-mark-node-c" />
    </span>
  )
}

export default IndustrialAgentMark
