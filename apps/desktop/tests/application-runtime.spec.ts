import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isModuleNavigationItem,
  moduleNavigationItems,
} from '../src/desktop-application-ui.ts'

const records = [
  {
    id: 'supplier-risk',
    label: 'Supplier Risk',
    page: 'home',
    group: 'procurement',
    moduleId: 'supplier-risk',
    moduleVersion: '1.4.0',
  },
  {
    id: 'payables',
    label: 'Payables',
    page: 'queue review',
    moduleId: 'finance/payables',
    moduleVersion: '2.0.1',
  },
] as const

void describe('enterprise application runtime navigation', () => {
  void it('converts governed OBIS navigation into collision-safe desktop routes', () => {
    const items = moduleNavigationItems(records)

    assert.deepEqual(items[0], {
      id: 'module:supplier-risk:supplier-risk',
      label: 'Supplier Risk',
      kind: 'module',
      route: '/apps/supplier-risk/home',
      icon: 'blocks',
      section: 'procurement',
      order: 1000,
      moduleId: 'supplier-risk',
      modulePageId: 'home',
      moduleVersion: '1.4.0',
    })
    assert.equal(items[1]?.route, '/apps/finance%2Fpayables/queue%20review')
    assert.equal(items[1]?.section, 'Apps')
    assert.equal(items[1]?.order, 1010)
  })

  void it('recognizes only fully resolved module navigation records', () => {
    const [item] = moduleNavigationItems(records)
    assert.ok(item)
    assert.equal(isModuleNavigationItem(item), true)
    assert.equal(isModuleNavigationItem({
      id: 'legacy-module',
      label: 'Legacy module',
      kind: 'module',
      route: '/legacy',
      order: 50,
      moduleId: 'legacy',
    }), false)
  })
})
