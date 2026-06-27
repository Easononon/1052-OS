import type { TokenUsage } from './agent.types.js'

export type AgentPackName =
  | 'base-read-pack'
  | 'repo-pack'
  | 'image-pack'
  | 'search-pack'
  | 'memory-pack'
  | 'skill-pack'
  | 'settings-pack'
  | 'plan-pack'
  | 'data-pack'
  | 'channel-pack'

export type ContextUpgradeRequest = {
  packs: Exclude<AgentPackName, 'base-read-pack'>[]
  reason: string
  scope?: string[]
}

export type SeedStatus = 'pending' | 'ready' | 'failed'

export type AgentCheckpoint = {
  sessionId: string
  goal?: string
  phase?: string
  facts: string[]
  done: string[]
  failedAttempts: string[]
  nextStep?: string
  mountedPacks: AgentPackName[]
  relatedRules: string[]
  relatedMemories: string[]
  relatedSkills: string[]
  summaryInjectedTokens?: number
  seedStatus?: SeedStatus
  seedAttempts?: number
  seedInputFingerprint?: string
  updatedAt: number
}

export type AgentStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: TokenUsage }
  | {
      type: 'tool-started'
      name: string
      /**
       * Per-invocation identifier. Frontend uses this to key a running
       * tool-call entry so that parallel calls can be displayed as separate
       * rows even when they share the same tool name.
       */
      callId?: string
      /**
       * Truncated, human-readable preview of the arguments (e.g.
       * `路径=D:/a.txt`, `query="hello world"`). Safe to render as-is.
       */
      argsPreview?: string
      /**
       * True when the tool is classified as a write/side-effect operation by
       * {@link classifyToolSafety}. Lets the UI render a warning badge.
       */
      dangerous?: boolean
    }
  | {
      type: 'tool-finished'
      name: string
      ok: boolean
      error?: string
      callId?: string
      /**
       * Truncated, human-readable preview of the return payload. Frontend can
       * show this inline in the panel so users no longer have to inspect the
       * raw LLM conversation to know what a tool returned.
       */
      resultPreview?: string
      /** Wall-clock duration of the tool execution in milliseconds. */
      durationMs?: number
      /**
       * Mirrors the runtime's `_retryable` flag from the tool's failure
       * envelope. Frontend uses this to color the row in the Work Bar
       * (transient network errors get a softer indicator; hard errors get
       * a stricter one) and to decide whether to surface a "Retry" affordance.
       */
      retryable?: boolean
      /**
       * Actionable hint string from the runtime's failure classifier. The
       * Work Bar shows this as a tooltip on the row's status pill so the
       * operator can tell at a glance whether the agent should keep going,
       * give up, or escalate to a human.
       */
      hint?: string
      /**
       * Set to `'open'` when the circuit breaker short-circuited the call.
       * The row should render with a distinct "halted" state that is
       * visually louder than a normal failure — this is the agent
       * deliberately refusing to retry a known-bad call.
       */
      breaker?: 'open' | 'closed'
      /** Number of consecutive failures that triggered the breaker (>=3). */
      failureCount?: number
    }
  | { type: 'context-upgrade-requested'; packs: string[]; reason: string }
  | { type: 'context-upgrade-applying'; packs: string[] }
  | { type: 'context-upgrade-applied'; packs: string[] }
  | { type: 'context-upgrade-aborted'; stage: string }
