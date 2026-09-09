import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enterpriseScopeNamespace,
  enterpriseSessionNamespace,
  sameEnterpriseRuntimeScope,
  type EnterpriseRuntimeScope,
} from '../src/desktop-enterprise-runtime-shared.ts'

const production: EnterpriseRuntimeScope = {
  tenantId: 'tenant/acme',
  projectId: 'finance ai',
  environmentId: 'production',
  installationId: 'desktop-1',
  userId: 'user-1',
}

test('enterprise runtime namespace is stable and path-safe', () => {
  assert.equal(
    enterpriseScopeNamespace(production),
    'tenant/tenant%2Facme/project/finance%20ai/environment/production',
  )
  assert.equal(
    enterpriseSessionNamespace(production, 'session/42'),
    'tenant/tenant%2Facme/project/finance%20ai/environment/production/session/session%2F42',
  )
})

test('scope equality includes tenant, project, environment, installation and user authority', () => {
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production }), true)
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production, tenantId: 'tenant-b' }), false)
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production, projectId: 'project-b' }), false)
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production, environmentId: 'staging' }), false)
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production, installationId: 'desktop-2' }), false)
  assert.equal(sameEnterpriseRuntimeScope(production, { ...production, userId: 'user-2' }), false)
  assert.equal(sameEnterpriseRuntimeScope(undefined, undefined), true)
  assert.equal(sameEnterpriseRuntimeScope(production, undefined), false)
})
