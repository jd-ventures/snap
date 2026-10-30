import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The content script, as ONE classic (non-module) file: `chrome.scripting`
 * injects a file, not a module graph, so everything — React, the surface,
 * the stylesheet as a string — is bundled into dist/content.js. Runs after
 * the main build and must not empty the folder it lands in.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('src/content.tsx', import.meta.url)),
      formats: ['iife'],
      name: 'SnapContent',
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
