import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function projectRoot(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
}

/** Stable id for a project: the git top level if there is one, else the folder. */
export function projectIdOf(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const base = r.status === 0 ? r.stdout.trim() : root
  return createHash('sha256').update(base).digest('hex').slice(0, 16)
}

/** Hook input arrives as JSON on stdin. An empty or broken payload reads as {}. */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

export const silenced = () => Boolean(process.env.SYNAPSE_CAPTURE)
