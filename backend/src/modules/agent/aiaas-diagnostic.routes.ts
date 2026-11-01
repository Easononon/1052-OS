import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import { isDiagnosticMode } from './agent.diagnostic-policy.js'
import { diagnosticModelBinding } from './aiaas-diagnostic-model.js'
import { DiagnosticLeaseStore } from './aiaas-diagnostic-store.js'
import { runInDiagnosticScope } from './aiaas-diagnostic-scope.js'
import { sendMessageStream } from './agent.service.js'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
const scopeSchema = z.object({ deploymentId: id, revision: id, expectedRevision: id.nullable(),
  enabled: z.boolean(), modelFingerprint: z.string().min(1).max(128),
  allowedSourceIds: z.array(id).max(50) }).strict()
const streamSchema = z.object({ deploymentId: id, revision: id,
  ownerKey: z.string().regex(/^[a-f0-9]{64}$/), chatId: z.string().uuid(), runId: z.string().uuid(),
  modelFingerprint: z.string().min(1).max(128),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(40000) }).strict()).min(1).max(40),
}).strict()
const revokeSchema = z.object({ deploymentId: id, revision: id, runId: z.string().uuid().optional() }).strict()
let store: DiagnosticLeaseStore | undefined
function leases() { return store ??= new DiagnosticLeaseStore(path.join(config.dataDir, 'aiaas-diagnostic-bridge.sqlite')) }
const active = new Map<string, { deploymentId: string; revision: string; controller: AbortController }>()
export const aiaasDiagnosticRouter = Router()
aiaasDiagnosticRouter.use((req, res, next) => {
  const secret = process.env.AIAAS_DIAGNOSTIC_BRIDGE_TOKEN || ''
  if (!secret) { res.status(503).json({ error: 'bridge_token_not_configured' }); return }
  const expected = Buffer.from(`Bearer ${secret}`)
  const supplied = Buffer.from(req.headers.authorization || '')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    res.status(401).json({ error: 'bridge_auth_required' }); return
  }
  if (!isDiagnosticMode()) { res.status(403).json({ error: 'diagnostic_mode_required' }); return }
  next()
})
aiaasDiagnosticRouter.get('/capabilities', async (_req, res, next) => {
  try {
    const binding = await diagnosticModelBinding()
    res.json({ protocol_version: 'aiaas.diagnostic.v1', mode: 'diagnostic', direct_control_allowed: false,
      scoped_sessions: true, scoped_data_policy: true, model: binding.public })
  } catch (error) { next(error) }
})
aiaasDiagnosticRouter.get('/scope/:deploymentId', (req, res, next) => {
  try {
    const deploymentId = id.parse(req.params.deploymentId)
    const scope = leases().getScope(deploymentId)
    res.json({ revision: scope?.revision ?? null, enabled: scope?.enabled ?? false })
  } catch (error) { next(error) }
})
aiaasDiagnosticRouter.put('/scope', async (req, res, next) => {
  try {
    const parsed = scopeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'invalid_scope')
    const input = parsed.data
    const binding = await diagnosticModelBinding()
    if (input.enabled && (!binding.public.configured || input.modelFingerprint !== binding.public.fingerprint)) {
      throw new HttpError(409, 'model_binding_changed')
    }
    leases().setScope(input, input.expectedRevision)
    for (const run of active.values()) if (run.deploymentId === input.deploymentId) run.controller.abort()
    res.json({ revision: input.revision, direct_control_allowed: false })
  } catch (error) { next(error) }
})
aiaasDiagnosticRouter.post('/revoke', (req, res, next) => {
  try {
    const input = revokeSchema.parse(req.body)
    const current = leases().getScope(input.deploymentId)
    if (input.runId) {
      leases().revokeRun(input.deploymentId, input.revision, input.runId)
      const run = active.get(input.runId)
      if (run?.deploymentId === input.deploymentId && run.revision === input.revision) run.controller.abort()
    } else if (current?.revision === input.revision) {
      leases().setScope({ ...current, enabled: false }, input.revision)
      for (const run of active.values()) if (run.deploymentId === input.deploymentId) run.controller.abort()
    }
    res.json({ ok: true })
  } catch (error) { next(error) }
})
aiaasDiagnosticRouter.post('/stream', async (req, res, next) => {
  let lease: ReturnType<DiagnosticLeaseStore['claim']> | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  try {
    const parsed = streamSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'invalid_diagnostic_request')
    const input = parsed.data
    const scope = leases().getScope(input.deploymentId)
    const binding = await diagnosticModelBinding()
    if (!scope?.enabled || scope.revision !== input.revision) throw new HttpError(409, 'scope_changed')
    if (binding.public.fingerprint !== scope.modelFingerprint) {
      leases().setScope({ ...scope, enabled: false }, scope.revision)
      throw new HttpError(409, 'model_binding_changed')
    }
    if (scope.modelFingerprint !== input.modelFingerprint) {
      throw new HttpError(409, 'model_binding_changed')
    }
    lease = leases().claim(input)
    const currentLease = lease
    const controller = new AbortController()
    active.set(input.runId, { deploymentId: input.deploymentId, revision: input.revision, controller })
    const timeout = AbortSignal.timeout(180000)
    const signal = AbortSignal.any([controller.signal, timeout])
    const assertCurrent = async () => {
      signal.throwIfAborted()
      leases().assertLease(currentLease)
      if ((await diagnosticModelBinding()).public.fingerprint !== input.modelFingerprint) {
        leases().setScope({ ...scope, enabled: false }, scope.revision)
        throw new HttpError(409, 'model_binding_changed')
      }
    }
    poll = setInterval(() => { void assertCurrent().catch(() => controller.abort()) }, 250)
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.flushHeaders()
    let outputLength = 0
    await runInDiagnosticScope({ allowedSourceIds: scope.allowedSourceIds, model: binding.model, signal, assertCurrent }, async () => {
      for await (const event of sendMessageStream(input.messages, { abortSignal: signal })) {
        await assertCurrent()
        if (event.type === 'delta') {
          outputLength += event.content.length
          if (outputLength > 40000) throw new HttpError(413, 'diagnostic_answer_too_large')
          res.write(`data: ${JSON.stringify({ type: 'delta', content: event.content })}\n\n`)
        }
        if (event.type === 'tool-started' || event.type === 'tool-finished') {
          res.write(`data: ${JSON.stringify({ type: event.type, name: event.name, ...('ok' in event ? { ok: event.ok } : {}) })}\n\n`)
        }
      }
      await assertCurrent()
      res.write('data: {"type":"done"}\n\n')
    })
    res.end()
  } catch (error) {
    if (!res.headersSent) next(error)
    else {
      if (!res.destroyed) res.end(`data: ${JSON.stringify({ type: 'error', code: error instanceof HttpError ? error.message : 'diagnostic_run_failed' })}\n\n`)
    }
  } finally {
    if (poll) clearInterval(poll)
    if (lease) { active.delete(lease.runId); leases().finish(lease) }
  }
})
