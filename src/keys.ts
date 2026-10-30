import { useEffect } from 'react'
import { useLatest } from './ui'

/**
 * A shortcut, named by the PHYSICAL key rather than the character it produces
 * (`event.code`, not `event.key`): a `key` match is wrong on any layout that
 * isn't the author's.
 */
export interface Hotkey {
  code: string
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
}

export const KEYS = {
  /** Marking up: copy the picture and close. */
  annotateDone: { code: 'Enter' },
  /** Bare `C`, safe because the hook is deaf while the note field is typed in. */
  annotateCopy: { code: 'KeyC' },
} satisfies Record<string, Hotkey>

/**
 * Hold one window-level shortcut for as long as the caller is mounted. Deaf
 * while someone is typing. The handler is kept in a ref so a fresh closure
 * each render doesn't re-subscribe the listener.
 */
export function useHotkey(hotkey: Hotkey, run: () => void, isOn = true): void {
  const latest = useLatest(run)
  useEffect(() => {
    if (!isOn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== hotkey.code) return
      if (e.shiftKey !== !!hotkey.shift) return
      if (e.altKey !== !!hotkey.alt) return
      if (e.ctrlKey !== !!hotkey.ctrl) return
      if (e.metaKey !== !!hotkey.meta) return
      if (typingInto(e.target)) return
      e.preventDefault()
      // Ours, not the host page's: inside somebody else's page a bare `C`
      // may be their shortcut too, and it must not fire under the surface.
      e.stopPropagation()
      latest.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [latest, hotkey.code, hotkey.shift, hotkey.alt, hotkey.ctrl, hotkey.meta, isOn])
}

function typingInto(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}
