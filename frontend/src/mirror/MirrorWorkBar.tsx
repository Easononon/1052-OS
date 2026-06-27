import { memo, useEffect, useRef, useState } from 'react'
import type { ToolCallEntry } from '../api/agent'

export type { ToolCallEntry }

const COMPLETED_FADE_MS = 8000

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function relativeTime(epoch: number): string {
  const diff = Math.max(0, Date.now() - epoch)
  if (diff < 1000) return 'now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

type RowState = 'queued' | 'running' | 'ok' | 'failed' | 'breaker'

function classifyRow(entry: ToolCallEntry): RowState {
  if (entry.status === 'running') return 'running'
  if (entry.status === 'ok') return 'ok'
  if (entry.breaker === 'open') return 'breaker'
  return 'failed'
}

const Row = memo(function Row({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const state = classifyRow(entry)
  const [now, setNow] = useState(() => Date.now())
  const ageRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (state === 'running') return
    const age = Date.now() - entry.finishedAt!
    const remaining = Math.max(0, COMPLETED_FADE_MS - age)
    ageRef.current = window.setTimeout(() => setNow(Date.now()), remaining + 50)
    return () => {
      if (ageRef.current !== undefined) window.clearTimeout(ageRef.current)
    }
  }, [state, entry.finishedAt])

  const faded = state !== 'running' && entry.finishedAt && (now - entry.finishedAt) > COMPLETED_FADE_MS
  const hasDetail = state === 'ok' || state === 'failed' || state === 'breaker'

  return (
    <div className={'mr-wb-row mr-wb-row--' + state + (faded ? ' mr-wb-row--faded' : '')}>
      <button
        type="button"
        className="mr-wb-row-head"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={'mr-wb-dot mr-wb-dot--' + state} aria-hidden="true" />
        <span className="mr-wb-name">{entry.name}</span>
        {entry.dangerous && <span className="mr-wb-warn" title="写入操作">!</span>}
        {state === 'running' && entry.argsPreview && (
          <span className="mr-wb-args" title={entry.argsPreview}>{entry.argsPreview}</span>
        )}
        {state !== 'running' && entry.durationMs != null && (
          <span className="mr-wb-dur">{formatDuration(entry.durationMs)}</span>
        )}
        {state === 'breaker' && <span className="mr-wb-pill mr-wb-pill--breaker">halted</span>}
        {state === 'failed' && entry.retryable && <span className="mr-wb-pill mr-wb-pill--retry">retry</span>}
        {hasDetail && (
          <span className={'mr-wb-caret' + (expanded ? ' mr-wb-caret--open' : '')} aria-hidden="true">▸</span>
        )}
      </button>
      {expanded && hasDetail && (
        <div className="mr-wb-detail">
          {entry.argsPreview && (
            <div className="mr-wb-detail-row">
              <span className="mr-wb-k">args</span>
              <code className="mr-wb-v">{entry.argsPreview}</code>
            </div>
          )}
          {state === 'ok' && entry.resultPreview && (
            <div className="mr-wb-detail-row">
              <span className="mr-wb-k">result</span>
              <span className="mr-wb-v mr-wb-v--result">{entry.resultPreview}</span>
            </div>
          )}
          {(state === 'failed' || state === 'breaker') && entry.error && (
            <div className="mr-wb-detail-row">
              <span className="mr-wb-k">error</span>
              <span className="mr-wb-v mr-wb-v--error">{entry.error}</span>
            </div>
          )}
          {entry.hint && (
            <div className="mr-wb-detail-row">
              <span className="mr-wb-k">hint</span>
              <span className="mr-wb-v mr-wb-v--hint">{entry.hint}</span>
            </div>
          )}
          {entry.finishedAt && (
            <div className="mr-wb-detail-row">
              <span className="mr-wb-k">when</span>
              <span className="mr-wb-v">{relativeTime(entry.finishedAt)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export const MirrorWorkBar = memo(function MirrorWorkBar({
  entries,
  busy = false,
}: {
  entries: ToolCallEntry[]
  busy?: boolean
}) {
  const running = entries.filter((e) => e.status === 'running').length
  const done = entries.filter((e) => e.status === 'ok').length
  const failed = entries.filter((e) => e.status !== 'running' && e.breaker !== 'open' && e.status !== 'ok').length
  const breaker = entries.filter((e) => e.breaker === 'open').length

  return (
    <aside className="mr-workbar" aria-label="作业栏">
      <header className="mr-wb-head">
        <div className="mr-wb-head-row">
          <span className="mr-wb-head-title">现场作业矩阵</span>
          <span className={'mr-wb-head-status' + (busy ? ' mr-wb-head-status--busy' : '')}>
            <span className="mr-wb-dot mr-wb-dot--live" aria-hidden="true" />
            {busy ? '执行中' : '待命'}
          </span>
        </div>
        <div className="mr-wb-head-counters">
          <span className="mr-wb-counter"><b>{running}</b> 运行</span>
          <span className="mr-wb-counter"><b>{done}</b> 完成</span>
          <span className="mr-wb-counter mr-wb-counter--err"><b>{failed}</b> 失败</span>
          {breaker > 0 && <span className="mr-wb-counter mr-wb-counter--breaker"><b>{breaker}</b> 熔断</span>}
        </div>
      </header>
      <div className="mr-wb-list" role="list">
        {entries.length === 0 ? (
          <div className="mr-wb-empty mr-ia-workbar-empty">
            <div className="wb-radar" aria-hidden="true">
              <span />
              <i />
              <b />
            </div>
            <span className="mr-wb-empty-title">现场通道待命</span>
            <span className="mr-wb-empty-sub">
              工控智能 Agent 调用 MQTT、OPC UA、Modbus、Node-RED 或文件工具时，
              <br />作业轨迹会在这里实时展开。
            </span>
            <div className="wb-empty-channels" aria-hidden="true">
              <em>MQTT</em>
              <em>OPC UA</em>
              <em>MODBUS</em>
              <em>NODE-RED</em>
            </div>
          </div>
        ) : (
          [...entries].reverse().map((entry) => (
            <Row key={entry.callId} entry={entry} />
          ))
        )}
      </div>
    </aside>
  )
})

export default MirrorWorkBar