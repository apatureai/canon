# Contributing

**This project is archived.** Apature was wound down and the code was open-sourced as a
historical record. It is not maintained.

What that means in practice:

- Issues and pull requests may sit indefinitely and may never be reviewed or merged. Please do
  not read silence as rejection — there is simply nobody on the other end.
- No roadmap, no releases, no support.
- **Forking is the encouraged path.** The MIT license lets you take this and do whatever you want
  with it, with no obligation to send anything back. If a fork of yours becomes the living
  version, that is a good outcome.

If you do open a PR anyway, keep it small and self-contained, and make sure the checks below pass
locally.

## Building it

A pnpm workspace of TypeScript packages. No application, no server, no browser — the whole repo
builds and tests offline after install.

Requirements:

- **Node 24.x** (`engines: >=24`, pinned in `.node-version`)
- **pnpm 9.15.0** (pinned via `packageManager`; `corepack enable` will pick it up)

```bash
pnpm install
pnpm lint        # eslint . --max-warnings=0  (warnings fail)
pnpm typecheck   # tsc -b across project references
pnpm test        # vitest run
pnpm build       # tsc -b — same thing as typecheck, but keeps dist/
pnpm clean       # tsc -b --clean
```

Lint, typecheck and test are exactly what CI runs (`.github/workflows/ci.yml`). As of the last
verified run on Node 24.14.0 the tree is green — lint clean, typecheck clean, **461 tests across
53 files in about 2 seconds**. If something fails right after a clean clone, suspect your Node or
pnpm version first.

### The one extra script

`pnpm eval:dtcg-corpus` typechecks, then benchmarks DTCG token extraction over a corpus of 20
public design-token files fetched from GitHub by immutable blob SHA, printing determinism, p95
latency and peak heap. It needs network access to `api.github.com`; set `GITHUB_TOKEN` or
`GH_TOKEN` to avoid the anonymous rate limit. It is deliberately outside CI. Useful if you touch
`packages/context`.

## Layout

Seven workspace packages under `packages/`, wired with TypeScript project references:

| Package | What it owns |
| --- | --- |
| `@uidna/schema` | The canonical genome schema: tokens, components, distributions, anchors, exceptions, per-field confidence + provenance, version metadata, approval state. Everything else depends on it. |
| `@uidna/context` | Static extraction — CSS custom properties, Tailwind v3 (`resolveConfig`) and v4 (`@theme` via PostCSS), DTCG `tokens.json`, brand config, changed-file→route mapping. Emits schema facts with confidence and provenance. |
| `@uidna/render` | The rendered-evidence *input port*. This repo never runs a browser; captured DOM geometry, screenshot refs and hashes arrive through this seam as data. |
| `@uidna/reconcile` | Merges code/config/pixel evidence for one logical field into a single resolved fact plus a recorded conflict trail. |
| `@uidna/store` | Immutable, content-addressed genome snapshots per repo; sign-off workflow; the authority/revocation log; the versioned downstream read contract; the design↔code drift gate. |
| `@uidna/eval` | Measures the precedence ladder instead of assuming it: reconciliation precision/recall and confidence calibration (ECE/Brier) over labeled fixtures, with a CI floor. |
| `@uidna/cli` | The `ui-dna` command line. The ONLY package that reads the filesystem; every other package takes strings and returns facts. Keep it that way when adding an extractor: parse in `context`, read the bytes here. |

Tests live in each package's `test/` directory next to `src/`. A hard rule the codebase follows
throughout: **tests never call a real model, launch a real browser, or hit the network** —
everything runs against stubs and fixtures. Please keep it that way.

### Conventions

- Strict TypeScript, NodeNext ESM, `verbatimModuleSyntax`. Relative imports carry an explicit
  `.js` extension.
- Each package has its own `tsconfig.json` and is wired into the root `tsc -b` project-reference
  graph. Dependencies flow strictly downward: `schema` → `context`/`render` → `reconcile` →
  `store`/`eval`/`cli`.
- The schema is the contract. Extractors fill it, consumers read it; nothing invents a second
  wire shape for the same data.
- **Determinism is a requirement, not a nicety.** The same inputs must produce byte-identical
  output: sorted keys, no timestamps in serialized artifacts, content-hash invalidation rather
  than wall-clock TTL. Several golden fixtures assert exactly this.
- Lint runs with `--max-warnings=0`; a warning fails the build.

`examples/` holds synthetic inputs for the CLI — a sample DTCG token file and a sample project.
They are fixtures the README's transcripts and `packages/cli/test` both run against, so changing
one means updating both.

## Reading the source

Bare `#N` markers in source comments and commit messages refer to issues in a private tracker that
is not part of this release; they are retained as provenance and cannot be resolved from here.
Treat them as context, not as instructions.

Commit messages here are plain prose with no attribution trailers; match that style if you are
continuing the history in a fork.

## License

By contributing you agree that your contribution is licensed under the MIT License, the same as
the rest of the project. See [LICENSE](LICENSE).
