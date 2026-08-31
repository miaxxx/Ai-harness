/** Provider-neutral computer-control vocabulary. @module @deepseek-ai/dsh-computer/types */

import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

/** One application that a local Provider may inspect or operate. */
export interface ComputerApp { readonly id: string; readonly name: string }
/** One visible accessibility element. The id is valid only for the immediately preceding snapshot. */
export interface ComputerElement { readonly id: string; readonly role: string; readonly label: string; readonly enabled: boolean }
/** A bounded current view of one app. */
export interface ComputerSnapshot {
  readonly app: ComputerApp
  readonly title?: string
  readonly text: string
  readonly elements: readonly ComputerElement[]
  readonly screenshot?: SaveImageAttachment
}
/** An app-scoped input operation. */
export type ComputerAction =
  | { readonly kind: 'click'; readonly elementId: string }
  | { readonly kind: 'type'; readonly elementId: string; readonly text: string }
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'scroll'; readonly elementId: string; readonly direction: 'up' | 'down' }
/** A local desktop automation backend. */
export interface ComputerProvider {
  readonly id: string
  available(): boolean
  listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]>
  inspect(app: string, includeScreenshot: boolean, signal?: AbortSignal): Promise<ComputerSnapshot>
  act(app: string, action: ComputerAction, signal?: AbortSignal): Promise<ComputerSnapshot>
}
