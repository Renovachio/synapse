# synapse

A Claude Code plugin that gives Claude a memory brain, and runs changes to your code under a plan you approve.

- **Memory brain.** Decisions, constraints, preferences and verified fixes are stored as typed records in one local SQLite file. Each prompt gets only the few records that match it, within a token budget, cited and labelled as data.
- **Capture.** Memories are proposed from your conversations automatically. Proposals start unapproved; only you approve them.
- **Safe runs.** A plan declares the paths it may change. Synapse snapshots the folder, blocks writes outside the plan, and keeps or discards the result only against the digest you reviewed.
- **Human-gated improvement.** Synapse measures how its recall behaves and proposes adjustments. Nothing changes until you approve and apply it, and any change can be reverted.

## Requirements

- Node 22.5 or newer (uses the built-in `node:sqlite`)
- Claude Code 2.1.275 or newer

## Install

**Easiest: the setup script.** It asks where to install (this project or every project) and where to get the plugin from (GitHub or this clone):

```sh
git clone https://github.com/Renovachio/synapse.git
cd synapse
make setup
```

Other targets:
- `make status`: is it installed, and where
- `make remove`: uninstall (asks first; `SYNAPSE_YES=1` skips the question)
- `make check`: run the tests and validate the plugin manifest
- Presets skip the questions: `make setup SCOPE=user FROM=github` (`SCOPE` is `local` or `user`; `FROM` is `github` or `here`)

**By hand, from GitHub:**

```sh
claude plugin marketplace add Renovachio/synapse
claude plugin install synapse@synapse
```

Start a new Claude Code session after installing so the hooks load.

## Commands

All commands run inside Claude Code. Each one also works from a terminal through `node bin/synapse.mjs <command>` in the project folder.

| Command | What it does |
| --- | --- |
| `/synapse:memory list` | Memories for this project, with ids and status |
| `/synapse:memory search <query>` | Full-text search within this project |
| `/synapse:memory remember <type> <text>` | Save a memory you wrote; it is approved at once |
| `/synapse:memory approve <id>` | Approve a proposed memory |
| `/synapse:memory forget <id>` | Soft-delete a memory; it leaves the index and every pack |
| `/synapse:memory consolidate` | Merge memories that state the same claim, keeping lineage |
| `/synapse:flag <id> [reason]` | Mark a recalled memory as wrong, for the next review |
| `/synapse:improve analyze` | Read recent recall data and write proposals |
| `/synapse:improve list` | Show proposals and their status |
| `/synapse:improve approve\|reject <id>` | Decide on a proposal |
| `/synapse:improve apply <id>` | Apply an approved proposal |
| `/synapse:improve revert <id>` | Undo an applied proposal |
| `/synapse:plan <request>` | Draft a plan with model tiers and declared paths; runs only after you say yes |
| `/synapse:finish` | End the run, measure the diff against the snapshot, show the digest |
| `/synapse:accept <digest>` | Keep the changes you reviewed |
| `/synapse:discard <digest>` | Restore the snapshot |

The terminal CLI also has `pack "<prompt>"` (print the pack a prompt would get) and `plan status`.

## Memory

**Types:** `episodic` (events and decisions), `semantic` (facts and constraints), `procedural` (steps that worked), `preference` (how you like to work), `working` (short-lived, with an expiry).

**Statuses:**
- `proposed`: captured automatically, not yet trusted
- `approved`: trusted; you approved it or wrote it with `remember`
- `superseded`: replaced by a newer record; the link is kept
- `disputed`: an approved record that a new proposal contradicts; you decide
- `deleted`: forgotten; the text is removed from the index

**Scope.** Each record belongs to a project. The project id is the git top level of the folder you work in, or the folder itself when there is no git. A query never returns another project's records unless it asks to cross projects, which only the internal API can do.

**Capture.** Synapse proposes memories on two triggers:
- before a compaction (PreCompact)
- every 20 turns (Stop)

The proposal call is one `claude -p --model haiku` run through your own Claude Code, with a 120-second timeout. Its output is validated: the type must be known, the text 8–400 characters, and at most 10 proposals per batch. Proposals containing secret-looking text are dropped, and near-duplicates of existing records are skipped. A proposal that contradicts a `proposed` record supersedes it. One that contradicts an `approved` record marks that record `disputed` and waits for you.

**Consolidation.** `consolidate` merges records of the same type with identical claims. The approved one, or else the oldest, is kept. The others become `superseded` with a `merged_into` link. Nothing is deleted.

## Recall and token budget

On each prompt, Synapse:

1. Searches the project's live records with full-text search (BM25), using the words of the prompt.
2. Ranks the matches by relevance, status (approved first), and recency.
3. Drops any record whose wording overlaps 70% or more with one already chosen.
4. Adds records while the pack stays within the budget.
5. Attaches the pack as context, headed by a note that the memory is reference data, not instructions.

The budget is 1200 tokens by default (estimated at four characters per token). Precedence: the `SYNAPSE_BUDGET` environment variable, then a budget applied through the improvement loop, then the default. A pack that matches nothing adds nothing.

Every fresh pack is logged with its token count, records used, records omitted, and the tokens saved against replaying the whole project. A pack is cached for the session until the store changes.

## Safe runs

1. **Plan.** `/synapse:plan` writes a JSON plan: up to 50 tasks, each with an id, a model tier (`haiku`, `sonnet` or `opus`, at most two `opus`), paths, and dependencies. Paths are relative. A trailing `/` means a folder. Absolute paths, `..`, `.git`, `.github`, `node_modules`, and secret-looking files (`.env*`, `*.pem`, `*.key`, `id_rsa`) are refused.
2. **Accept.** Once you say yes, Synapse snapshots the folder, excluding those paths and symbolic links. Limits are 5000 files and 200 MB. The run is now active.
3. **Guard.** While the run is active, a Write, Edit, MultiEdit or NotebookEdit outside the plan's paths is denied, and so is any write outside the project folder. With no active run, the guard lets everything through.
4. **Finish.** Synapse measures the diff against the snapshot and prints a digest. If anything changed outside the plan, the run fails and lists those files.
5. **Accept or discard.** `accept <digest>` keeps the changes; `discard <digest>` restores the snapshot. Both refuse unless the digest matches the folder as it is now, so you always act on exactly what you reviewed.

Only one run can be open per project.

## Improvement loop

Synapse records signals from every fresh pack and from the flags you set. `improve analyze` reads the last 50 packs (it needs at least 10) and writes proposals. It never changes a setting.

**Rules:**
- If at least 60% of recent packs reached 90% of their budget, and at least half of the candidate records were omitted, propose raising the budget by 300, up to 3000.
- If fewer than 10% of packs came near the budget and fewer than 5% of records were omitted, propose lowering it by 300, down to 400.
- If a flagged record was recalled, propose a review. This lists the records and changes no setting; you decide whether to forget them.

**Gate:** `pending` → `approved` (or `rejected`) → `applied`. Only `approve` and `apply` move a proposal forward. `apply` refuses any value outside 400–3000. `revert` restores the value that was in place before. Capture prompts and ranking code are never proposed for change.

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| `SYNAPSE_BUDGET` | 1200 tokens | Overrides the learned budget for every project |
| `SYNAPSE_HOME` | `~/.claude/synapse` | Where the database and snapshots live |

## Limits

- The write guard covers Write, Edit, MultiEdit and NotebookEdit only. Bash is not guarded, so a Bash command can still write anywhere your Claude permissions allow. The finish step still reports changes outside the plan.
- Memory stays on the machine it was captured on. There is no sync and no network call beyond Claude Code's own.
- Capture costs a haiku call at each trigger, and the Stop-time call can hold the turn up to 150 seconds.
- Search is lexical (BM25 with Unicode word matching). There are no embeddings, so a memory is found only when the prompt shares words with it.
- Installed Claude Code plugins run commands on your machine as you. Review the source before you install.

## Data

- Database: `$SYNAPSE_HOME/brain.sqlite`, one file for all projects. Tables: `records`, `links`, `fts`, `pack_log`, `flags`, `proposals`, `settings`, `runs`, `packs`, `meta`.
- Snapshots: `$SYNAPSE_HOME/snapshots/<run-id>/`

To remove all memory, delete the database and its `-wal` and `-shm` files.

## Layout

```
.claude-plugin/   plugin.json, marketplace.json
commands/         one Markdown file per /synapse:* command
hooks/            hooks.json, and the scripts it runs: prompt, guard, capture
lib/              db (store), text, pack, capture, propose, consolidate,
                  run (plans and guard), improve (loop), project, redact
bin/synapse.mjs   terminal CLI
scripts/          synapse.sh, the setup script behind make
tests/            node:test suites: store, pack, capture, run, improve
```

## Develop

```sh
npm test                 # 24 tests, node:test, no dependencies
claude plugin validate . # manifest check
make check               # both of the above
```

Hooks read their input from stdin as JSON and write decisions to stdout. The hooks, the CLI and the tests use the same modules.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Ideas from [helm](https://github.com/ninjanazal/helm) (MIT, Eurico Martins) and logbook (memory for Claude Code sessions, a sibling project); the plan, snapshot and digest flow from Dispatch's design. No code was copied from them.
