import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

export const MODELS = ['haiku', 'sonnet', 'opus']
export const LIMITS = { files: 5000, bytes: 200 * 1024 * 1024 }
const SECRET_NAME = /^\.env|\.(pem|key|p12)$|^id_(rsa|ed25519|ecdsa)(\.pub)?$/

/** Paths never snapshotted, never writable in a run. */
export function forbidden(rel) {
  const parts = rel.split('/')
  return parts.some((p) => p === '.git' || p === '.github' || p === 'node_modules') || SECRET_NAME.test(parts.at(-1))
}

export function normalizeScope(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('empty path in plan')
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) throw new Error(`absolute path not allowed: ${p}`)
  const dir = p.endsWith('/')
  const clean = posix.normalize(p).replace(/^\.\//, '').replace(/\/+$/, '')
  if (!clean || clean === '.' || clean.split('/').includes('..')) throw new Error(`path not allowed: ${p}`)
  if (forbidden(clean)) throw new Error(`path not allowed in a plan: ${p}`)
  return dir ? `${clean}/` : clean
}

export function validatePlan(plan) {
  const tasks = plan?.tasks
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 50) throw new Error('a plan needs 1 to 50 tasks')
  const ids = new Set()
  const scopes = new Set()
  let opus = 0
  for (const t of tasks) {
    if (typeof t?.id !== 'string' || !t.id || ids.has(t.id)) throw new Error(`bad or duplicate task id: ${t?.id}`)
    ids.add(t.id)
    if (!MODELS.includes(t.model)) throw new Error(`task ${t.id}: model must be haiku, sonnet or opus`)
    if (t.model === 'opus') opus++
    if (!Array.isArray(t.paths) || t.paths.length === 0) throw new Error(`task ${t.id}: needs paths`)
    for (const p of t.paths) scopes.add(normalizeScope(p))
  }
  for (const t of tasks) {
    for (const d of t.depends_on ?? []) {
      if (!ids.has(d) || d === t.id) throw new Error(`task ${t.id}: bad dependency ${d}`)
    }
  }
  if (opus > 2) throw new Error('at most 2 opus tasks')
  return { tasks, scopes: [...scopes] }
}

export const inScope = (rel, scopes) => scopes.some((s) => (s.endsWith('/') ? rel.startsWith(s) : rel === s))

/** Map of relative path to sha256 for every snapshot-eligible file under root. */
export function manifest(root) {
  const out = new Map()
  let files = 0
  let bytes = 0
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (ent.isSymbolicLink() || forbidden(rel)) continue
      if (ent.isDirectory()) {
        walk(abs)
        continue
      }
      if (!ent.isFile()) continue
      files++
      bytes += statSync(abs).size
      if (files > LIMITS.files || bytes > LIMITS.bytes) {
        throw new Error(`folder too large for a run: limit ${LIMITS.files} files or ${LIMITS.bytes} bytes`)
      }
      out.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(root)
  return out
}

export function diffEntries(before, after) {
  const changes = []
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(path) ?? null
    const a = after.get(path) ?? null
    if (a !== b) changes.push({ path, before: b, after: a })
  }
  return changes
}

export const digestOf = (changes) => createHash('sha256').update(JSON.stringify(changes)).digest('hex')

const activeRun = (db, projectId, statuses) => {
  const ph = statuses.map(() => '?').join(',')
  return db
    .prepare(`SELECT * FROM runs WHERE project_id = ? AND status IN (${ph}) ORDER BY created DESC LIMIT 1`)
    .get(projectId, ...statuses)
}

const setRun = (store, id, status, digest, now) => {
  store.db.prepare('UPDATE runs SET status = ?, digest = ?, updated = ? WHERE id = ?').run(status, digest, now, id)
  store.incr('version')
}

const changesOf = (run) => diffEntries(manifest(run.snapshot), manifest(run.root))

/** Validates the plan, snapshots the folder and starts the run. The write guard is active from here until finish. */
export function startRun(store, { projectId, root, plan, snapRoot, now = Date.now() }) {
  const open = activeRun(store.db, projectId, ['active', 'review', 'failed'])
  if (open) throw new Error(`run ${open.id} is ${open.status}; finish or discard it first`)
  const { tasks, scopes } = validatePlan(plan)
  const id = randomUUID()
  const snap = join(snapRoot, id)
  const files = manifest(root)
  for (const rel of files.keys()) {
    mkdirSync(dirname(join(snap, rel)), { recursive: true })
    copyFileSync(join(root, rel), join(snap, rel))
  }
  store.db
    .prepare('INSERT INTO runs (id, project_id, root, status, plan, snapshot, digest, created, updated) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, projectId, root, 'active', JSON.stringify({ tasks, scopes }), snap, null, now, now)
  store.incr('version')
  return { id, scopes, files: files.size }
}

/** Decides one write. Only an active run restricts writes; with no run the guard lets everything through, as Dispatch's plugin mode does. */
export function guardDecision(store, { projectId, root, filePath }) {
  const run = activeRun(store.db, projectId, ['active'])
  if (!run) return { allow: true }
  const rel = relative(root, resolve(root, filePath)).split(sep).join('/')
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return { allow: false, reason: 'write is outside the project folder' }
  if (forbidden(rel)) return { allow: false, reason: `${rel} is protected` }
  const { scopes } = JSON.parse(run.plan)
  if (!inScope(rel, scopes)) return { allow: false, reason: `${rel} is outside the accepted plan (${scopes.join(', ')})` }
  return { allow: true }
}

/** Measures the diff against the snapshot. Any change outside the plan fails the run and names the files. */
export function finishRun(store, { projectId, now = Date.now() }) {
  const run = activeRun(store.db, projectId, ['active', 'review', 'failed'])
  if (!run) throw new Error('no active run')
  const { scopes } = JSON.parse(run.plan)
  const changes = changesOf(run)
  const digest = digestOf(changes)
  const outside = changes.filter((c) => !inScope(c.path, scopes)).map((c) => c.path)
  const status = outside.length ? 'failed' : 'review'
  setRun(store, run.id, status, digest, now)
  return { id: run.id, status, digest, changes, outside }
}

function checkedRun(store, projectId, statuses, digest) {
  const run = activeRun(store.db, projectId, statuses)
  if (!run) throw new Error(`no run is ${statuses.join(' or ')}`)
  if (digestOf(changesOf(run)) !== digest) {
    throw new Error('the folder changed since the review; run synapse finish again and review the new digest')
  }
  return run
}

/** Keeps the changes. Refused unless the digest matches what was reviewed. */
export function acceptRun(store, { projectId, digest, now = Date.now() }) {
  const run = checkedRun(store, projectId, ['review'], digest)
  setRun(store, run.id, 'accepted', digest, now)
  return { id: run.id, status: 'accepted' }
}

/** Restores the snapshot: changed and removed files come back, added files are deleted. Refused unless the digest matches. */
export function discardRun(store, { projectId, digest, now = Date.now() }) {
  const run = checkedRun(store, projectId, ['review', 'failed'], digest)
  for (const c of changesOf(run)) {
    const dst = join(run.root, c.path)
    if (c.before === null) {
      unlinkSync(dst)
    } else {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(join(run.snapshot, c.path), dst)
    }
  }
  setRun(store, run.id, 'discarded', digest, now)
  return { id: run.id, status: 'discarded' }
}

export function reviewRun(store, projectId) {
  const run = activeRun(store.db, projectId, ['active', 'review', 'failed'])
  if (!run) return null
  const changes = changesOf(run)
  const { scopes } = JSON.parse(run.plan)
  return {
    id: run.id,
    status: run.status,
    digest: digestOf(changes),
    changes,
    outside: changes.filter((c) => !inScope(c.path, scopes)).map((c) => c.path),
  }
}
