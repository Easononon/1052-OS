import { spawn } from 'node:child_process'

export type TtsInput = {
  text: string
  voice?: string
  rate?: number
  pitch?: number
}

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
