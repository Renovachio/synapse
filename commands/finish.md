---
description: End the active run, measure the diff against the snapshot, and show the digest to review
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/synapse.mjs" finish` and show the changed files and the digest.
If `outside` is not empty, the run has failed: name those files and say the user can run `/synapse:discard <digest>`.
