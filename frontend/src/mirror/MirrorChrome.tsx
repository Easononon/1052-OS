import { useEffect, useRef, lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MirrorSidebar } from './MirrorSidebar'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import { attachCursorTracking } from './cursorTracking'
import { CouplingController, CouplingContext } from './cardCoupling'
// liquidPour.ts + LiquidPourOverlay.tsx kept on disk for Phase 2 reference.

// Lazy mirror pages — PR2/PR3 fill the stubs.
// Chat is the classic page (full command menu, source badges, /new, /compact,
// empty-state prompts, notification focus). The mirror-styled MirrorChat
// variant is kept on disk for Phase 2 reference but is not routed — users
// reported the mirror variant felt like a regression vs. the classic UI.
// Voice input (useVoiceIO + mode:'recorder' fallback) and TTS playback are
// already wired into the classic Chat page, so rolling the route back keeps
// all the recent voice work.
const Chat = lazy(() => import('../pages/Chat'))
const TodayPage = lazy(() => import('../pages/TodayPage'))
const CapabilitiesPage = lazy(() => import('../pages/CapabilitiesPage'))
const WorkspacePage = lazy(() => import('../pages/WorkspacePage'))
const KnowledgePage = lazy(() => import('../pages/KnowledgePage'))
const AutomationsPage = lazy(() => import('../pages/AutomationsPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const IndustrialGateway = lazy(() => import('../pages/IndustrialGateway'))

function Wrap(title: string, child: ReactNode) {
  return (
    <MirrorPageWrapper header={<MirrorPageHeader title={title} />}>
      {child}
    </MirrorPageWrapper>
  )
}

const legacyRoutes: Array<[string, string]> = [
  ['/calendar', '/automations/calendar'],
  ['/repository', '/workspace/repositories'],
  ['/repository/:id', '/workspace/repositories'],
  ['/notes', '/knowledge/notes'],
  ['/wiki', '/knowledge/wiki'],
  ['/pkm', '/knowledge/search'],
  ['/output-profiles', '/knowledge/output-profiles'],
  ['/resources', '/knowledge/resources'],
  ['/memory', '/knowledge/memory'],
  ['/social-channels', '/capabilities/channels'],
  ['/social-channels/:channel', '/capabilities/channels'],
  ['/toolbox', '/capabilities/tools'],
  ['/toolbox/:provider', '/capabilities/tools'],
  ['/sql', '/workspace/sql'],
  ['/sql/datasources', '/workspace/datasources'],
  ['/sql/files', '/workspace/sql-files'],
  ['/sql/variables', '/workspace/variables'],
  ['/sql/orchestration', '/automations/orchestrations'],
  ['/sql/loads', '/automations/runs'],
  ['/sql/servers', '/workspace/servers'],
  ['/sql/shell-files', '/workspace/shell-files'],
  ['/notifications', '/today/activity'],
  ['/search-sources', '/capabilities/search'],
  ['/skills', '/capabilities/skills'],
  ['/settings', '/settings/models'],
]

export function MirrorChrome() {
  // Lazy-init once so the controller identity stays stable across renders.
  const couplingRef = useRef<CouplingController | null>(null)
  if (couplingRef.current == null) couplingRef.current = new CouplingController()

  useEffect(() => attachCursorTracking(), [])

  // IU-16 → material self-reveal: ramp --mr-reveal from 0 → 1 over 1.2s
  // on first mount per session. Mirror's own material properties (specular
  // peak alpha, silk noise opacity) are multiplied by this var, so the UI
  // starts as a flat dark dashboard and "crystallizes" into reflective
  // material. Hover boost + coupling are NOT multiplied — they're interaction
  // effects, separate concern. sessionStorage key reused from pour gate.
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const seen = (() => {
      try { return sessionStorage.getItem('mirror_pour_seen') === '1' } catch { return false }
    })()

    if (reduced || seen) {
      root.style.setProperty('--mr-reveal', '1')
      return
    }

    root.style.setProperty('--mr-reveal', '0')
    const start = performance.now()
    const duration = 1200
    let rafId: number | null = null

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3)
    }

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      root.style.setProperty('--mr-reveal', eased.toFixed(3))
      if (t < 1) {
        rafId = requestAnimationFrame(tick)
      } else {
        try { sessionStorage.setItem('mirror_pour_seen', '1') } catch {}
        rafId = null
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      // Leave --mr-reveal at its final value on unmount.
    }
  }, [])

  // Cross-card coupling rAF loop: hover-source detection + scroll refresh
  // + 3s idle fadeout. Throttled via a single rAF in flight.
  useEffect(() => {
    const controller = couplingRef.current!
    let rafId: number | null = null
    let idleTimer: number | null = null

    const schedule = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        controller.tick()
        rafId = null
      })
    }

    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const card =
        (t && typeof t.closest === 'function'
          ? (t.closest('[data-mirror-card]') as HTMLElement | null)
          : null)
      if (card) {
        const r = card.getBoundingClientRect()
        controller.setSource({
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        })
      } else {
        controller.setSource(null)
      }
      schedule()
      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        controller.setSource(null)
        schedule()
      }, 3000)
    }

    const onScroll = () => {
      controller.refreshAll()
      schedule()
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (rafId != null) cancelAnimationFrame(rafId)
      if (idleTimer != null) window.clearTimeout(idleTimer)
    }
  }, [])

  return (
    <CouplingContext.Provider value={couplingRef.current}>
    <div className="mr-shell">
      <MirrorSidebar />
      <Suspense fallback={<div className="mr-page-loading" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today/*" element={<TodayPage />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings/*" element={<SettingsPage />} />

          <Route path="/automations/*" element={<AutomationsPage />} />
          <Route path="/workspace/*" element={<WorkspacePage />} />
          <Route path="/knowledge/*" element={<KnowledgePage />} />
          <Route path="/capabilities/*" element={<CapabilitiesPage />} />
          <Route path="/industrial-gateway" element={Wrap('工业网关', <IndustrialGateway />)} />
          {legacyRoutes.map(([path, target]) => (
            <Route key={path} path={path} element={<Navigate to={target} replace />} />
          ))}
        </Routes>
      </Suspense>
    </div>
    </CouplingContext.Provider>
  )
}
