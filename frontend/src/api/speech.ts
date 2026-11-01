export type SpeechTtsInput = {
  text: string
  voice?: string
  rate?: number
  pitch?: number
}

export async function requestSpeechTts(input: SpeechTtsInput): Promise<Blob> {
  const res = await fetch('/api/speech/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : res.statusText
    throw new Error(message || '语音合成失败')
  }
  return res.blob()
}

export type SpeechAsrResult = {
  text: string
}

export async function requestSpeechAsr(audio: Blob): Promise<SpeechAsrResult> {
  const form = new FormData()
  form.append('audio', audio, `speech.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`)

  const res = await fetch('/api/speech/asr', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : res.statusText
    throw new Error(message || '语音识别失败')
  }
  return res.json() as Promise<SpeechAsrResult>
}
