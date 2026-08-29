import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Build the unprivileged Renderer into the custom-protocol resource root. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    // The product UI packages all share one React identity. Workspace package
    // links must not cause Vite to materialize a second hooks runtime.
    dedupe: ['react', 'react-dom'],
  },
  define: {
    // Client packages only make build-time process.env reads. Keep the
    // sandboxed Renderer free of a process polyfill while selecting the
    // shipped brand contribution for the Desktop product composition.
    'process.env.DSH_CLIENT_BUILD_PROFILE': JSON.stringify(
      process.env.DSH_CLIENT_BUILD_PROFILE ?? 'official',
    ),
    'process.env': '{}',
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
})
