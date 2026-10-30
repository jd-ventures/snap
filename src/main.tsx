import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { fromDataUrl } from './capture'
import { applyTheme, loadPrefs, seedInk, type Prefs } from './prefs'
import { Surface } from './Surface'
import type { Pending } from './background'
import './styles.css'

const KEY = 'pending'

/**
 * The fallback host: the extension's own page, used when the surface could
 * not be put into the page itself (chrome://, the Web Store, a PDF) or when
 * the settings ask for a tab or a window. Reads the capture the service
 * worker left in session storage and closes the tab when the surface leaves.
 */
function App() {
  const [shot, setShot] = useState<{ canvas: HTMLCanvasElement; pending: Pending } | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    void (async () => {
      const p = await loadPrefs()
      applyTheme(document.documentElement, p.theme)
      seedInk(p)
      setPrefs(p)
      const got = (await chrome.storage.session.get(KEY))[KEY] as Pending | undefined
      if (!got) {
        setMissing(true)
        return
      }
      // Taken, so a reload of this tab does not show a stale picture.
      await chrome.storage.session.remove(KEY)
      if (got.title) document.title = `Snap · ${got.title}`
      setShot({ canvas: await fromDataUrl(got.dataUrl), pending: got })
    })()
  }, [])

  if (missing) {
    return (
      <p className="empty">
        Nothing to mark up. Press the toolbar button on a page to take a picture of it.{' '}
        <button className="small" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </p>
    )
  }
  if (!shot || !prefs) return null

  return (
    <Surface canvas={shot.canvas} pending={shot.pending} prefs={prefs} onClose={() => window.close()} />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
