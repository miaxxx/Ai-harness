import { defineConfig } from 'tsdown'

/** Bundle the thin Extension Host adapter; VS Code provides its own host module. */
export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  outExtensions: () => ({ js: '.cjs' }),
  dts: false,
  clean: true,
})
