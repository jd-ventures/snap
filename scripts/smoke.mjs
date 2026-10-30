// Loads dist/ into Chromium as an unpacked extension and proves the whole
// thing: the surface inside a page (box, arrow, note, the C key, the Copy
// button, the PNG read back off the clipboard, Escape cleanup, no leak of
// the key to the page), the extension-tab fallback, and the settings page.
// Writes scripts/smoke.png so a human can look at the surface.
//
//   npm run build && CHROMIUM=/path/to/chromium npm run smoke
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const profile = mkdtempSync(join(tmpdir(), 'snap-smoke-'))

const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'],
})

let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const id = new URL(worker.url()).host

// A page to photograph, on a real origin so the clipboard is readable, with
// a `c` shortcut of its own that must NOT fire under the surface.
await context.route('https://smoke.test/**', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<h1 style="font:700 32px sans-serif;margin:40px">Smoke page</h1><p style="margin:40px">Some words to draw a box round.</p><script>document.addEventListener("keydown", (e) => { if (e.key === "c") window.__leak = true })</script>',
  })
)
const page = await context.newPage()
await page.goto('https://smoke.test/')
const shot = await page.screenshot({ type: 'png' })
const dataUrl = `data:image/png;base64,${shot.toString('base64')}`
const pending = { dataUrl, pageUrl: 'https://smoke.test/?tab=1', ratio: 2, title: 'Smoke page' }
const prefs = { theme: 'system', openIn: 'page', addressBar: true, afterCopy: 'stay', ink: 'annotate', inside: 'none', rememberInk: true, diagnostics: true }

// ---- 1. The surface inside the page (what the worker does after a capture).
await page.addScriptTag({ path: `${dist}/content.js` })
await page.evaluate((detail) => document.dispatchEvent(new CustomEvent('snap:open', { detail })), { type: 'snap', pending, prefs })
const surface = page
const hand = surface.locator('snap-surface .annotate-hand')
await hand.waitFor()
const box = await hand.boundingBox()
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

let a = at(0.1, 0.1), b = at(0.4, 0.3)
await surface.mouse.move(a.x, a.y); await surface.mouse.down(); await surface.mouse.move(b.x, b.y, { steps: 5 }); await surface.mouse.up()
await surface.getByRole('button', { name: 'Draw an arrow' }).click()
a = at(0.6, 0.6); b = at(0.45, 0.35)
await surface.mouse.move(a.x, a.y); await surface.mouse.down(); await surface.mouse.move(b.x, b.y, { steps: 5 }); await surface.mouse.up()
await surface.getByRole('button', { name: /Leave a note/ }).click()
a = at(0.62, 0.62)
await surface.mouse.click(a.x, a.y)
await surface.getByRole('textbox', { name: 'Note' }).fill('This bit')
await surface.keyboard.press('Enter')
const inked = await surface.evaluate(() => {
  const c = document.querySelector('snap-surface').shadowRoot.querySelector('.annotate-ink')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
  return n
})
if (inked < 500) throw new Error(`expected ink on the sheet, found ${inked} pixels`)
await surface.screenshot({ path: fileURLToPath(new URL('smoke.png', import.meta.url)) })

// `C` copies. The page's own `c` handler must not have seen it.
const focused = await surface.evaluate(() => document.activeElement?.classList.contains('annotate-hand') || document.activeElement?.tagName === 'SNAP-SURFACE')
if (!focused) throw new Error('expected the surface to hold focus')
await surface.keyboard.press('c')
await surface.locator('.toast', { hasText: /Copied|Couldn/ }).waitFor({ timeout: 8000 }).catch(() => {})
const afterKey = await surface.locator('.toast').textContent().catch(() => 'no toast')
if (afterKey !== 'Copied the picture') throw new Error(`C key: ${afterKey}`)
if (await surface.evaluate(() => window.__leak)) throw new Error('the page saw the C key under the surface')
await surface.locator('.toast').waitFor({ state: 'detached' })
const diag = await surface.locator('.diag').textContent()
if (!/key KeyC/.test(diag) || !/clipboard: ok/.test(diag) || !/in the page/.test(diag)) throw new Error(`diagnostics missing lines:\n${diag}`)
await surface.getByRole('button', { name: /^Copy$/ }).click()
await surface.locator('.toast', { hasText: /Copied|Couldn/ }).waitFor({ timeout: 8000 }).catch(() => {})
const afterButton = await surface.locator('.toast').textContent().catch(() => 'no toast')
if (afterButton !== 'Copied the picture') throw new Error(`Copy button: ${afterButton}`)
// The picture on the clipboard: a PNG at the capture's width, taller by the bar.
const size = await surface.evaluate(async () => {
  const [item] = await navigator.clipboard.read()
  const bmp = await createImageBitmap(await item.getType('image/png'))
  return { w: bmp.width, h: bmp.height }
})
if (size.w !== shot.readUInt32BE(16)) throw new Error(`clipboard width ${size.w} ≠ capture ${shot.readUInt32BE(16)}`)
// Escape backs out of the innermost thing: the note just placed is still in
// hand, so the first Escape lets go of it and the second leaves.
await surface.keyboard.press('Escape')
await surface.keyboard.press('Escape')
await surface.locator('snap-surface').waitFor({ state: 'detached' })
const clean = await surface.evaluate(() => document.querySelector('snap-surface') === null && document.querySelector('h1')?.textContent === 'Smoke page')
if (!clean) throw new Error('the surface left something behind')

// ---- 2. The extension-tab fallback, close-on-copy.
await worker.evaluate(() => chrome.storage.sync.set({ prefs: { afterCopy: 'close', openIn: 'tab' } }))
await worker.evaluate((pending) => chrome.storage.session.set({ pending }), pending)
const tab = await context.newPage()
await tab.goto(`chrome-extension://${id}/annotate.html`)
await tab.locator('.annotate-hand').waitFor()
const closed = new Promise((resolve) => tab.once('close', () => resolve('closed')))
await tab.keyboard.press('c')
const outcome = await Promise.race([closed, tab.waitForTimeout(5000).then(() => 'still open')])
console.log(`in-page: ink ${inked}px; C → "${afterKey}"; Copy → "${afterButton}"; clipboard ${size.w}×${size.h}; page shortcut leaked: no`)
console.log(`diagnostics:\n${diag}`)
console.log(`extension-tab fallback: after C: ${outcome}`)

// ---- 3. The settings page: renders, shows the shortcut row, saves a change.
const options = await context.newPage()
await options.goto(`chrome-extension://${id}/options.html`)
await options.getByRole('heading', { name: /Snap settings/ }).waitFor()
const shortcutRow = await options.locator('.row-help').first().textContent()
await options.getByRole('radio', { name: 'Dark' }).click()
await options.locator('.saved').getByText('Saved').waitFor({ timeout: 3000 })
const theme = await options.evaluate(() => document.documentElement.dataset.theme)
const stored = await worker.evaluate(async () => (await chrome.storage.sync.get('prefs')).prefs)
if (theme !== 'dark' || stored?.theme !== 'dark') throw new Error('theme did not save')
console.log(`settings: shortcut row "${shortcutRow.trim().slice(0, 40)}…"; prefs saved: ${JSON.stringify(stored)}`)
await context.close()
