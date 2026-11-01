import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir = ''
const start = '2026-10-31T00:00:00Z'
const end = '2026-10-31T00:03:00Z'

beforeEach(async () => {
  vi.resetModules()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-diagnostic-'))
  vi.stubEnv('DATA_DIR', dir)
  vi.stubEnv('AIAAS_AGENT_MODE', 'diagnostic')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })
})

function call(name: string, args: unknown) {
  return { id: 'diagnostic-test', type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) } }
}

async function seed(maxRows = 100) {
  const filePath = path.join(dir, 'sample.sqlite')
  const db = new Database(filePath)
  db.exec('CREATE TABLE readings(ts_ms INTEGER, tag TEXT, value REAL)')
  const insert = db.prepare('INSERT INTO readings VALUES (?, ?, ?)')
  for (let i = 0; i < 3; i++) insert.run(Date.parse(start) + i * 60_000, 'nh4n', i + 1)
  db.close()
  await fs.mkdir(path.join(dir, 'sql-datasources'), { recursive: true })
  await fs.writeFile(path.join(dir, 'sql-datasources', 'sample.json'), JSON.stringify({
    id: 'sample', name: 'sample', type: 'sqlite', filePath,
    host: '', port: 0, user: '', password: '', database: '', createdAt: 0, updatedAt: 0,
  }))
  await fs.mkdir(path.join(dir, 'aiaas-diagnostics'), { recursive: true })
  await fs.writeFile(path.join(dir, 'aiaas-diagnostics', 'sources.json'), JSON.stringify({
    version: 1,
    sources: [{ id: 'demo', name: 'SIMULATED', datasourceId: 'sample', table: 'readings',
      timeColumn: 'ts_ms', metricColumn: 'tag', valueColumn: 'value',
      sampleIntervalSeconds: 60, maxRows, maxWindowHours: 24, simulated: true,
      metrics: [{ id: 'nh4n', unit: 'mg N/L', warningHigh: 2.5 }] }],
  }))
  return filePath
}

describe('AIAAS diagnostic execution boundary', () => {
  it('rejects direct SQL, settings and notification HTTP writes while retaining safe analysis', async () => {
    await seed()
    const { createApp } = await import('../../app.js')
    const app = createApp()
    for (const endpoint of ['/api/sql/query', '/api/settings', '/api/channels/wechat-desktop/send']) {
      const response = await request(app).post(endpoint).send({ sql: 'DELETE FROM readings', confirmed: true })
      expect(response.status).toBe(403)
    }
    const result = await request(app).post('/api/agent/diagnostics/analyze').send({ sourceId: 'demo', metric: 'nh4n', start, end })
    expect(result.status).toBe(200)
    expect(result.body.data.current.mean).toBe(2)
    const status = await request(app).get('/api/agent/diagnostics/policy')
    expect(status.body.mode).toBe('diagnostic')
    expect(status.body.direct_control_allowed).toBe(false)
  })

  it('rejects cross-origin local-data access and DNS-rebinding hosts', async () => {
    const { createApp } = await import('../../app.js')
    const app = createApp()
    expect((await request(app).get('/api/health').set('Origin', 'https://untrusted.example')).status).toBe(403)
    expect((await request(app).get('/api/health').set('Host', 'untrusted.example')).status).toBe(403)
    expect((await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:10055')).status).toBe(200)
  })

  it('rejects channel callbacks for GET and HEAD as well as POST', async () => {
    const { createApp } = await import('../../app.js')
    const app = createApp()
    for (const endpoint of ['/api/channels/feishu/callbacks/events', '/api/channels/feishu/callbacks/cards']) {
      for (const method of ['get', 'head', 'post'] as const) {
        const response = await request(app)[method](endpoint).set('Content-Type', 'application/json')
          .send(JSON.stringify({ type: 'url_verification', challenge: 'readonly-no-send' }))
        expect(response.status).toBe(403)
      }
    }
  })
  it.each(['terminal_run', 'sql_query', 'filesystem_write_file', 'industrial_update_modbus_config',
    'feishu_send_message', 'unreviewed_future_tool'])(
    'denies %s even when confirmed is supplied', async (name) => {
      const service = await import('./agent.tool.service.js')
      let executed = false
      service._registerToolForTest({ name, description: 'test', parameters: { type: 'object' },
        execute: async () => { executed = true; return { executed: true } } })
      const result = JSON.parse((await service.executeToolCall(call(name, { confirmed: true }))).content)
      expect(executed).toBe(false)
      expect(result.ok).toBe(false)
      expect(result._retryable).toBe(false)
    },
  )

  it('does not advertise dangerous tools in either tool discovery path', async () => {
    const service = await import('./agent.tool.service.js')
    expect(service.getAgentToolDefinitions().map(t => t.function.name)).not.toContain('terminal_run')
    expect(service.getAgentToolDefinitionsForNames(['terminal_run', 'aiaas_get_state'])
      .map(t => t.function.name)).toEqual(['aiaas_get_state'])
  })

  it('serves the industrial MD instead of the general execution prompt', async () => {
    const { getAgentSystemPrompt } = await import('./agent.prompt.service.js')
    const prompt = await getAgentSystemPrompt()
    expect(prompt).toContain('AIAAS 只读诊断')
    expect(prompt).not.toContain('可以直接在用户本地环境执行任何合理任务')
  })

  it('loads the same industrial MD in the progressive P0 conversation', async () => {
    const { buildP0Messages } = await import('./agent.p0.service.js')
    const result = await buildP0Messages({ history: [], userPrompt: '',
      checkpoint: { sessionId: 'diagnostic', facts: [], done: [], failedAttempts: [],
        mountedPacks: [], relatedRules: [], relatedMemories: [], relatedSkills: [], updatedAt: 0 } })
    expect(result.messages[0].content).toContain('AIAAS 只读诊断 Agent 权限与能力契约')
    expect(result.messages[0].content).not.toContain('UAPI目录')
  })

  it('cannot enable forbidden tools through fullAccess or an unknown mode', async () => {
    const settings = await import('../settings/settings.service.js')
    await settings.updateSettings({ agent: { permissionProfile: 'danger-full-access', fullAccess: true } })
    const service = await import('./agent.tool.service.js')
    let ran = false
    service._registerToolForTest({ name: 'terminal_run', description: 'test', parameters: {},
      execute: async () => { ran = true; return 'unsafe' } })
    const result = JSON.parse((await service.executeToolCall(call('terminal_run', { confirmed: true }))).content)
    expect(result.ok).toBe(false)
    expect(ran).toBe(false)
    vi.stubEnv('AIAAS_AGENT_MODE', 'typo')
    expect(() => service.getAgentToolDefinitions()).toThrow('Invalid AIAAS_AGENT_MODE')
  })
})

describe('approved database analysis', () => {
  it('reads approved measurements and computes evidence without changing the database', async () => {
    const file = await seed()
    const before = await fs.readFile(file)
    const { executeToolCall } = await import('./agent.tool.service.js')
    const result = JSON.parse((await executeToolCall(call('aiaas_database_analyze', {
      sourceId: 'demo', metric: 'nh4n', start, end,
    }))).content)
    expect(result.ok).toBe(true)
    expect(result.data.current).toMatchObject({ count: 3, minimum: 1, maximum: 3, mean: 2 })
    expect(result.data.simulated).toBe(true)
    expect(result.data.direct_control_allowed).toBe(false)
    expect(await fs.readFile(file)).toEqual(before)
  })

  it('marks a capped query as partial instead of reporting a complete-window mean', async () => {
    await seed(2)
    const { executeToolCall } = await import('./agent.tool.service.js')
    const result = JSON.parse((await executeToolCall(call('aiaas_database_analyze', {
      sourceId: 'demo', metric: 'nh4n', start, end,
    }))).content)
    expect(result.ok).toBe(true)
    expect(result.data.current.truncated).toBe(true)
    expect(result.data.current.complete).toBe(false)
    expect(result.data.current.totalRows).toBe(3)
  })

  it.each([
    { sourceId: 'unapproved', metric: 'nh4n', start, end },
    { sourceId: 'demo', metric: 'unapproved', start, end },
    { sourceId: 'demo', metric: 'nh4n', start: end, end: start },
    { sourceId: 'demo', metric: 'nh4n', start, end, sql: 'DELETE FROM readings' },
    { sourceId: 'demo', metric: 'nh4n', start: '2026-10-31T00:00:00', end },
    { sourceId: 'demo', metric: 'nh4n', start, end: '2026-11-02T00:00:00Z' },
    { sourceId: 'demo', metric: 'nh4n', start, end, baselineStart: start },
  ])('rejects unapproved or malformed analysis arguments', async (args) => {
    await seed()
    const { executeToolCall } = await import('./agent.tool.service.js')
    expect(JSON.parse((await executeToolCall(call('aiaas_database_analyze', args))).content).ok)
      .toBe(false)
  })

  it('does not let duplicate timestamps mask missing measurements', async () => {
    const file = await seed()
    const db = new Database(file)
    db.prepare('UPDATE readings SET ts_ms=? WHERE value=2').run(Date.parse(start))
    db.close()
    const { executeToolCall } = await import('./agent.tool.service.js')
    const result = JSON.parse((await executeToolCall(call('aiaas_database_analyze', {
      sourceId: 'demo', metric: 'nh4n', start, end,
    }))).content)
    expect(result.data.current).toMatchObject({ count: 3, duplicateTimestamps: 1, missingSlots: 1, complete: false })
  })

  it('flags irregular cadence even if each nominal time bucket contains a sample', async () => {
    const file = await seed()
    const db = new Database(file)
    for (const [value, offset] of [[1, 59999], [2, 60001], [3, 179999]]) {
      db.prepare('UPDATE readings SET ts_ms=? WHERE value=?').run(Date.parse(start) + offset, value)
    }
    db.close()
    const { executeToolCall } = await import('./agent.tool.service.js')
    const result = JSON.parse((await executeToolCall(call('aiaas_database_analyze', {
      sourceId: 'demo', metric: 'nh4n', start, end, baselineStart: start, baselineEnd: end,
    }))).content)
    expect(result.data.current).toMatchObject({ coverage: 1, irregularSampling: true, complete: false })
    expect(result.data.current.maximumGapSeconds).toBeCloseTo(119.998)
    expect(result.data.change.comparable).toBe(false)
  })
})
