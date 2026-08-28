import { defineConfig } from 'tsdown'

/** Bundle the ESM main process and CommonJS sandboxed preload separately. */
export default defineConfig([
  {
    entry: ['lib/types/main/main.js'],
    outDir: 'dist',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      alwaysBundle: ['@deepseek-ai/dsh-acp-client', '@agentclientprotocol/sdk', 'zod'],
      neverBundle: ['electron'],
    },
  },
  {
    entry: ['lib/types/main/preload.js'],
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    outExtensions: () => ({ js: '.cjs' }),
    dts: false,
    clean: false,
    deps: { skipNodeModulesBundle: true },
  },
])
