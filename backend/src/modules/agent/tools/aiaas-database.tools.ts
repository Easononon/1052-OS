import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { z } from 'zod'
import { config } from '../../../config.js'
import { HttpError } from '../../../http-error.js'
import { getDataSource } from '../../sql/sql.service.js'
import type { AgentTool } from '../agent.tool.types.js'
import { getDiagnosticScope } from '../aiaas-diagnostic-scope.js'

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const metricSchema = z.object({
  id, unit: z.string().min(1).max(40), warningHigh: z.number().finite().optional(),
}).strict()
const sourceSchema = z.object({
  id, name: z.string().min(1).max(120), datasourceId: id,
  table: identifier, timeColumn: identifier, metricColumn: identifier, valueColumn: identifier,
  sampleIntervalSeconds: z.number().positive().max(86400),
  samplingToleranceFraction: z.number().min(0).max(0.5).default(0.2),
  maxRows: z.number().int().min(1).max(10000),
  maxWindowHours: z.number().positive().max(24 * 31), simulated: z.boolean(),
  metrics: z.array(metricSchema).min(1).max(200),
}).strict()
const sourcesSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema).max(50) }).strict()
const time = z.string().datetime({ offset: true })
const inputSchema = z.object({
  sourceId: id, metric: id, start: time, end: time,
  baselineStart: time.optional(), baselineEnd: time.optional(),
}).strict()
const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/aiaas_analysis.py')

async function sources() {
  try {
    const parsed = sourcesSchema.parse(JSON.parse(await fs.readFile(
      path.join(config.dataDir, 'aiaas-diagnostics/sources.json'), 'utf8')))
    if (new Set(parsed.sources.map(s => s.id)).size !== parsed.sources.length) throw new Error('duplicate source id')
    for (const source of parsed.sources) {
      if (new Set(source.metrics.map(m => m.id)).size !== source.metrics.length) throw new Error('duplicate metric id')
    }
    const scope = getDiagnosticScope()
    return scope ? parsed.sources.filter(s => s.simulated && scope.allowedSourceIds.includes(s.id)) : parsed.sources
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new HttpError(400, '批准数据源配置无效；请由工程师检查 sources.json')
  }
}

function checkWindow(start: string, end: string, hours: number) {
  const duration = Date.parse(end) - Date.parse(start)
  if (!(duration > 0) || duration > hours * 3600000) throw new HttpError(400, '时间窗无效或超过批准范围')
}

export const aiaasDatabaseTools: AgentTool[] = [
  {
    name: 'aiaas_database_sources',
    description: '列出工程师批准的曝气历史测点和单位，不返回密码、连接地址、文件路径。先调用此工具，不猜测数据源。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(args) {
      z.object({}).strict().parse(args ?? {})
      return { direct_control_allowed: false, sources: (await sources()).map(s => ({
        id: s.id, name: s.name, simulated: s.simulated, metrics: s.metrics,
        sampleIntervalSeconds: s.sampleIntervalSeconds, maxRows: s.maxRows, maxWindowHours: s.maxWindowHours,
      })) }
    },
  },
  {
    name: 'aiaas_database_analyze',
    description: '对批准测点做只读数据库统计、质量检查和基线比较。[start,end) 必须含时区。禁止 SQL/路径参数；truncated 或 complete=false 时不可宣称完整统计。',
    parameters: { type: 'object', properties: {
      sourceId: { type: 'string' }, metric: { type: 'string' },
      start: { type: 'string', description: '含时区 ISO8601，区间起点（含）' },
      end: { type: 'string', description: '含时区 ISO8601，区间终点（不含）' },
      baselineStart: { type: 'string' }, baselineEnd: { type: 'string' },
    }, required: ['sourceId', 'metric', 'start', 'end'], additionalProperties: false },
    timeoutMs: 15000,
    async execute(args, ctx) {
      const parsed = inputSchema.safeParse(args)
      if (!parsed.success) throw new HttpError(400, '分析参数无效：只允许批准测点和含时区时间窗，不接受 SQL')
      const input = parsed.data
      const source = (await sources()).find(s => s.id === input.sourceId)
      const metric = source?.metrics.find(m => m.id === input.metric)
      if (!source || !metric) throw new HttpError(403, '数据源或测点未获批准')
      checkWindow(input.start, input.end, source.maxWindowHours)
      if (Boolean(input.baselineStart) !== Boolean(input.baselineEnd)) throw new HttpError(400, '基线起止时间必须同时提供')
      if (input.baselineStart && input.baselineEnd) checkWindow(input.baselineStart, input.baselineEnd, source.maxWindowHours)
      const ds = await getDataSource(source.datasourceId)
      if (ds.type !== 'sqlite') throw new HttpError(400, '诊断适配器当前仅支持 SQLite 历史副本；现场数据库需先配置只读适配器')
      if (!path.isAbsolute(ds.filePath || '')) throw new HttpError(400, '批准数据库必须是绝对路径')
      // No shell and no model-supplied program/SQL. The worker is bounded and opens mode=ro.
      return new Promise<unknown>((resolve, reject) => {
        const child = execFile(process.env.AIAAS_ANALYSIS_PYTHON || 'python3', [worker], {
          timeout: 10000, maxBuffer: 512000, signal: ctx?.signal,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        }, (error, stdout) => {
          if (error) return reject(new HttpError(400, '只读分析失败或超时；请检查批准副本的结构、时间索引和文件权限'))
          try { resolve(JSON.parse(stdout) as unknown) } catch { reject(new HttpError(500, '分析输出格式无效')) }
        })
        child.stdin?.end(JSON.stringify({ source, metric, input, filePath: ds.filePath }))
      })
    },
  },
]
