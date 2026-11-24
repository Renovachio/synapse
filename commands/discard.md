---
description: Restore the snapshot for a reviewed or failed run. Needs the digest shown by finish.
argument-hint: <digest>
---

Only run this when the user has typed the digest they saw: `node "${CLAUDE_PLUGIN_ROOT}/bin/synapse.mjs" discard $ARGUMENTS`.
Changed files are restored and added files are deleted. Never invent a digest.
