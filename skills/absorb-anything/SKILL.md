---
name: absorb-anything
description: "Use when studying, evaluating, or absorbing external codebases and material through the absorb CLI or an .absorb evidence workspace: initializing overlay or standalone workspaces, giving a repository a durable Source home, linking a source another workspace already tracks instead of re-cloning, syncing and observing upstream changes, capturing decision-critical bytes, running source-bound Analyses to an explicit exit, and promoting durable findings into Knowledge. Not for tracking your own project's tasks, roadmaps, or specs — that is the build half of the suite, a separate tool."
---

# Absorb Anything

Absorb anything you study — code, papers, reference projects — into durable, reusable evidence. One workspace gives each studied source a home — checkout, observation ledger, analyses, and distilled knowledge accumulate in plain files instead of evaporating with the session.

## Prerequisites

- Node.js >=22.13.0 and pnpm 11 (pinned by the repository).
- This skill lives inside the `absorb-anything` repo and runs the repo's CLI directly — there is no bundled copy. Install by junctioning `<repo>/skills/absorb-anything` into a skills directory; the launcher resolves back to the repo through the junction.
- Invoke via the skill-local launcher `scripts/absorb.mjs`; it walks up to the repo and runs the built CLI at `packages/absorb-anything/dist/cli.js`. `dist/` is a build artifact (not committed) — build once at the repo root with `pnpm install --frozen-lockfile && pnpm build`.

```bash
node <skill-root>/scripts/absorb.mjs <command>
```

## Session ritual

The CLI teaches its own semantics; the skill does not restate them.

- Run `absorb prime` once per session: one screen of object semantics plus the current workspace state.
- Run `absorb explain <topic>` before first use of an object (`workspace`, `project`, `source`, `analysis`, `knowledge`): purpose, when not to use it, common misuses, commands.
- Mutating commands end with a point-of-use hint, and errors state the correct model instead of just refusing. Read them; they are the semantics arriving exactly when needed.

## CLI quick reference

Source verbs are top level — the product has no `source` prefix.

```bash
# Workspace lifecycle
absorb init [dir] [--name <project>] [--template study|solve|explore|<yaml>]  # overlay by default: one .absorb/ in the current repo
absorb init --standalone                     # dedicated evidence workspace with work folders at the root
absorb check [--advisories]                  # structure + persisted-record integrity
absorb status [alias] [--json]               # workspace counts, or one Source's state
absorb update --dry-run                      # always dry-run first
absorb migrate-envelope                      # rename a legacy envelope directory to .absorb; idempotent, bytes untouched

# Orientation
absorb prime [--json]
absorb explain <topic> [--json]

# Sources
absorb add <repo-or-dir> [alias] [--branch <b>]     # give external material a home here
absorb link <workspace> <source> [--alias <local>]  # reference a Source that already has a home
absorb link <source>                                # clone registry resolves the home
absorb home <alias>                                 # where an alias actually lives
absorb unlink <alias>                               # forget the local reference; the home is untouched
absorb sync [alias] [--branch <b>] [--ref <r>] [--class same|patch|normal|major|replacement]
absorb switch <alias> <branch-or-ref> [--sync]
absorb capture <alias> [--note <text>]              # preserve current bytes with an integrity hash
absorb import <alias> <dir-or-archive>              # replace copied content; prior bytes are preserved first
absorb log <alias>                                  # observation ledger
absorb diff <alias> [--since <observation>]

# Analysis and Knowledge
absorb analysis new "Title" [--for-source <alias>] [--observation <id>]
absorb analysis close <path> --exit adopt|reject|experiment [--note <text>]
absorb knowledge add pattern|guide|troubleshooting "Title" [--from-analysis <path>]
```

## The loop

```text
sources/ ──▶ analyses/ ──▶ knowledge/
 absorb it    decide on it    keep what survived
```

Each step must produce content before it counts as done: an analysis with an empty `## Key observations` is a file, not a decision. Close analyses with an explicit exit; promote findings with `knowledge add`, optionally `--from-analysis`.

## Discipline

- **Link before add.** One upstream has one home. If another workspace tracks the material, `absorb link` shares its checkout, ledger, and brief; a second `add` starts a competing record. When `add` prints an advisory naming an existing home, that is this decision arriving late — prefer the link it suggests. Writes through a reference (`sync`, `capture`, `import`, `switch`) land in the home and say so before starting.
- **Pin at the tier the decision needs.** Tier 0 is the default and free: alias, date, and the commit for a Git source. Tier 1 is identity — commit and origin, or an on-demand tree hash for copied content — when an adopt/reject cites it. Tier 2 is `capture`: bytes with an integrity hash, for when the bytes themselves must survive. Record what this decision needs, not everything recordable.
- **Sync never refuses.** Local modifications become an advisory in the observation, not an error; Git protects the bytes. Copied content has no upstream — replace it with `import`, which preserves what it replaces.
- **Broken references stay local.** Only that alias fails; the rest of the workspace works. Repair by linking again at the new location (the error suggests one when the registry knows it), never by editing files under another workspace's `sources/`.
- **Overlay is the default shape.** Work areas resolve under one `.absorb/` directory in the repo you are already in; `--standalone` is the explicit choice for a dedicated evidence workspace.

## Anti-rules

- Do not `absorb add` material another workspace already tracks; link it.
- Do not hand-write a reference shell or hand-repair a broken one; a reference names a home and the home holds the state.
- Do not `capture` on every look; a capture is a byte-level record, not a semantic approval.
- Do not let `knowledge/` become an inbox; analyses hold work in progress, `knowledge add` promotes what survived.
- Do not treat copied or captured bytes as absorbed; a copy without an Analysis exit is unfinished work.
- Do not browse `.absorb/` internals by hand for state that `status`, `log`, `diff`, and `home` already answer.

## Validation

After init, update, migrate-envelope, or any adoption of an existing directory:

```bash
absorb check
absorb status
```

`check --advisories` adds opt-in workflow reminders (for example, open analysis drafts); the default check covers structure and persisted-record integrity.

## Final response checklist

Report:

- Target root, workspace shape (overlay or standalone), and the commands used.
- Which Source, Analysis, and Knowledge records were produced or updated — and **what was actually evaluated, not just created**: what the latest observations show, which analyses closed with which exits, which drafts remain open.
- Any advisories or broken references left standing, and the repair already suggested.
- The next absorption, analysis close, or knowledge promotion worth doing.
