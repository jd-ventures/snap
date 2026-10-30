/**
 * What a mark on a capture is drawn in.
 *
 * Four inks, each a token the stylesheet already defines and each redefined
 * for the dark theme where it needs to be — so a mark is legible on a
 * screenshot of either theme without this file naming a colour. Resolving them
 * here rather than at every call site is what keeps `Annotate.tsx` free of
 * hexes, the way nothing in `src/` names one.
 *
 * The choice is kept in this browser (`localStorage`, like the theme and the
 * document page's folded bands) rather than against the account: it is about
 * the marking-up in front of you, and it has to be right on the first frame of
 * the surface, before anything could have been asked of the server.
 */
import { useCallback, useEffect, useState } from 'react'
import { token } from './theme'

/** Named for the token each resolves to — `--sp-annotate` and the three
 *  beside it. Red leads because a report is usually about something wrong. */
export type MarkInk = 'annotate' | 'amber' | 'green' | 'purple'

export const MARK_INKS: MarkInk[] = ['annotate', 'amber', 'green', 'purple']

const KEY = 'snap-mark-ink'
const INSIDE_KEY = 'snap-mark-inside'

/** The colour `ink` is, in the theme as it stands. A style recalculation, so
 *  callers resolve it when the ink changes rather than per painted mark. */
export function markInk(ink: MarkInk): string {
  return token(`--sp-${ink}`)
}

/**
 * The ink in force: which one, how to change it, and what colour that is.
 *
 * An unreadable or unknown stored value is the default rather than an error —
 * the record being wrong is not a reason to refuse to draw.
 */
export function useMarkInk(): { ink: MarkInk; setInk: (ink: MarkInk) => void; colour: string } {
  const [ink, setStored] = useState<MarkInk>(remembered)
  const [colour, setColour] = useState('')

  // After paint, so the stylesheet is there to be asked. Re-read on every
  // change of ink, and never per mark.
  useEffect(() => {
    setColour(markInk(ink))
  }, [ink])

  const setInk = useCallback((next: MarkInk) => {
    setStored(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* unremembered is not broken */
    }
  }, [])

  return { ink, setInk, colour }
}

function remembered(): MarkInk {
  try {
    const raw = localStorage.getItem(KEY)
    return MARK_INKS.find((ink) => ink === raw) ?? MARK_INKS[0]
  } catch {
    return MARK_INKS[0]
  }
}

/** What is inside a box: nothing, a wash you can read the page through, or a
 *  slab that covers it. One question rather than two — the inside is the
 *  mark's own colour, heavier or lighter, which is the only pairing anyone
 *  reaches for on a screenshot. */
export type MarkInside = 'none' | 'wash' | 'solid'

export const MARK_INSIDES: MarkInside[] = ['none', 'wash', 'solid']

/**
 * Whether a box is filled, kept in this browser beside the ink: someone who
 * fills a box once is usually about to fill the next one.
 */
export function useMarkInside(): {
  inside: MarkInside
  setInside: (inside: MarkInside) => void
} {
  const [inside, setStored] = useState<MarkInside>(rememberedInside)

  const setInside = useCallback((next: MarkInside) => {
    setStored(next)
    try {
      localStorage.setItem(INSIDE_KEY, next)
    } catch {
      /* unremembered is not broken */
    }
  }, [])

  return { inside, setInside }
}

function rememberedInside(): MarkInside {
  try {
    const raw = localStorage.getItem(INSIDE_KEY)
    return MARK_INSIDES.find((one) => one === raw) ?? 'none'
  } catch {
    return 'none'
  }
}
