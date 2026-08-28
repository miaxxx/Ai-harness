import { defineConfig } from 'tsdown'

/** Bundle one CommonJS VS Code extension host entry; VS Code provides its own module. */
export default defineConfig({
  entry: ['lib/types/extension.js'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'es2024',
  outExtensions: () => ({ js: '.cjs' }),
  external: ['vscode'],
  dts: false,
  clean: true,
})
