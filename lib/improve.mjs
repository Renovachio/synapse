import { randomUUID } from 'node:crypto'

/**
 * Improvement loop, human-gated. analyze() only writes proposals. A proposal changes nothing until you approve
 * and apply it. Only the token budget can be changed, within BOUNDS. Capture prompts and ranking code are never touched.
 */
export const BOUNDS = { budget: { min: 400, max: 3000, step: 300, default: 1200 } }
export const budgetKey = (projectId) => `${projectId}:budget`

/** Env var (explicit user setting) > learned setting > default. */
export function budgetFor(store, projectId) {
  const env = Number(process.env.SYNAPSE_BUDGET)
  if (env) return env
  const v = store.getSetting(budgetKey(projectId))
  return v ? Number(v) : BOUNDS.budget.default
}

export function flag(store, { projectId, recordId, reason, now = Date.now() }) {
  const r = store.get(recordId)
  if (!r || r.project_id !== projectId) throw new Error('no such memory in this project')
  store.db
    .prepare('INSERT INTO flags (project_id, record_id, reason, created) VALUES (?,?,?,?)')
    .run(projectId, recordId, reason, now)
}

const round = (x) => Math.round(x * 100) / 100

function addProposal(store, raw, now) {
  const str = (v) => (v == null ? null : String(v))
  const p = { ...raw, from_value: str(raw.from_value), to_value: str(raw.to_value) }
  const dup = store.db
    .prepare("SELECT id FROM proposals WHERE project_id = ? AND kind = ? AND COALESCE(param,'') = COALESCE(?, '') AND COALESCE(to_value,'') = COALESCE(?, '') AND status = 'pending'")
    .get(p.projectId, p.kind, p.param, p.to_value)
  if (dup) return null
  const id = randomUUID()
  store.db
    .prepare('INSERT INTO proposals (id, project_id, kind, param, from_value, to_value, evidence, status, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, p.projectId, p.kind, p.param, p.from_value, p.to_value, JSON.stringify(p.evidence), 'pending', now, now)
  return id
}

/** Reads the last `window` packs and flags, and writes proposals. Returns what was proposed and why. */
export function analyze(store, projectId, { window = 50, now = Date.now() } = {}) {
  const rows = store.db
    .prepare('SELECT * FROM pack_log WHERE project_id = ? ORDER BY id DESC LIMIT ?')
    .all(projectId, window)
  if (rows.length < 10) return { created: [], reason: `need 10 packs, have ${rows.length}` }

  const current = budgetFor(store, projectId)
  const picked = rows.reduce((s, r) => s + r.picked, 0)
  const omitted = rows.reduce((s, r) => s + r.omitted, 0)
  const omitRatio = omitted / Math.max(1, picked + omitted)
  const nearBudget = rows.filter((r) => r.tokens >= r.budget * 0.9).length / rows.length
  const recalled = rows.flatMap((r) => JSON.parse(r.ids))
  const flagged = new Set(store.db.prepare('SELECT record_id FROM flags WHERE project_id = ?').all(projectId).map((r) => r.record_id))
  const flaggedRecalled = recalled.filter((id) => flagged.has(id))
  const evidence = { packs: rows.length, omitRatio: round(omitRatio), nearBudget: round(nearBudget), recalled: recalled.length, flaggedRecalled: flaggedRecalled.length }

  const created = []
  const { min, max, step } = BOUNDS.budget
  if (nearBudget > 0.6 && omitRatio > 0.5 && current < max) {
    const to = Math.min(max, current + step)
    const id = addProposal(store, { projectId, kind: 'budget', param: 'budget', from_value: current, to_value: to, evidence }, now)
    if (id) created.push(id)
  } else if (nearBudget < 0.1 && omitRatio < 0.05 && current > min) {
    const to = Math.max(min, current - step)
    const id = addProposal(store, { projectId, kind: 'budget', param: 'budget', from_value: current, to_value: to, evidence }, now)
    if (id) created.push(id)
  }
  if (flaggedRecalled.length) {
    const id = addProposal(store, { projectId, kind: 'review', param: null, from_value: null, to_value: JSON.stringify([...new Set(flaggedRecalled)]), evidence }, now)
    if (id) created.push(id)
  }
  return { created, evidence }
}

export const listProposals = (store, projectId) =>
  store.db.prepare('SELECT * FROM proposals WHERE project_id = ? ORDER BY created DESC').all(projectId)

const getProposal = (store, projectId, id) => {
  const p = store.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)
  if (!p || p.project_id !== projectId) throw new Error('no such proposal in this project')
  return p
}

const setStatus = (store, id, status, now) =>
  store.db.prepare('UPDATE proposals SET status = ?, updated = ? WHERE id = ?').run(status, now, id)

export function approve(store, { projectId, id, now = Date.now() }) {
  const p = getProposal(store, projectId, id)
  if (p.status !== 'pending') throw new Error(`proposal is ${p.status}, not pending`)
  setStatus(store, id, 'approved', now)
  return { id, status: 'approved' }
}

export function reject(store, { projectId, id, now = Date.now() }) {
  const p = getProposal(store, projectId, id)
  if (!['pending', 'approved'].includes(p.status)) throw new Error(`proposal is ${p.status}`)
  setStatus(store, id, 'rejected', now)
  return { id, status: 'rejected' }
}

/** Applies an approved proposal. Refuses any value outside BOUNDS. */
export function apply(store, { projectId, id, now = Date.now() }) {
  const p = getProposal(store, projectId, id)
  if (p.status !== 'approved') throw new Error('approve the proposal before applying it')
  if (p.kind === 'budget') {
    const to = Number(p.to_value)
    const { min, max } = BOUNDS.budget
    if (!Number.isInteger(to) || to < min || to > max) throw new Error(`budget ${p.to_value} is outside ${min}-${max}`)
    store.setSetting(budgetKey(projectId), to)
  }
  setStatus(store, id, 'applied', now)
  return { id, status: 'applied', note: p.kind === 'budget' ? `budget is now ${p.to_value}` : 'acknowledged; review the listed records and forget any that are wrong' }
}

/** Restores the value from before the proposal was applied. */
export function revert(store, { projectId, id, now = Date.now() }) {
  const p = getProposal(store, projectId, id)
  if (p.status !== 'applied') throw new Error(`proposal is ${p.status}, not applied`)
  if (p.kind === 'budget') store.setSetting(budgetKey(projectId), p.from_value)
  setStatus(store, id, 'reverted', now)
  return { id, status: 'reverted' }
}
