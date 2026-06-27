import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:18765'
const DEFAULT_RAW_LIMIT = 200
const MAX_RAW_LIMIT = 500
const DEFAULT_HISTORY_LIMIT = 100
const MAX_HISTORY_LIMIT = 500

function gatewayBaseUrl() {
  return (
    process.env.INDUSTRIAL_GATEWAY_URL ||
    process.env.GATEWAY_API_URL ||
    DEFAULT_GATEWAY_BASE_URL
  ).replace(/\/+$/, '')
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readLimit(value: unknown, fallback: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function addParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && !value.trim()) return
  params.set(key, String(value))
}

async function fetchGateway(
  path: string,
  params?: URLSearchParams,
  init?: RequestInit,
  signal?: AbortSignal,
) {
  const query = params && params.toString() ? `?${params.toString()}` : ''
  const url = `${gatewayBaseUrl()}${path}${query}`
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      ...(signal ? { signal } : {}),
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Surface as a 504 so the runtime's failure classification path
      // routes the timeout through the `_hint` machinery instead of
      // pretending it was a network error.
      throw new HttpError(504, `工业网关 ${path} 请求被中止（超时或取消）`)
    }
    throw new HttpError(502, `工业网关连接失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let body: unknown = text
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text.slice(0, 1000)
    }
  }

  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail?: unknown }).detail)
        : typeof body === 'string'
          ? body
          : response.statusText
    throw new HttpError(response.status, `工业网关 API ${path} 失败: ${detail}`)
  }

  return body
}

async function fetchOptionalGateway(
  path: string,
  params?: URLSearchParams,
  signal?: AbortSignal,
) {
  try {
    return await fetchGateway(path, params, undefined, signal)
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function postGateway(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return fetchGateway(
    path,
    undefined,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    signal,
  )
}

function assertConfirmed(value: unknown) {
  if (value !== true) throw new HttpError(400, '修改工业网关配置需要用户明确确认')
}

function filterTags(tags: unknown[], input: Record<string, unknown>) {
  const keyword = readString(input.keyword).toLowerCase()
  const device = readString(input.device).toLowerCase()
  const site = readString(input.site).toLowerCase()
  const limit = readLimit(input.limit, 100, 500)

  return tags
    .filter((item) => item && typeof item === 'object')
    .filter((item) => {
      const text = JSON.stringify(item).toLowerCase()
      if (keyword && !text.includes(keyword)) return false
      if (device && !text.includes(device)) return false
      if (site && !text.includes(site)) return false
      return true
    })
    .slice(0, limit)
}

function tableFromInput(input: Record<string, unknown>) {
  const table = readString(input.table) || readString(input.tag)
  if (!table) throw new HttpError(400, '必须提供 table 或 tag。自然语言名称不确定时，请先调用 industrial_list_tags 搜索点位。')
  return table
}

function readNumber(value: unknown, fallback?: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function pickDefined(input: Record<string, unknown>, keys: readonly string[]) {
  const output: Record<string, unknown> = {}
  for (const key of keys) {
    const value = input[key]
    if (value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())) {
      output[key] = typeof value === 'string' ? value.trim() : value
    }
  }
  return output
}

function ensureRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, `${label} 返回格式异常`)
  }
  return value as Record<string, unknown>
}

function normalizeRows(result: unknown) {
  if (Array.isArray(result)) return result
  if (!result || typeof result !== 'object') return []
  const record = result as Record<string, unknown>
  for (const key of ['data', 'rows', 'items', 'result']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

async function queryLatestRows(table: string, limit: number, signal?: AbortSignal) {
  const params = new URLSearchParams()
  addParam(params, 'table', table)
  addParam(params, 'limit', limit)
  const result = await fetchGateway('/api/td/query', params, undefined, signal)
  return {
    table,
    result,
    rows: normalizeRows(result),
  }
}

export const industrialGatewayTools: AgentTool[] = [
  {
    name: 'industrial_get_realtime_snapshot',
    description:
      '一键读取工业网关实时快照：采集健康、Node-RED 状态、点位列表，并可附带若干点位最近数据。适合“看看网关现在有没有数据、当前采集是否正常、最近数据是什么”。只读。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '按关键词筛选点位，例如 粉尘、温度、风机。留空返回前若干点位。' },
        tagLimit: { type: 'number', description: '最多返回点位数量，默认 20，最大 100。' },
        sampleLimit: { type: 'number', description: '每个点位最近数据条数，默认 5，最大 20。' },
        includeSamples: { type: 'boolean', description: '是否查询最近数据样本，默认 true。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const tagLimit = readLimit(input.tagLimit, 20, 100)
      const sampleLimit = readLimit(input.sampleLimit, 5, 20)
      const includeSamples = input.includeSamples !== false
      const [collector, nodered, tagsResult] = await Promise.all([
        fetchOptionalGateway('/api/collector/status', undefined, ctx?.signal),
        fetchOptionalGateway('/api/nodered/runtime', undefined, ctx?.signal),
        fetchOptionalGateway('/api/tags', undefined, ctx?.signal),
      ])
      const tags = Array.isArray((tagsResult as { tags?: unknown }).tags)
        ? filterTags((tagsResult as { tags: unknown[] }).tags, { ...input, limit: tagLimit })
        : []
      const sampleTargets = includeSamples
        ? tags
          .map((tag) => tag && typeof tag === 'object' ? readString((tag as Record<string, unknown>).table) || readString((tag as Record<string, unknown>).tag) : '')
          .filter((tag, index, array) => tag && array.indexOf(tag) === index)
          .slice(0, 5)
        : []
      const samples = await Promise.all(sampleTargets.map(async (table) => {
        try {
          return await queryLatestRows(table, sampleLimit, ctx?.signal)
        } catch (error) {
          return { table, unavailable: true, error: error instanceof Error ? error.message : String(error), rows: [] }
        }
      }))
      return {
        collector,
        nodered,
        tags,
        samples,
        _hint: '回答时先说明采集/Node-RED 是否运行，再列出可读点位和最近值；samples 为空时说明网关可达但当前点位没有最近数据。',
      }
    },
  },
  {
    name: 'industrial_list_tags',
    description:
      '列出或搜索工业网关采集点位/标签。用于自然语言查询现场数据前定位 tag/table，例如温度、压力、粉尘、设备名、产线名。只读。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '按自然语言关键词过滤，例如 温度、粉尘、1号风机。' },
        device: { type: 'string', description: '可选设备名过滤。' },
        site: { type: 'string', description: '可选站点/区域过滤。' },
        limit: { type: 'number', description: '最多返回数量，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const result = await fetchGateway('/api/tags', undefined, undefined, ctx?.signal)
      const tags = Array.isArray((result as { tags?: unknown }).tags)
        ? ((result as { tags: unknown[] }).tags)
        : []
      return {
        ...result as Record<string, unknown>,
        tags: filterTags(tags, input),
        _hint: '如果用户问趋势/统计，下一步用返回的 table/tag 调用 industrial_query_timeseries 或 industrial_aggregate_timeseries。',
      }
    },
  },
  {
    name: 'industrial_query_timeseries',
    description:
      '查询工业点位原始时序数据。适合精确时间线、最近 N 条、报警前后明细。大范围趋势/统计应优先使用 industrial_aggregate_timeseries。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'TDengine 表名或点位表名。' },
        tag: { type: 'string', description: '点位 tag/table。若不确定请先调用 industrial_list_tags。' },
        start: { type: 'string', description: '开始时间，可留空；如 2026-06-22 08:00:00。' },
        end: { type: 'string', description: '结束时间，可留空。' },
        limit: { type: 'number', description: '返回条数，默认 200，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'table', tableFromInput(input))
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_RAW_LIMIT, MAX_RAW_LIMIT))
      const result = await fetchGateway('/api/td/query', params, undefined, ctx?.signal)
      return {
        ...result as Record<string, unknown>,
        _hint: '请基于真实数据回答；如果 data 为空，明确说明当前时间窗没有数据。',
      }
    },
  },
  {
    name: 'industrial_aggregate_timeseries',
    description:
      '对工业点位做时序聚合/降采样统计。适合趋势、平均值、最大值、最小值、计数、分时段对比。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'TDengine 表名或点位表名。' },
        tag: { type: 'string', description: '点位 tag/table。若不确定请先调用 industrial_list_tags。' },
        col: { type: 'string', description: '数值列，raw_data 子表通常是 v，默认 v。' },
        start: { type: 'string', description: '开始时间。' },
        end: { type: 'string', description: '结束时间。' },
        interval: { type: 'string', description: '聚合窗口，如 1m、10m、1h；默认 10m。' },
        agg: { type: 'string', enum: ['avg', 'min', 'max', 'sum', 'count', 'last'], description: '聚合函数，默认 avg。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'table', tableFromInput(input))
      addParam(params, 'col', readString(input.col) || 'v')
      addParam(params, 'interval', readString(input.interval) || '10m')
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'agg', readString(input.agg) || 'avg')
      return fetchGateway('/api/td/aggregate', params, undefined, ctx?.signal)
    },
  },
  {
    name: 'industrial_get_anomaly_history',
    description:
      '查询工业异常/报警历史。适合“今天报警多少次、最近有哪些异常、哪个设备报警最多、报警时间线”等问题。只读。',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '开始时间，可选。' },
        end: { type: 'string', description: '结束时间，可选。' },
        channelId: { type: 'string', description: '异常通道/点位 ID，可选。' },
        level: { type: 'string', description: '报警等级关键词，可选。' },
        limit: { type: 'number', description: '返回条数，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'start', readString(input.start))
      addParam(params, 'end', readString(input.end))
      addParam(params, 'channel_id', readString(input.channelId))
      addParam(params, 'level', readString(input.level))
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT))
      return fetchGateway('/api/anomaly/history', params, undefined, ctx?.signal)
    },
  },
  {
    name: 'industrial_get_collector_status',
    description:
      '查询工业网关采集任务健康状态，包括任务是否运行、最近值、最近更新时间和错误。适合判断是否掉线、数据是否中断。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      return fetchGateway('/api/collector/status', undefined, undefined, ctx?.signal)
    },
  },
  {
    name: 'industrial_get_nodered_status',
    description:
      '查询内嵌 Node-RED 运行状态和 MQTT/发布状态。适合判断协议积木、Node-RED runtime、发布错误是否正常。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      const [runtime, bridge] = await Promise.all([
        fetchGateway('/api/nodered/runtime', undefined, undefined, ctx?.signal),
        fetchGateway('/api/nodered/status', undefined, undefined, ctx?.signal),
      ])
      return { runtime, bridge }
    },
  },
  {
    name: 'industrial_get_audit_writes',
    description:
      '查询工业写入/控制/设定值修改审计记录。适合“谁改过设定值、最近有哪些控制操作、某设备是否被写入”。只读，不会执行控制。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 100，最大 500。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      addParam(params, 'limit', readLimit(input.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT))
      return fetchGateway('/api/audit/writes', params, undefined, ctx?.signal)
    },
  },
  {
    name: 'industrial_describe_data',
    description:
      '查询工业数据存储结构：TDengine 表、超级表、字段结构、数据量。适合“有哪些表、表结构是什么、数据量多少”。只读。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '可选表名；提供后会返回 describe 和 count。' },
        includeCounts: { type: 'boolean', description: '是否返回指定表 count；仅 table 存在时有效。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const table = readString(input.table)
      const tables = await fetchGateway('/api/td/tables', undefined, undefined, ctx?.signal)
      if (!table) return tables

      const describeParams = new URLSearchParams()
      addParam(describeParams, 'table', table)
      const describe = await fetchGateway('/api/td/describe', describeParams, undefined, ctx?.signal)
      const output: Record<string, unknown> = { tables, describe }
      if (input.includeCounts !== false) {
        const countParams = new URLSearchParams()
        addParam(countParams, 'table', table)
        output.count = await fetchGateway('/api/td/count', countParams, undefined, ctx?.signal)
      }
      return output
    },
  },
  {
    name: 'industrial_get_gateway_parameters',
    description:
      '汇总工业网关全部关键参数：Modbus/OPC UA/MQTT 配置与连接状态、采集任务、协议模板、Node-RED runtime 和 TDengine 数据概况。只读。',
    parameters: {
      type: 'object',
      properties: {
        includeDataSummary: { type: 'boolean', description: '是否附带 TDengine 表概况，默认 true。' },
        includeProtocolSchemas: { type: 'boolean', description: '是否附带采集协议配置 schema，默认 true。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const baseCalls: Array<Promise<unknown>> = [
        fetchOptionalGateway('/api/modbus/status', undefined, ctx?.signal),
        fetchOptionalGateway('/api/modbus/types', undefined, ctx?.signal),
        fetchOptionalGateway('/api/opcua/status', undefined, ctx?.signal),
        fetchOptionalGateway('/api/mqtt/status', undefined, ctx?.signal),
        fetchOptionalGateway('/api/collector/status', undefined, ctx?.signal),
        fetchOptionalGateway('/api/nodered/runtime', undefined, ctx?.signal),
        fetchOptionalGateway('/api/nodered/protocols', undefined, ctx?.signal),
      ]
      const [modbus, modbusTypes, opcua, mqtt, collector, noderedRuntime, noderedProtocols] = await Promise.all(baseCalls)
      const output: Record<string, unknown> = {
        modbus,
        modbusTypes,
        opcua,
        mqtt,
        collector,
        nodered: { runtime: noderedRuntime, protocols: noderedProtocols },
        _hint: '回答时按协议参数、采集任务、Node-RED、数据存储分组汇报；某一项 unavailable 时说明该子系统当前不可读；修改配置需使用对应 update 工具并取得确认。',
      }
      if (input.includeProtocolSchemas !== false) output.collectorSchemas = await fetchOptionalGateway('/api/collector/schemas', undefined, ctx?.signal)
      if (input.includeDataSummary !== false) output.data = await fetchOptionalGateway('/api/td/tables', undefined, ctx?.signal)
      return output
    },
  },
  {
    name: 'industrial_update_modbus_config',
    description:
      '修改工业网关 Modbus 连接配置，例如 TCP host/port、RTU 串口、站号、超时。需要明确确认；只改网关连接配置，不写 PLC 寄存器/线圈。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['tcp', 'rtu'], description: 'Modbus 模式。' },
        host: { type: 'string', description: 'TCP 主机/IP。' },
        port: { type: 'number', description: 'TCP 端口。' },
        serial_port: { type: 'string', description: 'RTU 串口路径。' },
        baudrate: { type: 'number', description: 'RTU 波特率。' },
        parity: { type: 'string', description: 'RTU 校验位，如 N/E/O。' },
        stopbits: { type: 'number', description: 'RTU 停止位。' },
        bytesize: { type: 'number', description: 'RTU 数据位。' },
        unit_id: { type: 'number', description: 'Modbus 从站地址。' },
        timeout: { type: 'number', description: '超时时间秒。' },
        reconnect: { type: 'boolean', description: '修改后是否自动重连 Modbus，默认 false。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const current = ensureRecord(await fetchGateway('/api/modbus/config', undefined, undefined, ctx?.signal), 'Modbus 配置')
      const patch = pickDefined(input, [
        'mode',
        'host',
        'port',
        'serial_port',
        'baudrate',
        'parity',
        'stopbits',
        'bytesize',
        'unit_id',
        'timeout',
      ])
      if (Object.keys(patch).length === 0) throw new HttpError(400, '没有提供需要修改的 Modbus 配置字段')
      const next = { ...current, ...patch }
      const updated = await postGateway('/api/modbus/config', next, ctx?.signal)
      const reconnect = input.reconnect === true ? await postGateway('/api/modbus/connect', {}, ctx?.signal) : null
      return { before: current, after: updated, reconnect }
    },
  },
  {
    name: 'industrial_update_collector_task',
    description:
      '新增或覆盖工业采集点位配置，例如 Modbus 寄存器地址、寄存器类型、数据类型、表名、采集周期、OPC UA/MQTT 源参数。需要明确确认；不会直接写 PLC。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '采集任务 ID；同 ID 会覆盖原任务配置。' },
        protocol: { type: 'string', enum: ['modbus', 'opcua', 'mqtt'], description: '采集协议，默认 modbus。' },
        mb_host: { type: 'string', description: 'Modbus TCP 主机。' },
        mb_port: { type: 'number', description: 'Modbus TCP 端口。' },
        mb_unit: { type: 'number', description: 'Modbus 从站地址。' },
        mb_address: { type: 'number', description: 'Modbus 寄存器/线圈起始地址。' },
        mb_count: { type: 'number', description: '读取数量。' },
        mb_register: { type: 'string', enum: ['holding', 'input', 'coil', 'discrete'], description: 'Modbus 区域。' },
        dtype: { type: 'string', description: '数据类型，如 u16、i16、f32、bit、ascii。' },
        endian: { type: 'string', description: '字节序，如 ABCD、CDAB。' },
        bit_index: { type: 'number', description: 'bit 类型使用的位号。' },
        string_len: { type: 'number', description: '字符串长度。' },
        ua_url: { type: 'string', description: 'OPC UA endpoint。' },
        ua_node_id: { type: 'string', description: 'OPC UA NodeId。' },
        mq_broker_host: { type: 'string', description: 'MQTT broker 主机。' },
        mq_broker_port: { type: 'number', description: 'MQTT broker 端口。' },
        mq_topic: { type: 'string', description: 'MQTT topic。' },
        mq_qos: { type: 'number', description: 'MQTT QoS。' },
        mq_payload: { type: 'string', enum: ['raw', 'json'], description: 'MQTT payload 类型。' },
        mq_field: { type: 'string', description: 'JSON payload 字段名。' },
        site: { type: 'string', description: '站点/区域。' },
        device: { type: 'string', description: '设备名。' },
        table: { type: 'string', description: 'TDengine 超级表名。' },
        interval: { type: 'number', description: '采集周期秒。' },
        start: { type: 'boolean', description: '修改后是否启动该采集任务，默认 false。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const id = readString(input.id)
      if (!id) throw new HttpError(400, '采集任务 id 必填')
      const status = ensureRecord(await fetchGateway('/api/collector/status', undefined, undefined, ctx?.signal), '采集状态')
      const tasks = Array.isArray(status.tasks) ? status.tasks : []
      const current = tasks.find((task) => task && typeof task === 'object' && (task as { id?: unknown }).id === id) as Record<string, unknown> | undefined
      const patch = pickDefined(input, [
        'protocol',
        'mb_host',
        'mb_port',
        'mb_unit',
        'mb_address',
        'mb_count',
        'mb_register',
        'dtype',
        'endian',
        'bit_index',
        'string_len',
        'ua_url',
        'ua_node_id',
        'mq_broker_host',
        'mq_broker_port',
        'mq_topic',
        'mq_qos',
        'mq_payload',
        'mq_field',
        'site',
        'device',
        'table',
        'interval',
      ])
      const next = {
        id,
        protocol: 'modbus',
        table: 'raw_data',
        ...current,
        ...patch,
      }
      const updated = await postGateway('/api/collector/add', next, ctx?.signal)
      const start = input.start === true ? await postGateway('/api/collector/start', { task_id: id }, ctx?.signal) : null
      return { before: current ?? null, after: updated, started: start }
    },
  },
  {
    name: 'industrial_scan_modbus_registers',
    description:
      '扫描 Modbus holding registers，帮助确认寄存器地址是否有数据。只读，不写 PLC。',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'number', description: '起始地址，默认 0。' },
        count: { type: 'number', description: '扫描数量，默认 10。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      return postGateway('/api/modbus/scan', {
        start: readNumber(input.start, 0),
        count: readLimit(input.count, 10, 200),
      }, ctx?.signal)
    },
  },

  // ─────────────────────────────────────────
  // 写入类工具：驱动配置 + 采集任务增删启停
  // ─────────────────────────────────────────

  {
    name: 'industrial_bulk_add_collector_tasks',
    description:
      '批量新增/覆盖多个工业采集点位，逐条 POST 采集接口并返回每条结果。适合"加 100 个 OPC UA 点 / 50 个 Modbus 寄存器"等场景。不会直接写 PLC/物理设备。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '任务数组；每项至少含 id 和 protocol，其余字段按协议区分。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              protocol: { type: 'string', enum: ['modbus', 'opcua', 'mqtt'] },
              ua_url: { type: 'string' },
              ua_node_id: { type: 'string' },
              mb_host: { type: 'string' },
              mb_port: { type: 'number' },
              mb_unit: { type: 'number' },
              mb_address: { type: 'number' },
              mb_count: { type: 'number' },
              mb_register: { type: 'string' },
              dtype: { type: 'string' },
              endian: { type: 'string' },
              mq_broker_host: { type: 'string' },
              mq_broker_port: { type: 'number' },
              mq_topic: { type: 'string' },
              mq_qos: { type: 'number' },
              mq_payload: { type: 'string' },
              mq_field: { type: 'string' },
              table: { type: 'string' },
              site: { type: 'string' },
              device: { type: 'string' },
              interval: { type: 'number' },
            },
            required: ['id'],
            additionalProperties: true,
          },
        },
        autostart: { type: 'boolean', description: '添加后是否自动启动每个任务，默认 false。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['tasks', 'confirmed'],
      additionalProperties: false,
    },
    timeoutMs: 180_000,
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const tasks = Array.isArray(input.tasks) ? input.tasks : []
      if (tasks.length === 0) throw new HttpError(400, 'tasks 不能为空')
      if (tasks.length > 500) throw new HttpError(400, '单次最多 500 个任务；超出请分批')
      const autostart = input.autostart === true
      const results: Array<{ id: string; ok: boolean; error?: string; started?: unknown }> = []
      for (const raw of tasks) {
        if (!raw || typeof raw !== 'object') {
          results.push({ id: '', ok: false, error: '任务项不是对象' })
          continue
        }
        const t = raw as Record<string, unknown>
        const id = readString(t.id)
        if (!id) {
          results.push({ id: '', ok: false, error: '缺少 id' })
          continue
        }
        const protocol = readString(t.protocol) || 'modbus'
        try {
          if (protocol === 'opcua' || protocol === 'mqtt') {
            // use v2 (driver-validated) for protocols that have a driver schema
            const config: Record<string, unknown> = {}
            if (protocol === 'opcua') {
              if (t.ua_url) config.url = t.ua_url
              if (t.ua_node_id) config.node_id = t.ua_node_id
            } else {
              if (t.mq_broker_host) config.broker_host = t.mq_broker_host
              if (t.mq_broker_port) config.broker_port = t.mq_broker_port
              if (t.mq_topic) config.topic = t.mq_topic
              if (t.mq_qos !== undefined) config.qos = t.mq_qos
              if (t.mq_payload) config.payload = t.mq_payload
              if (t.mq_field) config.field = t.mq_field
            }
            await postGateway('/api/collector/add_v2', {
              id, protocol, config,
              site: readString(t.site) || 'default',
              device: readString(t.device) || 'sim',
              table: readString(t.table) || 'raw_data',
              interval: readNumber(t.interval, 1.0),
            }, ctx?.signal)
          } else {
            await postGateway('/api/collector/add', t, ctx?.signal)
          }
          let started: unknown = null
          if (autostart) {
            try {
              started = await postGateway('/api/collector/start', { task_id: id }, ctx?.signal)
            } catch (e) {
              started = { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
          }
          results.push({ id, ok: true, started })
        } catch (e) {
          results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
        }
      }
      const ok = results.filter((r) => r.ok).length
      return { total: tasks.length, ok, fail: tasks.length - ok, results }
    },
  },

  {
    name: 'industrial_delete_collector_task',
    description:
      '删除一个已注册的工业采集点位（停止 + 从列表移除）。需明确确认。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 ID。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const id = readString(input.id)
      if (!id) throw new HttpError(400, 'id 必填')
      return postGateway('/api/collector/delete', { task_id: id }, ctx?.signal)
    },
  },

  {
    name: 'industrial_start_collector_task',
    description:
      '启动一个已注册的采集任务。需明确确认。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 ID。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const id = readString(input.id)
      if (!id) throw new HttpError(400, 'id 必填')
      return postGateway('/api/collector/start', { task_id: id }, ctx?.signal)
    },
  },

  {
    name: 'industrial_stop_collector_task',
    description:
      '停止一个正在运行的采集任务（保留注册，仅暂停）。需明确确认。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 ID。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const id = readString(input.id)
      if (!id) throw new HttpError(400, 'id 必填')
      return postGateway('/api/collector/stop', { task_id: id }, ctx?.signal)
    },
  },

  {
    name: 'industrial_opcua_browse',
    description:
      '浏览 OPC UA 服务器节点结构，辅助定位 NodeId。不会写入 OPC UA 节点，只读浏览。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '起始节点 NodeId；空表示根节点 Objects。' },
        depth: { type: 'number', description: '0=单层子节点（默认，UI 友好），>0=递归树。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const body: Record<string, unknown> = {}
      const nodeId = readString(input.node_id)
      if (nodeId) body.node_id = nodeId
      body.depth = readNumber(input.depth, 0)
      return postGateway('/api/opcua/browse', body, ctx?.signal)
    },
  },

  {
    name: 'industrial_opcua_read',
    description:
      '读取一个或多个 OPC UA 节点的当前值。只读，不写。',
    parameters: {
      type: 'object',
      properties: {
        node_ids: { type: 'array', items: { type: 'string' }, description: 'NodeId 列表。' },
      },
      required: ['node_ids'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const nodeIds = Array.isArray(input.node_ids) ? input.node_ids.filter((n) => typeof n === 'string') : []
      if (nodeIds.length === 0) throw new HttpError(400, 'node_ids 必填且非空')
      return postGateway('/api/opcua/read', { node_ids: nodeIds }, ctx?.signal)
    },
  },

  {
    name: 'industrial_update_opcua_config',
    description:
      '修改工业网关 OPC UA 服务器连接配置（URL、超时、用户名、密码）。需明确确认。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'OPC UA endpoint URL，如 opc.tcp://192.168.10.112:4840。' },
        timeout: { type: 'number', description: '连接/读超时秒。' },
        username: { type: 'string', description: '可选。' },
        password: { type: 'string', description: '可选。' },
        reconnect: { type: 'boolean', description: '修改后是否自动连接，默认 false。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const current = ensureRecord(await fetchGateway('/api/opcua/config', undefined, undefined, ctx?.signal), 'OPC UA 配置')
      const patch = pickDefined(input, ['url', 'timeout', 'username', 'password'])
      if (Object.keys(patch).length === 0) throw new HttpError(400, '没有提供需要修改的 OPC UA 配置字段')
      const next = { ...current, ...patch }
      const updated = await postGateway('/api/opcua/config', next, ctx?.signal)
      const reconnect = input.reconnect === true ? await postGateway('/api/opcua/connect', {}, ctx?.signal) : null
      return { before: current, after: updated, reconnect }
    },
  },

  {
    name: 'industrial_update_mqtt_config',
    description:
      '修改工业网关 MQTT broker 连接配置（host/port/凭据/主题前缀）。需明确确认。',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
        client_id: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        keepalive: { type: 'number' },
        topic_prefix: { type: 'string' },
        reconnect: { type: 'boolean', description: '修改后是否自动连接，默认 false。' },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const current = ensureRecord(await fetchGateway('/api/mqtt/config', undefined, undefined, ctx?.signal), 'MQTT 配置')
      const patch = pickDefined(input, ['host', 'port', 'client_id', 'username', 'password', 'keepalive', 'topic_prefix'])
      if (Object.keys(patch).length === 0) throw new HttpError(400, '没有提供需要修改的 MQTT 配置字段')
      const next = { ...current, ...patch }
      const updated = await postGateway('/api/mqtt/config', next, ctx?.signal)
      const reconnect = input.reconnect === true ? await postGateway('/api/mqtt/connect', {}, ctx?.signal) : null
      return { before: current, after: updated, reconnect }
    },
  },

  {
    name: 'industrial_list_nodered_protocols',
    description:
      '列出可一键安装的 Node-RED 协议模板（如 S7 / OPC UA contrib / Modbus 进阶），含已安装列表和缺失模块列表。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '指定协议名，列出该协议的缺失模块；空返回全部协议概览。' },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const name = readString(input.name)
      if (name) return fetchGateway(`/api/nodered/protocols/missing/${encodeURIComponent(name)}`, undefined, undefined, ctx?.signal)
      return fetchGateway('/api/nodered/protocols', undefined, undefined, ctx?.signal)
    },
  },

  {
    name: 'industrial_install_nodered_protocol',
    description:
      '一键安装 Node-RED 协议模板（如 node-red-contrib-s7、node-red-contrib-opcua），并把对应 flow 写入 flows.json。需明确确认。',
    timeoutMs: 120_000,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '协议名（先调用 industrial_list_nodered_protocols 查可选项）。' },
        params: { type: 'object', description: '协议参数（host/port/unit_id 等，按所选协议 schema）。' },
        install_module_first: {
          type: 'string',
          description: '如该协议缺 contrib 模块，可先调此名（如 node-red-contrib-s7），再装 flow。',
        },
        confirmed: { type: 'boolean', description: '用户明确确认后必须为 true。' },
      },
      required: ['name', 'confirmed'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      const name = readString(input.name)
      if (!name) throw new HttpError(400, 'name 必填')
      const moduleName = readString(input.install_module_first)
      const moduleInstall = moduleName
        ? await postGateway(`/api/nodered/protocols/${encodeURIComponent(name)}/install-module`, { module: moduleName }, ctx?.signal)
        : null
      const flowInstall = await postGateway(`/api/nodered/protocols/${encodeURIComponent(name)}/install`, {
        params: (input.params && typeof input.params === 'object') ? input.params : {},
      }, ctx?.signal)
      return { module_install: moduleInstall, flow_install: flowInstall }
    },
  },

  {
    name: 'industrial_manage_anomaly_channel',
    description:
      '增/删/列出工业异常通道（高/低阈值、阶跃阈值、漂移阈值）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'add/remove/list。' },
        id: { type: 'string', description: '通道 ID（add/remove 必填）。' },
        table: { type: 'string', description: 'add 时必填，TDengine 超级表名。' },
        col: { type: 'string', description: 'add 时必填，监测列名。' },
        low: { type: 'number', description: '低阈值。' },
        high: { type: 'number', description: '高阈值。' },
        step_threshold: { type: 'number' },
        drift_threshold: { type: 'number' },
        drift_window: { type: 'number' },
        baseline: { type: 'number' },
        enabled: { type: 'boolean' },
        confirmed: { type: 'boolean', description: 'add/remove 需要明确确认。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const input = (args ?? {}) as Record<string, unknown>
      const action = readString(input.action) || 'list'
      if (action === 'list') {
        return fetchGateway('/api/anomaly/channels', undefined, undefined, ctx?.signal)
      }
      assertConfirmed(input.confirmed)
      if (action === 'add') {
        const id = readString(input.id)
        if (!id) throw new HttpError(400, 'id 必填')
        const body = pickDefined(input, ['id', 'table', 'col', 'low', 'high', 'step_threshold', 'drift_threshold', 'drift_window', 'baseline', 'enabled'])
        if (!body.table) throw new HttpError(400, 'table 必填')
        if (!body.col) throw new HttpError(400, 'col 必填')
        return postGateway('/api/anomaly/channel/add', body, ctx?.signal)
      }
      if (action === 'remove') {
        const id = readString(input.id)
        if (!id) throw new HttpError(400, 'id 必填')
        return postGateway('/api/anomaly/channel/remove', { channel_id: id }, ctx?.signal)
      }
      throw new HttpError(400, `unknown action: ${action}`)
    },
  },
]
