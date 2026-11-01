import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type AsrInput = {
  audio: Buffer
  mimeType?: string
  fileName?: string
}

export type TtsInput = {
  text: string
  voice?: string
  rate?: number
  pitch?: number
}

const MAX_ASR_BYTES = 25 * 1024 * 1024
const DEFAULT_ASR_MODEL = 'stepaudio-2.5-chat'

const MAX_TTS_CHARS = 4000
const DEFAULT_EDGE_TTS_VOICE = 'zh-CN-YunxiNeural'

function toEdgeRate(rate: number | undefined) {
  const normalized = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1
  const percent = Math.round((Math.min(Math.max(normalized, 0.5), 2) - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

function toEdgePitch(pitch: number | undefined) {
  const normalized = typeof pitch === 'number' && Number.isFinite(pitch) ? pitch : 1
  const hz = Math.round((Math.min(Math.max(normalized, 0), 2) - 1) * 50)
  return `${hz >= 0 ? '+' : ''}${hz}Hz`
}

export function normalizeEdgeTtsVoice(voice: string | undefined) {
  const value = voice?.trim()
  return value || DEFAULT_EDGE_TTS_VOICE
}

function runFfmpeg(inputPath: string, outputPath: string) {
  const errors: Buffer[] = []
  const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', outputPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
  return new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `ffmpeg 退出码 ${code}`))
    })
  })
}

async function normalizeAudioForAsr(input: AsrInput) {
  const tempDir = await mkdtemp(path.join(tmpdir(), '1052-asr-'))
  const inputPath = path.join(tempDir, input.fileName || `input-${randomUUID()}.webm`)
  const outputPath = path.join(tempDir, 'speech.wav')
  await writeFile(inputPath, input.audio)
  try {
    await runFfmpeg(inputPath, outputPath)
    return { audio: await readFile(outputPath), mimeType: 'audio/wav', fileName: 'speech.wav', cleanup: () => rm(tempDir, { recursive: true, force: true }) }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

function getOpenAiCompatibleBaseUrl() {
  const raw = process.env.NEWAPI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const base = raw.replace(/\/$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function getStepFunApiKey() {
  return process.env.STEPFUN_API_KEY || process.env.STEP_API_KEY
}

async function transcribeWithStepFun(normalized: { audio: Buffer }) {
  const apiKey = getStepFunApiKey()
  if (!apiKey) throw new Error('未配置 STEPFUN_API_KEY / NEWAPI_KEY，无法语音识别')

  const response = await fetch('https://api.stepfun.com/v1/audio/asr/sse', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio: {
        data: normalized.audio.toString('base64'),
        input: {
          transcription: {
            model: 'step-asr',
            language: 'zh',
            full_rerun_on_commit: true,
            enable_itn: true,
          },
          format: {
            type: 'wav',
            rate: 16000,
            bits: 16,
            channel: 1,
            codec: 'pcm_s16le',
          },
        },
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `StepFun ASR 返回 ${response.status}`)
  }

  const stream = response.body
  if (!stream) throw new Error('StepFun ASR 没有返回数据流')

  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let deltaText = ''
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const event = JSON.parse(payload) as { type?: string; text?: unknown; delta?: unknown; message?: unknown }
      if (event.type === 'transcript.text.done' && typeof event.text === 'string') finalText = event.text
      if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') deltaText += event.delta
      if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : 'StepFun ASR 识别失败')
    }
  }

  return (finalText || deltaText).trim()
}

async function transcribeWithAudioChat(baseUrl: string, apiKey: string, normalized: { audio: Buffer }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ASR_MODEL || process.env.NEWAPI_ASR_MODEL || DEFAULT_ASR_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请把这段音频转写成中文文本，只返回转写文本，不要解释。' },
          { type: 'input_audio', input_audio: { data: normalized.audio.toString('base64'), format: 'wav' } },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `语音识别接口返回 ${response.status}`)
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
  const text = body.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('语音识别没有返回文本')
  return text.replace(/^（[^）]+）\s*/u, '').trim()
}

async function transcribeWithOpenAiCompatible(baseUrl: string, apiKey: string, normalized: { audio: Buffer, mimeType: string, fileName: string }) {
  const form = new FormData()
  form.append('file', new Blob([normalized.audio], { type: normalized.mimeType }), normalized.fileName)
  form.append('model', process.env.OPENAI_ASR_MODEL || process.env.NEWAPI_ASR_MODEL || DEFAULT_ASR_MODEL)
  form.append('language', 'zh')

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `语音识别接口返回 ${response.status}`)
  }

  const body = await response.json() as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new Error('语音识别没有返回文本')
  return text
}

export async function transcribeSpeech(input: AsrInput): Promise<string> {
  if (!input.audio.length) throw new Error('音频不能为空')
  if (input.audio.length > MAX_ASR_BYTES) throw new Error('音频过大，最多 25MB')

  const normalized = await normalizeAudioForAsr(input)
  try {
    const provider = process.env.SPEECH_ASR_PROVIDER || 'audio-chat'
    if (provider === 'openai') {
      const apiKey = process.env.NEWAPI_KEY || process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('未配置 OPENAI_API_KEY 或 NEWAPI_KEY，无法语音识别')
      return await transcribeWithOpenAiCompatible(getOpenAiCompatibleBaseUrl(), apiKey, normalized)
    }
    if (provider === 'stepfun') return await transcribeWithStepFun(normalized)

    const apiKey = process.env.NEWAPI_KEY || process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('未配置 NEWAPI_KEY 或 OPENAI_API_KEY，无法语音识别')
    return await transcribeWithAudioChat(getOpenAiCompatibleBaseUrl(), apiKey, normalized)
  } finally {
    await normalized.cleanup()
  }
}

export async function synthesizeEdgeTts(input: TtsInput): Promise<Buffer> {
  const text = input.text.trim()
  if (!text) throw new Error('文本不能为空')
  if (text.length > MAX_TTS_CHARS) throw new Error(`文本过长，最多 ${MAX_TTS_CHARS} 字`)

  const chunks: Buffer[] = []
  const errors: Buffer[] = []
  const child = spawn('python3', [
    '-m',
    'edge_tts',
    '--voice',
    normalizeEdgeTtsVoice(input.voice),
    '--rate',
    toEdgeRate(input.rate),
    '--pitch',
    toEdgePitch(input.pitch),
    '--text',
    text,
    '--write-media',
    '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))

  return new Promise((resolve, reject) => {
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks))
        return
      }
      const detail = Buffer.concat(errors).toString('utf8').trim()
      reject(new Error(detail || `edge-tts 退出码 ${code}`))
    })
  })
}
