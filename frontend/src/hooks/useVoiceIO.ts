import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestSpeechTts } from '../api/speech'
import { SettingsApi, type SpeechSettings } from '../api/settings'

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string; message?: string }) => void) | null
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionResultEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'unsupported'

type StartListeningOptions = {
  onTranscript: (text: string) => void
  onAutoSend?: (text: string) => void
}

const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  inputEnabled: true,
  recognitionLanguage: 'zh-CN',
  autoSendAfterFinal: false,
  ttsEnabled: true,
  autoSpeakAssistant: true,
  ttsRate: 1,
  ttsPitch: 1,
  ttsVoiceName: 'zh-CN-YunxiNeural',
  provider: 'edge-tts',
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

function getSpeechSynthesisVoice(name: string) {
  if (typeof window === 'undefined' || !name) return null
  return window.speechSynthesis.getVoices().find((voice) => voice.name === name) ?? null
}

function normalizeDateForSpeech(text: string) {
  return text
    .replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_match, year: string, month: string, day: string) => `${year}年${Number(month)}月${Number(day)}日`)
    .replace(/\b(\d{1,2})\/(\d{1,2})(?:\s*[~～至-]\s*(\d{1,2}))?\b/g, (_match, month: string, day: string, endDay?: string) => `${Number(month)}月${Number(day)}日${endDay ? `到${Number(endDay)}日` : ''}`)
}

function normalizeTemperatureForSpeech(text: string) {
  return text
    .replace(/(\d{1,2})\s*[~～至-]\s*(\d{1,2})\s*°?\s*C/gi, (_match, low: string, high: string) => `${Number(low)}到${Number(high)}摄氏度`)
    .replace(/(\d{1,2})\s*°\s*C/gi, (_match, value: string) => `${Number(value)}摄氏度`)
}

function stripEmojiForSpeech(text: string) {
  return text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{2793}\u{2795}-\u{27BF}️]/gu, '')
}

function isSpeechNoiseLine(line: string) {
  return /^(?:工具|状态|用量|tokens?|usage)[:：]/i.test(line) ||
    /(?:用|调用).{0,12}(?:API|接口|工具|搜索).{0,20}(?:查|查询|读取|获取)/i.test(line) ||
    /(?:API|接口).{0,12}(?:查不到|失败|不可用|没有返回)/i.test(line) ||
    /(?:换用|改用).{0,8}(?:搜索|网页|接口|API)/i.test(line) ||
    /(?:搜索|读取|打开).{0,12}(?:网页|页面|结果|链接)/i.test(line) ||
    /^下周天气来了[！!。]?/.test(line)
}

export function prepareSpeechText(text: string) {
  const withoutBlocks = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]\s*|\d+[.)]\s*)/gm, '')
    .replace(/^\s*[-*_#]{3,}\s*$/gm, ' ')
    .replace(/[#*_`]+/g, '')
    .replace(/[•◆◇▪▫●○]/g, '')
    .replace(/\|/g, '，')

  const lines = withoutBlocks
    .split(/\n+/)
    .map((line) => normalizeDateForSpeech(normalizeTemperatureForSpeech(stripEmojiForSpeech(line.trim()))))
    .filter((line) => line && !isSpeechNoiseLine(line))

  return lines
    .join('。')
    .replace(/\s+/g, ' ')
    .replace(/。\s+/g, '。')
    .replace(/[。.!！?？]{2,}/g, '。')
    .trim()
    .slice(0, 600)
}

export function useVoiceIO() {
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SPEECH_SETTINGS)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [message, setMessage] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  const recognitionSupported = useMemo(() => getRecognitionConstructor() !== null, [])
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    let cancelled = false
    SettingsApi.get()
      .then((loaded) => {
        if (cancelled) return
        setSettings({ ...DEFAULT_SPEECH_SETTINGS, ...loaded.speech })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setInterimTranscript('')
    setStatus((current) => (current === 'listening' || current === 'processing' ? 'idle' : current))
  }, [])

  const stopEdgeAudio = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
  }, [])

  const cancelSpeaking = useCallback(() => {
    stopEdgeAudio()
    if (ttsSupported) window.speechSynthesis.cancel()
    setStatus((current) => (current === 'speaking' ? 'idle' : current))
  }, [stopEdgeAudio, ttsSupported])

  const startListening = useCallback(
    ({ onTranscript, onAutoSend }: StartListeningOptions) => {
      if (!settings.inputEnabled) return
      const Recognition = getRecognitionConstructor()
      if (!Recognition) {
        setStatus('unsupported')
        setMessage('当前浏览器不支持语音识别，请使用 Chrome 或 Edge。')
        return
      }

      cancelSpeaking()
      const recognition = new Recognition()
      recognitionRef.current = recognition
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = settings.recognitionLanguage || 'zh-CN'
      recognition.onstart = () => {
        setStatus('listening')
        setMessage('正在听，请开始说话。')
      }
      recognition.onerror = (event) => {
        setStatus('error')
        setMessage(event.error === 'not-allowed' ? '麦克风权限被拒绝。' : event.message || '语音识别失败。')
        recognitionRef.current = null
      }
      recognition.onend = () => {
        recognitionRef.current = null
        setInterimTranscript('')
        setStatus((current) => (current === 'listening' || current === 'processing' ? 'idle' : current))
      }
      recognition.onresult = (event) => {
        let interim = ''
        let finalText = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) finalText += transcript
          else interim += transcript
        }
        setInterimTranscript(interim.trim())
        if (!finalText.trim()) return
        const text = finalText.trim()
        setStatus('processing')
        setMessage('已识别语音。')
        onTranscript(text)
        if (settings.autoSendAfterFinal) onAutoSend?.(text)
      }

      try {
        recognition.start()
      } catch {
        setStatus('error')
        setMessage('语音识别启动失败，请稍后重试。')
        recognitionRef.current = null
      }
    },
    [cancelSpeaking, settings.autoSendAfterFinal, settings.inputEnabled, settings.recognitionLanguage],
  )

  const speak = useCallback(
    (text: string) => {
      const content = prepareSpeechText(text)
      if (!settings.ttsEnabled || !content) return
      setMessage('')
      stopEdgeAudio()
      if (ttsSupported) window.speechSynthesis.cancel()

      if (settings.provider === 'edge-tts') {
        setStatus('speaking')
        requestSpeechTts({
          text: content,
          voice: settings.ttsVoiceName || 'zh-CN-YunxiNeural',
          rate: settings.ttsRate,
          pitch: settings.ttsPitch,
        })
          .then((blob) => {
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audioRef.current = audio
            audioUrlRef.current = url
            audio.onended = () => {
              stopEdgeAudio()
              setStatus('idle')
            }
            audio.onerror = () => {
              stopEdgeAudio()
              setStatus('error')
              setMessage('Edge TTS 播放失败。')
            }
            return audio.play()
          })
          .catch((error) => {
            stopEdgeAudio()
            setStatus('error')
            setMessage(error instanceof Error ? error.message : 'Edge TTS 合成失败。')
          })
        return
      }

      if (!ttsSupported) return
      const utterance = new SpeechSynthesisUtterance(content)
      utterance.lang = settings.recognitionLanguage || 'zh-CN'
      utterance.rate = settings.ttsRate
      utterance.pitch = settings.ttsPitch
      utterance.voice = getSpeechSynthesisVoice(settings.ttsVoiceName)
      utterance.onstart = () => setStatus('speaking')
      utterance.onend = () => setStatus('idle')
      utterance.onerror = () => {
        setStatus('error')
        setMessage('语音播报失败。')
      }
      window.speechSynthesis.speak(utterance)
    },
    [settings.provider, settings.recognitionLanguage, settings.ttsEnabled, settings.ttsPitch, settings.ttsRate, settings.ttsVoiceName, stopEdgeAudio, ttsSupported],
  )

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      stopEdgeAudio()
      if (ttsSupported) window.speechSynthesis.cancel()
    }
  }, [stopEdgeAudio, ttsSupported])

  return {
    settings,
    status,
    message,
    interimTranscript,
    recognitionSupported,
    ttsSupported,
    listening: status === 'listening' || status === 'processing',
    speaking: status === 'speaking',
    startListening,
    stopListening,
    speak,
    cancelSpeaking,
  }
}
