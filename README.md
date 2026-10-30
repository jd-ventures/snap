# Snap — a Chrome extension for screenshot + markup + copy

Photograph the current tab, draw on it the way artc's Send-feedback surface
lets you, and put the finished PNG on the clipboard. That is the whole
product. **Nothing is uploaded anywhere: no GitHub, no server, no account.**

This folder is a complete, buildable specification. An agent should be able to
run the steps under *Build* and have a working extension without reading
anything outside this folder. Every source file is here; the artc originals
they were lifted from are in `reference/` for comparison only and are not
part of the build. Publishing is `HANDOFF.md`.

## 1. What it does

1. The user presses the toolbar button or `Shift+Alt+S` on any tab.
2. The service worker takes a picture of the visible tab with
   `chrome.tabs.captureVisibleTab`, at the tab's own device pixel ratio.
3. The surface drops over the page itself, exactly as artc's Send-feedback
   surface does: the picture letterboxed on a plain ground with a toolbar at
   the bottom, inside a shadow root so neither stylesheet touches the other.
   The page keeps the keyboard it already had, and the clipboard write runs
   in an ordinary https document, which is the context artc's copy runs in.
   On a page Chrome keeps scripts out of (`chrome://`, the Web Store, PDFs)
   the surface opens in an extension tab instead; the settings can also ask
   for a tab or a window always.
4. The user draws **boxes**, **arrows** and **text notes** in one of four
   inks (red, amber, green, purple). A box can be a ring, a wash, or solid.
   Marks are objects until copied: click to pick up, drag to move, pull a
   corner to resize, recolour or refill from the swatch, Delete to remove,
   Cmd/Ctrl+Z to undo. Double-click a note to edit it. Hold Shift to flip
   the shape tool to text momentarily.
5. **Copy** (or `Enter`, or bare `C`) composites the marks onto the capture,
   draws a browser-style address bar with the page URL across the top,
   writes the PNG to the clipboard, and takes the surface away. `Escape`
   backs out of the innermost thing: the note, the drag, the selection, then
   the surface. While the surface is up, its keys are taken in the capture
   phase and stopped, so the host page's own shortcuts do not fire under it.
6. **Settings** (right-click the icon → Options, or `chrome://extensions` →
   Snap → Details → Extension options) is a page of its own. Every change
   saves on the spot. It holds:
   - **Shortcut**: shows what Chrome has it set to and opens
     `chrome://extensions/shortcuts`. An extension cannot set its own
     shortcut; `commands.suggested_key` in the manifest is only the default
     Chrome applies at install, and Chrome may refuse it if another
     extension already has it.
   - **Theme**: system, light, dark. Sets `data-theme` on the surface's root.
   - **Open in**: over the page (default, the artc way), a tab beside the page, or a popup window sized to the capture.
   - **After copying**: close the surface, or keep it open to copy variations.
   - **Address bar**: on or off.
   - **Starting ink and fill**, and whether the last used pair is remembered.
   - **Show diagnostics**: a panel on the surface listing every key it
     receives (code, modifiers, target), focus changes, and each step of a
     copy with timings and the clipboard's verdict. For "I pressed it and
     nothing happened" reports: screenshot the panel.
   Stored under one key, `prefs`, in `chrome.storage.sync` (`src/prefs.ts`),
   read with defaults filled in so a setting added later is never undefined.
   The settings heading shows the build version from the manifest.

### Non-goals (do not build these)

- No upload, no issue filing, no sharing link, no server, no sign-in.
- No sessions, labels, parent issues, or any of artc's report composer.
- No content script declared for every site. The surface is injected only
  into the tab the user just pressed on, under `activeTab`, after the
  picture is taken, and removed when it leaves.
- No full-page (scrolling) capture in v1. Visible viewport only.
- No "save to disk" button. The clipboard is the deliverable. (If ever
  wanted, `chrome.downloads.download` on the same PNG blob is one line.)

## 2. Architecture

```
public/manifest.json     MV3 manifest, copied verbatim into dist/
src/background.ts        service worker: capture → inject content.js and message it; else storage.session → open tab/window
src/content.tsx          the surface INSIDE the page: shadow host, stylesheet re-addressed to :host, Surface mounted in it
src/Surface.tsx          Annotate + toast + diagnostics panel, shared by the in-page and extension-tab hosts
src/theme.ts             where tokens are read from: <html> on the extension page, the shadow host inside a page
annotate.html            the fallback page shell (root div + module script)
src/main.tsx             the fallback host: reads the capture from storage.session, applies prefs, mounts Surface
options.html             the settings page shell
src/options.tsx          the settings page: shortcut row, theme, open-in, after-copy, address bar, inks, diagnostics
src/prefs.ts             Prefs type, DEFAULTS, loadPrefs/savePrefs over chrome.storage.sync, applyTheme, seedInk
src/Annotate.tsx         the markup surface — artc's, with the report and session code removed
src/capture.ts           canvas helpers: fitRect, withStrokes, withAddressBar, toPng, fromDataUrl
src/marks.ts             which ink and fill are in force, remembered in localStorage
src/glyphs.tsx           six lucide icons, named for what they mean here
src/keys.ts              KEYS + useHotkey (physical-key matching, deaf while typing)
src/ui.tsx               Menu (+useDismiss), MarkButton, copyImage, Toast, useFlash, useLatest
src/styles.css           tokens + button + menu-card + the .annotate-* block from artc + settings + diagnostics
vite.config.ts           main build: annotate page, options page, service worker
vite.content.config.ts   second build: content.js as ONE classic script with React and the CSS string inside
scripts/icons.mjs        writes public/icons/{16,48,128}.png with no image library
scripts/smoke.mjs        Playwright: loads dist/ as an extension and drives the surface end to end
scripts/release.mjs      sets the version, builds, smokes, zips dist/ contents for the store
store/                   listing description, privacy policy, 1280×800 screenshot
reference/               the artc files this was ported from (not built)
HANDOFF.md               publishing on the Chrome Web Store, start to finish
```

**Data flow, in-page (default).** The worker captures the tab, reads its
`devicePixelRatio` with one `executeScript`, injects `content.js` with
`chrome.scripting.executeScript({ files })` (idempotent: a guard on
`window`), and sends `{ type: 'snap', pending, prefs }` with
`chrome.tabs.sendMessage`. The content script creates a `<snap-surface>`
host with an open shadow root, puts the stylesheet in it with `:root`
rewritten to `:host`, sets the theme attribute and the z-index tokens on
the host, and mounts `Surface`. Closing unmounts and removes the host.

**Data flow, fallback.** If injection throws or the page refuses, or the
settings say tab/window, the worker stores `{ dataUrl, pageUrl, ratio,
title }` under key `pending` in `chrome.storage.session` and opens
`annotate.html`, which reads and removes the key.

**Why in the page.** It is what artc does, and it removes every difference
between artc's copy and this one: the page already holds the keyboard (the
user just pressed the toolbar button or the shortcut on it), the clipboard
write runs in an https document, and there is no second tab to focus or
close. The shadow root keeps the page's CSS off the surface; the tokens
every canvas routine reads are declared on the host and resolved through
`theme.ts` rather than `document.documentElement`, which inside a page
belongs to the host page and has none of them.

**Permissions**, all in `manifest.json`:

| permission | why |
|---|---|
| `activeTab` | lets `captureVisibleTab` and `executeScript` run on the tab the user just pressed on, and nowhere else |
| `scripting` | injects `content.js` into that tab, and reads `window.devicePixelRatio` |
| `storage` | `chrome.storage.sync` for settings; `chrome.storage.session` for the pending capture on the fallback path |
| `clipboardWrite` | `navigator.clipboard.write` of the finished PNG |

No `host_permissions`, no `tabs`, no `<all_urls>`.

**Pixel ratio.** `captureVisibleTab` returns device pixels. The address bar
is drawn in CSS pixels at that ratio (`withAddressBar(page, url, ratio)`) so
its 12px type is as sharp as the page under it. If the page refuses scripts,
the ratio falls back to 1 and the bar is drawn a size small rather than the
capture being lost. If the capture itself is refused, the action badge shows
`!` with a title saying why.

**Theme.** The surface follows `prefers-color-scheme` unless the setting
says otherwise. Every colour the canvas code uses is read from CSS custom
properties at runtime through `theme.ts` (`--sp-annotate`, `--sp-amber`,
`--sp-green`, `--sp-purple`, `--sp-paper`, `--sp-bg`, `--sp-text`,
`--sp-text-muted`, `--sp-border`, `--sp-border-strong`,
`--sp-font-display`, `--sp-font-mono`). Keep those defined or the marks
paint in an empty string.

## 3. Build

Requires Node 22+.

```sh
npm install
npm run icons      # once: writes public/icons/*.png
npm run build      # tsc --noEmit && vite build && vite build -c vite.content.config.ts → dist/
```

Load `dist/` in Chrome via `chrome://extensions` → Developer mode → *Load
unpacked*. `npm run dev` rebuilds on change; press the reload icon on the
extension card after each rebuild.

Build output must be exactly:

```
dist/manifest.json
dist/background.js            (module service worker, fixed name)
dist/content.js               (classic script: React + surface + CSS string; injected into pages)
dist/annotate.html
dist/options.html
dist/assets/annotate-*.js  options-*.js  (plus shared chunks)
dist/assets/*.css
dist/icons/16.png 48.png 128.png
```

## 4. Verify

```sh
CHROMIUM=/path/to/chromium npm run smoke
```

`scripts/smoke.mjs` launches Chromium with `--load-extension=dist`, then:

1. **In the page**: serves a page on `https://smoke.test/` that has its own
   `c` shortcut, adds `content.js` to it and opens the surface through the
   harness hook (a `snap:open` CustomEvent, taken only when no extension
   runtime is present). Draws a box, an arrow and a note; asserts ink on the
   sheet; screenshots to `scripts/smoke.png`; presses `C` and reads the
   toast; asserts the page's shortcut did not fire; reads the diagnostics
   panel; presses Copy; reads the PNG back off the clipboard and checks its
   width; presses Escape twice (the note is still in hand) and asserts the
   host element is gone and the page is intact.
2. **The extension-tab fallback**: seeds a capture in session storage, opens
   `annotate.html`, presses `C`, expects the tab to close.
3. **Settings**: reads the shortcut row, saves a theme change, checks storage.

Expected output ends with:

```
in-page: ink <n>px; C → "Copied the picture"; Copy → "Copied the picture"; clipboard <w>×<h>; page shortcut leaked: no
extension-tab fallback: after C: closed
settings: shortcut row "Currently Alt+Shift+S…"; prefs saved: {…}
```

Manual acceptance, in a real Chrome:

- [ ] Toolbar press on any https page drops the surface over that page; the page's own scrollbar does not move under it.
- [ ] On a `chrome://` page, or with Open in set to a tab, the surface opens in an extension tab instead.
- [ ] `Shift+Alt+S` does the same (see `chrome://extensions/shortcuts`).
- [ ] The picture is letterboxed, not stretched, and resizing the window keeps marks on the words they were drawn round.
- [ ] Box, arrow, note all draw; each can be picked up, moved, resized, recoloured, deleted, undone.
- [ ] The swatch card opens above the bar, closes on outside press or Escape.
- [ ] Copy takes the surface away and pasting into Slack/Figma/Docs gives the picture with an address bar across the top showing the page host in text ink and the path muted.
- [ ] On a `chrome://` page the action badge shows `!` and the fallback tab opens.
- [ ] Pressing the tools' chevron tucks the bar off the bottom edge and brings it back.
- [ ] In dark mode the ground, bar and address strip are dark; the red ink is the lighter dark-theme red.
- [ ] Reloading the fallback tab shows "Nothing to mark up" with a Settings button.
- [ ] Settings: the shortcut row shows the current combo; "Change in Chrome" opens `chrome://extensions/shortcuts`; changing it there and returning updates the row.
- [ ] Settings: Dark theme darkens the settings page at once and the next capture's surface; Open in → window opens a popup; After copying → keep open leaves the surface up with the "Copied" toast; Address bar off yields a picture with no strip; a starting ink of green with "remember" off makes every fresh capture start green.

## 5. What was changed from artc, precisely

Compare `src/Annotate.tsx` with `reference/artc-Annotate.tsx`:

- Imports: `SparkGlyph`, `TickGlyph`, `Session` gone; `CopyGlyph`, `token`, `useLatest` added.
- Props: `onDone`, `session`, `canStart`, `onStartSession`, `onEndSession` removed; `ratio: number`, `withBar: boolean`, `onCopied` and `onLog` added.
- `marked()` passes `ratio` to `withAddressBar`, and skips the bar when `withBar` is false.
- `done()` removed. `Enter` and `C` both run `copyAndClose()`, which reports to `onCopied`; the page decides whether that closes the surface (a setting). `copy()` shows "Copying…" at once, logs each step to the diagnostics panel, and reports the clipboard's own reason on refusal.
- Toolbar: the session chip/start button removed; the `Done` primary is now `Copy`.
- The pointer sheet is focusable (`tabIndex={-1}`) and takes focus when the surface opens and whenever the note field closes.
- The Escape/Delete/Undo key handler is registered once and reads the latest state through a ref (`useLatest`). artc re-registers it on every render, which works there but drops the key whenever an earlier listener on the same event sets state: the browser skips a listener removed and re-added mid-dispatch. Both key handlers listen in the capture phase and stop propagation, so a host page's shortcuts do not fire under the surface.
- Every token read at runtime goes through `theme.ts` (`token()` / `styleRoot()`) instead of `getComputedStyle(document.documentElement)`, so the same code runs inside a shadow root.
- Everything else — the mark model, hit testing, gestures, undo, note field sizing, the picker — is byte-for-byte the original.

`src/capture.ts` keeps only the drawing helpers from `reference/artc-capture.ts`
(`fitRect`, `withStrokes`, `withAddressBar`, `toPng`, `nextPaint`) and adds
`fromDataUrl`. The html-to-image rasteriser, the iframe bridge, and the page
hold logic are dropped: the browser takes the picture now.

`src/ui.tsx` carries `copyImage` with one change: it takes the PNG as a
promise and calls `navigator.clipboard.write` synchronously inside the
gesture, so a slow encode of a large capture cannot outlive Chrome's
user-activation window.

`src/styles.css` is a subset of artc's `index.css`: the tokens listed in §2,
the base `button` and `.primary` rules, `.mark-btn`, `.glyph`, `.menu-card`,
and the `.annotate-*` block minus the session and modal rules, plus the
settings page and the diagnostics panel. `data-tip` hints are a small
CSS-only caption because artc's tooltip component is not carried over.
artc's fonts (Helvetica Now Display, Spline Sans Mono) are not bundled; the
font stacks fall back. To match artc exactly, drop the woff2 files into
`public/fonts/` and add `@font-face` rules at the top of `styles.css`.

## 6. Publishing

`HANDOFF.md` is the start-to-finish guide to the Chrome Web Store: accounts,
`npm run release -- <version>`, every form field with its text, review
expectations, and the per-release routine. `store/` holds the listing
description, a privacy policy to host, and a 1280×800 screenshot.

## 7. Extending (after v1)

- **Full-page capture:** scroll-and-stitch from the worker using
  `executeScript` to step `scrollY`, capturing each viewport and drawing them
  into one canvas. Hide fixed headers between frames.
- **Crop before marking:** a fourth tool that trims the capture to a
  rectangle; apply it to `shot` before `fitRect`.
- **Save to disk** and **full-page capture** would each be one more row on
  the settings page.
