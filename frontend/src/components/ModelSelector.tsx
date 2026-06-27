import { memo, useEffect, useRef, useState } from 'react'
import type { PublicLlmProfile } from '../api/settings'
import { IconChevron } from './Icons'

const PROVIDER_BADGE: Record<string, string> = {
  'openai-compatible': 'cloud',
  ollama: 'local',
  'lm-studio': 'local',
  localai: 'local',
  custom: 'custom',
}

/**
 * Inline SVG check — kept local so we don't grow the shared icon set for
 * a single usage. Path matches Lucide's `check` glyph.
 */
function Check({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

type Props = {
  activeProfile: PublicLlmProfile | null
  enabledProfiles: PublicLlmProfile[]
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  errorMessage: string | null
  onSelect: (profileId: string) => Promise<boolean>
}

function profileLabel(p: PublicLlmProfile): string {
  return p.name?.trim() || p.modelId || p.id
}

export const ModelSelector = memo(function ModelSelector({
  activeProfile,
  enabledProfiles,
  status,
  errorMessage,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const handlePick = async (profileId: string) => {
    if (profileId === activeProfile?.id) {
      setOpen(false)
      return
    }
    setPendingId(profileId)
    const ok = await onSelect(profileId)
    setPendingId(null)
    if (ok) setOpen(false)
  }

  const label = activeProfile ? profileLabel(activeProfile) : '未配置模型'
  const providerKind = activeProfile?.provider
    ? PROVIDER_BADGE[activeProfile.provider] ?? 'custom'
    : '—'
  const isBusy = status === 'saving' || pendingId !== null

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        type="button"
        className={
          'model-trigger' +
          (open ? ' model-trigger--open' : '') +
          (!activeProfile ? ' model-trigger--empty' : '')
        }
        onClick={() => setOpen((v) => !v)}
        disabled={status === 'loading'}
        title={errorMessage ?? (activeProfile ? `当前模型：${label}` : '点击选择模型')}
      >
        <span className="model-trigger-label">{label}</span>
        <span className="model-trigger-kind">{providerKind}</span>
        <span className={'model-trigger-caret' + (isBusy ? ' model-trigger-caret--busy' : '')}>
          <IconChevron size={12} />
        </span>
      </button>
      {open && (
        <div className="model-popover" role="listbox" aria-label="切换 Agent 模型">
          <div className="model-popover-head">
            <span className="model-popover-title">Agent 模型</span>
            <span className="model-popover-sub">只影响当前对话路由</span>
          </div>
          {enabledProfiles.length === 0 ? (
            <div className="model-popover-empty">
              暂无可用模型。请到
              <br />
              设置 → LLM 配置添加。
            </div>
          ) : (
            <ul className="model-popover-list">
              {enabledProfiles.map((p) => {
                const isActive = p.id === activeProfile?.id
                const isPending = pendingId === p.id
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={
                        'model-option' +
                        (isActive ? ' model-option--active' : '') +
                        (isPending ? ' model-option--pending' : '')
                      }
                      onClick={() => void handlePick(p.id)}
                      disabled={isBusy && !isPending}
                    >
                      <span className="model-option-name">{profileLabel(p)}</span>
                      <span className="model-option-meta">
                        <span className="model-option-kind">
                          {PROVIDER_BADGE[p.provider] ?? 'custom'}
                        </span>
                        {p.modelId && p.modelId !== p.name && (
                          <code className="model-option-id">{p.modelId}</code>
                        )}
                      </span>
                      {isActive && (
                        <span className="model-option-check">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})

export default ModelSelector