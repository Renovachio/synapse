import { TYPES } from './db.mjs'
import { containsSecret } from './redact.mjs'
import { jaccard, norm, words } from './text.mjs'

export const MAX_PROPOSALS = 10

/**
 * Validates model proposals and stores them as "proposed". Only an explicit user command approves a record.
 * A proposal that names a record it contradicts supersedes a proposed one; an approved one is marked disputed instead.
 */
export function applyProposals(store, projectId, proposals, now = Date.now()) {
  const out = { added: [], skipped: [], superseded: [], disputed: [] }
  if (!Array.isArray(proposals)) return out
  const active = store.list(projectId, ['approved', 'proposed'], now)

  for (const p of proposals.slice(0, MAX_PROPOSALS)) {
    const text = typeof p?.text === 'string' ? p.text.replace(/\s+/g, ' ').trim() : ''
    if (!TYPES.includes(p?.type) || text.length < 8 || text.length > 400) {
      out.skipped.push('invalid')
      continue
    }
    if (containsSecret(text)) {
      out.skipped.push('secret')
      continue
    }
    const set = words(text)
    if (active.some((r) => norm(r.text) === norm(text) || jaccard(words(r.text), set) >= 0.8)) {
      out.skipped.push('duplicate')
      continue
    }
    const id = store.add({ projectId, type: p.type, text, status: 'proposed', source: 'capture', now })
    out.added.push(id)
    active.push({ id, text, type: p.type, status: 'proposed', project_id: projectId })

    const old = typeof p.supersedes === 'string' ? store.get(p.supersedes) : null
    if (old && old.project_id === projectId && ['approved', 'proposed'].includes(old.status)) {
      if (old.status === 'approved') {
        store.setStatus(old.id, 'disputed', now)
        store.link(id, old.id, 'contradicts')
        out.disputed.push(old.id)
      } else {
        store.supersede(old.id, id, now)
        out.superseded.push(old.id)
      }
    }
  }
  return out
}
