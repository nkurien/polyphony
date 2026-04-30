import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],

  // Exclude the engine package from Vite's dependency pre-bundling.
  // The WASM glue code uses import.meta.url to locate the .wasm binary at runtime,
  // which breaks if Vite tries to pre-bundle it with esbuild.
  optimizeDeps: {
    exclude: ['engine'],
  },

  server: {
    fs: {
      // Allow Vite to serve files from engine/pkg, which sits outside the web/ root
      allow: ['..'],
    },
  },
})
