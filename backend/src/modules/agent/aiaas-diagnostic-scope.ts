import { AsyncLocalStorage } from 'node:async_hooks'
import type { LLMConfig } from './llm.client.js'

export const SCOPED_DIAGNOSTIC_TOOLS = new Set([
  'skills_list', 'skills_read', 'aiaas_get_state', 'aiaas_database_sources', 'aiaas_database_analyze',
])
export const SCOPED_DIAGNOSTIC_SKILLS = new Set([
  'aiaas-data-quality', 'aiaas-trend-analysis', 'aiaas-process-diagnosis',
])
export type DiagnosticRunScope = {
  allowedSourceIds: readonly string[]
  signal: AbortSignal
  model: LLMConfig
  assertCurrent: () => Promise<void>
}
const storage = new AsyncLocalStorage<DiagnosticRunScope>()
export const getDiagnosticScope = () => storage.getStore()
export function runInDiagnosticScope<T>(scope: DiagnosticRunScope, run: () => T): T {
  return storage.run(scope, run)
}
