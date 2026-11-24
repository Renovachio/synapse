import { norm } from './text.mjs'

/**
 * Merges records that share type and an identical claim. The approved one, then the oldest, is kept.
 * Merged records stay in the store with a merged_into link, so lineage is never lost. Nothing is deleted.
 */
export function consolidate(store, projectId, now = Date.now()) {
  const groups = new Map()
  for (const r of store.list(projectId, ['approved', 'proposed'], now)) {
    const key = `${r.type}|${norm(r.text)}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const merged = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => (b.status === 'approved') - (a.status === 'approved') || a.created - b.created)
    const [keep, ...rest] = group
    for (const r of rest) {
      store.merge(r.id, keep.id, now)
      merged.push({ kept: keep.id, merged: r.id })
    }
  }
  return merged
}
