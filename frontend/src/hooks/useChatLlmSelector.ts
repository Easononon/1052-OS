import { useCallback, useEffect, useState } from 'react'
import {
  SettingsApi,
  type LlmTaskKind,
  type LlmTaskRoute,
  type PublicLlmProfile,
  type PublicSettings,
} from '../api/settings'

type Status = 'idle' | 'loading' | 'ready' | 'saving' | 'error'

export type ChatLlmState = {
  status: Status
  /** Profile currently routed to the agent-chat task, or null if not set. */
  activeProfile: PublicLlmProfile | null
  /** All enabled profiles the user can switch between. */
  enabledProfiles: PublicLlmProfile[]
  errorMessage: string | null
  /**
   * Switch the agent-chat task to a different profile by id. Returns true
   * when the change was applied (caller may want to refresh derived state).
   */
  selectProfile: (profileId: string) => Promise<boolean>
  reload: () => Promise<void>
}

const AGENT_CHAT_TASK: LlmTaskKind = 'agent-chat'

function pickAgentChatProfile(settings: PublicSettings): PublicLlmProfile | null {
  const route = settings.llm.taskRoutes.find((r) => r.task === AGENT_CHAT_TASK)
  const profileId = route?.profileId ?? settings.llm.activeProfileId
  if (!profileId) return null
  return settings.llm.profiles.find((p) => p.id === profileId) ?? null
}

function pickEnabledProfiles(settings: PublicSettings): PublicLlmProfile[] {
  return settings.llm.profiles.filter((p) => p.enabled)
}

/**
 * Lightweight read/write of the agent-chat LLM route. Used by the chat
 * composer's model selector. Avoids pulling in the full SettingsPageModel
 * state graph (image gen / OCR / advanced) — Chat only needs the active
 * profile plus a way to switch it.
 *
 * Why agent-chat only and not the global activeProfileId? Because users may
 * want agent-chat on a fast local model while image-gen / OCR stay on
 * cloud. The task-route is the right level of granularity; activeProfileId
 * is reserved for "the profile the system uses as a fallback when a task
 * has no explicit route" and changing it would surprise unrelated features.
 */
export function useChatLlmSelector(): ChatLlmState {
  const [status, setStatus] = useState<Status>('idle')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const next = await SettingsApi.get()
      setSettings(next)
      setStatus('ready')
    } catch (err) {
      setErrorMessage((err as Error).message || '加载模型列表失败')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selectProfile = useCallback(
    async (profileId: string): Promise<boolean> => {
      if (!settings) return false
      setStatus('saving')
      setErrorMessage(null)
      // Merge with the other existing routes so we don't drop routes for
      // pdf-to-markdown / coding / etc. when switching agent-chat.
      const otherRoutes = settings.llm.taskRoutes.filter(
        (r) => r.task !== AGENT_CHAT_TASK,
      )
      const nextRoutes: LlmTaskRoute[] = [
        ...otherRoutes,
        { task: AGENT_CHAT_TASK, profileId },
      ]
      try {
        const next = await SettingsApi.updateLlmTaskRoutes(nextRoutes)
        setSettings(next)
        setStatus('ready')
        return true
      } catch (err) {
        setErrorMessage((err as Error).message || '切换模型失败')
        setStatus('error')
        return false
      }
    },
    [settings],
  )

  return {
    status,
    activeProfile: settings ? pickAgentChatProfile(settings) : null,
    enabledProfiles: settings ? pickEnabledProfiles(settings) : [],
    errorMessage,
    selectProfile,
    reload,
  }
}