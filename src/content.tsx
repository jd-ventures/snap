import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fromDataUrl } from './capture'
import { applyTheme, seedInk, type Prefs } from './prefs'
import { Surface } from './Surface'
import { setStyleRoot } from './theme'
import type { Pending } from './background'
import css from './styles.css?inline'

/**
 * The surface, inside the page it is a picture of — the way artc's is.
 *
 * Injected by the service worker after the picture is taken, so the
 * capture never contains the surface. It lives in a shadow root on a host
 * element appended to the document, which is what keeps the page's
 * stylesheet off the surface and the surface's off the page: the tokens
 * are declared on the host (`:host`, rewritten from `:root` below), and the
 * three files that read a token at runtime read them from there.
 *
 * Why here rather than an extension tab: the page already has the keyboard
 * — the reader just pressed the toolbar button or the shortcut on it — and
 * the clipboard write happens in an ordinary https document, which is
 * exactly the context artc's copy runs in. No tab to focus, no tab to close.
 *
 * Loaded once per page (`SNAP` guard) and told to open by a message; a
 * second snap while one is open replaces it.
 */
type Open = { type: 'snap'; pending: Pending; prefs: Prefs }

const SNAP = '__snapContent'
const w = window as unknown as Record<string, unknown>

if (!w[SNAP]) {
  w[SNAP] = true
  let live: { host: HTMLElement; root: Root } | null = null

  const close = () => {
    if (!live) return
    live.root.unmount()
    live.host.remove()
    live = null
    setStyleRoot(null)
  }

  const open = async ({ pending, prefs }: Open) => {
    close()
    const host = document.createElement('snap-surface')
    // The page can have a `data-theme` of its own; ours is on the host.
    applyTheme(host, prefs.theme)
    // Over everything the page has, and the diagnostics over that.
    host.style.setProperty('--z-capture', '2147483644')
    host.style.setProperty('--z-toast', '2147483645')
    host.style.setProperty('--z-diag', '2147483646')
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = forShadow(css)
    const mount = document.createElement('div')
    shadow.append(style, mount)
    ;(document.body ?? document.documentElement).append(host)
    setStyleRoot(host)
    seedInk(prefs)
    // The page under the surface must not scroll away from under it.
    host.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })
    const canvas = await fromDataUrl(pending.dataUrl)
    const root = createRoot(mount)
    live = { host, root }
    root.render(
      <StrictMode>
        <Surface canvas={canvas} pending={pending} prefs={prefs} onClose={close} />
      </StrictMode>
    )
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg: Open, _sender, reply) => {
      if (msg?.type !== 'snap') return
      void open(msg).then(
        () => reply({ ok: true }),
        (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
      )
      return true
    })
  } else {
    // No extension runtime: this file was put in a page by a test harness
    // rather than by the service worker. Inert in a real injection, where
    // the runtime is always present and this branch is never taken.
    document.addEventListener('snap:open', (e) => void open((e as CustomEvent<Open>).detail))
  }
}

/**
 * The stylesheet, re-addressed to a shadow root: what was said of `:root`
 * is said of the host. `html, body` rules match nothing in a shadow tree and
 * are left alone.
 */
function forShadow(sheet: string): string {
  return (
    sheet
      .replace(/:root:not\(\[data-theme='light'\]\)/g, ":host(:not([data-theme='light']))")
      .replace(/:root\[data-theme='dark'\]/g, ":host([data-theme='dark'])")
      .replace(/:root\s*\{/g, ':host {') +
    `
:host { all: initial; display: block; font-family: var(--sp-font-display); font-size: var(--text-md); color: var(--sp-text); line-height: normal; }
`
  )
}
