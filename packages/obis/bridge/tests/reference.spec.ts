import { describe, expect, it } from 'vitest'
import { readObisBusinessReferences, serializeObisBusinessReference } from '../src/reference.ts'

describe('durable business selection', () => {
  it('round-trips labels while omitting untrusted permission and credential fields', () => {
    const reference = { kind: 'module' as const, projectId: 'procurement', environmentId: 'test',
      moduleId: 'supplier-risk', moduleVersion: '0.1.0', pageId: 'home', label: '供应商 "风险"\n管理',
      accessToken: 'must-not-serialize', allowed: true }
    const marker = serializeObisBusinessReference(reference)
    expect(readObisBusinessReferences(`查询供应商${marker}只读`)).toEqual([{
      kind: 'module', projectId: 'procurement', environmentId: 'test', moduleId: 'supplier-risk',
      moduleVersion: '0.1.0', pageId: 'home', label: reference.label,
    }])
    expect(marker).not.toContain('must-not-serialize')
    expect(marker).not.toContain('allowed')
  })

  it('rejects missing module identity and malformed persisted markers', () => {
    expect(() => readObisBusinessReferences('[obis-reference {"kind":"module","projectId":"p","environmentId":"e","label":"业务"}]')).toThrow('moduleId')
    expect(() => readObisBusinessReferences('[obis-reference invalid]')).toThrow()
    expect(() => readObisBusinessReferences('[obis-reference {}')).toThrow('Malformed')
    expect(readObisBusinessReferences('普通业务对话')).toEqual([])
  })
})
