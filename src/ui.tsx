import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentProps, MouseEvent, ReactNode, RefObject } from 'react'

/**
 * The slice of artc's `ui/` the annotate surface needs: a popover wrapper
 * with the dismissal manners, the clipboard write, a toast, and two hooks.
 */

export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/** Close on a press outside, on Escape, and on the window losing focus. */
export function useDismiss<E extends HTMLElement>(
  isOpen: boolean,
  onDismiss: () => void,
  { alsoInside }: { alsoInside?: RefObject<HTMLElement | null> } = {}
) {
  const wrap = useRef<E>(null)
  const latest = useLatest(onDismiss)

  useEffect(() => {
    if (!isOpen) return
    let blurAsk: ReturnType<typeof setTimeout>
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrap.current?.contains(t)) return
      if (alsoInside?.current?.contains(t)) return
      latest.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      latest.current()
    }
    const onBlur = () => {
      blurAsk = setTimeout(() => {
        if (document.hasFocus()) latest.current()
      })
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimeout(blurAsk)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [isOpen, latest, alsoInside])

  return wrap
}

/** A control, and the panel it opens beside itself. Placement is the
 *  caller's, via `variant` — the wrapper's class. */
export function Menu({
  isOpen,
  onDismiss,
  variant,
  stopsClicks = false,
  children,
}: {
  isOpen: boolean
  onDismiss: () => void
  variant: string
  stopsClicks?: boolean
  children: ReactNode
}) {
  const wrap = useDismiss<HTMLDivElement>(isOpen, onDismiss)
  return (
    <div className={variant} ref={wrap} onClick={stopsClicks ? stopClick : undefined}>
      {children}
    </div>
  )
}

function stopClick(e: MouseEvent) {
  e.stopPropagation()
}

/**
 * Put a picture on the clipboard. Resolves to null when it landed, or to the
 * browser's own reason when it did not — "Document is not focused" and
 * "Write permission denied" are the two that happen in practice, and they
 * need different fixes, so the toast says which.
 *
 * Takes the PNG as a PROMISE and hands that promise to the clipboard. The
 * write is called synchronously, inside the keypress or click that asked
 * for it; the bytes arrive later. The other order — encode first, then
 * write — encodes a 5K retina capture for several seconds, by which time
 * Chrome's activation window has closed and the write is refused as if
 * nobody pressed anything.
 */
export function copyImage(png: Blob | Promise<Blob>): Promise<string | null> {
  try {
    if (typeof ClipboardItem === 'undefined')
      return Promise.resolve('no ClipboardItem in this browser')
    return navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
  } catch (e) {
    return Promise.resolve(e instanceof Error ? e.message : String(e))
  }
}

const FLASH_MS = 2400

/** A message that shows for a moment. */
export function useFlash(ms = FLASH_MS): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const flash = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current)
      setMsg(next)
      timer.current = setTimeout(() => setMsg(null), ms)
    },
    [ms]
  )
  return [msg, flash]
}

export function Toast({ msg }: { msg?: string | null }) {
  if (!msg) return null
  return (
    <div className="toast" role="status">
      {msg}
    </div>
  )
}

/**
 * MarkButton is a control whose whole face is a mark: `label` names it for
 * a reader who cannot see the mark, `tip` is the hint for one who can.
 * `inline` keeps the mark's own size and no box.
 */
export function MarkButton({
  label,
  tip,
  inline,
  className,
  children,
  ...rest
}: {
  label: string
  tip?: string
  inline?: boolean
  className?: string
  children: ReactNode
} & Omit<ComponentProps<'button'>, 'className' | 'children' | 'aria-label'>) {
  const classes = ['mark-btn', inline && 'inline', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} aria-label={label} data-tip={tip ?? label} {...rest}>
      {children}
    </button>
  )
}
