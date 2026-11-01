/** A process-level boundary, independent of model arguments and UI fullAccess. */
export function isDiagnosticMode(): boolean {
  const mode = process.env.AIAAS_AGENT_MODE?.trim()
  if (mode && mode !== 'general' && mode !== 'diagnostic') {
    throw new Error('Invalid AIAAS_AGENT_MODE; expected general or diagnostic')
  }
  return mode === 'diagnostic'
}

const DIAGNOSTIC_TOOLS = new Set([
  'agent_runtime_status', 'skills_list', 'skills_read',
  'aiaas_get_state', 'aiaas_get_alarms', 'aiaas_get_prediction_analysis',
  'aiaas_get_control_logs', 'aiaas_database_sources', 'aiaas_database_analyze',
])

export function isToolAllowed(name: string): boolean {
  if (getDiagnosticScope()) return isDiagnosticMode() && SCOPED_DIAGNOSTIC_TOOLS.has(name)
  return !isDiagnosticMode() || DIAGNOSTIC_TOOLS.has(name)
}
import { getDiagnosticScope, SCOPED_DIAGNOSTIC_TOOLS } from './aiaas-diagnostic-scope.js'
