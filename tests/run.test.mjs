import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openStore } from '../lib/db.mjs'
import { projectIdOf } from '../lib/project.mjs'
import { acceptRun, discardRun, finishRun, guardDecision, normalizeScope, startRun, validatePlan } from '../lib/run.mjs'

const PLAN = { tasks: [{ id: 't1', model: 'sonnet', paths: ['src/'] }] }

function project() {
  const root = mkdtempSync(join(tmpdir(), 'synapse-proj-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1\n')
  writeFileSync(join(root, 'README.md'), 'readme\n')
  writeFileSync(join(root, '.env'), 'TOKEN=secret\n')
  return root
}

test('plan validation rejects bad paths, models and dependencies', () => {
  assert.throws(() => normalizeScope('../etc'), /not allowed/)
  assert.throws(() => normalizeScope('/abs/path'), /absolute/)
  assert.throws(() => normalizeScope('.env'), /not allowed/)
  assert.throws(() => validatePlan({ tasks: [{ id: 'x', model: 'gpt', paths: ['a'] }] }), /model/)
  assert.throws(() => validatePlan({ tasks: [{ id: 'x', model: 'haiku', paths: ['a'], depends_on: ['nope'] }] }), /dependency/)
  assert.throws(() => validatePlan({ tasks: [1, 2, 3].map((i) => ({ id: `o${i}`, model: 'opus', paths: ['a'] })) }), /2 opus/)
  assert.deepEqual(validatePlan(PLAN).scopes, ['src/'])
})

test('guard allows writes inside the plan and denies outside it while a run is active', () => {
  const root = project()
  const s = openStore(':memory:')
  const snapRoot = mkdtempSync(join(tmpdir(), 'synapse-snap-'))
  assert.equal(guardDecision(s, { projectId: 'P', root, filePath: 'README.md' }).allow, true, 'no run: allowed')
  startRun(s, { projectId: 'P', root, plan: PLAN, snapRoot })
  assert.equal(guardDecision(s, { projectId: 'P', root, filePath: 'src/new.js' }).allow, true)
  const denied = guardDecision(s, { projectId: 'P', root, filePath: 'README.md' })
  assert.equal(denied.allow, false)
  assert.match(denied.reason, /outside the accepted plan/)
  assert.equal(guardDecision(s, { projectId: 'P', root, filePath: '../escape.js' }).allow, false)
  assert.equal(guardDecision(s, { projectId: 'P', root, filePath: '.env' }).allow, false)
})

test('snapshot excludes secrets; a change outside the plan fails the run and is named', () => {
  const root = project()
  const s = openStore(':memory:')
  const snapRoot = mkdtempSync(join(tmpdir(), 'synapse-snap-'))
  startRun(s, { projectId: 'P', root, plan: PLAN, snapRoot })
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 2\n')
  writeFileSync(join(root, 'README.md'), 'changed outside plan\n')
  const r = finishRun(s, { projectId: 'P' })
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.outside, ['README.md'])
  assert.equal(r.changes.some((c) => c.path === '.env'), false)
})

test('accept needs the reviewed digest; discard restores the snapshot', () => {
  const root = project()
  const s = openStore(':memory:')
  const snapRoot = mkdtempSync(join(tmpdir(), 'synapse-snap-'))
  startRun(s, { projectId: 'P', root, plan: PLAN, snapRoot })
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 2\n')
  writeFileSync(join(root, 'src', 'b.js'), 'export const b = 1\n')
  const r = finishRun(s, { projectId: 'P' })
  assert.equal(r.status, 'review')
  assert.throws(() => acceptRun(s, { projectId: 'P', digest: 'wrong' }), /changed since the review/)
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 3\n')
  assert.throws(() => acceptRun(s, { projectId: 'P', digest: r.digest }), /changed since the review/)
  const fresh = finishRun(s, { projectId: 'P' })
  assert.equal(acceptRun(s, { projectId: 'P', digest: fresh.digest }).status, 'accepted')
})

test('discard restores changed files and deletes added ones', () => {
  const root = project()
  const s = openStore(':memory:')
  const snapRoot = mkdtempSync(join(tmpdir(), 'synapse-snap-'))
  startRun(s, { projectId: 'P', root, plan: PLAN, snapRoot })
  writeFileSync(join(root, 'src', 'a.js'), 'changed\n')
  writeFileSync(join(root, 'src', 'b.js'), 'added\n')
  const r = finishRun(s, { projectId: 'P' })
  discardRun(s, { projectId: 'P', digest: r.digest })
  assert.equal(readFileSync(join(root, 'src', 'a.js'), 'utf8'), 'export const a = 1\n')
  assert.equal(existsSync(join(root, 'src', 'b.js')), false)
})

test('PreToolUse hook denies an out-of-plan write with a deny decision on stdout', () => {
  const root = project()
  const home = mkdtempSync(join(tmpdir(), 'synapse-home-'))
  const env = { ...process.env, SYNAPSE_HOME: home, CLAUDE_PROJECT_DIR: root, SYNAPSE_CAPTURE: '' }
  const s = openStore(join(home, 'brain.sqlite'))
  startRun(s, { projectId: projectIdOf(root), root, plan: PLAN, snapRoot: join(home, 'snapshots') })
  s.close()
  const hook = new URL('../hooks/guard.mjs', import.meta.url).pathname
  const run = (filePath) =>
    spawnSync('node', [hook], { input: JSON.stringify({ tool_input: { file_path: filePath } }), env, encoding: 'utf8' })
  const denied = run(join(root, 'README.md'))
  assert.equal(denied.status, 0)
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(run(join(root, 'src', 'ok.js')).stdout, '')
})
