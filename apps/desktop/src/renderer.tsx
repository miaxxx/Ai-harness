import { mountDesktopProduct } from './product-runtime.ts'
import './renderer.css'

function renderBootFailure(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  root.replaceChildren()
  const panel = document.createElement('main')
  panel.className = 'desktop-boot-error'
  const eyebrow = document.createElement('p')
  eyebrow.textContent = 'Desktop product boot failed'
  const heading = document.createElement('h1')
  heading.textContent = 'Orbis AI could not start'
  const detail = document.createElement('pre')
  detail.textContent = message
  panel.append(eyebrow, heading, detail)
  root.append(panel)
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop renderer: missing #root')

void mountDesktopProduct(root).catch((error: unknown) => {
  console.error('[desktop-product] boot failed:', error)
  renderBootFailure(root, error)
})
