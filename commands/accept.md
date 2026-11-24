---
description: Keep the reviewed run's changes. Needs the digest shown by finish.
argument-hint: <digest>
---

Only run this when the user has reviewed the diff and typed the digest they saw: `node "${CLAUDE_PLUGIN_ROOT}/bin/synapse.mjs" accept $ARGUMENTS`.
Never invent or copy a digest from memory; if the command refuses, the folder changed, so run `/synapse:finish` again.
