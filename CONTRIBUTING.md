# Contributing

Contributions are welcome. This is a small, strict, offline TypeScript codebase: no application, no
server, no browser, no network in the test suite, so a clean clone is fully verifiable in one
command.

The fastest way in: read [Roadmap](README.md#roadmap) in the README. Every item names the interface
you would build against. For anything larger than a bug fix, open an issue describing the approach
first; it is much cheaper to agree on a seam than to redo a PR.

## Setup

Requirements:

- **Node 24.x** (`engines: >=24`, pinned in `.node-version`)
- **pnpm 9.15.0** (pinned via `packageManager`; `corepack enable pnpm` picks it up)

```bash
pnpm install --frozen-lockfile
pnpm build       # tsc -b across project references; also what produces packages/cli/dist
pnpm lint        # eslint . --max-warnings=0  (warnings fail)
pnpm typecheck   # tsc -b, same graph as build
pnpm test        # vitest run
pnpm clean       # tsc -b --clean
```

Lint, typecheck and test are exactly what CI runs (`.github/workflows/ci.yml`). Last verified run on
Node 24.14.0 and pnpm 10.34.3: lint clean, typecheck clean, 519 tests across 60 files in about five
seconds. If something fails right after a clean clone, suspect your Node or pnpm version first.

Run a subset while iterating:

```bash
pnpm vitest run packages/cli                      # one package
pnpm vitest run packages/cli/test/scan.test.ts    # one file
```

### The one extra script

`pnpm eval:dtcg-corpus` typechecks, then resolves a corpus of 20 public design-token files fetched
from GitHub by immutable blob SHA, printing determinism, p95 latency and peak heap. It asserts
recorded per-file expectations, so it fails loudly if resolution behaviour drifts. It needs network
access to `api.github.com`; set `GITHUB_TOKEN` or `GH_TOKEN` to avoid the anonymous rate limit. It
is deliberately outside CI. Run it if you touch `packages/context`, and update the recorded
expectations in `packages/context/test/fixtures/dtcg-real-corpus.json` in the same PR if a
behaviour change legitimately moves the numbers.

## What contributions are wanted

- **Roadmap items** from the README, in rough order of value: a `CaptureSource` adapter, a
  persistent `SnapshotStore`, a `ui-dna review` sign-off subcommand, more extractors and route
  adapters, Windows support, labeled fixtures for the eval harness.
- **Conformance bugs.** If you have a DTCG document that this resolver handles wrongly, a failing
  fixture in `packages/context/test/fixtures` plus the spec citation is an excellent PR on its own,
  even without the fix.
- **Diagnostics that are unclear.** A diagnostic message that does not tell the reader what to
  change is a bug.
- **Documentation that has drifted from behaviour.** Every transcript in the README is real output;
  if one no longer matches, that is a defect.

Two kinds of change need a discussion first: anything that makes output non-deterministic, and
anything that makes a core package read the filesystem or the network.

## Layout

Seven workspace packages under `packages/`, wired with TypeScript project references:

| Package | What it owns |
| --- | --- |
| `@uidna/schema` | The canonical schema: tokens, components, distributions, anchors, exceptions, per-field confidence and provenance, version metadata, approval state. Everything else depends on it. |
| `@uidna/context` | Static extraction: CSS custom properties, Tailwind v3 (`resolveConfig`) and v4 (`@theme` via PostCSS), DTCG `tokens.json`, brand config, changed-file to route mapping. Emits schema facts with confidence and provenance. |
| `@uidna/render` | The rendered-evidence *input port*. This repo never runs a browser; captured DOM geometry, screenshot refs and hashes arrive through this seam as data. |
| `@uidna/reconcile` | Merges code/config/pixel evidence for one logical field into a single resolved fact plus a recorded conflict trail. |
| `@uidna/store` | Immutable, content-addressed snapshots per repo; sign-off workflow; the authority and revocation log; the versioned downstream read contract; the design-to-code drift gate. |
| `@uidna/eval` | Measures the precedence ladder instead of assuming it: reconciliation precision/recall and confidence calibration (ECE, Brier) over labeled fixtures, with a CI floor. |
| `@uidna/cli` | The `ui-dna` command line. The only package that reads the filesystem; every other package takes strings and returns facts. Keep it that way when adding an extractor: parse in `context`, read the bytes here. |

Tests live in each package's `test/` directory next to `src/`. A hard rule the codebase follows
throughout: **tests never call a model, launch a browser, or hit the network.** Everything runs
against stubs and fixtures. Please keep it that way.

## Conventions that matter

- Strict TypeScript, NodeNext ESM, `verbatimModuleSyntax`. **Relative imports carry an explicit
  `.js` extension**, even from `.ts` files. This is the single most common thing a first PR gets
  wrong.
- Each package has its own `tsconfig.json` and is wired into the root `tsc -b` project-reference
  graph. **Dependencies flow strictly downward**: `schema` then `context`/`render` then `reconcile`
  then `store`/`eval`/`cli`. A new cross-package import that points sideways or upward will fail the
  build; that is intentional.
- **The schema is the contract.** Extractors fill it, consumers read it. Nothing invents a second
  wire shape for the same data.
- **Determinism is a requirement, not a nicety.** The same inputs must produce byte-identical
  output: sorted keys and arrays, no timestamps in serialized artifacts, content-hash invalidation
  rather than wall-clock TTL. Several golden fixtures assert exactly this, and they will catch you.
- **Abstain rather than guess.** When input is malformed or ambiguous, emit a diagnostic and leave
  the value out. A confidently wrong value is worse than a missing one, everywhere in this codebase.
- Lint runs with `--max-warnings=0`; a warning fails the build.

`examples/` holds synthetic inputs for the CLI: a DTCG token file, a rich sample project, a project
that declares nothing, and a runnable library example. They are fixtures that both the README's
transcripts and `packages/cli/test` run against, so changing one means updating both.

## Pull requests

- Branch from `main`, keep the PR focused on one thing, and include tests. New behaviour without a
  test will be asked for one.
- Run `pnpm lint && pnpm typecheck && pnpm test` before pushing. CI runs the same three.
- If your change alters CLI output, update the affected README transcript by pasting **real** output
  from your machine, not by hand-editing the old block.
- For a user-facing change (a new flag, a new command, a behaviour change), add a line under
  `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- Describe what you changed and why in plain prose. Commit messages here carry no attribution
  trailers; please match that.
- Reviews are done by the maintainer, usually within a few days. Expect questions about determinism
  and about which package owns the new code. A PR that is stalled on review is fair to ping.

Bare `#N` markers in some older source comments refer to an issue tracker that is not part of this
repository. Treat them as historical provenance, not as instructions.

## Releasing

Publishing is the maintainer's job and is documented in the README under
[Releasing](README.md#releasing): the six public `@uidna/*` packages ship together, keyed off a
`vX.Y.Z` tag, via `.github/workflows/release.yml`. Contributors do not publish; you only move your
change from `[Unreleased]` intent into the changelog. The one-time `NPM_TOKEN` secret and the
tag-and-push steps live in that section.

## License

By contributing you agree that your contribution is licensed under the MIT License, the same as the
rest of the project. See [LICENSE](LICENSE).
