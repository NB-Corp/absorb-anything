# Split contract: extracting Absorb Anything from Assay v0.14.0

This repo is the study half of a three-product split of [Assay](https://github.com/X-T-E-R/assay). Code is **copy-ported** from the Assay repo at tag `v0.14.0` (local checkout: `../assay`); the Assay repo itself stays untouched in this wave. The authoritative task PRD lives at `../../.trellis/tasks/08-28-absorb-anything-split/prd.md` in the MetaSystem workspace; this file is the self-contained summary an implementer needs when working inside this repo.

## What this repo owns

- **Workspace envelope infrastructure** (the `absorb-anything-core` package): manifest schema, fail-closed envelope contract, mutation coordination locks, event ledger, atomic managed writes, migration runner, `init/adopt/convert/update/check/status` skeletons, Template mechanism with the study/solve/explore built-ins, Project identity (`project/project.yaml` id/name authority), the semantics-registry mechanism.
- **The evidence loop** (the `absorb-anything` CLI package, bin `absorb`): Source homes and content modes, source references (`source.ref.yaml`), the machine-local clone registry, capture/import, observations and advisories, Analysis, Knowledge, and this product's `prime`/`explain`/hints/teaching-error texts.

The CLI surface is **flattened**: `absorb add/sync/switch/link/home/unlink/capture/import/status/log/diff` are top-level (Source is the center of this product; the `source` prefix is dropped). `absorb analysis`, `absorb knowledge`, `absorb prime`, `absorb explain` stay as groups.

## What this repo must NOT absorb

- Task, Roadmap, Spec, System registry → they belong to [`build-your-own`](../../build-your-own), which depends on `absorb-anything-core`.
- Source adoption and the `status` Upstream adoption-reach reporting → they stay in Assay, which later becomes the thin stitching layer.

## Non-negotiable contracts

1. **The on-disk format is `.assay/` envelope 0.14, unchanged.** The directory name is contract, not brand. A workspace created by Assay 0.14 must be fully usable by `absorb`, and vice versa; each tool ignores the other's record types gracefully, and `check` must not flag them.
2. Toolchain parity with Assay: pnpm monorepo, biome, vitest, a `scripts/check.ps1`-equivalent full gate, `releases/NEXT.md` ledger, cli-smoke reading the version from the build.
3. README.md / README.zh.md positioning copy is owned by the planning session. Technical usage docs go under `docs/`; propose README changes in your report instead of editing them.
4. No push and no npm publish without explicit user authorization. Package names `absorb-anything` and `absorb-anything-core` were verified available on npm 2026-08-28.

## Where judgment is expected

Ambiguous module ownership (for example, how to trim the shared semantics registry per product) resolves by asking: *which product's user still needs this if the other product is not installed?* If still ambiguous, list it in your report rather than guessing.
