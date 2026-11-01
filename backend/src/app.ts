import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import cors from 'cors'
import { HttpError } from './http-error.js'
import { config } from './config.js'
import { settingsRouter } from './modules/settings/settings.routes.js'
import { agentRouter } from './modules/agent/agent.routes.js'
import { calendarRouter } from './modules/calendar/calendar.routes.js'
import { repositoryRouter } from './modules/repository/repository.routes.js'
import { notesRouter } from './modules/notes/notes.routes.js'
import { resourcesRouter } from './modules/resources/resources.routes.js'
import { websearchRouter } from './modules/websearch/websearch.routes.js'
import { notificationsRouter } from './modules/notifications/notifications.routes.js'
import { skillsRouter } from './modules/skills/skills.routes.js'
import { memoryRouter } from './modules/memory/memory.routes.js'
import { wechatRouter } from './modules/channels/wechat/wechat.routes.js'
import { wechatDesktopRouter } from './modules/channels/wechat-desktop/wechat-desktop.routes.js'
import { sqlRouter } from './modules/sql/sql.routes.js'
import { orchestrationRouter } from './modules/orchestration/orchestration.routes.js'
import { wecomRouter } from './modules/channels/wecom/wecom.routes.js'
import { uapisRouter } from './modules/uapis/uapis.routes.js'
import { runtimeLogsRouter } from './modules/runtime-logs/runtime-logs.routes.js'
import { wikiRouter } from './modules/wiki/wiki.routes.js'
import { pkmRouter } from './modules/pkm/pkm.routes.js'
import { outputProfileRouter } from './modules/output-profiles/output-profile.routes.js'
import { updatesRouter } from './modules/updates/updates.routes.js'
import { appearanceRouter } from './modules/appearance/appearance.routes.js'
import { speechRouter } from './modules/speech/speech.routes.js'
import {
  feishuCardWebhookHandler,
  feishuEventWebhookHandler,
  feishuRouter,
} from './modules/channels/feishu/feishu.routes.js'
import { appendBackendRuntimeLog } from './runtime-logs.js'
import { ensurePkmIndex } from './modules/pkm/pkm.service.js'
import { isDiagnosticMode } from './modules/agent/agent.diagnostic-policy.js'
import { aiaasDiagnosticRouter } from './modules/agent/aiaas-diagnostic.routes.js'

export function createApp(): Express {
  const app = express()

  app.use((req, res, next) => {
    if (!isDiagnosticMode()) return next()
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
    let host = ''
    let allowedOrigin = true
    try {
      host = new URL(`http://${req.headers.host || ''}`).hostname
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin)
        allowedOrigin = localHosts.has(origin.hostname) && origin.protocol === 'http:'
      }
    } catch { allowedOrigin = false }
    if (!localHosts.has(host) || !allowedOrigin) {
      res.status(403).json({ error: 'Diagnostic mode only accepts loopback hosts and local HTTP origins' })
      return
    }
    next()
  })
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  // Callback SDKs may accept GET/HEAD bodies; disabling startup alone is insufficient.
  app.use('/api/channels', (_req, res, next) => {
    if (!isDiagnosticMode()) return next()
    res.status(403).json({ error: 'External channels and callbacks are disabled in diagnostic mode' })
  })
  app.use((req, res, next) => {
    if (!isDiagnosticMode() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const allowed = new Set([
      'POST /api/agent/chat', 'POST /api/agent/chat/stream',
      'PUT /api/agent/history', 'POST /api/agent/diagnostics/analyze',
      'PUT /api/aiaas/diagnostics/scope', 'POST /api/aiaas/diagnostics/stream', 'POST /api/aiaas/diagnostics/revoke',
    ])
    if (allowed.has(`${req.method} ${req.path}`)) return next()
    res.status(403).json({ error: 'AIAAS diagnostic mode: administrative, SQL and external-action endpoints disabled' })
  })
  app.use(
    '/api/agent/uploads',
    express.static(path.join(config.dataDir, '1052', 'uploads')),
  )
  app.use(
    '/api/generated-images',
    express.static(path.join(config.dataDir, 'generated-images')),
  )
  app.use(
    '/api/channels/wechat/media',
    express.static(path.join(config.dataDir, 'channels', 'wechat', 'media')),
  )
  app.use(
    '/api/channels/feishu/media',
    express.static(path.join(config.dataDir, 'channels', 'feishu', 'media')),
  )

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() })
  })

  app.use('/api/settings', settingsRouter)
  app.use('/api/agent', agentRouter)
  app.use('/api/aiaas/diagnostics', aiaasDiagnosticRouter)
  app.use('/api/calendar', calendarRouter)
  app.use('/api/repository', repositoryRouter)
  app.use('/api/notes', notesRouter)
  app.use('/api/resources', resourcesRouter)
  app.use('/api/wiki', wikiRouter)
  app.use('/api/pkm', pkmRouter)
  app.use('/api/output-profiles', outputProfileRouter)
  app.use('/api/appearance', appearanceRouter)
  app.use('/api/speech', speechRouter)
  app.use('/api/updates', updatesRouter)
  app.use('/api/websearch', websearchRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/skills', skillsRouter)
  app.use('/api/memory', memoryRouter)
  app.use('/api/channels/wechat', wechatRouter)
  app.use('/api/channels/wechat-desktop', wechatDesktopRouter)
  app.use('/api/sql', sqlRouter)
  app.use('/api/orchestration', orchestrationRouter)
  app.use('/api/uapis', uapisRouter)
  app.use('/api/logs', runtimeLogsRouter)
  app.use('/api/channels/wecom', wecomRouter)
  app.use('/api/channels/feishu/callbacks/events', feishuEventWebhookHandler)
  app.use('/api/channels/feishu/callbacks/cards', feishuCardWebhookHandler)
  app.use('/api/channels/feishu', feishuRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('[unhandled]', err)
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    void appendBackendRuntimeLog('error', '[http-unhandled]', {
      method: req.method,
      path: req.originalUrl,
      message,
      error: err,
    }).catch(() => {})
    res.status(500).json({ error: message })
  })

  // Auto-build PKM index on first startup
  void ensurePkmIndex()

  return app
}
