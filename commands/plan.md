---
description: Draft a plan with model tiers and declared paths; it runs only after you accept it
argument-hint: <request>
---

Write a plan for: $ARGUMENTS

1. Write JSON to a file in the scratchpad: `{"tasks":[{"id":"t1","model":"haiku|sonnet|opus","goal":"...","paths":["src/","README.md"],"depends_on":[]}]}`. At most 50 tasks and 2 `opus` tasks. Paths are relative; a trailing `/` means a folder.
2. Show the plan to the user and wait for a clear yes.
3. Only after a yes, run `node "${CLAUDE_PLUGIN_ROOT}/bin/synapse.mjs" plan accept <file>`. This snapshots the folder and turns on the write guard: writes outside the plan's paths are denied until `finish`.
