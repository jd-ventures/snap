import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Two entries, one output folder that IS the unpacked extension:
 *   dist/annotate.html + dist/assets/…   the fallback annotate page
 *   dist/options.html                    the settings page
 *   dist/background.js                   the service worker (ES module)
 *   dist/manifest.json, dist/icons/      copied from public/
 * The content script is a second build (vite.content.config.ts) because
 * chrome.scripting injects one classic file, not a module graph.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        annotate: fileURLToPath(new URL('annotate.html', import.meta.url)),
        options: fileURLToPath(new URL('options.html', import.meta.url)),
        background: fileURLToPath(new URL('src/background.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
