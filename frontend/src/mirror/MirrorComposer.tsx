import { useCallback, useEffect, useRef, type KeyboardEvent, type ChangeEvent } from 'react'
import { MirrorCard } from './primitives'
import ToolCallPanel from '../components/ToolCallPanel'
import { IconMic, IconVolume } from '../components/Icons'
import type { UseChatModelReturn } from '../hooks/useChatModel'
import { useVoiceIO } from '../hooks/useVoiceIO'

export interface MirrorComposerProps {
  model: UseChatModelReturn
}

/**
 * Floating composer for the mirror chat doc.
 *
 * Renders a glass card pinned to the bottom of the viewport with:
 *  - an attach (+) button on the left,
 *  - an auto-resizing textarea in the middle,
 *  - an 8x8 accent dot on the right (Enter or click to send, becomes a
 *    square while a stream is in flight so Enter / click stops it).
 *
 * Tool calls and pending upload chips stack above the card. Field names
 * mirror `UseChatModelReturn` directly — this component is a thin shell
 * over the hook, no extra state.
 */
export function MirrorComposer({ model }: MirrorComposerProps) {
  const {
    input,
    setInput,
    send,
    stop,
    loading,
    uploading,
    pendingUploads,
    removePendingUpload,
    handleUploadSelection,
    toolCalls,
  } = model

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastSpokenMessageIdRef = useRef<number | null>(null)
  const voice = useVoiceIO()

  // Auto-resize: snap height to scrollHeight, capped at 200px so the doc
  // above the composer never disappears entirely.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [input])

  useEffect(() => {
    const lastAssistant = [...model.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && !message.streaming && !message.error && message.content.trim())
    if (!voice.settings.autoSpeakAssistant || !lastAssistant || lastSpokenMessageIdRef.current === lastAssistant.id) return
    lastSpokenMessageIdRef.current = lastAssistant.id
    voice.speak(lastAssistant.content)
  }, [model.messages, voice])

  const startVoiceInput = useCallback(() => {
    voice.startListening({
      onTranscript: (text) => {
        setInput((current) => {
          const separator = current.trim() ? ' ' : ''
          return `${current}${separator}${text}`
        })
        textareaRef.current?.focus()
      },
      onAutoSend: (text) => void send(text),
    }, { mode: 'recorder' })
  }, [send, setInput, voice])

  const onSubmit = useCallback(() => {
    if (loading) {
      voice.cancelSpeaking()
      stop()
      return
    }
    if (!input.trim() && pendingUploads.length === 0) return
    void send()
  }, [input, loading, send, stop, pendingUploads.length, voice])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.key === 'Process') return
      // Enter (without shift) sends; ⇧↵ inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void handleUploadSelection(e.target.files)
      // Reset so the same file can be re-selected after removal.
      e.target.value = ''
    },
    [handleUploadSelection],
  )

  const hasInput = input.trim().length > 0 || pendingUploads.length > 0
  const dotActive = hasInput || loading

  return (
    <div className="mr-composer-wrap">
      {toolCalls.length > 0 && (
        <div className="mr-composer-tools">
          <ToolCallPanel entries={toolCalls} />
        </div>
      )}
      {pendingUploads.length > 0 && (
        <div className="mr-composer-uploads">
          {pendingUploads.map((u) => (
            <div key={u.id} className="mr-upload-chip">
              <span>{u.fileName}</span>
              <button
                type="button"
                onClick={() => removePendingUpload(u.id)}
                aria-label={`移除附件 ${u.fileName}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {voice.interimTranscript && (
        <div className="mr-composer-voice-hint">正在识别：{voice.interimTranscript}</div>
      )}
      {voice.message && <div className="mr-composer-voice-hint">{voice.message}</div>}
      <MirrorCard level={1} pad="tight" className="mr-composer">
        <button
          className="mr-composer-attach"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="添加附件"
          disabled={uploading || loading}
        >
          ＋
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onFileInput}
        />
        <button
          className="mr-composer-attach"
          type="button"
          onClick={voice.listening ? voice.stopListening : startVoiceInput}
          aria-label={voice.listening ? '停止语音输入' : '语音输入'}
          disabled={uploading || loading || !voice.settings.inputEnabled}
          title={voice.listening ? '停止语音输入' : '语音输入'}
        >
          <IconMic size={14} />
        </button>
        {voice.speaking && (
          <button
            className="mr-composer-attach is-speaking"
            type="button"
            onClick={voice.cancelSpeaking}
            aria-label="停止播报"
            title="停止播报"
          >
            <IconVolume size={14} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="mr-composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={loading ? '正在生成…按 ↵ 停止' : '说点什么…按 ↵ 发送，⇧↵ 换行'}
          rows={1}
        />
        <button
          className={`mr-composer-send${dotActive ? ' is-active' : ''}${loading ? ' is-loading' : ''}`}
          type="button"
          onClick={onSubmit}
          aria-label={loading ? '停止生成' : '发送'}
        >
          {loading ? <SquareIcon /> : null}
        </button>
      </MirrorCard>
    </div>
  )
}

function SquareIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="0" y="0" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}
