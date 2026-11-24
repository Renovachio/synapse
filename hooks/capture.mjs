#!/usr/bin/env node
// PreCompact, and Stop every 20 turns: proposes memories from the recent transcript. Proposals are stored as "proposed".
import { openStore, synapseHome } from '../lib/db.mjs'
import { projectIdOf, projectRoot, readInput, silenced } from '../lib/project.mjs'
import { applyProposals } from '../lib/capture.mjs'
import { claudeProposer } from '../lib/propose.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function transcriptText(path, maxChars = 12000) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-200)
  const out = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (e.type !== 'user' && e.type !== 'assistant') continue
      const c = e.message?.content
      const text =
        typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : ''
      if (text) out.push(`${e.type}: ${text}`)
    } catch {
      // skip malformed lines
    }
  }
  return out.join('\n').slice(-maxChars)
}

try {
  if (!silenced()) {
    const input = readInput()
    const store = openStore(join(synapseHome(), 'brain.sqlite'))
    const turnKey = `turns:${input.session_id ?? 'default'}`
    const isStop = input.hook_event_name === 'Stop'
    const turns = isStop ? store.incr(turnKey) : 0
    if (!isStop || turns % 20 === 0) {
      const root = projectRoot(input)
      const transcript = input.transcript_path ? transcriptText(input.transcript_path) : ''
      applyProposals(store, projectIdOf(root), claudeProposer()(transcript))
    }
    store.close()
  }
} catch {
  // Capture must never break a turn.
}
process.exit(0)
