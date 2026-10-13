/** Effective model limits and reasoning advertised by the configured endpoint. */
import type { DesktopModelCapabilities, DesktopModelOverrides, DesktopReasoningLevel } from './shared.ts'

/** Canonical reasoning controls; providers advertise a subset and wire mapping. */
export const REASONING_LEVELS: readonly DesktopReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Parse manual overrides from IPC or durable JSON; empty fields mean automatic.
 * @param value - Untrusted override record.
 * @returns Validated positive token limits and optional reasoning selection.
 */
export function parseModelOverrides(value: unknown): DesktopModelOverrides {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型参数必须是对象')
  const row = value as Record<string, unknown>
  const result: DesktopModelOverrides = {}
  for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
    const item = row[key]
    if (item === undefined) continue
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) throw new Error('Token 上限必须为正整数')
    result[key] = item
  }
  if (row.reasoning !== undefined) {
    if (!REASONING_LEVELS.includes(row.reasoning as DesktopReasoningLevel)) throw new Error('不支持的思考强度')
    result.reasoning = row.reasoning as DesktopReasoningLevel
  }
  return result
}

/** Resolve manual overrides without modifying detected metadata.
 * @param capabilities - Endpoint or installed catalog evidence.
 * @param overrides - User supplied limits and reasoning.
 * @returns Effective capabilities, retaining metadata provenance.
 */
export function effectiveModelCapabilities(
  capabilities: DesktopModelCapabilities, overrides: DesktopModelOverrides = {},
): DesktopModelCapabilities {
  const result = { ...capabilities,
    ...(overrides.contextWindow === undefined ? {} : { contextWindow: overrides.contextWindow }),
    ...(overrides.maxOutputTokens === undefined ? {} : { maxOutputTokens: overrides.maxOutputTokens }),
  }
  if (result.contextWindow !== undefined && result.maxOutputTokens !== undefined && result.maxOutputTokens > result.contextWindow) {
    throw new Error('最大输出不能超过整个上下文窗口')
  }
  if (overrides.reasoning !== undefined && !Object.hasOwn(capabilities.reasoningEfforts ?? {}, overrides.reasoning)) {
    throw new Error('当前接口未声明支持所选思考强度，请选择自动或重新检测')
  }
  return result
}
