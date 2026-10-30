import { useCallback, useEffect, useRef, useState } from 'react'
import { fitRect, toPng, withAddressBar, withStrokes } from './capture'
import { ArrowGlyph, BoxGlyph, ChevronGlyph, CloseGlyph, CopyGlyph, TextGlyph } from './glyphs'
import { KEYS, useHotkey } from './keys'
import {
  markInk,
  MARK_INKS,
  MARK_INSIDES,
  useMarkInk,
  useMarkInside,
  type MarkInk,
  type MarkInside,
} from './marks'
import { token } from './theme'
import { copyImage, Menu, MarkButton, useLatest } from './ui'

/**
 * Marking up the capture: the picture, a transparent sheet over it, and three
 * ways to point at something.
 *
 * Ported from artc's Annotate.tsx (reference/artc-Annotate.tsx) with the
 * report removed: there is no Done-and-write-a-report here, only Copy. The
 * session controls that lived on the bar are gone with it. Everything about
 * drawing, picking up, moving, resizing, recolouring and undoing a mark is
 * unchanged, and so are the keys. Tokens are read through theme.ts so the
 * same code runs inside a shadow root in somebody else's page.
 *
 * The picture is letterboxed rather than stretched (`fitRect`), and the sheet
 * is exactly the picture's rectangle — so a box drawn round a word is round
 * that word whatever shape the capture came back, and a stroke's coordinates
 * need no correcting when they are baked in.
 *
 * **Nothing is baked in until you finish.** A mark is an object for as long as
 * the surface is open: click it to pick it up, drag it somewhere better, take
 * a corner to resize it, recolour or fill or delete it. Only Done (and Copy)
 * composite the sheet onto the capture — see `marked()`. A drawing that cannot
 * be adjusted is one you throw away and draw again, which is the slowest way
 * to say a small thing.
 *
 * THREE layers, and the middle one is the deliverable: the capture, the ink
 * (marks, and only marks — this is what `withStrokes` composites), and the
 * chrome (the selection's dashes and handles, which must never reach the
 * picture). The chrome canvas is on top, so it is also what the pointer talks
 * to. A fourth thing exists only in what LEAVES: the address bar, drawn across
 * the top of the finished picture by `marked()` and never across the one being
 * marked up.
 *
 * Marks are kept in a ref and painted by hand rather than held in state: a
 * drag repaints on every pointer move, and a React render per move is a render
 * per frame of a gesture that only ever changes one canvas. What IS state is
 * what the toolbar has to show — which mark is picked up, how deep the undo
 * stack is — because those change buttons rather than pixels.
 *
 * A note is typed in a field that stands where it will be painted, and a press
 * anywhere else puts it down without starting another — the next press does
 * that.
 *
 * The keyboard: Enter finishes, Escape lets go of the innermost thing (the
 * drag, then the selection, then the surface), Delete removes the mark in
 * hand, Cmd/Ctrl+Z steps back through everything done here, C copies the
 * picture and closes. **Holding Shift** flips the shape tool to text and back
 * — momentary, so a note is one held key away from wherever your hand already
 * is. That last one is a raw `keyup` listener rather than a `useHotkey`,
 * because a held modifier is a state and not a combo: nothing in a
 * discrete-shortcut hook can see the release.
 */
export function Annotate({
  shot,
  ratio,
  pageUrl,
  withBar,
  onCancel,
  onCopied,
  onSay,
  onLog,
}: {
  /** The captured frame, at the resolution the screen drew it. */
  shot: HTMLCanvasElement
  /** Device pixels per CSS pixel the capture was taken at — what the address
   *  bar is drawn at so its type matches the page's. */
  ratio: number
  /** The address of the page in the picture. Drawn across the top of the
   *  finished picture — not of the one being marked up; see `marked()`. */
  pageUrl: string
  /** Whether the address bar is drawn across the top of what leaves. */
  withBar: boolean
  /** Throw the capture away. */
  onCancel: () => void
  /** The picture is on the clipboard. The page decides whether that closes
   *  the surface — a setting — so the surface does not. */
  onCopied: () => void
  /** A line for the reader: what the clipboard did. The surface has no toast
   *  of its own — the page owns the one for the whole flow. */
  onSay: (msg: string) => void
  /** A line for the diagnostics panel, when it is on. */
  onLog?: (line: string) => void
}) {
  const pictureRef = useRef<HTMLCanvasElement | null>(null)
  const inkRef = useRef<HTMLCanvasElement | null>(null)
  const chromeRef = useRef<HTMLCanvasElement | null>(null)
  const marksRef = useRef<Mark[]>([])
  // Every state the marks have been in, oldest first. Undo is a step back
  // through this rather than a lopped-off last mark: once a mark can be moved,
  // recoloured and deleted, "take back the last one" is not what was last
  // done.
  const pastRef = useRef<Mark[][]>([])
  const gestureRef = useRef<Gesture | null>(null)
  const faceRef = useRef<string>('')
  // The two tones the selection is drawn in — the page's own text and paper,
  // read off the stylesheet like the face below it, so this file names no
  // colour.
  const toneRef = useRef<{ line: string; fill: string }>({ line: '', fill: '' })
  const paletteRef = useRef<Map<string, MarkInk>>(new Map())
  // The colour of the note being re-opened, if it is one that already exists:
  // editing a green note under a red nib must not turn it red.
  const noteInkRef = useRef<string | null>(null)
  // A press that lands while a note is being typed puts that note down and
  // does nothing else — see `onPointerDown`.
  const putsNoteDownRef = useRef(false)
  // The colour last used, kept in this browser: someone who marks up in green
  // once means it, and meant it about the next capture too.
  const { ink, setInk, colour } = useMarkInk()
  // What is inside a box: nothing, a wash, or a slab. The colour is the
  // mark's own — one colour per mark, because a green ring round an amber
  // wash is a choice nobody marking up a screenshot has ever needed, and two
  // colour controls in a bar this size is most of what the bar looks like.
  const { inside, setInside } = useMarkInside()
  const [isPicking, setPicking] = useState(false)
  const [isShiftHeld, setIsShiftHeld] = useState(false)
  const [rect, setRect] = useState(() => fitRect(shot, viewport()))
  const [tool, setTool] = useState<Tool>('box')
  // The shape to come back to when Shift is released out of the text tool.
  const [lastShape, setLastShape] = useState<Tool>('box')
  const [undoDepth, setUndoDepth] = useState(0)
  /** The mark in hand, by index. What the swatch shows, what a colour taken
   *  from it recolours, and what Delete removes. */
  const [picked, setPicked] = useState<number | null>(null)
  const [noteAt, setNoteAt] = useState<Point | null>(null)
  // The bar, out of the way. A capture is often ABOUT the bottom of the page,
  // and the tools stand exactly there — so they drop away and leave a bump to
  // bring them back, rather than making you work around them.
  const [isTucked, setTucked] = useState(false)
  const [note, setNote] = useState('')
  // What the pointer is over: a mark to pick up, a handle to pull. Null leaves
  // the tool's own cursor, which the stylesheet sets.
  const [cursor, setCursor] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  // The field's own box, measured from the words in it, and the chrome it
  // wears — see the effect below.
  const [noteSize, setNoteSize] = useState({ width: 0, height: 0 })
  const [notePad, setNotePad] = useState({ x: 0, y: 0 })

  // The sheet takes focus the moment the surface stands, so `C` and Enter
  // reach it wherever the keyboard was. A note being typed takes focus back
  // when it opens (`autoFocus`) and hands it here again when it closes.
  useEffect(() => {
    if (!noteAt) chromeRef.current?.focus({ preventScroll: true })
  }, [noteAt])

  // The window can change size while the surface is open — a rotated phone, a
  // dragged edge — and the picture is only in the right place if the
  // rectangle follows it. The marks are in picture space, so they come along.
  useEffect(() => {
    const onResize = () => setRect(fitRect(shot, viewport()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [shot])

  // The face a mark is written in is the theme's, read off the stylesheet
  // rather than named here — this file names no colour and no font, the way
  // nothing in `src/` does. Read once: `getComputedStyle` is a style
  // recalculation, and a drag repaints every mark on every pointer move.
  useEffect(() => {
    faceRef.current = token('--sp-font-display')
    toneRef.current = { line: token('--sp-text'), fill: token('--sp-paper') }
    // Which ink a mark is drawn in, backwards: a mark carries the colour it is
    // painted with, and the toolbar has to show which swatch that was. Built
    // once here rather than resolved per render, for the same reason the face
    // is.
    paletteRef.current = new Map(MARK_INKS.map((one) => [markInk(one), one]))
  }, [])

  // Holding Shift flips the shape tool to text and back. Momentary, so it is
  // one key rather than a trip to the toolbar — and a state rather than a
  // combo, which is why this is a listener and not a `useHotkey`.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftHeld(false)
    }
    // A window that loses focus mid-hold never sends the keyup, and the tool
    // would stay flipped for as long as the surface is open.
    const blur = () => setIsShiftHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  /**
   * Both sheets, from the marks as they stand.
   *
   * `overlay` is the mark under the hand: `at: null` for one being drawn, an
   * index for the one being moved or resized — which is painted INSTEAD of the
   * mark it stands for, so a drag shows where the mark is going without the
   * marks themselves changing until the pointer comes up.
   */
  const draw = useCallback(
    (overlay: Overlay, pick: number | null) => {
      const ink = inkRef.current?.getContext('2d')
      const chrome = chromeRef.current?.getContext('2d')
      if (!ink || !chrome) return
      ink.clearRect(0, 0, rect.width, rect.height)
      chrome.clearRect(0, 0, rect.width, rect.height)
      const face = faceRef.current
      const shown =
        overlay && overlay.at !== null
          ? marksRef.current.map((mark, i) => (i === overlay.at ? overlay.mark : mark))
          : marksRef.current
      for (const mark of shown) paint(ink, mark, face)
      if (overlay && overlay.at === null) paint(ink, overlay.mark, face)
      const chosen = pick === null ? null : shown[pick]
      if (chosen) paintChrome(chrome, chosen, ink, face, toneRef.current)
    },
    [rect.width, rect.height]
  )

  // All three canvases are backed at the screen's own pixel density and then
  // sized down in CSS: a 3px line on a 2x display is six device pixels, and a
  // stroke drawn at CSS resolution is visibly soft next to the crisp
  // screenshot under it.
  useEffect(() => {
    const ratio = window.devicePixelRatio || 1
    for (const canvas of [pictureRef.current, inkRef.current, chromeRef.current]) {
      if (!canvas) continue
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      canvas.getContext('2d')?.scale(ratio, ratio)
    }
    const picture = pictureRef.current?.getContext('2d')
    if (picture) picture.drawImage(shot, 0, 0, rect.width, rect.height)
  }, [shot, rect])

  // Every settled change repaints from here rather than from its own handler:
  // a mark added, moved, recoloured, filled, deleted or stepped back to shows
  // up as a change of depth or of what is picked up, and both are state. Only
  // the frames of a gesture in hand call `draw` directly, with the overlay.
  useEffect(() => {
    draw(null, picked)
  }, [draw, picked, undoDepth])

  /**
   * The note field, sized to what is in it.
   *
   * The field is a PREVIEW of a mark that is painted line by line, so the two
   * have to break in the same places: the field never soft-wraps, and instead
   * grows to the widest line as it is typed. Its width comes from the ink
   * sheet's own `measureText` in the very font the note is painted in, so what
   * stands here is the size the mark will be.
   *
   * The chrome — padding, border, and the half-leading CSS puts above the
   * first line — is measured rather than named, and the field is then offset
   * by it so the words sit exactly where the painted note will: what you type
   * does not shift when you place it.
   */
  useEffect(() => {
    const field = noteRef.current
    const gauge = inkRef.current?.getContext('2d')
    if (!field || !gauge || !noteAt) return
    const box = getComputedStyle(field)
    const px = (value: string) => parseFloat(value) || 0
    const padX = px(box.paddingLeft) + px(box.paddingRight) + px(box.borderLeftWidth) * 2
    const padY = px(box.paddingTop) + px(box.paddingBottom) + px(box.borderTopWidth) * 2
    gauge.font = noteFace(faceRef.current)
    // Empty, it is as wide as the words asking for words: a field that says
    // "Type a note" and shows "Type a no" is a field that looks broken before
    // it has been used.
    const lines = (note || NOTE_ASKS).split('\n')
    const widest = Math.max(...lines.map((line) => gauge.measureText(line).width))
    setNoteSize({
      // A caret's worth of room past the last letter, or typing the character
      // that grows the field puts the caret against its own border.
      width: Math.ceil(Math.max(widest + NOTE_SIZE, MIN_NOTE_WIDTH)) + padX,
      height: Math.ceil(lines.length * NOTE_LEADING) + padY,
    })
    setNotePad({
      x: px(box.paddingLeft) + px(box.borderLeftWidth),
      // CSS hangs half the leading above the first line; the canvas draws from
      // the top of the em box. Without that half, a placed note jumps up by
      // three pixels the moment it stops being a field.
      y: px(box.paddingTop) + px(box.borderTopWidth) + (NOTE_LEADING - NOTE_SIZE) / 2,
    })
  }, [note, noteAt])

  // What the hand is holding right now. Shift flips a shape to text and text
  // back to the shape it came from, so the flip is reversible without the
  // toolbar — and a shift held while a note is being typed is a capital
  // letter, not a tool change.
  const activeTool: Tool = isShiftHeld && !noteAt ? (tool === 'note' ? lastShape : 'note') : tool
  const chosen = picked === null ? null : (marksRef.current[picked] ?? null)
  /** What the next mark is drawn with. */
  const nib: Paint = { color: colour, inside }
  /** Which swatch a painted colour was. */
  const inkOf = (paint: string | null) => (paint ? (paletteRef.current.get(paint) ?? null) : null)
  // A mark picked up speaks for itself: the swatch shows ITS colour and ITS
  // inside, so what the toolbar says and what is selected cannot disagree.
  const shownInk = (chosen && inkOf(chosen.color)) ?? ink
  const shownInside = chosen?.kind === 'box' ? chosen.inside : inside

  /** The one way the marks change. Remembering first is what makes Undo a step
   *  back through the work rather than through the drawing only. */
  const setMarks = (next: Mark[]) => {
    pastRef.current = [...pastRef.current, marksRef.current]
    marksRef.current = next
    setUndoDepth(pastRef.current.length)
  }

  const replace = (at: number, mark: Mark) =>
    setMarks(marksRef.current.map((one, i) => (i === at ? mark : one)))

  const commit = (mark: Mark) => {
    setMarks([...marksRef.current, mark])
    setPicked(marksRef.current.length - 1)
  }

  const undo = () => {
    const back = pastRef.current[pastRef.current.length - 1]
    if (!back) return
    pastRef.current = pastRef.current.slice(0, -1)
    marksRef.current = back
    setUndoDepth(pastRef.current.length)
    // The mark that was in hand may not exist in the state being stepped back
    // to, and an index into the wrong array draws handles round a stranger.
    setPicked(null)
  }

  const remove = () => {
    if (picked === null) return
    setMarks(marksRef.current.filter((_, i) => i !== picked))
    setPicked(null)
  }

  const cancelDrag = () => {
    gestureRef.current = null
    draw(null, picked)
  }

  // Escape backs out of the innermost thing, the way it does everywhere else:
  // the note being typed (the textarea's own handler), then a drag in
  // progress, then the mark in hand, then the surface. Delete removes that
  // mark, and Cmd/Ctrl+Z steps back through the whole sitting.
  //
  // Registered ONCE, reading the latest handler through a ref, rather than
  // re-registered on every render. A listener that is removed and re-added
  // while a key event is being dispatched is skipped by that dispatch — the
  // browser walks the listeners it had when the event began — and any
  // earlier listener that sets state (the diagnostics logger) re-renders this
  // component between listeners. The old shape lost every Escape that way.
  // Capture phase and stopped: inside a host page, its own listeners must not
  // see the keys the surface takes.
  const onKeyLatest = useLatest((e: KeyboardEvent) => {
    if (noteAt) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (gestureRef.current) cancelDrag()
      else if (picked !== null) setPicked(null)
      else onCancel()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && picked !== null) {
      e.preventDefault()
      e.stopPropagation()
      remove()
      return
    }
    if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      undo()
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyLatest.current(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onKeyLatest])

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  /** The measuring context: the ink sheet, whose font a note's own bounds are
   *  a consequence of. Every hit test that involves a note needs it. */
  const gauge = () => inkRef.current?.getContext('2d') ?? null

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A press with a note open is a press that PUTS THAT NOTE DOWN, and
    // nothing more: the field's own blur commits it, and this press is
    // remembered so the release does not also start the next note where it
    // landed — one click was closing one field and opening another under the
    // pointer, so a note could not be finished without leaving an empty one
    // behind. The click after this one starts the next note.
    if (noteAt) {
      putsNoteDownRef.current = true
      return
    }
    const ink = gauge()
    if (!ink) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = pointOf(e)
    const face = faceRef.current

    // A corner of the mark already in hand, before anything else: the handles
    // sit ON the mark's edge, and a pull on one would otherwise read as a
    // grab of the mark itself.
    const grip = chosen ? handleUnder(chosen, at, ink, face) : null
    if (chosen && grip && picked !== null) {
      gestureRef.current = { kind: 'resize', at: picked, grip, origin: chosen }
      return
    }
    const over = topmostUnder(marksRef.current, at, ink, face)
    if (over !== null) {
      setPicked(over)
      gestureRef.current = { kind: 'move', at: over, from: at, origin: marksRef.current[over] }
      return
    }
    // Open ground: whatever was in hand is put down, and the tool draws. The
    // note tool draws nothing on the way down — its mark is placed where the
    // pointer comes up, which is also where the field opens.
    setPicked(null)
    if (activeTool === 'note') return
    gestureRef.current = { kind: 'draw', tool: activeTool, from: at }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ink = gauge()
    if (!ink) return
    const at = pointOf(e)
    const gesture = gestureRef.current
    const face = faceRef.current
    if (!gesture) {
      // Nothing in hand: say what the pointer is over. A cursor is the only
      // hint a canvas can give that the thing under it can be taken hold of.
      const grip = chosen ? handleUnder(chosen, at, ink, face) : null
      const over = grip ? null : topmostUnder(marksRef.current, at, ink, face)
      const next = grip ? GRIP_CURSORS[grip] : over !== null ? 'move' : null
      if (next !== cursor) setCursor(next)
      return
    }
    if (gesture.kind === 'draw') {
      draw({ mark: shape(gesture.tool, gesture.from, at, nib), at: null }, null)
      return
    }
    draw({ mark: dragged(gesture, at), at: gesture.at }, gesture.at)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (putsNoteDownRef.current) {
      putsNoteDownRef.current = false
      return
    }
    const at = pointOf(e)
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture) {
      // A press on open ground with the note tool: the field opens where the
      // pointer came up. A press that picked a mark up is not that.
      if (activeTool === 'note' && picked === null) {
        setNote('')
        noteInkRef.current = null
        setNoteAt(at)
      }
      return
    }
    if (gesture.kind === 'draw') {
      if (isBigEnough(gesture.tool, gesture.from, at)) {
        commit(shape(gesture.tool, gesture.from, at, nib))
      } else {
        draw(null, picked)
      }
      return
    }
    const moved = dragged(gesture, at)
    // A click that only picked a mark up is not a change, and an undo step
    // that undoes nothing is a press of Undo that appears to do nothing.
    if (isSame(moved, gesture.origin)) draw(null, gesture.at)
    else replace(gesture.at, moved)
  }

  /** Re-open a note that is already placed: the same field, at the same point,
   *  in the same ink. The mark comes out of the picture while it is being
   *  written, so the words are not drawn twice. */
  const editNote = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ink = gauge()
    if (!ink) return
    const at = pointOf(e)
    const over = topmostUnder(marksRef.current, at, ink, faceRef.current)
    if (over === null) return
    const mark = marksRef.current[over]
    if (mark.kind !== 'note') return
    setMarks(marksRef.current.filter((_, i) => i !== over))
    setPicked(null)
    noteInkRef.current = mark.color
    setNote(mark.text)
    setNoteAt({ x: mark.x, y: mark.y })
  }

  const commitNote = () => {
    const at = noteAt
    const text = note.trim()
    const shade = noteInkRef.current ?? colour
    setNoteAt(null)
    setNote('')
    noteInkRef.current = null
    if (at && text) commit({ kind: 'note', x: at.x, y: at.y, text, color: shade })
  }

  const pickTool = (next: Tool) => {
    setTool(next)
    if (next !== 'note') setLastShape(next)
  }

  /** The colour, and the mark in hand if there is one: a colour taken while
   *  something is picked up is a recolour of that thing, which is the only
   *  reading of it once a mark can still be changed. */
  const pickInk = (next: MarkInk) => {
    setInk(next)
    if (picked !== null && chosen) replace(picked, { ...chosen, color: markInk(next) })
  }

  /** What is inside a box, for the next one and for the one in hand. */
  const pickInside = (next: MarkInside) => {
    setInside(next)
    if (picked !== null && chosen?.kind === 'box') replace(picked, { ...chosen, inside: next })
  }

  /**
   * The picture as it stands, marks and all — the ink sheet only, so the
   * dashes and handles round whatever is in hand never reach it. A fresh
   * composite every time: `withStrokes` copies rather than baking into the
   * capture, so copying twice and then finishing does not draw the same box
   * three times.
   *
   * The address bar goes on HERE, at the end, and never on the picture being
   * marked up. Two reasons, and the second is the one that matters: a strip of
   * browser chrome across the top of the surface is a thing to draw a box
   * round by mistake and a thing the marks have to be measured past, and the
   * page you are pointing at should fill the sheet you are pointing at it on.
   * What leaves is a picture OF a page; what you draw on is the page.
   */
  const marked = () => {
    const strokes = inkRef.current
    const picture = strokes ? withStrokes(shot, strokes) : shot
    return withBar ? withAddressBar(picture, pageUrl, ratio) : picture
  }

  const copy = async () => {
    // Something on screen at once: on a large display the encode below is
    // seconds, and seconds of nothing read as a press that did nothing.
    onSay('Copying…')
    const t0 = performance.now()
    const log = (line: string) => onLog?.(`copy +${Math.round(performance.now() - t0)}ms: ${line}`)
    log('start')
    let picture: HTMLCanvasElement
    try {
      picture = marked()
      log(`composited ${picture.width}×${picture.height}`)
    } catch (e) {
      log(`compositing threw: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
    const png = toPng(picture).then(
      (blob) => {
        log(`encoded ${Math.round(blob.size / 1024)} KB`)
        return blob
      },
      (e: unknown) => {
        log(`encoding threw: ${e instanceof Error ? e.message : String(e)}`)
        throw e
      }
    )
    // The write is asked for NOW, in the gesture, with the bytes to follow —
    // see `copyImage` for why the order matters.
    const failed = await copyImage(png)
    log(failed ? `clipboard refused: ${failed}` : 'clipboard: ok')
    onSay(failed ? `Couldn’t copy — ${failed}. Try the Copy button.` : 'Copied the picture')
    return !failed
  }

  // Copy is the whole deliverable. Enter and `C` both do it. Only a success
  // reports up, so a refusal keeps the surface on screen to try again.
  const copyAndClose = async () => {
    try {
      if (await copy()) onCopied()
    } catch (e) {
      onSay(`Couldn’t make the picture — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Deaf while a note is being typed: its own Enter places the note and its
  // own Escape drops it, and neither belongs to the surface.
  useHotkey(KEYS.annotateDone, () => void copyAndClose(), !noteAt)
  useHotkey(KEYS.annotateCopy, () => void copyAndClose(), !noteAt)

  const style = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }

  return (
    <div className="annotate">
      <span className="annotate-flash" aria-hidden="true" />
      <canvas className="annotate-shot" ref={pictureRef} style={style} />
      <canvas className="annotate-ink" ref={inkRef} style={style} />
      {/* The sheet the pointer talks to. On top of the ink and never composited
          into the picture, which is what lets it carry the selection. */}
      <canvas
        className={activeTool === 'note' ? 'annotate-hand noting' : 'annotate-hand'}
        ref={chromeRef}
        tabIndex={-1}
        style={cursor ? { ...style, cursor } : style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={editNote}
      />
      {noteAt && (
        <textarea
          /* In the ink it will be painted in — a note re-opened in green is
             typed in green, not in whatever the nib is now. */
          className={`annotate-note ink-${inkOf(noteInkRef.current) ?? ink}`}
          ref={noteRef}
          autoFocus
          /* Never soft-wrapped: the field is a preview of a mark that is
             painted line by line, and a browser breaking a long line to fit a
             fixed width showed two lines and then drew one. The field grows
             instead, and a line break is Shift+Enter — the same key that makes
             one in the note. */
          wrap="off"
          value={note}
          // ui-exempt: live annotation geometry — the field sits where the
          // mark is being drawn, a measurement only this pointer knows.
          style={{
            left: rect.left + noteAt.x - notePad.x,
            top: rect.top + noteAt.y - notePad.y,
            width: noteSize.width,
            height: noteSize.height,
          }}
          /* Three words, because the field is exactly as wide as what is in it
             and a placeholder longer than that is a placeholder cut in half. */
          placeholder={NOTE_ASKS}
          aria-label="Note"
          // A note being re-opened arrives with its words already in it, and
          // Chrome parks the caret before them — the first thing typed lands
          // in front of what is already written.
          onFocus={(e) => e.currentTarget.setSelectionRange(note.length, note.length)}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setNoteAt(null)
              setNote('')
              noteInkRef.current = null
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitNote()
            }
          }}
        />
      )}
      {/* The handle and the bar, in one column so the handle sits exactly on the
          bar's top edge without either of them being told how tall the other
          is. ONE handle, and it never moves: the bar slides down from under it
          and back up to it, so the thing you press to put the tools away is the
          thing you press to get them back. It used to be two — a tab on the bar
          and a bump at the screen's edge — and tucking the bar left both on
          screen at once. */}
      <div className={isTucked ? 'annotate-dock tucked' : 'annotate-dock'}>
        <button
          className="annotate-bump"
          onClick={() => setTucked((was) => !was)}
          aria-label={isTucked ? 'Bring the tools back' : 'Get the tools out of the way'}
          aria-expanded={!isTucked}
          data-tip={isTucked ? 'Bring the tools back' : 'Out of the way'}
        >
          <ChevronGlyph />
        </button>
        <div className="annotate-tools" inert={isTucked}>
          <ToolButton tool="box" active={activeTool} onPick={pickTool} label="Draw a box">
            <BoxGlyph />
          </ToolButton>
          <ToolButton tool="arrow" active={activeTool} onPick={pickTool} label="Draw an arrow">
            <ArrowGlyph />
          </ToolButton>
          <ToolButton
            tool="note"
            active={activeTool}
            onPick={pickTool}
            label="Leave a note · hold Shift"
          >
            <TextGlyph />
          </ToolButton>
          <span className="annotate-split" />
          {/* One swatch: the colour a mark is drawn in, and how solid a box's
            inside is. Four inks, because a fifth is a decision rather than a
            glance — and each is a token, so the swatch and the stroke cannot
            drift apart. */}
          <MarkPick
            ink={shownInk}
            inside={shownInside}
            isOpen={isPicking}
            onOpen={setPicking}
            onInk={pickInk}
            onInside={pickInside}
          />
          <span className="annotate-split" />
          <MarkButton
            className="bar-btn bar-icon"
            onClick={onCancel}
            label="Cancel"
            tip="Throw this capture away"
          >
            <CloseGlyph />
          </MarkButton>
          <button
            className="primary"
            onClick={() => void copyAndClose()}
            data-tip="Copy the picture to the clipboard · Enter or C"
          >
            <CopyGlyph />
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}

type Tool = 'box' | 'arrow' | 'note'

interface Point {
  x: number
  y: number
}

type Mark =
  | ({ kind: 'box'; x: number; y: number; width: number; height: number } & Paint)
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: 'note'; x: number; y: number; text: string; color: string }

/** The corners of a box and the ends of an arrow — what a resize takes hold
 *  of. A note has none: it is as big as what it says. */
type Grip = 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to'

/** What the pointer is in the middle of. Drawing makes a mark that does not
 *  exist yet (`at: null` when it is painted); moving and resizing stand in for
 *  one that does, at `at`, and neither touches the marks until the pointer
 *  comes up. */
type Gesture = { kind: 'draw'; tool: Tool; from: Point } | Hold

/** The two gestures that are about a mark that already exists — both carry the
 *  mark as it was when the hand closed on it, and where it lives. */
type Hold =
  | { kind: 'move'; at: number; from: Point; origin: Mark }
  | { kind: 'resize'; at: number; grip: Grip; origin: Mark }

/** The mark under the hand, and which mark it stands in for. */
type Overlay = { mark: Mark; at: number | null } | null

const LINE = 3
const HEAD = 14
const NOTE_SIZE = 16
/** `--leading-body`, which is what the field it is typed in is set in (a
 *  fixed 24px line, not a ratio, since the leadings went on the grid). The
 *  two have to agree to the pixel or a two-line note lands somewhere other
 *  than where it was written. */
const NOTE_LEADING = 24
/** A wash rather than a pane: enough to say "this region" and not so much that
 *  the words under it stop being readable, which is the whole point of drawing
 *  on a screenshot. Solid is the other answer, and covers them on purpose. */
const WASH_ALPHA = 0.18
/** What an empty field says, and — because the field is exactly as wide as
 *  what is in it — how wide it starts. */
const NOTE_ASKS = 'Type a note'
/** A field with nothing in it still has to be a field — enough room to read as
 *  one, and to hold the caret. */
const MIN_NOTE_WIDTH = 90
/** Under this and it was a click, not a drag — every gesture that starts a box
 *  ends with a stray one-pixel rectangle otherwise. */
const MIN_DRAG = 5
/** How near the pointer has to be to count as on a mark. Generous, because a
 *  3px line is a hard thing to hit and a miss draws a new mark over the one
 *  you meant to take hold of. */
const TOUCH = 8
/** The grab square, and the breathing room the selection's dashes stand off
 *  by so they are not confused with the mark itself. */
const GRIP = 9
const CHROME_PAD = 4

const GRIP_CURSORS: Record<Grip, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  from: 'grab',
  to: 'grab',
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** What a box is drawn with: the line round it, what is inside it, and whether
 *  that inside is a wash or a slab. Passed about as one thing because it is one
 *  answer — the toolbar states it, and a box drawn or picked up wears it. */
interface Paint {
  color: string
  inside: MarkInside
}

function shape(tool: Tool, from: Point, to: Point, paint: Paint): Mark {
  if (tool === 'arrow')
    return { kind: 'arrow', x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: paint.color }
  return {
    kind: 'box',
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
    ...paint,
  }
}

function isBigEnough(tool: Tool, from: Point, to: Point): boolean {
  if (tool === 'arrow') return Math.hypot(to.x - from.x, to.y - from.y) > MIN_DRAG * 2
  return Math.abs(to.x - from.x) > MIN_DRAG && Math.abs(to.y - from.y) > MIN_DRAG
}

/** Where a gesture in hand has got to: the mark it would leave if the pointer
 *  came up here. Always computed from the mark as it was when the gesture
 *  began, so a drag is one arithmetic step rather than a running total that
 *  drifts. */
function dragged(gesture: Hold, to: Point): Mark {
  return gesture.kind === 'move'
    ? moved(gesture.origin, to.x - gesture.from.x, to.y - gesture.from.y)
    : resized(gesture.origin, gesture.grip, to)
}

function moved(mark: Mark, dx: number, dy: number): Mark {
  if (mark.kind === 'arrow') {
    return { ...mark, x1: mark.x1 + dx, y1: mark.y1 + dy, x2: mark.x2 + dx, y2: mark.y2 + dy }
  }
  return { ...mark, x: mark.x + dx, y: mark.y + dy }
}

function resized(mark: Mark, grip: Grip, to: Point): Mark {
  if (mark.kind === 'arrow') {
    return grip === 'from' ? { ...mark, x1: to.x, y1: to.y } : { ...mark, x2: to.x, y2: to.y }
  }
  if (mark.kind !== 'box') return mark
  // The corner opposite the one being pulled stays put; the box is then read
  // off the two of them, which is what lets a pull through the far edge turn
  // the box inside out without going negative.
  const anchor = {
    x: grip === 'nw' || grip === 'sw' ? mark.x + mark.width : mark.x,
    y: grip === 'nw' || grip === 'ne' ? mark.y + mark.height : mark.y,
  }
  return {
    ...mark,
    x: Math.min(anchor.x, to.x),
    y: Math.min(anchor.y, to.y),
    width: Math.abs(to.x - anchor.x),
    height: Math.abs(to.y - anchor.y),
  }
}

/** Whether a gesture actually changed anything — a click that only picked a
 *  mark up must not become a step on the undo stack. */
function isSame(a: Mark, b: Mark): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The rectangle a mark occupies. A note's is a consequence of the font it is
 *  written in, which is why every caller hands over the ink context. */
function boundsOf(mark: Mark, ink: CanvasRenderingContext2D, face: string) {
  if (mark.kind === 'box') return { x: mark.x, y: mark.y, width: mark.width, height: mark.height }
  if (mark.kind === 'arrow') {
    return {
      x: Math.min(mark.x1, mark.x2),
      y: Math.min(mark.y1, mark.y2),
      width: Math.abs(mark.x2 - mark.x1),
      height: Math.abs(mark.y2 - mark.y1),
    }
  }
  ink.font = noteFace(face)
  const lines = mark.text.split('\n')
  const width = Math.max(...lines.map((line) => ink.measureText(line).width))
  return { x: mark.x, y: mark.y, width, height: lines.length * NOTE_LEADING }
}

/** The topmost mark the point is on, or null for open ground. Topmost, because
 *  the last mark drawn is the one on top and so the one being pointed at. */
function topmostUnder(
  marks: Mark[],
  at: Point,
  ink: CanvasRenderingContext2D,
  face: string
): number | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (isUnder(marks[i], at, ink, face)) return i
  }
  return null
}

function isUnder(mark: Mark, at: Point, ink: CanvasRenderingContext2D, face: string): boolean {
  if (mark.kind === 'arrow') {
    return distanceToLine(at, mark.x1, mark.y1, mark.x2, mark.y2) <= TOUCH
  }
  const box = boundsOf(mark, ink, face)
  const inside =
    at.x >= box.x - TOUCH &&
    at.x <= box.x + box.width + TOUCH &&
    at.y >= box.y - TOUCH &&
    at.y <= box.y + box.height + TOUCH
  if (!inside) return false
  // A note is its words, and a filled box is its pane: both are solid to the
  // pointer. An open box is its four edges — the inside of it belongs to
  // whatever it was drawn around, which is usually where the next mark goes.
  if (mark.kind === 'note' || mark.inside !== 'none') return true
  return (
    Math.abs(at.x - box.x) <= TOUCH ||
    Math.abs(at.x - (box.x + box.width)) <= TOUCH ||
    Math.abs(at.y - box.y) <= TOUCH ||
    Math.abs(at.y - (box.y + box.height)) <= TOUCH
  )
}

function gripsOf(
  mark: Mark,
  ink: CanvasRenderingContext2D,
  face: string
): { grip: Grip; x: number; y: number }[] {
  if (mark.kind === 'arrow') {
    return [
      { grip: 'from', x: mark.x1, y: mark.y1 },
      { grip: 'to', x: mark.x2, y: mark.y2 },
    ]
  }
  if (mark.kind === 'note') return []
  const box = boundsOf(mark, ink, face)
  return [
    { grip: 'nw', x: box.x, y: box.y },
    { grip: 'ne', x: box.x + box.width, y: box.y },
    { grip: 'sw', x: box.x, y: box.y + box.height },
    { grip: 'se', x: box.x + box.width, y: box.y + box.height },
  ]
}

function handleUnder(
  mark: Mark,
  at: Point,
  ink: CanvasRenderingContext2D,
  face: string
): Grip | null {
  for (const one of gripsOf(mark, ink, face)) {
    if (Math.abs(at.x - one.x) <= GRIP && Math.abs(at.y - one.y) <= GRIP) return one.grip
  }
  return null
}

function distanceToLine(at: Point, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const span = dx * dx + dy * dy
  // A degenerate arrow is a point, and dividing by its length is a NaN that
  // makes every hit test say yes.
  if (span === 0) return Math.hypot(at.x - x1, at.y - y1)
  const along = Math.max(0, Math.min(1, ((at.x - x1) * dx + (at.y - y1) * dy) / span))
  return Math.hypot(at.x - (x1 + along * dx), at.y - (y1 + along * dy))
}

function noteFace(face: string) {
  return `700 ${NOTE_SIZE}px ${face || 'sans-serif'}`
}

function paint(ink: CanvasRenderingContext2D, mark: Mark, face: string) {
  ink.strokeStyle = mark.color
  ink.fillStyle = mark.color
  ink.lineWidth = LINE
  ink.lineJoin = 'round'
  ink.lineCap = 'round'
  if (mark.kind === 'box') {
    // The pane first and the ring over it: a fill drawn last would cover the
    // inner half of its own line and leave the box a hair thin. Solid is a
    // slab you cannot read through, which is how a screenshot gets something
    // taken out of it; soft is a wash that says "this region".
    if (mark.inside !== 'none') {
      ink.globalAlpha = mark.inside === 'solid' ? 1 : WASH_ALPHA
      ink.fillRect(mark.x, mark.y, mark.width, mark.height)
      ink.globalAlpha = 1
    }
    ink.strokeRect(mark.x, mark.y, mark.width, mark.height)
    return
  }
  if (mark.kind === 'arrow') {
    paintArrow(ink, mark.x1, mark.y1, mark.x2, mark.y2)
    return
  }
  // The app's own face — a note in the browser's default sans is a note that
  // came from somewhere else.
  ink.font = noteFace(face)
  ink.textBaseline = 'top'
  mark.text.split('\n').forEach((line, i) => {
    ink.fillText(line, mark.x, mark.y + i * NOTE_LEADING)
  })
}

/**
 * The mark in hand, said in the page's own two tones rather than in the ink:
 * the selection is a fact about this surface, not part of the drawing, and it
 * is drawn on the sheet that never reaches the picture.
 */
function paintChrome(
  chrome: CanvasRenderingContext2D,
  mark: Mark,
  ink: CanvasRenderingContext2D,
  face: string,
  tone: { line: string; fill: string }
) {
  const box = boundsOf(mark, ink, face)
  chrome.save()
  chrome.strokeStyle = tone.line || mark.color
  chrome.lineWidth = 1
  chrome.setLineDash([4, 3])
  chrome.strokeRect(
    box.x - CHROME_PAD,
    box.y - CHROME_PAD,
    box.width + CHROME_PAD * 2,
    box.height + CHROME_PAD * 2
  )
  chrome.setLineDash([])
  for (const one of gripsOf(mark, ink, face)) {
    chrome.fillStyle = tone.fill || '#fff'
    chrome.beginPath()
    chrome.rect(one.x - GRIP / 2, one.y - GRIP / 2, GRIP, GRIP)
    chrome.fill()
    chrome.stroke()
  }
  chrome.restore()
}

function paintArrow(ink: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ink.beginPath()
  ink.moveTo(x1, y1)
  ink.lineTo(x2, y2)
  ink.stroke()
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ink.beginPath()
  ink.moveTo(x2, y2)
  ink.lineTo(x2 - HEAD * Math.cos(angle - Math.PI / 6), y2 - HEAD * Math.sin(angle - Math.PI / 6))
  ink.lineTo(x2 - HEAD * Math.cos(angle + Math.PI / 6), y2 - HEAD * Math.sin(angle + Math.PI / 6))
  ink.closePath()
  ink.fill()
}

/**
 * One control for how a mark looks: which of the four inks, and how solid a
 * box's inside is.
 *
 * It was two dropdowns — a line colour and a fill colour, each with its own
 * chevron and its own menu of five. On a bar whose whole job is "say what is
 * wrong with this page", two colour systems were most of what the bar looked
 * like, and nobody marking up a screenshot has ever needed a green ring round
 * an amber wash. One colour per mark, and the inside is that colour heavier or
 * lighter, says everything the pair said in a third of the room.
 */
function MarkPick({
  ink,
  inside,
  isOpen,
  onOpen,
  onInk,
  onInside,
}: {
  /** The answers in force — the mark in hand's, or the next mark's. */
  ink: MarkInk
  inside: MarkInside
  isOpen: boolean
  onOpen: (isOpen: boolean) => void
  onInk: (ink: MarkInk) => void
  onInside: (inside: MarkInside) => void
}) {
  return (
    <Menu isOpen={isOpen} onDismiss={() => onOpen(false)} variant="annotate-pick">
      <MarkButton
        className={isOpen ? 'bar-btn bar-icon on' : 'bar-btn bar-icon'}
        onClick={() => onOpen(!isOpen)}
        aria-expanded={isOpen}
        label={`Colour · ${INK_NAMES[ink]}, ${INSIDE_NAMES[inside]}`}
        tip="Colour and fill"
      >
        <Swatch ink={ink} inside={inside} />
      </MarkButton>
      {isOpen && (
        <div className="menu-card annotate-pick-card">
          {/* The colour, as dots — a swatch IS its answer, so a word beside it
              is a word to read past. */}
          <div className="annotate-pick-row">
            {MARK_INKS.map((one) => (
              <button
                key={one}
                className={`annotate-dot ink-${one}`}
                onClick={() => onInk(one)}
                aria-pressed={one === ink}
                aria-label={`Mark in ${INK_NAMES[one]}`}
                data-tip={INK_NAMES[one]}
              />
            ))}
          </div>
          {/* And how solid a box is, drawn as the three things it can be. */}
          <div className="annotate-pick-row">
            {MARK_INSIDES.map((one) => (
              <button
                key={one}
                className="annotate-inside"
                onClick={() => onInside(one)}
                aria-pressed={one === inside}
                aria-label={INSIDE_NAMES[one]}
                data-tip={INSIDE_TIPS[one]}
              >
                <Swatch ink={ink} inside={one} />
              </button>
            ))}
          </div>
        </div>
      )}
    </Menu>
  )
}

/** A box as it will be drawn: a ring, a ring over a wash, or a slab. */
function Swatch({ ink, inside }: { ink: MarkInk; inside: MarkInside }) {
  return <span className={`annotate-swatch ${inside} ink-${ink}`} />
}

/** What each inside is called, and what it is for. */
const INSIDE_NAMES: Record<MarkInside, string> = {
  none: 'no fill',
  wash: 'a wash',
  solid: 'solid',
}

const INSIDE_TIPS: Record<MarkInside, string> = {
  none: 'A ring — nothing inside it',
  wash: 'A wash — the page stays readable under it',
  solid: 'Solid — covers what is under it',
}

/** What each ink is called, for the people who reach these by name rather than
 *  by eye. */
const INK_NAMES: Record<MarkInk, string> = {
  annotate: 'red',
  amber: 'amber',
  green: 'green',
  purple: 'purple',
}

function ToolButton({
  tool,
  active,
  onPick,
  label,
  children,
}: {
  tool: Tool
  active: Tool
  onPick: (tool: Tool) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <MarkButton
      className={active === tool ? 'bar-btn bar-icon on' : 'bar-btn bar-icon'}
      onClick={() => onPick(tool)}
      aria-pressed={active === tool}
      label={label}
    >
      {children}
    </MarkButton>
  )
}
