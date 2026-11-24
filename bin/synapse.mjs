#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openStore, synapseHome } from '../lib/db.mjs'
import { projectIdOf, projectRoot } from '../lib/project.mjs'
import { buildPack } from '../lib/pack.mjs'
import { consolidate } from '../lib/consolidate.mjs'
import { acceptRun, discardRun, finishRun, reviewRun, startRun } from '../lib/run.mjs'

const [cmd, sub, ...rest] = process.argv.slice(2)
const root = projectRoot()
const pid = projectIdOf(root)
const store = openStore(join(synapseHome(), 'brain.sqlite'))
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))
const show = (rows) => rows.map((r) => `${r.id}  ${r.type}/${r.status}  ${r.text}`).join('\n') || 'none'

try {
  if (cmd === 'memory') {
    if (sub === 'list') out(show(store.list(pid)))
    else if (sub === 'search') out(show(store.search(pid, rest.join(' '))))
    else if (sub === 'remember') {
      const [type, ...text] = rest
      store.add({ projectId: pid, type, text: text.join(' '), status: 'approved', source: 'user' })
      out('saved, approved by you')
    } else if (sub === 'approve' || sub === 'forget') {
      const r = store.get(rest[0])
      if (!r || r.project_id !== pid) throw new Error('no such memory in this project')
      if (sub === 'approve') store.setStatus(r.id, 'approved')
      else store.forget(r.id)
      out(`${sub}d ${r.id}`)
    } else if (sub === 'consolidate') out(consolidate(store, pid))
    else throw new Error('memory list|search <q>|remember <type> <text>|approve <id>|forget <id>|consolidate')
  } else if (cmd === 'pack') {
    out(buildPack(store, { projectId: pid, prompt: [sub, ...rest].join(' ') }))
  } else if (cmd === 'plan' && sub === 'accept') {
    out(startRun(store, { projectId: pid, root, plan: JSON.parse(readFileSync(rest[0], 'utf8')), snapRoot: join(synapseHome(), 'snapshots') }))
  } else if (cmd === 'plan' && sub === 'status') {
    out(reviewRun(store, pid) ?? 'no run')
  } else if (cmd === 'finish') {
    out(finishRun(store, { projectId: pid }))
  } else if (cmd === 'accept') {
    out(acceptRun(store, { projectId: pid, digest: sub }))
  } else if (cmd === 'discard') {
    out(discardRun(store, { projectId: pid, digest: sub }))
  } else {
    out('usage: synapse memory|pack|plan accept <file>|plan status|finish|accept <digest>|discard <digest>')
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  store.close()
}
