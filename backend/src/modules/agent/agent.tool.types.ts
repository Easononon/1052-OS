/**
 * Optional context passed into a tool's `execute` on every invocation. Tools
 * that issue network I/O should forward `signal` to `fetch` / async libraries
 * so the runtime can actually cancel hung operations on timeout — relying on
 * a Promise.race reject alone leaves sockets, child processes, and gateway
 * connections alive even after the agent has moved on.
 */
export type AgentToolContext = {
  signal?: AbortSignal
}

export type AgentTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  /**
   * Per-tool wall-clock timeout in milliseconds. Defaults to
   * `DEFAULT_TOOL_TIMEOUT_MS` (90s) when unset. Most tools should be safe with
   * the default; long-running bulk operations may opt into a longer budget
   * (e.g. 120s for 100-point bulk add) but anything beyond 5 minutes should
   * reconsider whether it belongs in a synchronous tool call at all.
   */
  timeoutMs?: number
  execute: (args: unknown, ctx?: AgentToolContext) => Promise<unknown>
}
