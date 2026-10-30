/**
 * Settings, kept in `chrome.storage.sync` so they follow the Chrome profile.
 *
 * Read with defaults filled in, so a setting added later is never undefined
 * for someone who saved before it existed. The shortcut is NOT here: Chrome
 * owns it (chrome://extensions/shortcuts) and an extension can only read it.
 */
import type { MarkInk, MarkInside } from './marks'

export type Theme = 'system' | 'light' | 'dark'
export type OpenIn = 'page' | 'tab' | 'window'
export type AfterCopy = 'close' | 'stay'

export interface Prefs {
  theme: Theme
  /** Where the surface opens: over the page itself (the artc way), in a tab
   *  beside it, or in its own window. Pages Chrome keeps scripts out of fall
   *  back from `page` to `tab`. */
  openIn: OpenIn
  /** Draw the browser-style address bar with the page URL across the top. */
  addressBar: boolean
  /** Close the surface once the picture is on the clipboard, or stay to copy again. */
  afterCopy: AfterCopy
  /** The ink and fill the surface starts with… */
  ink: MarkInk
  inside: MarkInside
  /** …unless the last used ones are remembered, which wins when on. */
  rememberInk: boolean
  /** A panel on the surface saying what it receives: keys, focus, and each
   *  step of a copy with timings. For finding out why a press did nothing. */
  diagnostics: boolean
}

export const DEFAULTS: Prefs = {
  theme: 'system',
  openIn: 'page',
  addressBar: true,
  afterCopy: 'close',
  ink: 'annotate',
  inside: 'none',
  rememberInk: true,
  diagnostics: false,
}

const KEY = 'prefs'

export async function loadPrefs(): Promise<Prefs> {
  const got = (await chrome.storage.sync.get(KEY))[KEY] as Partial<Prefs> | undefined
  return { ...DEFAULTS, ...(got ?? {}) }
}

export async function savePrefs(next: Prefs): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: next })
}

/** The theme as an attribute on the element the stylesheet reads it from:
 *  `<html>` on the extension's page, the shadow host inside somebody else's. */
export function applyTheme(on: HTMLElement, theme: Theme) {
  if (theme === 'system') delete on.dataset.theme
  else on.dataset.theme = theme
}

/**
 * The starting ink and fill. marks.ts remembers the last used pair in
 * localStorage; the settings say what a fresh capture starts with when that
 * memory is off, or when there is nothing remembered yet. Inside a page the
 * localStorage is that page's, so the memory is per site there — a small
 * price for not needing a storage permission on every site.
 */
export function seedInk(p: Prefs) {
  try {
    if (!p.rememberInk || localStorage.getItem('snap-mark-ink') === null) {
      localStorage.setItem('snap-mark-ink', p.ink)
      localStorage.setItem('snap-mark-inside', p.inside)
    }
  } catch {
    /* unremembered is not broken */
  }
}
