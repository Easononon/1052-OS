import { createHmac } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import { getSettings, resolveLlmConfigForTask } from '../settings/settings.service.js'

async function dataConfigurationBinding() {
  const read = async (file: string) => {
    try {
      const raw = await fs.readFile(file, 'utf8')
      if (raw.length > 262144) throw new Error('oversized configuration')
      return raw
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw new HttpError(503, 'diagnostic_data_configuration_invalid')
    }
  }
  const registry = await read(path.join(config.dataDir, 'aiaas-diagnostics/sources.json'))
  if (!registry) return { registry, connections: [] }
  try {
    const parsed: unknown = JSON.parse(registry)
    if (!parsed || typeof parsed !== 'object' || !('sources' in parsed) || !Array.isArray(parsed.sources) || parsed.sources.length > 50) throw new Error('invalid registry')
    const ids = parsed.sources.map((source: unknown) => {
      if (!source || typeof source !== 'object' || !('datasourceId' in source) || typeof source.datasourceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.datasourceId)) throw new Error('invalid id')
      return source.datasourceId
    })
    const connections: string[] = []
    for (const id of [...new Set(ids)].sort()) connections.push(await read(path.join(config.dataDir, 'sql-datasources', `${id}.json`)))
    return { registry, connections }
  } catch {
    throw new HttpError(503, 'diagnostic_data_configuration_invalid')
  }
}

export async function diagnosticModelBinding() {
  const settings = await getSettings()
  const model = resolveLlmConfigForTask(settings.llm, 'agent-chat')
  const fingerprint = createHmac('sha256', process.env.AIAAS_DIAGNOSTIC_BRIDGE_TOKEN || '')
    .update(JSON.stringify({ profile: model.activeProfileId, baseUrl: model.baseUrl,
      modelId: model.modelId, apiKey: model.apiKey, provider: model.provider,
      apiFormat: model.apiFormat, kind: model.kind, dataConfiguration: await dataConfigurationBinding() })).digest('hex')
  let host = ''
  try { host = new URL(model.baseUrl).hostname } catch { /* unconfigured model */ }
  return { model, public: { fingerprint, model_id: model.modelId, provider: model.provider,
    endpoint_host: host, kind: model.kind, configured: Boolean(host && model.modelId) } }
}
