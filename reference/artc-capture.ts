/**
 * A photograph of the page, for a feedback report: the app as it stands, the
 * documents inside it, the strokes someone draws on top, and a PNG of all
 * three.
 *
 * **The picture is drawn rather than filmed.** `html-to-image` walks the DOM,
 * inlines what it finds and rasterises it — no permission prompt, no picker,
 * nothing for the reader to allow. The browser's own capture API would give
 * truer pixels and asks to share the tab every single time, which is a dialog
 * between someone and the thing they were trying to report.
 *
 * The catch, and the interesting half of this file: **every document artc
 * shows lives in `sandbox="allow-scripts"`** — an opaque origin — so a
 * rasteriser up here cannot read a word of it, and the shot comes back with a
 * white rectangle where the document was. The frame photographs itself
 * instead: it hands over its own markup (`shoot`, in the bridge in
 * `app/src/api.rs`), and that markup is drawn here inside an
 * `<img src="data:image/svg+xml,…<foreignObject>">`, which renders HTML and
 * runs nothing, loads nothing and reaches nothing. The artifact stays as inert
 * out here as it is untrusted in there.
 *
 * What that costs, said plainly. A foreignObject image fetches nothing, so
 * anything the document did not carry with it — an image at a URL, a font from
 * a server — is absent from the picture. Everything artc renders itself is
 * inline, so this shows up as a missing picture inside somebody's uploaded
 * HTML, not as a blank report.
 *
 * And the markup is re-laid-out as XML rather than HTML on the way in, which
 * for a document with **no doctype** means it is laid out in standards mode
 * having been written in quirks mode. The difference is the quirks margin
 * rules: a line or so of vertical drift near the top, on uploaded HTML that
 * omits its doctype. Everything artc renders carries one.
 */

/** The device pixels per CSS pixel the page is drawn at. High enough that
 *  13px type is readable in the report, low enough that a wide screen is a
 *  couple of megabytes rather than eight. */
const PIXEL_RATIO = 1.5

/** The address bar across the top of the picture: its height, the inset its
 *  furniture stands off by, the three lights and the field between them. CSS
 *  pixels — the bar is drawn at `PIXEL_RATIO` like everything else. */
const BAR_H = 38
const BAR_PAD = 12
const LIGHT = 11
const LIGHT_GAP = 8
const FIELD_H = 22
const FIELD_R = 6
const FIELD_PAD = 10
const ADDRESS_SIZE = 12

/** How long the frames get to answer before the picture is taken without
 *  them. They answer in a few milliseconds; this is here so a frame that is
 *  wedged cannot wedge the report. */
const FRAME_MS = 2_000

/** Kept out of the shot: the widget's own furniture, which is on screen at the
 *  moment the picture is drawn and is not part of anybody's report. */
const skipOurs = (node: Node): boolean =>
  !(node instanceof HTMLElement && node.hasAttribute('data-feedback-skip'))

/**
 * The page as it looks right now, documents and all.
 *
 * Order matters: the frames are asked for their pictures FIRST, because the
 * asking is a round trip and the rasterise below is synchronous work that
 * would otherwise sit in front of it.
 */
export async function freezePage(): Promise<HTMLCanvasElement> {
  const frames = await Promise.all(
    [...document.querySelectorAll('iframe')].map(async (frame) => ({
      frame,
      shot: await askFrame(frame),
    }))
  )
  const page = await rasterise()
  const ink = page.getContext('2d')
  if (!ink) throw new Error('capture: no 2d context')
  for (const { frame, shot } of frames) {
    if (!shot) continue
    const box = frame.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    ink.drawImage(
      shot,
      box.left * PIXEL_RATIO,
      box.top * PIXEL_RATIO,
      box.width * PIXEL_RATIO,
      box.height * PIXEL_RATIO
    )
  }
  return page
}

/**
 * The app's own pixels — everything except the frames.
 *
 * `html-to-image` is imported here rather than at the top of the file so it
 * stays out of the bundle until somebody presses the button: it is the one
 * dependency this feature adds, and most sessions never open it.
 *
 * What scrolls is the question this has to get right — see `holdPage`, which
 * is what makes rasterising the body enough, and which also holds every row
 * that is on one line ON one line.
 */
async function rasterise(): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image')
  const release = holdPage()
  try {
    return await toCanvas(document.body, {
      pixelRatio: PIXEL_RATIO,
      filter: skipOurs,
      width: window.innerWidth,
      height: window.innerHeight,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: 'top left',
      },
    })
  } finally {
    release()
  }
}

/** Overflow values that make an element a scroll container. */
const SCROLLS = /(auto|scroll|overlay)/

/**
 * Every scroller on the page, held still for the moment the picture is taken.
 * Returns the undo.
 *
 * artc pins the document — `.app` is `height: 100vh` — and scrolls panes
 * inside it, so `window.scrollY` is 0 and everything a reader has actually
 * scrolled is an inner box: the comment rail, the document pane, a list. Two
 * things go wrong there, and both come back as "that is not the page I was
 * looking at":
 *
 *   - **A clone starts at the top.** `html-to-image` copies computed styles,
 *     and scroll position is not one of them — a rail somebody had scrolled
 *     halfway down comes back showing its first card. So the offset is moved
 *     out of `scrollTop`, which the clone cannot see, and into a transform,
 *     which it can. The two are exchanged in the same frame and cancel, so
 *     nothing moves on screen while it happens.
 *   - **A clone draws its own scrollbar.** The app's are overlay scrollbars:
 *     over the content while it moves, gone at rest. The render inside the
 *     SVG has no such thing and paints a classic track, arrows and all, down
 *     the edge of every scroller — a column of chrome the reader never saw,
 *     where the rail's own margin should be. `scrollbar-width: none` takes it
 *     out; where the platform really was reserving a gutter for it, the same
 *     width goes back as padding so nothing reflows.
 *
 * One thing this is NOT: `position: sticky`-safe. A transform makes the child
 * a containing block, so a sticky heading inside a scroller would stick to the
 * wrong thing. artc has no `position: sticky` anywhere today — if one arrives
 * inside a scroller, it will need translating by `scrollTop` instead of with
 * the rest of the content.
 */
function holdPage(): () => void {
  const undo: Array<() => void> = []
  for (const node of document.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(node)
    holdOneLine(node, style, undo)

    const down = SCROLLS.test(style.overflowY) && node.scrollHeight > node.clientHeight
    const across = SCROLLS.test(style.overflowX) && node.scrollWidth > node.clientWidth
    if (!down && !across) continue

    // Measured before the scrollbar goes, because taking it away is what
    // makes a reserved gutter collapse.
    const edges = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
    const gutter = Math.max(0, Math.round(node.offsetWidth - node.clientWidth - edges))
    const was = {
      bar: node.style.scrollbarWidth,
      pad: node.style.paddingRight,
      ease: node.style.scrollBehavior,
      top: node.scrollTop,
      left: node.scrollLeft,
    }
    node.style.scrollbarWidth = 'none'
    if (gutter) node.style.paddingRight = `${parseFloat(style.paddingRight) + gutter}px`

    const kids = [...node.children] as HTMLElement[]
    const kidWas = kids.map((kid) => kid.style.transform)
    if (was.top || was.left) {
      for (const kid of kids) kid.style.transform = `translate(${-was.left}px, ${-was.top}px)`
      // Instant, or a pane set to scroll smoothly animates back to the top
      // in the middle of the picture.
      node.style.scrollBehavior = 'auto'
      node.scrollTop = 0
      node.scrollLeft = 0
    }
    undo.push(() => {
      node.style.scrollbarWidth = was.bar
      node.style.paddingRight = was.pad
      kids.forEach((kid, i) => (kid.style.transform = kidWas[i]))
      node.scrollTop = was.top
      node.scrollLeft = was.left
      node.style.scrollBehavior = was.ease
    })
  }
  return () => {
    for (const step of undo) step()
  }
}

/**
 * A row that is on one line, kept on one line.
 *
 * **Why a picture of the page can lay out differently from the page.**
 * `html-to-image` gives the clone no stylesheet at all: every element instead
 * carries the computed style it had up here, written out as inline CSS. That
 * has to include the used `width` — without it a sidebar styled `width: 300px`
 * would collapse to its text — and a used width is a fraction:
 * `.docs-page-actions` on the documents index is **297.734375px**. But
 * `getComputedStyle` serialises to three decimals, so what the clone is handed
 * is `297.734px`, which the engine then snaps to **297.71875px**.
 *
 * The container loses a sixty-fourth of a pixel. Its contents do not — each
 * button is pinned at its own full-precision width. A row whose three buttons
 * came to exactly the width they had to fit in therefore no longer fits, and
 * the last one wraps onto a line of its own, behind whatever is under it. That
 * is a picture of a layout bug the reader never had, in a report about
 * something else.
 *
 * So a row that is on one line at the moment the button is pressed is pinned
 * `nowrap` for the length of the picture. The sixty-fourth still goes missing;
 * it now costs an invisible fraction of overflow instead of a wrapped line.
 *
 * **Only rows that are already on one line.** A row the reader can see wrapped
 * is left exactly as it is, because its wrapping is part of what they are
 * reporting. Counting lines by vertical overlap rather than by equal tops is
 * what makes that safe under `align-items: center`, where two things on one
 * line start at different heights; and the way it fails — two lines read as
 * three, so nothing is pinned — costs a fix, never a wrong picture.
 */
function holdOneLine(node: HTMLElement, style: CSSStyleDeclaration, undo: Array<() => void>): void {
  if (!FLEX.test(style.display)) return
  if (style.flexWrap === 'nowrap') return
  // A column wraps into more columns; the width it would lose is not what
  // decides where its items go.
  if (style.flexDirection.startsWith('column')) return
  if (lineCount(node) !== 1) return
  const was = node.style.flexWrap
  node.style.flexWrap = 'nowrap'
  undo.push(() => {
    node.style.flexWrap = was
  })
}

/** Displays whose children are flex items. */
const FLEX = /(^|\s)(inline-)?flex$/

/**
 * How many lines this container's children sit on right now.
 *
 * `display: contents` children are stepped through rather than measured: such
 * an element has no box of its own — artc groups buttons behind one — and
 * measuring it would report a row of three items as a row of one.
 */
function lineCount(node: HTMLElement): number {
  const spans: Array<{ top: number; bottom: number }> = []
  const collect = (parent: HTMLElement): void => {
    for (const kid of parent.children) {
      if (!(kid instanceof HTMLElement)) continue
      if (getComputedStyle(kid).display === 'contents') {
        collect(kid)
        continue
      }
      const box = kid.getBoundingClientRect()
      if (box.width || box.height) spans.push({ top: box.top, bottom: box.bottom })
    }
  }
  collect(node)
  if (!spans.length) return 1
  spans.sort((a, b) => a.top - b.top)
  let lines = 1
  let floor = spans[0].bottom
  for (const span of spans.slice(1)) {
    // Overlap means the same line: things centred against each other on one
    // row start at different heights, and are still one row.
    if (span.top >= floor) {
      lines += 1
      floor = span.bottom
    } else if (span.bottom > floor) {
      floor = span.bottom
    }
  }
  return lines
}

/**
 * Ask one frame for a picture of itself, and turn its answer into something
 * drawable.
 *
 * Null on anything at all — a frame with no bridge in it, a document that
 * refused to serialise, markup an image will not parse, a frame that never
 * answers. A report missing one picture is worth having; a report that could
 * not be sent because a frame was slow is not.
 */
async function askFrame(frame: HTMLIFrameElement): Promise<HTMLImageElement | null> {
  const said = await new Promise<FrameShot | null>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve(null)
    }, FRAME_MS)
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.contentWindow) return
      const said = e.data as FrameShot | undefined
      if (!said || said.source !== 'artc-artifact' || said.type !== 'shot') return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(said)
    }
    window.addEventListener('message', onMessage)
    // '*' rather than an origin: the frame is sandboxed to an opaque one,
    // which no origin string can name.
    frame.contentWindow?.postMessage({ source: 'artc-host', type: 'shoot' }, '*')
  })
  if (!said?.html || !said.w || !said.h) return null
  return drawable(said)
}

interface FrameShot {
  source: string
  type: string
  html: string
  w: number
  h: number
}

/**
 * The frame's markup as an image.
 *
 * The `<foreignObject>` is what makes this safe: an SVG loaded through `<img>`
 * is a picture, not a document — no script runs, no request goes out, nothing
 * reaches back. It is also what makes a malformed document produce nothing at
 * all rather than half a picture, since the image parses the SVG as XML.
 */
function drawable(shot: FrameShot): Promise<HTMLImageElement | null> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${shot.w}" height="${shot.h}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${shot.html}</foreignObject></svg>`
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** After the next two frames, so freshly-rendered DOM is actually on screen —
 *  what the widget waits on before it draws the page. */
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
export function withAddressBar(page: HTMLCanvasElement, url: string): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = page.width
  out.height = page.height + Math.round(BAR_H * PIXEL_RATIO)
  const ink = out.getContext('2d')
  if (!ink) throw new Error('capture: no 2d context')

  // Everything below is written in CSS pixels and drawn at the picture's own
  // density, which is the only way the 12px address stays as crisp as the
  // 13px type in the screenshot under it.
  ink.scale(PIXEL_RATIO, PIXEL_RATIO)
  const width = page.width / PIXEL_RATIO
  const tone = getComputedStyle(document.documentElement)
  const paint = (name: string) => tone.getPropertyValue(name).trim()

  ink.fillStyle = paint('--sp-paper')
  ink.fillRect(0, 0, width, BAR_H)
  // The hairline where the chrome ends and the page begins. Without it a pale
  // bar over a pale page is a picture that appears to start with a blank inch.
  ink.fillStyle = paint('--sp-border-strong')
  ink.fillRect(0, BAR_H - 1, width, 1)

  // The three lights, in the app's own red, amber and green — the shape that
  // says "this is a window" faster than any label could.
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

  // The host in the page's own ink and the rest of the address muted, the way
  // every browser draws it: what site this is, then where in it.
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

  // The page itself, under the chrome, at exactly the size it was taken.
  ink.drawImage(page, 0, BAR_H, width, page.height / PIXEL_RATIO)
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
