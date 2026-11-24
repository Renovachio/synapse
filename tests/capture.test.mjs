import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../lib/db.mjs'
import { applyProposals } from '../lib/capture.mjs'

test('proposals with a secret are dropped and never stored', () => {
  const s = openStore(':memory:')
  const r = applyProposals(s, 'A', [
    { type: 'semantic', text: 'the staging key is sk-abcdefghijklmnopqrstuvwx ok' },
    { type: 'semantic', text: 'api_key = supersecretvalue123' },
    { type: 'semantic', text: 'use the billing service for refunds' },
  ])
  assert.deepEqual(r.skipped, ['secret', 'secret'])
  assert.equal(r.added.length, 1)
  assert.equal(s.list('A', ['proposed']).length, 1)
  assert.ok(!s.list('A', ['proposed'])[0].text.includes('sk-'))
})

test('duplicates are skipped and stored records are proposed, not approved', () => {
  const s = openStore(':memory:')
  applyProposals(s, 'A', [{ type: 'preference', text: 'prefer small pull requests' }])
  const r = applyProposals(s, 'A', [{ type: 'preference', text: 'Prefer small  pull requests' }])
  assert.deepEqual(r.skipped, ['duplicate'])
  assert.equal(s.list('A', ['approved']).length, 0)
})

test('a contradiction supersedes a proposed record and disputes an approved one', () => {
  const s = openStore(':memory:')
  const proposed = s.add({ projectId: 'A', type: 'semantic', text: 'release every week on monday', status: 'proposed' })
  const approved = s.add({ projectId: 'A', type: 'semantic', text: 'database is mysql 8 in production', status: 'approved' })
  const r = applyProposals(s, 'A', [
    { type: 'semantic', text: 'release every week on thursday', supersedes: proposed },
    { type: 'semantic', text: 'database is postgres 17 in production', supersedes: approved },
  ])
  assert.deepEqual(r.superseded, [proposed])
  assert.deepEqual(r.disputed, [approved])
  assert.equal(s.get(proposed).status, 'superseded')
  assert.equal(s.get(approved).status, 'disputed')
})

test('a proposal that names another project’s record is ignored for supersede', () => {
  const s = openStore(':memory:')
  const other = s.add({ projectId: 'B', type: 'semantic', text: 'owned by project b entirely', status: 'proposed' })
  const r = applyProposals(s, 'A', [{ type: 'semantic', text: 'project a has its own rule', supersedes: other }])
  assert.deepEqual(r.superseded, [])
  assert.equal(s.get(other).status, 'proposed')
})
