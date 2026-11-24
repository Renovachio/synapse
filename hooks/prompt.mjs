#!/usr/bin/env node
// UserPromptSubmit: attaches a token-budgeted, cited memory pack as additional context. Never blocks a prompt.
import { openStore, synapseHome } from '../lib/db.mjs'
import { projectIdOf, projectRoot, readInput, silenced } from '../lib/project.mjs'
import { cachedPack } from '../lib/pack.mjs'
import { budgetFor } from '../lib/improve.mjs'
import { join } from 'node:path'

try {
  if (!silenced()) {
    const input = readInput()
    const root = projectRoot(input)
    const store = openStore(join(synapseHome(), 'brain.sqlite'))
    const projectId = projectIdOf(root)
    const pack = cachedPack(store, { projectId, prompt: input.prompt ?? '', budget: budgetFor(store, projectId) }, input.session_id)
    store.close()
    if (pack.text) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: pack.text } }),
      )
    }
  }
} catch {
  // Recall is an aid. If it fails, the prompt goes through unchanged.
}
process.exit(0)
