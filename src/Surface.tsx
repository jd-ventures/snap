import { useEffect, useState } from 'react'
import { Annotate } from './Annotate'
import type { Pending } from './background'
import type { Prefs } from './prefs'
import { Toast, useFlash } from './ui'

/**
 * The surface with its toast and diagnostics, as one component — rendered
 * over the host page (content.tsx) and, as a fallback, on the extension's
 * own page (main.tsx). The two differ only in how they leave: `onClose`.
 */
export function Surface({
  canvas,
  pending,
  prefs,
  onClose,
}: {
  canvas: HTMLCanvasElement
  pending: Pending
  prefs: Prefs
  onClose: () => void
}) {
  const [toast, flash] = useFlash()
  const [lines, setLines] = useState<string[]>([])
  const log = (line: string) =>
    setLines((was) => [...was.slice(-14), `${new Date().toISOString().slice(11, 23)} ${line}`])

  useEffect(() => {
    log(
      `build ${typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'dev'}; capture ${canvas.width}×${canvas.height} at ratio ${pending.ratio}; ${navigator.userAgent.replace(/^.*?(Chrome\/[\d.]+).*$/, '$1')} ${navigator.platform}; in ${location.protocol === 'chrome-extension:' ? 'extension tab' : 'the page'}`
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Diagnostics: every key and every change of focus, as the page sees them.
  useEffect(() => {
    if (!prefs.diagnostics) return
    const el = (t: EventTarget | null) =>
      t instanceof Element ? `${t.tagName.toLowerCase()}.${t.className || '-'}` : String(t)
    const onKey = (e: KeyboardEvent) =>
      log(
        `key ${e.code || '(no code)'} "${e.key}"${e.shiftKey ? ' shift' : ''}${e.altKey ? ' alt' : ''}${e.ctrlKey ? ' ctrl' : ''}${e.metaKey ? ' meta' : ''} on ${el(e.target)}`
      )
    const onFocusIn = (e: FocusEvent) => log(`focus → ${el(e.target)}`)
    const onBlur = () => log('window lost focus')
    const onFocus = () => log(`window focused; active ${el(document.activeElement)}`)
    log(`diagnostics on; active ${el(document.activeElement)}; hasFocus ${document.hasFocus()}`)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocusIn, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [prefs.diagnostics])

  // Nothing here may fail silently: rendering errors and unhandled
  // rejections are said in the toast, with the browser's words.
  useEffect(() => {
    const onError = (e: ErrorEvent) => flash(`Error — ${e.message}`)
    const onReject = (e: PromiseRejectionEvent) =>
      flash(`Error — ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onReject)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onReject)
    }
  }, [flash])

  return (
    <>
      <Annotate
        shot={canvas}
        ratio={pending.ratio}
        pageUrl={pending.pageUrl}
        withBar={prefs.addressBar}
        onCancel={onClose}
        onCopied={prefs.afterCopy === 'close' ? onClose : () => undefined}
        onSay={flash}
        onLog={prefs.diagnostics ? log : undefined}
      />
      <Toast msg={toast} />
      {prefs.diagnostics && (
        <pre className="diag" aria-label="Diagnostics">
          {lines.join('\n')}
        </pre>
      )}
    </>
  )
}
