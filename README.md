# synapse

A Claude Code plugin with one memory brain. It stores typed, scoped records in one local SQLite file, and each prompt gets only the few records that fit a token budget, cited and labelled as data. Plans run with a snapshot, a write guard that denies writes outside the plan, and a digest-bound accept or discard.

## Install
Requires Node 22.5 or newer and Claude Code 2.1.275 or newer.

**Easiest: the setup script.** It asks where to install (this project or every project) and from where (GitHub or this clone):
```sh
git clone https://github.com/Renovachio/synapse.git
cd synapse
make setup
```
Other targets: `make status`, `make remove`, `make check` (tests and plugin validation). Presets skip the questions: `make setup SCOPE=user FROM=github`.

**By hand, from GitHub:**
```sh
claude plugin marketplace add Renovachio/synapse
claude plugin install synapse@synapse
```

Start a new Claude Code session after installing so the hooks load.

## Use
- `/synapse:memory list | search <q> | remember <type> <text> | approve <id> | forget <id> | consolidate`
- `/synapse:plan <request>`: writes a plan with model tiers and declared paths; runs only after you say yes
- `/synapse:finish`, then `/synapse:accept <digest>` or `/synapse:discard <digest>`

Memory types: episodic, semantic, procedural, preference, working (with expiry). Captured records start as `proposed`. Only your `remember` or `approve` makes one `approved`.

## How it saves tokens
- Recall: the prompt is matched by full-text search (BM25) within the project, then packed under a budget (`SYNAPSE_BUDGET`, default 1200 tokens). Near-duplicates are dropped; the omitted count is reported.
- Superseded, deleted and expired records never enter a pack. A pack is cached per session until the store changes.

## Limits
- The write guard covers Write, Edit, MultiEdit and NotebookEdit. Bash is not guarded: a Bash command can still write anywhere your Claude permissions allow. The finish step still checks the diff against the snapshot.
- Memory is local to one machine and one user. Nothing is shared between machines, and no network call is made beyond Claude Code's own.
- Capture spends one haiku call through your own Claude Code at PreCompact and every 20 turns on Stop. That call can take up to 2 minutes.
- Lexical search only; no embeddings.

## Develop
```sh
npm test                      # node:test, no dependencies
claude plugin validate .
```
Storage: `$SYNAPSE_HOME/brain.sqlite` (default `~/.claude/synapse`). Snapshots: `$SYNAPSE_HOME/snapshots/`.

## Credits
Ideas from helm (MIT, Eurico Martins) and logbook; Dispatch's plan, snapshot and digest flow. No code copied.
