import { HttpError } from '../../http-error.js'
import type {
  LLMConversationMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.client.js'
import type { AgentTool, AgentToolContext } from './agent.tool.types.js'
import { agentRuntimeTools } from './tools/agent-runtime.tools.js'
import { calendarTools } from './tools/calendar.tools.js'
import { claudeCodeTools } from './tools/claude-code.tools.js'
import { filesystemTools } from './tools/filesystem.tools.js'
import { feishuTools } from './tools/feishu.tools.js'
import { aiaasTools } from './tools/aiaas.tools.js'
import { imageTools } from './tools/image.tools.js'
import { intelTools } from './tools/intel.tools.js'
import { industrialGatewayTools } from './tools/industrial-gateway.tools.js'
import { memoryTools } from './tools/memory.tools.js'
import { notesTools } from './tools/notes.tools.js'
import { orchestrationTools } from './tools/orchestration.tools.js'
import { outputProfileTools } from './tools/output-profile.tools.js'
import { repositoryTools } from './tools/repository.tools.js'
import { resourcesTools } from './tools/resources.tools.js'
import { scheduleTools } from './tools/schedule.tools.js'
import { skillsTools } from './tools/skills.tools.js'
import { sqlTools } from './tools/sql.tools.js'
import { terminalTools } from './tools/terminal.tools.js'
import { uapisTools } from './tools/uapis.tools.js'
import { wechatDesktopTools } from './tools/wechat-desktop.tools.js'
import { websearchTools } from './tools/websearch.tools.js'
import { wikiTools } from './tools/wiki.tools.js'
import { pkmTools } from './tools/pkm.tools.js'
import { ocrTools } from './tools/ocr.tools.js'
import { getSettings } from '../settings/settings.service.js'
import { isDiagnosticMode, isToolAllowed } from './agent.diagnostic-policy.js'
import { aiaasDatabaseTools } from './tools/aiaas-database.tools.js'
import { getDiagnosticScope } from './aiaas-diagnostic-scope.js'

/**
 * Default per-tool wall-clock timeout when a tool does not declare its own.
 * 90s is long enough for any well-behaved industrial gateway / TDengine /
 * Node-RED REST call yet short enough that a hung fetch (gateway crashed,
 * OPC UA server wedged, etc.) does not freeze the agent. Tools that
 * genuinely need longer (e.g. 100-point bulk add) should set their own
 * `timeoutMs`.
 */
const DEFAULT_TOOL_TIMEOUT_MS = 90_000

/**
 * Maximum size, in characters, that a single tool result JSON is allowed to
 * occupy when injected back into the LLM conversation. Hit this and the
 * content is replaced with a truncated preview plus a `_hint` that nudges
 * the model to re-issue a narrower query. Without this cap a single
 * `sql_query`, `websearch_read_page`, or unbounded list dump can push the
 * next turn's prompt past the model's context window — typically surfacing
 * as either `413`/`context_length_exceeded` errors or silent information
 * loss on the model's side.
 *
 * 80_000 chars ≈ 20K tokens at a 4:1 char:token ratio for English and closer
 * to 40K tokens for CJK — both comfortably under the 128K/200K context of
 * mainstream models while still being generous for legitimate file reads.
 */
export const MAX_TOOL_RESULT_CHARS = 80_000

/** Safe upper bound on tool-event preview strings sent to the frontend. */
const MAX_PREVIEW_CHARS = 240

const AGENT_TOOLS: AgentTool[] = [
  ...agentRuntimeTools,
  ...calendarTools,
  ...claudeCodeTools,
  ...imageTools,
  ...memoryTools,
  ...outputProfileTools,
  ...repositoryTools,
  ...notesTools,
  ...resourcesTools,
  ...skillsTools,
  ...scheduleTools,
  ...websearchTools,
  ...wikiTools,
  ...pkmTools,
  ...uapisTools,
  ...filesystemTools,
  ...feishuTools,
  ...aiaasTools,
  ...aiaasDatabaseTools,
  ...industrialGatewayTools,
  ...intelTools,
  ...wechatDesktopTools,
  ...sqlTools,
  ...orchestrationTools,
  ...terminalTools,
  ...ocrTools,
]
const TOOL_MAP = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]))

/**
 * Test-only escape hatch to register a tool without going through the
 * production tool list (which would pull in the entire real tool surface
 * and force every test file to mock a dozen modules). NOT exported from
 * the package's public surface.
 */
export function _registerToolForTest(tool: AgentTool) {
  TOOL_MAP.set(tool.name, tool)
}

export type AgentToolRuntimeContext = {
  source?:
    | {
        channel: 'wechat'
        accountId: string
        peerId: string
      }
    | {
        channel: 'feishu'
        receiveIdType: 'chat_id'
        receiveId: string
        chatType: 'p2p' | 'group'
        senderOpenId?: string
      }
    | {
        channel: 'wechat_desktop'
        sessionId: string
        sessionName: string
        sessionType: 'direct' | 'group'
        groupId?: string
        senderName?: string
        mentionedBot?: boolean
        allowTools?: boolean
      }
}

function stringifyResult(result: unknown) {
  return JSON.stringify(result, null, 2)
}

function parseArguments(value: string) {
  if (!value.trim()) return {}
  return JSON.parse(value) as unknown
}

/**
 * Wrap a successful tool result as the canonical `{ ok: true, data }` envelope,
 * truncating the serialized form when it exceeds {@link MAX_TOOL_RESULT_CHARS}.
 *
 * The truncated form preserves the head of the original payload as
 * `data_preview_head` and attaches explicit `_truncated`, `_originalSize`,
 * `_limit`, and `_hint` fields so the model gets an actionable signal to
 * narrow its next query rather than silently losing tail data.
 */
function buildTruncatedResultContent(result: unknown): string {
  const fullJson = stringifyResult({ ok: true, data: result })
  if (fullJson.length <= MAX_TOOL_RESULT_CHARS) return fullJson

  // Leave a small safety margin for the JSON envelope + hint metadata.
  const previewBudget = Math.max(0, MAX_TOOL_RESULT_CHARS - 2_000)
  const preview = fullJson.slice(0, previewBudget)
  return stringifyResult({
    ok: true,
    _truncated: true,
    _originalSize: fullJson.length,
    _limit: MAX_TOOL_RESULT_CHARS,
    _hint:
      `工具输出已从 ${fullJson.length} 字符截断至约 ${previewBudget} 字符。` +
      '请收窄查询范围（例如增加 limit/offset、过滤字段、缩短时间窗、按路径/ID 定位），' +
      '或直接告知用户原始输出过大、让用户选择下一步。',
    data_preview_head: preview,
  })
}

function truncatePreview(input: string, maxLen = MAX_PREVIEW_CHARS): string {
  const trimmed = input.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen - 1) + '…'
}

/**
 * Short human-readable summary of tool_call arguments, suitable for showing
 * directly in the UI beside the tool name. Handles three cases:
 *
 *   - valid JSON object → renders the top-level keys as `key=value` pairs
 *     (values truncated individually), stripping internal fields like
 *     `confirmed` and `__runtimeContext`
 *   - valid JSON but not an object → `JSON.stringify` truncated
 *   - malformed JSON → raw string truncated (we deliberately do not try to
 *     auto-repair here — that belongs in a future Zod/json5 phase)
 */
export function buildArgsPreview(rawArgs: string): string {
  const trimmed = rawArgs.trim()
  if (!trimmed) return ''

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return truncatePreview(trimmed)
  }

  if (parsed === null || parsed === undefined) return ''
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return truncatePreview(JSON.stringify(parsed))
  }

  const record = parsed as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record)) {
    if (key === 'confirmed' || key === '__runtimeContext') continue
    parts.push(renderArgPair(key, record[key]))
    if (parts.join(', ').length >= MAX_PREVIEW_CHARS) break
  }
  return truncatePreview(parts.join(', '))
}

function renderArgPair(key: string, value: unknown): string {
  if (value === null || value === undefined) return `${key}=null`
  if (typeof value === 'string') {
    const short = value.length <= 48 ? value : value.slice(0, 47) + '…'
    return `${key}="${short}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}=${value}`
  }
  if (Array.isArray(value)) {
    return `${key}=[${value.length} items]`
  }
  return `${key}={…}`
}

interface ToolResultEnvelope {
  ok?: unknown
  error?: unknown
  data?: unknown
  _truncated?: unknown
}

/**
 * Short human-readable summary of a tool's JSON return payload, suitable for
 * showing directly in the UI when a tool call completes. Mirrors the shape
 * produced by {@link executeToolCall}.
 */
export function buildResultPreview(content: string): string {
  let parsed: ToolResultEnvelope | null = null
  try {
    const candidate = JSON.parse(content) as unknown
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as ToolResultEnvelope
    }
  } catch {
    return truncatePreview(content)
  }

  if (!parsed) return truncatePreview(content)
  if (parsed.ok === false && typeof parsed.error === 'string') {
    return truncatePreview(parsed.error)
  }
  if (parsed.ok === true) {
    const prefix = parsed._truncated === true ? '[已截断] ' : ''
    return truncatePreview(prefix + formatResultPayload(parsed.data))
  }
  return truncatePreview(content)
}

function formatResultPayload(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) return '{}'
    return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`
  }
  return ''
}

function buildToolDefinition(tool: AgentTool): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

type ToolFailureOptions = {
  /** Whether the same call could plausibly succeed on retry (transient I/O). */
  retryable: boolean
  /**
   * Actionable next step for the model. Distinct from `error` (the cause);
   * this is the "what to do now" guidance — e.g. "check the gateway is up
   * and ask the user to confirm", or "you've retried this 3 times, escalate
   * to the user instead of looping again".
   */
  hint?: string
  /** Optional structured metadata to surface alongside the message. */
  meta?: Record<string, unknown>
}

function buildToolFailureMessage(
  toolCall: Pick<LLMToolCall, 'id' | 'function'>,
  toolName: string,
  error: string,
  options: ToolFailureOptions = { retryable: false },
): LLMConversationMessage {
  const payload: Record<string, unknown> = {
    ok: false,
    error,
    _retryable: options.retryable,
  }
  if (options.hint) payload._hint = options.hint
  if (options.meta) Object.assign(payload, options.meta)
  return {
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolName,
    content: stringifyResult(payload),
  }
}

function toolTimeoutMessage(name: string, ms: number) {
  return `Tool timed out: ${name} exceeded ${Math.floor(ms / 1000)}s`
}

/**
 * Run `executor` with a wall-clock deadline. On timeout we both reject the
 * awaited promise (so the caller unblocks immediately) AND call
 * `controller.abort()` so tools that forwarded the signal into `fetch` /
 * async libraries actually release their sockets. The previous Promise.race
 * implementation only rejected — sockets, child processes, and gateway
 * connections stayed alive, which is what made the agent "feel stuck": the
 * promise was already settled but resources kept burning in the background.
 */
async function withToolTimeout<T>(
  executor: (signal: AbortSignal) => Promise<T>,
  name: string,
  ms: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      executor(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new HttpError(504, toolTimeoutMessage(name, ms)))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function getAgentToolDefinitions(): LLMToolDefinition[] {
  return AGENT_TOOLS.filter((tool) => isToolAllowed(tool.name)).map((tool) => buildToolDefinition(tool))
}

export function hasAgentTool(name: string) {
  return isToolAllowed(name) && TOOL_MAP.has(name)
}

export function getAgentToolDefinitionsForNames(names: readonly string[]): LLMToolDefinition[] {
  const seen = new Set<string>()
  const tools: LLMToolDefinition[] = []

  for (const name of names) {
    if (!isToolAllowed(name)) continue
    if (seen.has(name)) continue
    const tool = TOOL_MAP.get(name)
    if (!tool) continue
    seen.add(name)
    tools.push(buildToolDefinition(tool))
  }

  return tools
}

/** Max retries for transient tool execution errors (network, 502/503/504/408/429). */
const MAX_TOOL_RETRIES = 2

/**
 * Returns true if the error is transient and the tool call should be retried
 * with the same arguments. The model is the ultimate judge: even when we
 * auto-retry, the failure message we ultimately surface carries a
 * `_retryable: true` flag so the model knows the next attempt is on the
 * runtime, not on it.
 */
function isRetriableToolError(error: unknown): boolean {
  if (error instanceof HttpError) {
    // 502/503/504 — upstream/gateway problems, worth one more try
    // 408 — request timeout, often transient
    // 429 — rate limit, transient
    if (error.status === 502 || error.status === 503 ||
        error.status === 504 || error.status === 408 ||
        error.status === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    // AbortError from our own AbortController is a timeout — DO NOT retry,
    // the next attempt will also hit the timeout and just waste time.
    if (error.name === 'AbortError') return false
    if (msg.includes('fetch failed') || msg.includes('econnreset') ||
        msg.includes('econnrefused') || msg.includes('etimedout') ||
        msg.includes('socket hang up') || msg.includes('network')) return true
  }
  return false
}

/**
 * Classify a tool error into a hint string the model can act on. The split
 * between "transient" and "hard" matters because LLM loops tend to be caused
 * by the model retrying the SAME bad call again and again. A clear hint is
 * what nudges it to either give up, change parameters, or ask the user.
 */
function buildFailureHint(name: string, error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 504) {
      return `工具 ${name} 执行超过超时时间。底层请求已被中止。` +
        '如果连续出现，请先确认后端服务（网关/Node-RED/TDengine）是否存活，再考虑更换工具或换一种思路。'
    }
    if (error.status === 408 || error.status === 502 || error.status === 503) {
      return `工具 ${name} 暂时不可用（${error.status}）。已自动重试仍失败，` +
        '建议先确认依赖服务状态，或告知用户稍候再试。'
    }
    if (error.status === 429) {
      return `工具 ${name} 触发限流（429）。请降低调用频率或让用户稍候再试。`
    }
    if (error.status === 400) {
      return `工具 ${name} 收到 400，请检查参数是否正确（ID 格式、必填字段、确认标志 confirmed）。` +
        '相同参数继续重试不会成功。'
    }
    if (error.status === 403) {
      return `工具 ${name} 权限不足（403）。需要用户明确授权或在 fullAccess 模式下运行。`
    }
    if (error.status === 404) {
      return `工具 ${name} 找不到目标资源（404）。请确认 ID/路径是否正确，再决定是否重试。`
    }
    if (error.status >= 500) {
      return `工具 ${name} 后端异常（${error.status}）。请告知用户检查后端服务。`
    }
    return `工具 ${name} 返回 ${error.status}。如非瞬时错误请勿继续以相同参数重试。`
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return `工具 ${name} 被超时中止。如果这正是预期结果（防止长时间挂起），` +
      '则无需重试；否则请告知用户检查后端服务。'
  }
  return `工具 ${name} 调用失败。请检查参数或告知用户。`
}

// ── circuit breaker ────────────────────────────────────────────────────────
//
// Without this guard, a model that emits a failing tool call (e.g. it
// misread an OPC UA node id format and keeps asking the gateway to browse
// the same broken path) will re-issue the SAME call on every retry turn
// indefinitely. Each retry costs latency + tokens, and from the user's
// perspective the agent looks "stuck" — they see tool-started/tool-finished
// events spinning in a tight loop. The breaker detects (toolName, argsHash)
// repeats within a short window, lets the first 2 attempts through, and
// from the 3rd failure onward returns a stop-and-ask-user message WITHOUT
// re-executing the tool. The model sees a strongly-worded `_hint` and
// breaks the loop.

const CIRCUIT_BREAKER_WINDOW_MS = 60_000
const CIRCUIT_BREAKER_THRESHOLD = 3

type CircuitBreakerEntry = {
  failures: number
  firstAt: number
  lastAt: number
  lastError: string
}

const circuitBreaker = new Map<string, CircuitBreakerEntry>()

function circuitBreakerKey(name: string, args: unknown): string {
  // Stable, low-cardinality hash with sorted object keys so `{a:1,b:2}` and
  // `{b:2,a:1}` produce the same key (the LLM sometimes reorders fields).
  // Arrays keep their order since the semantics of array parameters (e.g.
  // 100-point bulk add) depend on it.
  let normalized: string
  try {
    normalized = stableStringify(args)
  } catch {
    normalized = String(args)
  }
  return `${name}|${normalized}`
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') +
    '}'
  )
}

function pruneCircuitBreaker(now: number) {
  for (const [key, entry] of circuitBreaker) {
    if (now - entry.lastAt > CIRCUIT_BREAKER_WINDOW_MS) circuitBreaker.delete(key)
  }
}

function recordCircuitBreakerSuccess(key: string) {
  circuitBreaker.delete(key)
}

function recordCircuitBreakerFailure(key: string, error: string, now: number) {
  const existing = circuitBreaker.get(key)
  if (!existing) {
    circuitBreaker.set(key, { failures: 1, firstAt: now, lastAt: now, lastError: error })
    return
  }
  existing.failures += 1
  existing.lastAt = now
  existing.lastError = error
}

function checkCircuitBreaker(key: string, now: number):
  | { blocked: true; entry: CircuitBreakerEntry }
  | { blocked: false } {
  const entry = circuitBreaker.get(key)
  if (!entry) return { blocked: false }
  if (now - entry.lastAt > CIRCUIT_BREAKER_WINDOW_MS) {
    circuitBreaker.delete(key)
    return { blocked: false }
  }
  if (entry.failures >= CIRCUIT_BREAKER_THRESHOLD) return { blocked: true, entry }
  return { blocked: false }
}

export async function executeToolCall(
  toolCall: LLMToolCall,
  runtimeContext?: AgentToolRuntimeContext,
): Promise<LLMConversationMessage> {
  if (!isToolAllowed(toolCall.function.name)) {
    return buildToolFailureMessage(toolCall, toolCall.function.name,
      'AIAAS 只读诊断权限拒绝此工具。confirmed/fullAccess 不能提升权限。',
      { retryable: false, hint: '只能读取批准的遥测和数据库分析；禁止写 PLC、数据库、终端和外部通知。' })
  }
  const settings = await getSettings()
  const fullAccess = !isDiagnosticMode() && settings.agent.fullAccess === true
  const tool = TOOL_MAP.get(toolCall.function.name)

  if (!tool) {
    return buildToolFailureMessage(
      toolCall,
      toolCall.function.name,
      `未找到工具: ${toolCall.function.name}。请检查工具名称是否正确。`,
      { retryable: false, hint: '工具名称不存在。请检查模型是否生成了正确的工具名。' },
    )
  }

  // Resolve the parsed args once so the circuit breaker can key on a stable
  // representation of the call (text-args variance would defeat the breaker).
  let parsedArgs: unknown
  try {
    parsedArgs = parseArguments(toolCall.function.arguments)
  } catch (error) {
    return buildToolFailureMessage(
      toolCall,
      tool.name,
      `工具参数解析失败: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: false, hint: '工具参数不是合法 JSON。请检查模型输出的参数格式。' },
    )
  }

  // Circuit breaker: short-circuit calls that have already failed too many
  // times recently. Done before the retry loop so we never even try to
  // re-issue a known-bad call.
  const now = Date.now()
  pruneCircuitBreaker(now)
  const breakerKey = circuitBreakerKey(tool.name, parsedArgs)
  const breaker = checkCircuitBreaker(breakerKey, now)
  if (breaker.blocked) {
    return buildToolFailureMessage(
      toolCall,
      tool.name,
      `工具 ${tool.name} 在最近 ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s 内已连续失败 ${breaker.entry.failures} 次（最后错误：${breaker.entry.lastError}）。已停止重复执行。`,
      {
        retryable: false,
        hint: '同一工具同一参数已经连续失败多次。请立刻停止重试，' +
          '将当前情况、最后一次错误信息告知用户，让用户决定是检查后端、修改参数还是放弃此任务。',
        meta: {
          _breaker: 'open',
          _failureCount: breaker.entry.failures,
          _signature: breakerKey,
        },
      },
    )
  }

  let lastError: Error | HttpError | null = null
  let lastRetryable = false
  const timeoutMs = tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS

  for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt += 1) {
    try {
      await getDiagnosticScope()?.assertCurrent()
      const confirmedArgs =
        fullAccess && parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
          ? { ...(parsedArgs as Record<string, unknown>), confirmed: true }
          : parsedArgs
      const args =
        runtimeContext &&
        confirmedArgs &&
        typeof confirmedArgs === 'object' &&
        !Array.isArray(confirmedArgs)
          ? { ...(confirmedArgs as Record<string, unknown>), __runtimeContext: runtimeContext }
          : confirmedArgs
      const toolCtx: AgentToolContext = {}
      const result = await withToolTimeout(
        (signal) => tool.execute(args, { ...toolCtx, signal: getDiagnosticScope()
          ? AbortSignal.any([signal, getDiagnosticScope()!.signal]) : signal }),
        tool.name,
        timeoutMs,
      )

      // Success: clear any breaker state for this signature so future
      // legitimately-different calls aren't accidentally blocked.
      recordCircuitBreakerSuccess(breakerKey)

      return {
        role: 'tool',
        toolCallId: toolCall.id,
        name: tool.name,
        content: buildTruncatedResultContent(result),
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('工具调用失败')
      lastRetryable = isRetriableToolError(error)

      // Retry on transient errors with backoff
      if (!getDiagnosticScope() && attempt < MAX_TOOL_RETRIES && lastRetryable) {
        console.warn(`[tool] ${tool.name} transient error (attempt ${attempt + 1}/${MAX_TOOL_RETRIES + 1}): ${lastError.message}`)
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      break
    }
  }

  // Failure: record in the circuit breaker so the next identical call from
  // the model is short-circuited. We record only the user-visible error
  // message; do NOT include the breaker key in the recorded value (it would
  // just bloat the entry).
  recordCircuitBreakerFailure(breakerKey, lastError?.message ?? '工具调用失败', Date.now())

  const message = lastError?.message ?? '工具调用失败'
  return buildToolFailureMessage(toolCall, tool.name, message, {
    retryable: lastRetryable,
    hint: buildFailureHint(tool.name, lastError),
  })
}

/**
 * Execute every tool call from a single assistant turn in parallel.
 *
 * When a model emits multiple tool_calls in one turn it is explicitly
 * signalling that the calls are independent and may be dispatched
 * concurrently (this is OpenAI's documented contract for parallel tool use).
 * `Promise.all` preserves the input order in its results, which we must keep
 * because OpenAI requires the subsequent tool messages to be ordered by
 * `tool_call_id` matching the assistant turn's tool_calls array.
 *
 * Each `executeToolCall` already wraps its body in try/catch and produces a
 * tool message regardless of success or failure, so `Promise.all` cannot
 * reject here.
 */
export async function executeToolCalls(
  toolCalls: LLMToolCall[],
  runtimeContext?: AgentToolRuntimeContext,
): Promise<LLMConversationMessage[]> {
  if (toolCalls.length === 0) return []
  if (toolCalls.length === 1) {
    return [await executeToolCall(toolCalls[0], runtimeContext)]
  }
  return Promise.all(toolCalls.map((toolCall) => executeToolCall(toolCall, runtimeContext)))
}
