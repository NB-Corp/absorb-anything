# absorb-anything-core

Shared workspace infrastructure for the Absorb Anything suite. You probably want the [`absorb-anything`](https://www.npmjs.com/package/absorb-anything) CLI instead — this package is its engine, also consumed by the suite's build half, `own-work`.

It owns the on-disk workspace contract the suite's tools agree on:

- the fail-closed manifest and envelope (`.absorb/`, with one-way compatibility for the legacy envelope directory),
- mutation coordination locks and the append-only event ledger,
- atomic managed writes with crash recovery,
- workspace lifecycle: init (overlay by default), check, status, update, migration,
- Source homes, cross-workspace source references, the machine-local clone registry, observations and captures,
- Analysis and Knowledge records, object semantics, and the `prime`/`explain` texts.

APIs are TypeScript-first and file-backed; there is no server or database. The stability contract lives in the envelope version, not this package's minor version — workspaces refuse operations from incompatible tool versions instead of corrupting silently.

## License

MIT.
