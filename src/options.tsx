import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MARK_INKS, MARK_INSIDES, type MarkInk, type MarkInside } from './marks'
import { applyTheme, DEFAULTS, loadPrefs, savePrefs, type Prefs } from './prefs'
import './styles.css'

/**
 * The settings page. Every change saves on the spot — there is no Save
 * button to forget — and the row says so for a moment.
 *
 * The shortcut row is the one that cannot be edited here: Chrome keeps every
 * extension's shortcuts on one page of its own, so this row shows what it is
 * set to and opens that page.
 */
function Options() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [shortcut, setShortcut] = useState<string>('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void loadPrefs().then((p) => {
      setPrefs(p)
      applyTheme(document.documentElement, p.theme)
    })
    void readShortcut()
    // The shortcut can change while this page is open, on Chrome's page in the
    // next tab over. Re-read whenever this page gets focus back.
    const onFocus = () => void readShortcut()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  async function readShortcut() {
    const all = await chrome.commands.getAll()
    const snap = all.find((c) => c.name === 'snap')
    setShortcut(snap?.shortcut || '')
  }

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    if (!prefs) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    if (key === 'theme') applyTheme(document.documentElement, next.theme)
    void savePrefs(next).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    })
  }

  function openShortcuts() {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
  }

  if (!prefs) return null

  return (
    <main className="options">
      <h1>
        Snap settings <span className="version">v{chrome.runtime.getManifest().version}</span>
      </h1>

      <section>
        <h2>Shortcut</h2>
        <div className="row">
          <div>
            <div className="row-name">Snap this page</div>
            <div className="row-help">
              {shortcut ? (
                <>Currently <kbd>{shortcut}</kbd>.</>
              ) : (
                <>Not set. Chrome may have refused the default because another extension has it.</>
              )}{' '}
              Chrome keeps shortcuts on its own page; change it there and come back.
            </div>
          </div>
          <button onClick={openShortcuts}>Change in Chrome</button>
        </div>
      </section>

      <section>
        <h2>Surface</h2>
        <Choice
          name="Theme"
          help="The ground the picture sits on, and the address bar's colours."
          value={prefs.theme}
          options={[
            ['system', 'Follow system'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={(v) => update('theme', v)}
        />
        <Choice
          name="Open in"
          help="Over the page is how artc does it: the picture drops over the page you snapped. A tab or a window keeps the page as it was."
          value={prefs.openIn}
          options={[
            ['page', 'Over the page'],
            ['tab', 'A new tab'],
            ['window', 'Its own window'],
          ]}
          onChange={(v) => update('openIn', v)}
        />
        <Choice
          name="After copying"
          help="Close is one press to a picture. Stay lets you copy variations of the same capture."
          value={prefs.afterCopy}
          options={[
            ['close', 'Close the surface'],
            ['stay', 'Keep it open'],
          ]}
          onChange={(v) => update('afterCopy', v)}
        />
        <Toggle
          name="Address bar"
          help="Draw the page's URL in a browser-style strip across the top of the copied picture."
          value={prefs.addressBar}
          onChange={(v) => update('addressBar', v)}
        />
      </section>

      <section>
        <h2>Marks</h2>
        <div className="row">
          <div>
            <div className="row-name">Starting ink</div>
            <div className="row-help">What the first mark on a fresh capture is drawn in.</div>
          </div>
          <div className="dots">
            {MARK_INKS.map((one) => (
              <button
                key={one}
                className={`annotate-dot ink-${one}`}
                aria-pressed={one === prefs.ink}
                aria-label={INK_NAMES[one]}
                data-tip={INK_NAMES[one]}
                onClick={() => update('ink', one)}
              />
            ))}
          </div>
        </div>
        <div className="row">
          <div>
            <div className="row-name">Starting fill</div>
            <div className="row-help">Whether a box starts as a ring, a wash, or solid.</div>
          </div>
          <div className="dots">
            {MARK_INSIDES.map((one) => (
              <button
                key={one}
                className="annotate-inside"
                aria-pressed={one === prefs.inside}
                aria-label={INSIDE_NAMES[one]}
                data-tip={INSIDE_NAMES[one]}
                onClick={() => update('inside', one)}
              >
                <span className={`annotate-swatch ${one} ink-${prefs.ink}`} />
              </button>
            ))}
          </div>
        </div>
        <Toggle
          name="Remember the last ink used"
          help="On: each capture starts with whatever you used last. Off: always the starting ink and fill above."
          value={prefs.rememberInk}
          onChange={(v) => update('rememberInk', v)}
        />
      </section>

      <section>
        <h2>Troubleshooting</h2>
        <Toggle
          name="Show diagnostics on the surface"
          help="A panel listing every key the surface receives, where focus is, and each step of a copy with timings. Screenshot it when something does nothing."
          value={prefs.diagnostics}
          onChange={(v) => update('diagnostics', v)}
        />
      </section>

      <footer>
        <button className="small" onClick={() => void savePrefs(DEFAULTS).then(() => setPrefs(DEFAULTS))}>
          Reset to defaults
        </button>
        <span className="saved" aria-live="polite">
          {saved ? 'Saved' : ''}
        </span>
      </footer>
    </main>
  )
}

function Choice<T extends string>({
  name,
  help,
  value,
  options,
  onChange,
}: {
  name: string
  help: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="row">
      <div>
        <div className="row-name">{name}</div>
        <div className="row-help">{help}</div>
      </div>
      <div className="seg" role="radiogroup" aria-label={name}>
        {options.map(([v, label]) => (
          <button
            key={v}
            role="radio"
            aria-checked={v === value}
            className={v === value ? 'on' : undefined}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({
  name,
  help,
  value,
  onChange,
}: {
  name: string
  help: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="row">
      <div>
        <div className="row-name">{name}</div>
        <div className="row-help">{help}</div>
      </div>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const INK_NAMES: Record<MarkInk, string> = {
  annotate: 'Red',
  amber: 'Amber',
  green: 'Green',
  purple: 'Purple',
}
const INSIDE_NAMES: Record<MarkInside, string> = {
  none: 'A ring',
  wash: 'A wash',
  solid: 'Solid',
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>
)
