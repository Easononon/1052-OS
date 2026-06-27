// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChatLlmSelector } from './useChatLlmSelector'
import type {
  LlmTaskRoute,
  PublicLlmProfile,
  PublicSettings,
} from '../api/settings'

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../api/client'

function makeProfile(over: Partial<PublicLlmProfile> = {}): PublicLlmProfile {
  return {
    id: 'profile-1',
    name: '云端·默认',
    kind: 'cloud',
    provider: 'openai-compatible',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'gpt-5.5',
    enabled: true,
    hasApiKey: true,
    apiKeyMask: 'sk-****1234',
    ...over,
  }
}

function makeSettings(over: Partial<PublicSettings['llm']> = {}): PublicSettings {
  return {
    llm: {
      baseUrl: '',
      modelId: 'gpt-5.5',
      kind: 'cloud',
      provider: 'openai-compatible',
      apiFormat: 'openai-compatible',
      activeProfileId: 'profile-1',
      profiles: [makeProfile()],
      taskRoutes: [{ task: 'agent-chat', profileId: 'profile-1' }],
      hasApiKey: true,
      apiKeyMask: 'sk-****1234',
      ...over,
    },
    imageGeneration: {
      apiFormat: 'openai-compatible',
      baseUrl: '',
      modelId: '',
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 100,
      hasApiKey: false,
      apiKeyMask: '',
    },
    appearance: { theme: 'dark', language: 'zh-CN' },
    agent: {
      streaming: true,
      userPrompt: '',
      fullAccess: false,
      contextMessageLimit: 60,
      progressiveDisclosureEnabled: true,
      providerCachingEnabled: false,
      checkpointEnabled: false,
      seedOnResumeEnabled: false,
      upgradeDebugEventsEnabled: false,
      autoCompactEnabled: false,
      autoCompactThreshold: 8000,
      morningBrief: { enabled: false, time: '08:30' },
    },
    speech: {
      inputEnabled: false,
      recognitionLanguage: 'zh-CN',
      autoSendAfterFinal: false,
      ttsEnabled: false,
      autoSpeakAssistant: false,
      ttsRate: 1,
      ttsPitch: 1,
      ttsVoiceName: '',
      provider: 'browser',
    },
    ocr: {
      provider: 'uapis',
      customBaseUrl: '',
      customModelId: '',
      hasCustomApiKey: false,
      customApiKeyMask: '',
    },
    uapis: {
      hasApiKey: false,
      apiKeyMask: '',
      mode: 'free-ip-quota',
      home: '',
      console: '',
      anonymousMonthlyCredits: 0,
      apiKeyMonthlyCredits: 0,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChatLlmSelector', () => {
  it('loads public settings on mount and exposes the active agent-chat profile', async () => {
    vi.mocked(api.get).mockResolvedValue(makeSettings({
      profiles: [makeProfile({ id: 'profile-1', name: '云端·默认', modelId: 'gpt-5.5' })],
      taskRoutes: [{ task: 'agent-chat', profileId: 'profile-1' }],
    }))

    const { result } = renderHook(() => useChatLlmSelector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.activeProfile?.id).toBe('profile-1')
    expect(result.current.enabledProfiles.map((p) => p.id)).toEqual(['profile-1'])
  })

  it('falls back to llm.activeProfileId when no agent-chat task route exists', async () => {
    vi.mocked(api.get).mockResolvedValue(makeSettings({
      activeProfileId: 'profile-1',
      profiles: [makeProfile({ id: 'profile-1' })],
      taskRoutes: [],
    }))

    const { result } = renderHook(() => useChatLlmSelector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.activeProfile?.id).toBe('profile-1')
  })

  it('selectProfile merges with other existing task routes (does not drop pdf/coding routes)', async () => {
    const existingRoutes: LlmTaskRoute[] = [
      { task: 'agent-chat', profileId: 'profile-1' },
      { task: 'pdf-to-markdown', profileId: 'profile-2' },
      { task: 'coding', profileId: 'profile-3' },
    ]
    vi.mocked(api.get).mockResolvedValue(makeSettings({
      profiles: [
        makeProfile({ id: 'profile-1', name: '云端·默认' }),
        makeProfile({ id: 'profile-2', name: 'PDF 专用' }),
        makeProfile({ id: 'profile-3', name: 'Coding 专用' }),
        makeProfile({ id: 'profile-4', name: '本地·Ollama', provider: 'ollama' }),
      ],
      taskRoutes: existingRoutes,
    }))
    vi.mocked(api.put).mockResolvedValue(makeSettings({
      profiles: [
        makeProfile({ id: 'profile-1', name: '云端·默认' }),
        makeProfile({ id: 'profile-2', name: 'PDF 专用' }),
        makeProfile({ id: 'profile-3', name: 'Coding 专用' }),
        makeProfile({ id: 'profile-4', name: '本地·Ollama', provider: 'ollama' }),
      ],
      taskRoutes: [
        { task: 'pdf-to-markdown', profileId: 'profile-2' },
        { task: 'coding', profileId: 'profile-3' },
        { task: 'agent-chat', profileId: 'profile-4' },
      ],
    }))

    const { result } = renderHook(() => useChatLlmSelector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let ok = false
    await act(async () => {
      ok = await result.current.selectProfile('profile-4')
    })
    expect(ok).toBe(true)

    expect(api.put).toHaveBeenCalledWith('/settings/llm/task-routes', {
      routes: [
        { task: 'pdf-to-markdown', profileId: 'profile-2' },
        { task: 'coding', profileId: 'profile-3' },
        { task: 'agent-chat', profileId: 'profile-4' },
      ],
    })
    expect(result.current.activeProfile?.id).toBe('profile-4')
  })

  it('selectProfile surfaces error message and leaves state intact on failure', async () => {
    vi.mocked(api.get).mockResolvedValue(makeSettings())
    vi.mocked(api.put).mockRejectedValue(new Error('保存失败: 502'))

    const { result } = renderHook(() => useChatLlmSelector())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let ok = true
    await act(async () => {
      ok = await result.current.selectProfile('profile-2')
    })
    expect(ok).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toContain('502')
  })
})