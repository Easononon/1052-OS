import './clippit-buddy.css'

type ClippitBuddyProps = {
  compact?: boolean
}

export default function ClippitBuddy({ compact = false }: ClippitBuddyProps) {
  return (
    <div className={`clippit-buddy${compact ? ' compact' : ''}`} aria-label="Clippit 助手" title="Clippit 助手">
      <div className="clippit-shadow" />
      <div className="clippit-body">
        <div className="clippit-loop outer" />
        <div className="clippit-loop inner" />
        <div className="clippit-face">
          <span className="clippit-eye left" />
          <span className="clippit-eye right" />
          <span className="clippit-smile" />
        </div>
      </div>
      <div className="clippit-bubble">Hi</div>
    </div>
  )
}
