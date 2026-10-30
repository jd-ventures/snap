/**
 * Where the stylesheet's tokens are read from.
 *
 * On the extension's own page that is `<html>`. Inside somebody else's page
 * the surface lives in a shadow root, its tokens are declared on the shadow
 * HOST, and `document.documentElement` belongs to the host page — which has
 * no `--sp-annotate` and would paint every mark in an empty string. So the
 * three files that resolve a token at runtime (marks.ts, capture.ts,
 * Annotate.tsx) ask here rather than reaching for the document.
 */
let root: Element | null = null

export function setStyleRoot(el: Element | null) {
  root = el
}

export function styleRoot(): Element {
  return root ?? document.documentElement
}

/** One token, resolved as it stands. */
export function token(name: string): string {
  return getComputedStyle(styleRoot()).getPropertyValue(name).trim()
}
