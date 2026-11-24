import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../lib/db.mjs'
import { analyze, apply, approve, budgetFor, flag, reject, revert } from '../lib/improve.mjs'

// Seeds pack_log rows as if 12 packs had been built near a 1200-token budget with many omissions.
function seedNearBudget(s, pid, n = 12) {
  for (let i = 0; i < n; i++) {
    s.db
      .prepare('INSERT INTO pack_log (project_id, session, tokens, picked, omitted, saved, budget, ids, created) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(pid, 's', 1150, 5, 10, 900, 1200, JSON.stringify([]), i)
  }
}

test('analyze needs at least 10 packs and proposes nothing before that', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P', 5)
  assert.deepEqual(analyze(s, 'P').created, [])
})

test('analyze proposes a budget increase only; nothing changes until approve and apply', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P')
  const { created } = analyze(s, 'P')
  assert.equal(created.length, 1)
  assert.equal(budgetFor(s, 'P'), 1200, 'analyze alone changes no setting')
  approve(s, { projectId: 'P', id: created[0] })
  assert.equal(budgetFor(s, 'P'), 1200, 'approve alone changes no setting')
  apply(s, { projectId: 'P', id: created[0] })
  assert.equal(budgetFor(s, 'P'), 1500)
  revert(s, { projectId: 'P', id: created[0] })
  assert.equal(budgetFor(s, 'P'), 1200, 'revert restores the previous value')
})

test('a proposal is applied only after approval and cannot be approved twice', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P')
  const [id] = analyze(s, 'P').created
  assert.throws(() => apply(s, { projectId: 'P', id }), /approve the proposal/)
  approve(s, { projectId: 'P', id })
  assert.throws(() => approve(s, { projectId: 'P', id }), /not pending/)
  assert.equal(reject(s, { projectId: 'P', id }).status, 'rejected')
})

test('apply refuses a budget outside the bounds', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P')
  const [id] = analyze(s, 'P').created
  s.db.prepare("UPDATE proposals SET to_value = '99999' WHERE id = ?").run(id)
  approve(s, { projectId: 'P', id })
  assert.throws(() => apply(s, { projectId: 'P', id }), /outside 400-3000/)
  assert.equal(budgetFor(s, 'P'), 1200)
})

test('a flagged memory that was recalled yields a review proposal, not a parameter change', () => {
  const s = openStore(':memory:')
  const bad = s.add({ projectId: 'P', type: 'semantic', text: 'deploys happen on fridays', status: 'approved' })
  for (let i = 0; i < 12; i++) {
    s.db
      .prepare('INSERT INTO pack_log (project_id, session, tokens, picked, omitted, saved, budget, ids, created) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('P', 's', 100, 1, 0, 0, 1200, JSON.stringify([bad]), i)
  }
  flag(s, { projectId: 'P', recordId: bad, reason: 'wrong' })
  const { created } = analyze(s, 'P')
  const p = s.db.prepare("SELECT * FROM proposals WHERE kind = 'review'").get()
  assert.ok(created.includes(p.id))
  assert.equal(p.kind, 'review')
  assert.equal(p.param, null)
  assert.ok(JSON.parse(p.to_value).includes(bad))
  assert.equal(s.get(bad).status, 'approved', 'flagging does not forget the record')
})

test('repeated analyze does not duplicate a pending proposal', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P')
  analyze(s, 'P')
  assert.deepEqual(analyze(s, 'P').created, [])
})

test('proposals and flags are scoped to their project', () => {
  const s = openStore(':memory:')
  seedNearBudget(s, 'P')
  const [id] = analyze(s, 'P').created
  assert.throws(() => approve(s, { projectId: 'Q', id }), /no such proposal/)
  const other = s.add({ projectId: 'Q', type: 'semantic', text: 'belongs to project q', status: 'approved' })
  assert.throws(() => flag(s, { projectId: 'P', recordId: other, reason: 'x' }), /no such memory/)
})
