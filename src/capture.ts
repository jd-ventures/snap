/**
 * Drawing helpers for the annotate surface. Lifted from artc's capture.ts
 * with the DOM rasteriser removed: in an extension the picture comes from
 * `chrome.tabs.captureVisibleTab`, so nothing here walks a DOM.
 *
 * What remains is pure canvas arithmetic: letterboxing (`fitRect`), baking
 * the ink sheet onto a copy of the shot (`withStrokes`), the address bar
 * drawn across the top of what leaves (`withAddressBar`), and PNG encoding.
 */
import { token } from './theme'

const BAR_H = 38
const BAR_PAD = 12
const LIGHT = 11
const LIGHT_GAP = 8
const FIELD_H = 22
const FIELD_R = 6
const FIELD_PAD = 10
const ADDRESS_SIZE = 12

/** A data: URL (what `captureVisibleTab` returns) as a canvas at its own
 *  pixel size. */
export async function fromDataUrl(url: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('capture: the image would not decode'))
    img.src = url
  })
  const out = document.createElement('canvas')
  out.width = img.naturalWidth
  out.height = img.naturalHeight
  const ink = out.getContext('2d')
  if (!ink) throw new Error('capture: no 2d context')
  ink.drawImage(img, 0, 0)
  return out
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Where the shot sits inside a box, letterboxed: the largest rectangle with
 *  the shot's own proportions that fits. The annotate surface draws the
 *  picture at this rectangle and takes strokes in it, so a mark lands where it
 *  was drawn whatever shape the capture came back. */
export function fitRect(
  shot: { width: number; height: number },
  box: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const scale = Math.min(box.width / shot.width, box.height / shot.height)
  const width = Math.round(shot.width * scale)
  const height = Math.round(shot.height * scale)
  return {
    left: Math.round((box.width - width) / 2),
    top: Math.round((box.height - height) / 2),
    width,
    height,
  }
}

/**
 * The strokes, baked onto a copy of the shot at the shot's own resolution.
 *
 * A copy rather than the shot itself: the surface stays open after a copy or a
 * cancelled send, and compositing in place would bake the same boxes twice.
 */
export function withStrokes(
  shot: HTMLCanvasElement,
  strokes: HTMLCanvasElement
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = shot.width
  out.height = shot.height
  const ink = out.getContext('2d')
  if (!ink) throw new Error('capture: no 2d context')
  ink.drawImage(shot, 0, 0)
  // The strokes are drawn at the size the picture is displayed at; scaling
  // them up here is what keeps a box around a word around that word.
  ink.drawImage(strokes, 0, 0, out.width, out.height)
  return out
}

/**
 * The address bar: a strip across the top of the picture carrying the URL of
 * the page it is a picture of.
 *
 * A screenshot on its own says what was on screen and not WHERE — and "where"
 * is the first thing anyone reading the report asks, especially for a report
 * about a list that looks like three other lists. The URL is on the report's
 * row either way (`page_url`), but a row is not what gets pasted into a
 * thread, dragged into a chat, or looked at six months later. The picture is.
 *
 * Drawn as a browser rather than as a caption for the same reason a screenshot
 * of a browser reads instantly: three lights and an address field are a shape
 * people parse before they read. It is chrome around the app's own pixels, not
 * over them — the page keeps every pixel it had, and the picture grows by the
 * strip.
 *
 * Tones and the face come off the stylesheet, so a capture taken in the dark
 * theme wears a dark bar: this file names no colour of its own.
 */
/**
 * The address bar: a strip across the top of the picture carrying the URL of
 * the page it is a picture of, drawn as a browser — three lights and a
 * field — because that shape is read before any caption is. Drawn at
 * `ratio` device pixels per CSS pixel, the capture's own density, so its
 * 12px type is as crisp as the page under it. Tones come off the stylesheet
 * through `token`, so this file names no colour.
 */
export function withAddressBar(
  page: HTMLCanvasElement,
  url: string,
  ratio: number
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = page.width
  out.height = page.height + Math.round(BAR_H * ratio)
  const ink = out.getContext('2d')
  if (!ink) throw new Error('capture: no 2d context')

  ink.scale(ratio, ratio)
  const width = page.width / ratio
  const paint = token

  ink.fillStyle = paint('--sp-paper')
  ink.fillRect(0, 0, width, BAR_H)
  ink.fillStyle = paint('--sp-border-strong')
  ink.fillRect(0, BAR_H - 1, width, 1)

  const lights = ['--sp-annotate', '--sp-amber', '--sp-green']
  lights.forEach((one, i) => {
    ink.beginPath()
    ink.arc(BAR_PAD + LIGHT / 2 + i * (LIGHT + LIGHT_GAP), BAR_H / 2, LIGHT / 2, 0, Math.PI * 2)
    ink.fillStyle = paint(one)
    ink.fill()
  })

  const fieldX = BAR_PAD + 3 * LIGHT + 2 * LIGHT_GAP + BAR_PAD
  const fieldW = Math.max(0, width - fieldX - BAR_PAD)
  const fieldY = (BAR_H - FIELD_H) / 2
  ink.beginPath()
  round(ink, fieldX, fieldY, fieldW, FIELD_H, FIELD_R)
  ink.fillStyle = paint('--sp-bg')
  ink.fill()
  ink.strokeStyle = paint('--sp-border')
  ink.lineWidth = 1
  ink.stroke()

  const face = paint('--sp-font-mono') || 'monospace'
  ink.font = `${ADDRESS_SIZE}px ${face}`
  ink.textBaseline = 'middle'
  const room = fieldW - 2 * FIELD_PAD
  const parts = split(url)
  const host = clip(ink, parts.host, room)
  const rest = clip(ink, parts.rest, room - ink.measureText(host).width)
  const middle = fieldY + FIELD_H / 2
  ink.fillStyle = paint('--sp-text')
  ink.fillText(host, fieldX + FIELD_PAD, middle)
  ink.fillStyle = paint('--sp-text-muted')
  ink.fillText(rest, fieldX + FIELD_PAD + ink.measureText(host).width, middle)

  ink.drawImage(page, 0, BAR_H, width, page.height / ratio)
  return out
}

/** The address, in the two pieces a browser colours differently. An address
 *  that will not parse is not an error — it is printed as it stands. */
function split(url: string): { host: string; rest: string } {
  try {
    const at = new URL(url)
    // The scheme goes, as it does in every address bar, unless it is one worth
    // seeing: a report from a `file://` or a `localhost` is about that.
    const scheme = at.protocol === 'https:' ? '' : `${at.protocol}//`
    return { host: scheme + at.host, rest: at.pathname + at.search + at.hash }
  } catch {
    return { host: '', rest: url }
  }
}

/** As much of a string as fits, with the tail said by an ellipsis. */
function clip(ink: CanvasRenderingContext2D, text: string, room: number): string {
  if (room <= 0) return ''
  if (ink.measureText(text).width <= room) return text
  let cut = text
  while (cut.length > 1 && ink.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** `roundRect` is everywhere artc runs, but a canvas without it should draw a
 *  square field rather than throw away the report. */
function round(
  ink: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ink.roundRect === 'function') ink.roundRect(x, y, w, h, r)
  else ink.rect(x, y, w, h)
}

/** A canvas as PNG bytes, which is what the report carries. */
export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('capture: the canvas produced no image'))
    }, 'image/png')
  })
}
