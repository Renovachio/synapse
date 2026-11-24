import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../lib/db.mjs'

test('search is scoped to the project; cross-project recall is opt-in', () => {
  const s = openStore(':memory:')
  s.add({ projectId: 'A', type: 'semantic', text: 'billing uses postgres', status: 'approved' })
  s.add({ projectId: 'B', type: 'semantic', text: 'billing uses mysql', status: 'approved' })
  assert.deepEqual(s.search('A', 'billing').map((r) => r.text), ['billing uses postgres'])
  assert.equal(s.search('A', 'billing', { crossProject: true }).length, 2)
})

test('forget removes the record from the full-text index', () => {
  const s = openStore(':memory:')
  const id = s.add({ projectId: 'A', type: 'preference', text: 'zebra quartz rule', status: 'approved' })
  assert.equal(s.search('A', 'quartz').length, 1)
  s.forget(id)
  assert.equal(s.search('A', 'quartz').length, 0)
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM fts WHERE fts MATCH 'quartz'").get().n, 0)
  assert.equal(s.get(id).status, 'deleted')
})

test('expired records are not searched', () => {
  const s = openStore(':memory:')
  s.add({ projectId: 'A', type: 'working', text: 'temporary aardvark note', status: 'approved', expires: 100 })
  assert.equal(s.search('A', 'aardvark', { now: 200 }).length, 0)
})
