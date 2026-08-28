# Absorb Anything

**Absorb any codebase into durable, reusable evidence.**

Absorb Anything is a local-first CLI for people (and AI agents) who read other people's code for a living. Point it at a repository you're evaluating, studying, or about to build on, and it gives that source a **home**: a place where checkouts, observations, analyses, and distilled knowledge accumulate, instead of evaporating when the terminal closes and the next chat session starts from zero.

```bash
absorb init                                      # one .absorb/ folder, right in your repo
absorb add https://github.com/qiskit/qiskit      # give a codebase a home
absorb log qiskit                                # how it changed since you last looked
absorb analysis new "Adopt the scheduler?" --for-source qiskit
absorb knowledge add pattern "Pulse schedules are immutable plans"
```

> Status: pre-release, not on npm yet. The commands above are the committed surface for the first release, not a mockup.

## The loop

Everything in Absorb Anything serves one loop:

```
sources/ ──▶ analyses/ ──▶ knowledge/
 absorb it    decide on it    keep what survived
```

A **source** is external code kept where its origin and its changes stay readable — a git checkout that syncs, or a one-time copy. An **analysis** is the working surface where you read it and reach a decision. **Knowledge** is what survived the decision and is worth reusing. Files all the way down: no server, no database, no account. Everything sits in a single `.absorb/` directory inside the repo you already work in; if evidence deserves a dedicated repo of its own, that's `absorb init --standalone`.

## Clone once. Reference everywhere.

The problem with studying code across projects is not disk space — it's re-reading. The same library gets cloned into five projects and understood five times from scratch.

Here, one workspace owns a source's home. Every other workspace links to it with a few dozen bytes:

```bash
absorb link ../research qiskit        # sources/qiskit/source.ref.yaml, that's the whole file
absorb sync qiskit                    # works from anywhere; writes through to the real home
absorb home qiskit                    # shows where the home actually is
```

A machine-local registry remembers every home you've created, so `absorb add` on a URL you already studied says so before you clone it again, and a broken link tells you where the home went.

## Evidence when the decision needs it

Recording is priced by what your decision is worth, not by what the tool can measure:

- Reading around? An entry is an alias and a date. Nothing else.
- Adopting or rejecting? Pin the commit (free for git sources).
- Need the bytes to survive upstream deletion? `absorb capture` snapshots them with an integrity hash.

Syncing never refuses to work because your checkout is dirty. Local experiments on someone else's code are how reading actually happens; the ledger records them as what they are.

## Built for AI agents

Agents misuse tools whose semantics live only in documentation. This CLI explains itself at the point of use:

```bash
absorb prime            # one screen: what each object is for, and the current workspace state
absorb explain source   # why an object exists, when not to use it, common misuses
```

Mutating commands end with a one-line reminder of the rule most often broken, and error messages state the correct model instead of just refusing. Session starts with `absorb prime`; everything downstream stays on-model.

## Part of a pair

Absorb Anything is the study half of a two-tool suite: its sibling package `own-work` manages what you build from the evidence — tasks, roadmaps, specs, systems — on the same on-disk workspace format. Use either alone, or both together.

**Absorb Anything. Build Your Own.**

## License

MIT.
