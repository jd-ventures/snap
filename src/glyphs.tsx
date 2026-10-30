import {
  ArrowUpRight,
  CaseSensitive,
  ChevronDown,
  Copy,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react'

/** The one optical size a mark in a control is drawn at. */
export const GLYPH = 15

/**
 * Name a lucide icon for what it stands for HERE, with the set's defaults on
 * it. The subset artc's Annotate surface uses, and nothing else.
 */
function name(Icon: LucideIcon, extra?: string) {
  return function Glyph({ size = GLYPH, className }: { size?: number; className?: string }) {
    const classes = ['glyph', extra, className].filter(Boolean).join(' ')
    return <Icon className={classes} size={size} aria-hidden="true" focusable="false" />
  }
}

export const BoxGlyph = name(Square)
export const ArrowGlyph = name(ArrowUpRight)
export const TextGlyph = name(CaseSensitive)
export const CloseGlyph = name(X)
export const CopyGlyph = name(Copy)
/** `.chev` is what the dock's fold animates. */
export const ChevronGlyph = name(ChevronDown, 'chev')
