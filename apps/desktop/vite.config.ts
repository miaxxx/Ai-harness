import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/** Build the unprivileged Renderer into the custom-protocol resource root. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      // Desktop deliberately consumes the repository's client source graph
      // without duplicating every product package in apps/desktop's manifest.
      // TypeScript resolves the same graph through tsconfig.base.json paths.
      {
        find: /^@deepseek-ai\/dsh-client-([^/]+)\/client$/,
        replacement: src('../../packages/client/$1/src/client/index.ts'),
      },
      {
        find: /^@deepseek-ai\/dsh-client-([^/]+)$/,
        replacement: src('../../packages/client/$1/src/index.ts'),
      },
      { find: '@deepseek-ai/cordis', replacement: src('../../vendor/cordis/src/index.ts') },
    ],
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
