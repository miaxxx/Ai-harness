/** Orbis occupants for the Desktop product's shared brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './desktop-brand.module.css'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Render the compact Orbis monogram while leaving the expanded row to the wordmark.
 * @param props - Sidebar presentation state.
 * @returns The compact monogram, or no mark beside the expanded wordmark.
 */
export function OrbisSidebarMark({ wide }: SidebarBrandMarkOwnerProps) {
  return wide ? null : <span className={css.monogram}>O</span>
}

/**
 * Render the Desktop product wordmark.
 * @param _props - Empty owner share from the sidebar.
 * @returns The Orbis wordmark.
 */
export function OrbisSidebarName(_props: SidebarBrandNameOwnerProps) {
  return <span className={css.name}>Orbis</span>
}

/**
 * Suppress the generic hero mark; the Orbis AI headline carries the identity.
 * @param _props - Hero mark presentation supplied by the host.
 * @returns No mark.
 */
export function OrbisHeroMark(_props: HeroBrandMarkOwnerProps): null {
  return null
}

/**
 * Register the Orbis identity in every Desktop brand slot.
 * @param ctx - Desktop client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OrbisSidebarMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, OrbisSidebarName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OrbisHeroMark)
      })))
}
