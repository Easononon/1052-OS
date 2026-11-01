export type ShellMode = 'new' | 'legacy'

export const SHELL_MODE_KEY = '1052.shellMode'
export const LEGACY_MIRROR_KEY = '1052.legacyMirrorShell'
export const SHELL_MODE_EVENT = '1052-shell-mode-change'

export function readShellMode(): ShellMode {
  try {
    const value = localStorage.getItem(SHELL_MODE_KEY)
    if (value === 'legacy' || localStorage.getItem(LEGACY_MIRROR_KEY) === 'true') return 'legacy'
  } catch {
    // Default to the new shell when browser storage is unavailable.
  }
  return 'new'
}

export function writeShellMode(mode: ShellMode) {
  localStorage.setItem(SHELL_MODE_KEY, mode)
  localStorage.setItem(LEGACY_MIRROR_KEY, mode === 'legacy' ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent(SHELL_MODE_EVENT, { detail: { mode } }))
}
