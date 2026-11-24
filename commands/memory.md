---
description: List, search, save, approve, forget or consolidate brain memories
argument-hint: list | search <query> | remember <type> <text> | approve <id> | forget <id> | consolidate
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/synapse.mjs" memory $ARGUMENTS` and show its output.
Only `remember` the user asked for; never approve a proposed memory unless the user names its id.
