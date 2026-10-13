/** Packaged Renderer acceptance for runtime theme styles and composer CSS. */
import type { BrowserWindow } from 'electron'

/**
 * Verify both palettes in the local Renderer, restoring its selected theme afterward.
 * @param window - The loaded product window owned by the native Main process.
 */
export async function verifyDesktopTheme(window: BrowserWindow): Promise<void> {
  const palette = await window.webContents.executeJavaScript(`(() => {
    const body = document.body
    const wasDark = body.hasAttribute('data-ds-dark-theme')
    const names = ['--dsw-alias-bg-base', '--dsw-specific-input-major', '--dsw-alias-border-l3']
    const read = () => names.map(name => getComputedStyle(body).getPropertyValue(name).trim())
    body.removeAttribute('data-ds-dark-theme')
    const light = read()
    body.setAttribute('data-ds-dark-theme', '')
    const dark = read()
    body.toggleAttribute('data-ds-dark-theme', wasDark)
    const composer = document.querySelector('[data-composer-card]')
    const composerBorder = composer === null ? '' : getComputedStyle(composer).borderTopWidth
    return { light, dark, composerBorder }
  })()`) as { light: string[]; dark: string[]; composerBorder: string }
  if (palette.light.some(value => value === '') || palette.dark.some(value => value === '')
    || palette.light[0] === palette.dark[0] || palette.light[1] === palette.dark[1]
    || palette.composerBorder === '' || palette.composerBorder === '0px') {
    throw new Error(`Desktop light/dark theme or composer styles did not apply: ${JSON.stringify(palette)}`)
  }
}
