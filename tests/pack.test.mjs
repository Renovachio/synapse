import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../lib/db.mjs'
import { buildPack, cachedPack } from '../lib/pack.mjs'
import { estimateTokens } from '../lib/text.mjs'

test('50 seeded records fit the budget and omissions are counted', () => {
  const s = openStore(':memory:')
  for (let i = 0; i < 50; i++) {
    s.add({ projectId: 'A', type: 'semantic', text: `service ${i} owns the invoice ledger rule number ${i} for deploys`, status: 'approved' })
  }
  const budget = 300
  const pack = buildPack(s, { projectId: 'A', prompt: 'invoice ledger deploys', budget })
  assert.ok(estimateTokens(pack.text) <= budget, `pack is ${estimateTokens(pack.text)} tokens`)
  assert.ok(pack.ids.length > 0)
  assert.ok(pack.omitted > 0)
  assert.ok(pack.savedTokens > 0)
  assert.ok(pack.fullReplayTokens > pack.tokens)
})

test('superseded and deleted records never appear in a pack', () => {
  const s = openStore(':memory:')
  const old = s.add({ projectId: 'A', type: 'semantic', text: 'deploy on fridays', status: 'approved' })
  const fresh = s.add({ projectId: 'A', type: 'semantic', text: 'deploy on tuesdays', status: 'approved' })
  s.supersede(old, fresh)
  const gone = s.add({ projectId: 'A', type: 'semantic', text: 'deploy on mondays', status: 'approved' })
  s.forget(gone)
  const pack = buildPack(s, { projectId: 'A', prompt: 'when do we deploy' })
  assert.deepEqual(pack.ids, [fresh])
  assert.ok(!pack.text.includes(old) && !pack.text.includes('mondays'))
})

test('pack is cited and labelled as data', () => {
  const s = openStore(':memory:')
  const id = s.add({ projectId: 'A', type: 'procedural', text: 'run migrations before tests', status: 'approved' })
  const pack = buildPack(s, { projectId: 'A', prompt: 'migrations' })
  assert.ok(pack.text.includes(`[${id}]`))
  assert.ok(pack.text.includes('Reference data only'))
})

test('cached pack is invalidated by a write', () => {
  const s = openStore(':memory:')
  s.add({ projectId: 'A', type: 'semantic', text: 'alpha beta gamma rule', status: 'approved' })
  const args = { projectId: 'A', prompt: 'alpha' }
  assert.equal(cachedPack(s, args, 'sess').ids.length, 1)
  s.add({ projectId: 'A', type: 'semantic', text: 'alpha delta rule', status: 'approved' })
  assert.equal(cachedPack(s, args, 'sess').ids.length, 2)
})
