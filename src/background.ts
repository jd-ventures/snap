/**
 * The service worker: one job, which is to photograph the active tab and put
 * the annotate surface on the picture.
 *
 * `captureVisibleTab` needs `activeTab`, which the toolbar press or the
 * keyboard command grants for that tab alone — no host permissions, no
 * declared content script, no access to any page the user did not just
 * press on.
 *
 * The surface goes INTO the page by default (the artc way): the content
 * script is injected after the picture is taken and told to open. A page
 * Chrome keeps scripts out of, or a setting asking for a tab or window, uses
 * the fallback: the picture travels through `chrome.storage.session` (memory
 * only, cleared when the browser closes) to the extension's own page.
 */
import { loadPrefs } from './prefs'

const KEY = 'pending'

export interface Pending {
  dataUrl: string
  pageUrl: string
  ratio: number
  /** Tab title, for the annotate page's own tab. */
  title: string
}

async function snap(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || tab.windowId === undefined) return
  // A page the browser will not let an extension see (chrome://, the Web
  // Store, another extension) throws here. Say so with a badge rather than
  // silently doing nothing.
  let dataUrl: string
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  } catch {
    await chrome.action.setBadgeText({ text: '!', tabId: tab.id })
    await chrome.action.setTitle({ title: 'Chrome won’t let extensions see this page', tabId: tab.id })
    return
  }
  const ratio = await pixelRatio(tab.id)
  const pending: Pending = {
    dataUrl,
    pageUrl: tab.url ?? '',
    ratio,
    title: tab.title ?? '',
  }
  const prefs = await loadPrefs()
  if (prefs.openIn === 'page') {
    // The artc way: the surface goes into the page itself. `activeTab` lets
    // the script in; a page Chrome keeps scripts out of throws, and the tab
    // below is the fallback.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      const answer = (await chrome.tabs.sendMessage(tab.id, { type: 'snap', pending, prefs })) as
        | { ok: boolean; error?: string }
        | undefined
      if (answer?.ok) return
      console.warn('snap: the page refused the surface', answer?.error)
    } catch (e) {
      console.warn('snap: could not put the surface in the page, opening a tab', e)
    }
  }
  await chrome.storage.session.set({ [KEY]: pending })
  const url = chrome.runtime.getURL('annotate.html')
  if (prefs.openIn === 'window') {
    // A window the size of the picture in CSS pixels, so it opens at 1:1 and
    // the bar has room under it. Chrome clamps it to the screen.
    const size = await imageSize(dataUrl)
    await chrome.windows.create({
      url,
      type: 'popup',
      width: Math.round(size.width / ratio) + 16,
      height: Math.round(size.height / ratio) + 120,
    })
    return
  }
  await chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id })
}

/** A PNG's pixel size, read from its IHDR — a worker has no Image to decode
 *  with, and the two ints are at a fixed offset. */
async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const bytes = await (await fetch(dataUrl)).arrayBuffer()
  const view = new DataView(bytes)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * The tab's devicePixelRatio, asked of the page itself under `activeTab`.
 * `captureVisibleTab` returns device pixels and the address bar is drawn in
 * CSS pixels, so the picture has to say what one is. Falls back to 1 on a
 * page that refuses scripts, which draws the bar a size small rather than
 * losing the capture.
 */
async function pixelRatio(tabId: number): Promise<number> {
  try {
    const [hit] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.devicePixelRatio || 1,
    })
    return typeof hit?.result === 'number' ? hit.result : 1
  } catch {
    return 1
  }
}

chrome.action.onClicked.addListener((tab) => void snap(tab))

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'snap' && tab) void snap(tab)
})
