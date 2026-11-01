import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir = ''
beforeEach(async () => {
  vi.resetModules()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-scoped-'))
  vi.stubEnv('DATA_DIR', dir)
  vi.stubEnv('AIAAS_AGENT_MODE', 'diagnostic')
  vi.stubEnv('AIAAS_DIAGNOSTIC_BRIDGE_TOKEN', 'isolated-test-service-token')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.doUnmock('./llm.client.js')
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })
})
const auth = 'Bearer isolated-test-service-token'

async function appFixture() {
  const settings = await import('../settings/settings.service.js')
  await settings.upsertLlmProfile({ id: 'fixture', name: 'fixture', kind: 'local', provider: 'ollama',
    baseUrl: 'http://127.0.0.1:1/v1', modelId: 'fixture-model', enabled: true }, { activate: true })
  const { createApp } = await import('../../app.js')
  return createApp()
}

describe('AIAAS dedicated diagnostic protocol', () => {
  it('requires a configured backend token and diagnostic mode', async () => {
    const app = await appFixture()
    expect((await request(app).get('/api/aiaas/diagnostics/capabilities')).status).toBe(401)
    expect((await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', 'Bearer wrong')).status).toBe(401)
    vi.stubEnv('AIAAS_AGENT_MODE', 'general')
    expect((await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).status).toBe(403)
    vi.stubEnv('AIAAS_AGENT_MODE', 'diagnostic')
    vi.stubEnv('AIAAS_DIAGNOSTIC_BRIDGE_TOKEN', '')
    expect((await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).status).toBe(503)
  })

  it('registers a CAS scope and invalidates existing leases across store instances', async () => {
    const app = await appFixture()
    const caps = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    expect(caps).toMatchObject({ protocol_version: 'aiaas.diagnostic.v1', direct_control_allowed: false,
      scoped_sessions: true, scoped_data_policy: true })
    expect(JSON.stringify(caps)).not.toContain('apiKey')
    const input = { deploymentId: 'demo', revision: 'rev-1', expectedRevision: null,
      modelFingerprint: caps.model.fingerprint, allowedSourceIds: [], enabled: true }
    const registration = await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send(input)
    expect(registration.status).toBe(200)
    expect((await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send(input)).status).toBe(409)
    const { DiagnosticLeaseStore } = await import('./aiaas-diagnostic-store.js')
    const file = path.join(dir, 'aiaas-diagnostic-bridge.sqlite')
    const first = new DiagnosticLeaseStore(file)
    const second = new DiagnosticLeaseStore(file)
    const lease = first.claim({ deploymentId: 'demo', revision: 'rev-1', ownerKey: 'a'.repeat(64),
      chatId: '11111111-1111-4111-8111-111111111111', runId: 'run-1' })
    expect(() => second.claim({ ...lease, runId: 'run-2' })).toThrow('in_progress')
    expect((await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth)
      .send({ ...input, revision: 'rev-2', expectedRevision: 'rev-1' })).status).toBe(200)
    expect(() => second.assertLease(lease)).toThrow('scope_changed')
    first.close(); second.close()
  })

  it('rejects unexpected scope fields and an unconfirmed model', async () => {
    const app = await appFixture()
    const input = { deploymentId: 'demo', revision: 'r1', expectedRevision: null,
      modelFingerprint: 'wrong', allowedSourceIds: [], enabled: true }
    expect((await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send(input)).status).toBe(409)
    expect((await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth)
      .send({ ...input, fullAccess: true })).status).toBe(400)
  })

  it('restricts discovery and execution within a trusted per-run scope', async () => {
    const { runInDiagnosticScope } = await import('./aiaas-diagnostic-scope.js')
    const tools = await import('./agent.tool.service.js')
    await runInDiagnosticScope({ allowedSourceIds: [], signal: new AbortController().signal,
      assertCurrent: async () => {}, model: {} as never }, async () => {
      expect(tools.getAgentToolDefinitions().map(t => t.function.name)).toEqual([
        'skills_list', 'skills_read', 'aiaas_get_state', 'aiaas_database_sources', 'aiaas_database_analyze',
      ])
      const result = await tools.executeToolCall({ id: 'test', type: 'function',
        function: { name: 'agent_runtime_status', arguments: '{}' } })
      expect(JSON.parse(result.content).ok).toBe(false)
      const db = await import('./tools/aiaas-database.tools.js')
      expect(await db.aiaasDatabaseTools[0].execute({})).toEqual({ direct_control_allowed: false, sources: [] })
      const skill = (await import('./tools/skills.tools.js')).skillsTools.find(t => t.name === 'skills_read')!
      await expect(skill.execute({ id: 'private-skill' })).rejects.toThrow('not_approved')
    })
  })

  it('does not return unknown or legacy state to a simulation-only model run', async () => {
    const { runInDiagnosticScope } = await import('./aiaas-diagnostic-scope.js')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/observation')
      ? new Response('Not Found', { status: 404 })
      : new Response(JSON.stringify({ do_mg_l: 2 }), { status: 200 })))
    const tool = (await import('./tools/aiaas.tools.js')).aiaasTools.find(t => t.name === 'aiaas_get_state')!
    await runInDiagnosticScope({ allowedSourceIds: [], signal: new AbortController().signal,
      assertCurrent: async () => {}, model: {} as never }, async () => {
      await expect(tool.execute({})).rejects.toThrow('simulation_only')
    })
  })

  it('streams through the existing Agent without private context and enforces chat ownership', async () => {
    vi.doMock('./llm.client.js', async original => ({
      ...await original<typeof import('./llm.client.js')>(),
      chatCompletionStream: async function* (_model: unknown, messages: { role: string; content: string }[]) {
        expect(messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['sample question'])
        expect(messages[0].content).not.toContain('Workspace root:')
        yield 'simulated response'
        return { role: 'assistant', content: 'simulated response', toolCalls: [], finishReason: 'stop' }
      },
    }))
    const app = await appFixture()
    const caps = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    const scope = { deploymentId: 'stream-demo', revision: 'v1', expectedRevision: null,
      modelFingerprint: caps.model.fingerprint, allowedSourceIds: [], enabled: true }
    await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send(scope)
    const input = { deploymentId: 'stream-demo', revision: 'v1', ownerKey: 'a'.repeat(64),
      chatId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
      modelFingerprint: caps.model.fingerprint, messages: [{ role: 'user', content: 'sample question' }] }
    const response = await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth).send(input)
    expect(response.status).toBe(200)
    expect(response.text).toContain('simulated response')
    expect(response.text).toContain('"type":"done"')
    expect((await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth)
      .send({ ...input, ownerKey: 'b'.repeat(64), runId: '33333333-3333-4333-8333-333333333333' })).status).toBe(404)
  })

  it('filters real/private sources before returning any catalogue or analysis', async () => {
    await fs.mkdir(path.join(dir, 'aiaas-diagnostics'), { recursive: true })
    await fs.writeFile(path.join(dir, 'aiaas-diagnostics/sources.json'), JSON.stringify({ version: 1,
      sources: ['approved', 'private', 'real'].map(id => ({ id, name: id, datasourceId: id,
        table: 'readings', timeColumn: 'ts_ms', metricColumn: 'tag', valueColumn: 'value',
        sampleIntervalSeconds: 60, maxRows: 100, maxWindowHours: 24, simulated: id !== 'real',
        metrics: [{ id: 'do', unit: 'mg/L' }] })) }))
    const { runInDiagnosticScope } = await import('./aiaas-diagnostic-scope.js')
    const tools = (await import('./tools/aiaas-database.tools.js')).aiaasDatabaseTools
    await runInDiagnosticScope({ allowedSourceIds: ['approved', 'real'], model: {} as never,
      signal: new AbortController().signal, assertCurrent: async () => {} }, async () => {
      const result = await tools[0].execute({}) as { sources: { id: string }[] }
      expect(result.sources.map(s => s.id)).toEqual(['approved'])
      await expect(tools[1].execute({ sourceId: 'private', metric: 'do', start: '2026-11-01T00:00:00Z', end: '2026-11-01T01:00:00Z' })).rejects.toThrow('未获批准')
    })
  })

  it('persists per-run revocation for other worker processes', async () => {
    const { DiagnosticLeaseStore } = await import('./aiaas-diagnostic-store.js')
    const file = path.join(dir, 'shared.sqlite')
    const a = new DiagnosticLeaseStore(file), b = new DiagnosticLeaseStore(file)
    a.setScope({ deploymentId: 'demo', revision: 'r1', enabled: true, modelFingerprint: 'fixture', allowedSourceIds: [] }, null)
    const run = a.claim({ deploymentId: 'demo', revision: 'r1', ownerKey: 'a'.repeat(64), chatId: 'chat', runId: 'one' })
    b.revokeRun('demo', 'r1', 'one')
    expect(() => a.assertLease(run)).toThrow('scope_changed')
    a.close(); b.close()
  })

  it.each(['length', undefined])('never completes an unverified model finish %s', async finishReason => {
    vi.doMock('./llm.client.js', async original => ({
      ...await original<typeof import('./llm.client.js')>(),
      chatCompletionStream: async function* () {
        yield 'partial only'
        return { role: 'assistant', content: 'partial only', toolCalls: [], finishReason }
      },
    }))
    const app = await appFixture()
    const caps = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send({
      deploymentId: 'truncated', revision: 'r1', expectedRevision: null, enabled: true,
      modelFingerprint: caps.model.fingerprint, allowedSourceIds: [] })
    const result = await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth).send({
      deploymentId: 'truncated', revision: 'r1', ownerKey: 'a'.repeat(64),
      chatId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
      modelFingerprint: caps.model.fingerprint, messages: [{ role: 'user', content: 'test' }] })
    expect(result.text).not.toContain('"type":"done"')
    expect(result.text).toContain('diagnostic_model_incomplete')
  })

  it('permanently revokes a binding change detected before the stream starts', async () => {
    const app = await appFixture()
    const caps = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send({
      deploymentId: 'preflight', revision: 'r1', expectedRevision: null, enabled: true,
      modelFingerprint: caps.model.fingerprint, allowedSourceIds: [] })
    const settings = await import('../settings/settings.service.js')
    const profile = { id: 'fixture', name: 'fixture', kind: 'local' as const, provider: 'ollama' as const,
      baseUrl: 'http://127.0.0.1:1/v1', modelId: 'changed-model', enabled: true }
    await settings.upsertLlmProfile(profile, { activate: true })
    const input = { deploymentId: 'preflight', revision: 'r1', ownerKey: 'a'.repeat(64),
      chatId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
      modelFingerprint: caps.model.fingerprint, messages: [{ role: 'user', content: 'test' }] }
    expect((await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth).send(input)).status).toBe(409)
    const revoked = await request(app).get('/api/aiaas/diagnostics/scope/preflight').set('Authorization', auth)
    expect(revoked.body.enabled).toBe(false)
    await settings.upsertLlmProfile({ ...profile, modelId: 'fixture-model' }, { activate: true })
    expect((await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth).send(input)).status).toBe(409)
  })

  it('revokes a run before another model call when the source registry changes', async () => {
    let calls = 0
    vi.doMock('./llm.client.js', async original => ({
      ...await original<typeof import('./llm.client.js')>(),
      chatCompletionStream: async function* () {
        calls += 1
        await fs.mkdir(path.join(dir, 'aiaas-diagnostics'), { recursive: true })
        await fs.writeFile(path.join(dir, 'aiaas-diagnostics/sources.json'), '{"version":1,"sources":[]}')
        yield 'interrupted'
        return { role: 'assistant', content: 'interrupted', toolCalls: [], finishReason: 'stop' }
      },
    }))
    const app = await appFixture()
    const caps = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    await request(app).put('/api/aiaas/diagnostics/scope').set('Authorization', auth).send({
      deploymentId: 'registry', revision: 'r1', expectedRevision: null, enabled: true,
      modelFingerprint: caps.model.fingerprint, allowedSourceIds: [] })
    const result = await request(app).post('/api/aiaas/diagnostics/stream').set('Authorization', auth).send({
      deploymentId: 'registry', revision: 'r1', ownerKey: 'a'.repeat(64),
      chatId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
      modelFingerprint: caps.model.fingerprint, messages: [{ role: 'user', content: 'test' }] })
    expect(calls).toBe(1)
    expect(result.text).not.toContain('"type":"done"')
    const changed = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    expect(changed.model.fingerprint).not.toBe(caps.model.fingerprint)
    await fs.rm(path.join(dir, 'aiaas-diagnostics/sources.json'))
    const restored = (await request(app).get('/api/aiaas/diagnostics/capabilities').set('Authorization', auth)).body
    expect(restored.model.fingerprint).toBe(caps.model.fingerprint)
    const revoked = await request(app).get('/api/aiaas/diagnostics/scope/registry').set('Authorization', auth)
    expect(revoked.body.enabled).toBe(false)
  })
})
