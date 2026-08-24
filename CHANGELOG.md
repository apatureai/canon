# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions are shared across every `@apatureai/*` workspace package; a release tags and
publishes them together.

## [Unreleased]

## [0.1.1] - 2026-08-24

First release published to npm. The six public packages (`@apatureai/canon`,
`@apatureai/canon-schema`, `@apatureai/canon-context`, `@apatureai/canon-reconcile`,
`@apatureai/canon-render`, `@apatureai/canon-store`) ship to the registry from this
version onward; `@apatureai/canon-eval` remains private and unpublished.

### Added

- **Downstream consumer exporters.** `ui-dna export <genome.json> --target
  verdict|lattice|pointer` projects an approved genome into a specific
  consumer's read contract: Verdict's `snapshot`/`items` rule shape, Lattice's
  `projectionSchemaVersion`/`dnaContentDigest`/`state`/`tokens` view, and the
  existing Pointer local-check profile. Backed by pure `projectVerdictDnaProfile`
  and `projectLatticeDnaProfile` in `@apatureai/canon-store`, each with an approval gate,
  snapshot validation, repo/version matching, and a content digest.
- **CLI approval path.** `ui-dna approve <genome.json>` promotes a draft genome
  through the sign-off transition (draft → in_review → approved) and stamps its
  content-addressed immutable `dnaVersion`, so a draft scan can become approved
  DNA without writing code against the library.
- **npm publish readiness.** The six runtime packages (`@apatureai/canon`, `schema`,
  `context`, `reconcile`, `render`, `store`) are now publishable: `private:false`,
  `publishConfig.access: public`, and a `prepack` build. `@apatureai/canon-eval` stays
  private as an internal harness.
- **Release workflow.** `.github/workflows/release.yml` publishes the public
  packages to npm on a `v*` tag, with build provenance, gated on lint/typecheck/
  test/build and a tag-vs-version check. Requires a maintainer-provided
  `NPM_TOKEN` secret.
- **Project docs.** `CHANGELOG.md` (this file) and a publishing/release section
  in the README and `CONTRIBUTING.md`.

### Changed

- **Packages renamed to the `@apatureai/*` scope.** `@uidna/cli` → `@apatureai/canon`,
  `@uidna/schema` → `@apatureai/canon-schema`, `@uidna/context` → `@apatureai/canon-context`,
  `@uidna/reconcile` → `@apatureai/canon-reconcile`, `@uidna/render` → `@apatureai/canon-render`,
  `@uidna/store` → `@apatureai/canon-store`, and the private `@uidna/eval` →
  `@apatureai/canon-eval`. The CLI binary name is unchanged (`ui-dna`). Nothing had been
  published to npm yet, so this is a name change only.
- `--strict` no longer reports a clean result from a walk it could not finish:
  a truncated walk (hit `--max-files`/`--max-depth`) or an unreadable candidate
  design source now exits non-zero, because a scan that did not examine
  everything reports lower bounds, not a pass.
- A single unparseable stylesheet is skipped with a diagnostic instead of
  aborting the whole scan; every count a truncated walk produces is tagged a
  lower bound.
- The context report prints the two design-token corpus numbers the README
  quotes.
- Strings the tools emit no longer contain em dashes.

## [0.1.0] - 2026-08-10

Initial release of `ui-dna`: a strict DTCG 2025.10 token resolver and static
project scanner that abstains and explains instead of guessing. It never runs a
browser, calls a model, or edits code, and needs no credentials or network.

### Added

- **Strict DTCG 2025.10 resolution** — aliases, same-document `$ref`, and
  `$extends`, with eleven diagnostic codes that each name the exact token and
  reason; conformance, adversarial, and 20-file public-corpus goldens.
- **Static extraction** — CSS custom properties (`:root`/`html`/`.dark`/
  `[data-theme]`), Tailwind v4 `@theme`, DTCG/Style-Dictionary token files,
  `.designreview.yml` brand config, and component-library detection; Tailwind v3
  config evaluation behind `--exec-tailwind-config` in a worker thread.
- **Reconciliation** — provenance precedence chooses the winning value,
  confidence degrades in proportion to dissent, and every losing candidate stays
  in the report.
- **Determinism** — recursively sorted keys/arrays, no timestamps, content-hash
  cache invalidation, and a byte-identical `sha256:` context hash across
  machines.
- **Library surfaces** — versioning, the sign-off state machine, the authority
  log, and the design-code drift gate.

[Unreleased]: https://github.com/apatureai/canon/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/apatureai/canon/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/apatureai/canon/releases/tag/v0.1.0
