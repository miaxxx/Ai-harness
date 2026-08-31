/** Provider-neutral computer-control vocabulary. @module @deepseek-ai/dsh-computer/types */

import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

export type ComputerTargetKind = 'app' | 'browser-tab' | 'desktop'
export type ComputerTarget =
  | { readonly kind: 'app'; readonly id: string; readonly name: string }
  | { readonly kind: 'browser-tab'; readonly id: string; readonly name: string; readonly url?: string }
  | { readonly kind: 'desktop'; readonly id: 'desktop'; readonly name: 'Desktop' }

export type ComputerObservationMode = 'accessibility' | 'visual' | 'both'
export interface ComputerBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** One visible semantic element. The id is valid only for the observation that returned it. */
export interface ComputerElement {
  readonly id: string
  readonly role: string
  readonly label: string
  readonly value?: string
  readonly enabled: boolean
  readonly focused: boolean
  readonly bounds?: ComputerBounds
  readonly actions: readonly string[]
}
export interface ComputerAccessibilityObservation {
  readonly text: string
  readonly elements: readonly ComputerElement[]
  readonly partial?: boolean
}
export interface ComputerVisualObservation {
  readonly image: SaveImageAttachment
  readonly scope: 'desktop' | 'window' | 'browser-tab'
}
/** Bounded current state for exactly one target. */
export interface ComputerObservation {
  readonly id: string
  readonly target: ComputerTarget
  readonly title?: string
  readonly accessibility?: ComputerAccessibilityObservation
  readonly visual?: ComputerVisualObservation
}

export interface ComputerPoint { readonly x: number; readonly y: number }
export type ComputerAction =
  | { readonly kind: 'click'; readonly elementId?: string; readonly point?: ComputerPoint; readonly button: 'left' | 'right'; readonly count: 1 | 2 }
  | { readonly kind: 'drag'; readonly from: ComputerPoint; readonly to: ComputerPoint }
  | { readonly kind: 'set_value'; readonly elementId: string; readonly value: string }
  | { readonly kind: 'type_text'; readonly elementId?: string; readonly text: string }
  | { readonly kind: 'paste'; readonly elementId?: string; readonly text: string }
  | { readonly kind: 'key'; readonly key: string; readonly modifiers: readonly ('alt' | 'control' | 'meta' | 'shift')[] }
  | { readonly kind: 'scroll'; readonly elementId?: string; readonly point?: ComputerPoint; readonly direction: 'up' | 'down' | 'left' | 'right'; readonly amount: number }
  | { readonly kind: 'secondary_action'; readonly elementId: string }

export type ComputerErrorCode =
  | 'COMPUTER_PERMISSION_REQUIRED'
  | 'TARGET_NOT_FOUND'
  | 'WINDOW_UNAVAILABLE'
  | 'ELEMENT_EXPIRED'
  | 'ACTION_UNSUPPORTED'
  | 'CAPTURE_FAILED'

export class ComputerError extends Error {
  constructor(readonly code: ComputerErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options)
    this.name = 'ComputerError'
  }
}
export function computerError(code: ComputerErrorCode, message: string, cause?: unknown): ComputerError {
  return new ComputerError(code, message, cause === undefined ? undefined : { cause })
}

/** Stateless adapter over one or more target kinds. */
export interface ComputerProvider {
  readonly id: string
  readonly targetKinds: readonly ComputerTargetKind[]
  available(): boolean
  listTargets(signal?: AbortSignal): Promise<readonly ComputerTarget[]>
  observe(target: ComputerTarget, mode: ComputerObservationMode, signal?: AbortSignal): Promise<ComputerObservation>
  perform(target: ComputerTarget, action: ComputerAction, signal?: AbortSignal): Promise<ComputerObservation>
}
