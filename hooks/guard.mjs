#!/usr/bin/env node
// PreToolUse for Write/Edit/MultiEdit/NotebookEdit. Denies a write outside the accepted plan while a run is active.
import { openStore, synapseHome } from '../lib/db.mjs'
import { projectIdOf, projectRoot, readInput, silenced } from '../lib/project.mjs'
import { guardDecision } from '../lib/run.mjs'
import { join } from 'node:path'

if (!silenced()) {
  const input = readInput()
  const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (filePath) {
    const root = projectRoot(input)
    let decision
    try {
      const store = openStore(join(synapseHome(), 'brain.sqlite'))
      decision = guardDecision(store, { projectId: projectIdOf(root), root, filePath })
      store.close()
    } catch (e) {
      // Fail closed: if the guard cannot decide, the write is refused.
      decision = { allow: false, reason: `guard error: ${e.message}` }
    }
    if (!decision.allow) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `synapse: ${decision.reason}`,
          },
        }),
      )
    }
  }
}
process.exit(0)
