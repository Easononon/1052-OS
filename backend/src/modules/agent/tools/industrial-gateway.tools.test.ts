import { afterEach, describe, expect, it, vi } from 'vitest'
import { industrialGatewayTools } from './industrial-gateway.tools.js'

function toolByName(name: string) {
  const tool = industrialGatewayTools.find((item) => item.name === name)
  if (!tool) throw new Error(`missing tool: ${name}`)
  return tool
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('industrialGatewayTools', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.INDUSTRIAL_GATEWAY_URL
  })

  it('reads realtime gateway snapshot with recent samples', async () => {
    process.env.INDUSTRIAL_GATEWAY_URL = 'http://gateway.local/'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/collector/status')) return jsonResponse({ ok: true, tasks: [{ id: 'dust', running: true }] })
      if (url.endsWith('/api/nodered/runtime')) return jsonResponse({ ok: true, running: true })
      if (url.endsWith('/api/tags')) return jsonResponse({ tags: [{ tag: 'dust_pm', table: 'raw_data_dust', device: '粉尘仪' }] })
      if (url.includes('/api/td/query?') && url.includes('table=raw_data_dust')) return jsonResponse({ data: [{ ts: '2026-06-25 10:00:00', v: 12.3 }] })
      throw new Error(`unexpected url ${url}`)
    })

    const result = await toolByName('industrial_get_realtime_snapshot').execute({ keyword: '粉尘' }) as Record<string, any>

    expect(fetchMock).toHaveBeenCalledWith('http://gateway.local/api/tags', expect.any(Object))
    expect(result.collector.tasks[0].running).toBe(true)
    expect(result.nodered.running).toBe(true)
    expect(result.tags[0].table).toBe('raw_data_dust')
    expect(result.samples[0].rows[0].v).toBe(12.3)
  })

  it('summarizes gateway parameters and degrades unavailable sections', async () => {
    process.env.INDUSTRIAL_GATEWAY_URL = 'http://gateway.local/'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/modbus/status')) return jsonResponse({ ok: true, connected: true, config: { host: '192.168.10.2', port: 502 } })
      if (url.endsWith('/api/modbus/types')) return jsonResponse({ ok: true, dtypes: ['u16', 'f32'] })
      if (url.endsWith('/api/opcua/status')) return jsonResponse({ ok: true, connected: false })
      if (url.endsWith('/api/mqtt/status')) return jsonResponse({ ok: true, connected: true })
      if (url.endsWith('/api/collector/status')) return jsonResponse({ ok: true, tasks: [{ id: 'vd0', mb_address: 0 }] })
      if (url.endsWith('/api/nodered/runtime')) return jsonResponse({ ok: true, running: true })
      if (url.endsWith('/api/nodered/protocols')) return jsonResponse({ ok: true, installed: ['mqtt'] })
      if (url.endsWith('/api/collector/schemas')) return jsonResponse({ ok: true, drivers: [] })
      if (url.endsWith('/api/td/tables')) return jsonResponse({ detail: 'TDengine not connected' }, 503)
      throw new Error(`unexpected url ${url}`)
    })

    const result = await toolByName('industrial_get_gateway_parameters').execute({}) as Record<string, any>

    expect(fetchMock).toHaveBeenCalledWith('http://gateway.local/api/modbus/status', expect.any(Object))
    expect(result.modbus.config.host).toBe('192.168.10.2')
    expect(result.nodered.protocols.installed).toEqual(['mqtt'])
    expect(result.data).toMatchObject({ ok: false, unavailable: true })
  })

  it('requires confirmation before updating Modbus config', async () => {
    await expect(
      toolByName('industrial_update_modbus_config').execute({ port: 1502 }),
    ).rejects.toThrow('明确确认')
  })

  it('merges and posts Modbus config updates without PLC writes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/modbus/config') && !init?.method) {
        return jsonResponse({ mode: 'tcp', host: '192.168.10.2', port: 502, unit_id: 1, timeout: 3 })
      }
      if (url.endsWith('/api/modbus/config') && init?.method === 'POST') {
        return jsonResponse({ ok: true, config: JSON.parse(String(init.body)) })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await toolByName('industrial_update_modbus_config').execute({
      port: 1502,
      confirmed: true,
    }) as Record<string, any>

    expect(result.after.config).toMatchObject({ host: '192.168.10.2', port: 1502, unit_id: 1 })
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/modbus/write/'), expect.anything())
  })

  it('updates collector task register address through collector config only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/collector/status')) {
        return jsonResponse({ ok: true, tasks: [{ id: 'vd0', protocol: 'modbus', mb_address: 0, mb_port: 502, table: 'raw_data' }] })
      }
      if (url.endsWith('/api/collector/add') && init?.method === 'POST') {
        return jsonResponse({ ok: true, task: JSON.parse(String(init.body)) })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await toolByName('industrial_update_collector_task').execute({
      id: 'vd0',
      mb_address: 12,
      dtype: 'f32',
      confirmed: true,
    }) as Record<string, any>

    expect(result.after.task).toMatchObject({ id: 'vd0', mb_address: 12, mb_port: 502, dtype: 'f32' })
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/modbus/write/'), expect.anything())
  })

  it('bulk-adds 100 OPC UA tasks via v2 endpoint and reports per-row results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/collector/add_v2') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return jsonResponse({ ok: true, task: { id: body.id, protocol: 'opcua' } })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `AI_${String(i + 1).padStart(3, '0')}`,
      protocol: 'opcua',
      ua_url: 'opc.tcp://192.168.10.112:4840',
      ua_node_id: `ns=1;i=${i}`,
    }))
    const result = await toolByName('industrial_bulk_add_collector_tasks').execute({
      tasks, confirmed: true,
    }) as { total: number; ok: number; fail: number; results: Array<{ id: string; ok: boolean }> }

    expect(result.total).toBe(100)
    expect(result.ok).toBe(100)
    expect(result.fail).toBe(0)
    expect(result.results[0].id).toBe('AI_001')
    expect(result.results[99].id).toBe('AI_100')
    expect(fetchMock).toHaveBeenCalledTimes(100)
  })

  it('bulk-add rejects empty tasks array', async () => {
    await expect(
      toolByName('industrial_bulk_add_collector_tasks').execute({
        tasks: [], confirmed: true,
      }),
    ).rejects.toThrow('tasks 不能为空')
  })

  it('bulk-add requires confirmation', async () => {
    await expect(
      toolByName('industrial_bulk_add_collector_tasks').execute({
        tasks: [{ id: 'x' }],
      }),
    ).rejects.toThrow('明确确认')
  })

  it('delete/start/stop collector task all require confirmation', async () => {
    for (const name of ['industrial_delete_collector_task', 'industrial_start_collector_task', 'industrial_stop_collector_task']) {
      await expect(toolByName(name).execute({ id: 'x' })).rejects.toThrow('明确确认')
    }
  })

  it('delete forwards task_id to gateway and reports removed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/collector/delete') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return jsonResponse({ ok: true, removed: body.task_id })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await toolByName('industrial_delete_collector_task').execute({
      id: 'AI_005', confirmed: true,
    }) as { removed: string }
    expect(result.removed).toBe('AI_005')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opcua browse posts node_id and depth to gateway', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/opcua/browse') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return jsonResponse({ ok: true, children: [{ node_id: body.node_id, display_name: 'X' }] })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await toolByName('industrial_opcua_browse').execute({
      node_id: 'ns=2;i=1', depth: 0,
    }) as { children: Array<{ node_id: string }> }
    expect(result.children[0].node_id).toBe('ns=2;i=1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('update_opcua_config merges current and posts new endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/opcua/config') && !init?.method) {
        return jsonResponse({ url: 'opc.tcp://old:4840', timeout: 5.0, username: null, password: null })
      }
      if (url.endsWith('/api/opcua/config') && init?.method === 'POST') {
        return jsonResponse({ ok: true, config: JSON.parse(String(init.body)) })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await toolByName('industrial_update_opcua_config').execute({
      url: 'opc.tcp://192.168.10.112:4840', confirmed: true,
    }) as { after: { ok: boolean; config: { url: string } } }
    expect(result.after.config.url).toBe('opc.tcp://192.168.10.112:4840')
  })

  it('install_nodered_protocol requires confirmation and forwards params', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/install-module') && init?.method === 'POST') {
        return jsonResponse({ ok: true, installing: 'node-red-contrib-s7' })
      }
      if (url.includes('/install') && !url.includes('install-module') && init?.method === 'POST') {
        return jsonResponse({ ok: true, protocol: 's7' })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await toolByName('industrial_install_nodered_protocol').execute({
      name: 's7', params: { host: '192.168.10.50' },
      install_module_first: 'node-red-contrib-s7', confirmed: true,
    }) as { module_install: { installing: string }; flow_install: { protocol: string } }
    expect(result.module_install.installing).toBe('node-red-contrib-s7')
    expect(result.flow_install.protocol).toBe('s7')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
