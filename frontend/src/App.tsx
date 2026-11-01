import { Routes, Route, Navigate } from 'react-router-dom'
import OnboardingModal from './components/OnboardingModal'
import { AppShell } from './components/shell/AppShell'
import ThemeEffectLayer from './components/ThemeEffectLayer'
import { MirrorChrome } from './mirror/MirrorChrome'
import { useTheme } from './theme-context'
import Chat from './pages/Chat'
import IndustrialGateway from './pages/IndustrialGateway'
import TodayPage from './pages/TodayPage'
import CapabilitiesPage from './pages/CapabilitiesPage'
import WorkspacePage from './pages/WorkspacePage'
import KnowledgePage from './pages/KnowledgePage'
import AutomationsPage from './pages/AutomationsPage'
import SettingsPage from './pages/SettingsPage'
import { readShellMode, SHELL_MODE_EVENT, type ShellMode } from './shell-mode'
import { useOnboarding } from './use-onboarding'
import { useEffect, useState } from 'react'

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

export default function App() {
  const onboarding = useOnboarding()
  useTheme()
  const [shellMode, setShellMode] = useState<ShellMode>(() => readShellMode())

  useEffect(() => {
    const sync = () => setShellMode(readShellMode())
    window.addEventListener('storage', sync)
    window.addEventListener(SHELL_MODE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SHELL_MODE_EVENT, sync)
    }
  }, [])

  // Keep the previous Mirror shell available as an explicit fallback, but make
  // the 10052-style AppShell the default so the upgraded workspace is visible.
  const usesMirrorShell = shellMode === 'legacy'

  if (usesMirrorShell) {
    return (
      <>
        <ThemeEffectLayer />
        <MirrorChrome />
        <OnboardingModal open={onboarding.shouldShow} onClose={onboarding.markCompleted} />
      </>
    )
  }

  return (
    <>
      <ThemeEffectLayer />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today/*" element={<TodayPage />} />
          <Route path="/chat/*" element={<Chat />} />
          <Route path="/automations/*" element={<AutomationsPage />} />
          <Route path="/workspace/*" element={<WorkspacePage />} />
          <Route path="/knowledge/*" element={<KnowledgePage />} />
          <Route path="/capabilities/*" element={<CapabilitiesPage />} />
          <Route path="/industrial-gateway" element={<IndustrialGateway />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          {legacyRoutes.map(([path, target]) => (
            <Route key={path} path={path} element={<Navigate to={target} replace />} />
          ))}
        </Route>
      </Routes>
      <OnboardingModal open={onboarding.shouldShow} onClose={onboarding.markCompleted} />
    </>
  )
}
