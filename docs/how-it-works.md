Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

## How it works

```
  repo sources (read by @apatureai/canon)          rendered evidence (supplied by you)
  tailwind.config / @theme                   DOM geometry, computed styles
  CSS custom properties                      a11y facts, screenshot refs, phash
  tokens.json (DTCG)                                  |
  package.json, .designreview.yml                     |
         |                                            |
         v                                            v
   @apatureai/canon-context                                @apatureai/canon-render
   Fact<T> @ code|config|human                   Fact<T> @ pixels
   confidence 0.5-0.9                            VisualDistributions, RenderedAnchor[]
         +---------------+----------------------------+
                         v
                  @apatureai/canon-reconcile
         value by precedence, confidence by agreement
         resolved DnaTokens + Conflict[] -> DriftHint[]
                         |
                         v
                    @apatureai/canon-store
     content-addressed version -> draft -> in_review -> approved
     append-only authority log (effective | superseded | revoked)
                         |
         +---------------+----------------+------------------+
         v               v                v                  v
   getSnapshot    retrieveGenomeSlice  drift gate      named projections
   (approved      (only what a PR      (design vs      (agent card,
    only)          touches)             code, delta-    local-check profile)
                                        fair)
```

pnpm workspace, seven packages, strict TypeScript with NodeNext ESM and `tsc -b` project references.
Dependencies flow strictly downward.

```
packages/
  schema/      @apatureai/canon-schema     the contract every other package speaks
  context/     @apatureai/canon-context    static extraction from repo sources
  render/      @apatureai/canon-render     the rendered-evidence input port
  reconcile/   @apatureai/canon-reconcile  merge code/config/pixels into resolved facts
  store/       @apatureai/canon-store      versioning, sign-off, authority, read contract, drift gate
  eval/        @apatureai/canon-eval       measures whether reconciliation is any good
  cli/         @apatureai/canon            the filesystem entry point (`ui-dna`)
examples/      sample-tokens.json, sample-project/, utility-only-project/, library-example.ts
scripts/       dtcg-corpus-benchmark.mjs, the one network-touching script
```

**`@apatureai/canon-schema`** holds `DnaSnapshot` and its parts: product identity, tokens (color, typography,
spacing, radii, shadows, breakpoints, motion), component conventions, visual distributions, rendered
anchors, exceptions, metadata. `Fact<T>` carries `{ value, confidence, provenance }`; `Conflict`
records a reconciliation disagreement. Plus `fact()`, `emptyDraft()`, `isApproved()`,
`validateSnapshot()` and a shared color canonicalizer so the drift gate and the reconciler agree on
what "the same color" means. `SCHEMA_VERSION = "1"`; evolution is additive-only within a version.

**`@apatureai/canon-context`** holds the pure extractors, each split into a source-format parser plus a thin
`*-dna.ts` that maps its output onto schema facts: Tailwind v3 via Tailwind's own `resolveConfig`
behind an injected `ConfigLoader` port, Tailwind v4 `@theme` via PostCSS, CSS custom properties
including theme-scoped blocks, DTCG and Style Dictionary token files, component-library detection,
the `.designreview.yml` brand block, and changed-file to route mapping for Next.js App and Pages
routers with an import-graph pass that falls back deterministically when resolution coverage is
below threshold. Also `buildContextBlock`, the deterministic content-hash serializer.

**`@apatureai/canon-render`** defines the `CaptureEvidence` port (viewports, DOM geometry rects,
computed-style and a11y facts, screenshot object-storage refs, perceptual hashes), a validator, a
fixture capture source, `computeVisualDistributions` and `selectAnchors`. Screenshot *bytes* are
never stored, only refs.

**`@apatureai/canon-reconcile`** contains `reconcileField`, `reconcileTokens` (declared tokens by observed
distributions), `reconcileComponents`, `computeDriftHints`, and `thresholds.ts`.

**`@apatureai/canon-store`** is the largest package. Content-addressed immutable versions over an injected
`SnapshotStore` port; the draft to in_review to approved state machine, where approval applies
headless JSON `ReviewDecisions` and promotes confirmed facts to confidence 1.0 with provenance
`human`; route exceptions; `diffSnapshots`; the versioned `getSnapshot` read contract, which never
serves a draft; an append-only hash-chained authority log with revocation semantics;
`retrieveGenomeSlice`, which returns only the slices a PR touches; a residency layer (tenant
entitlement, pattern-based scrubbing, retention tiers); the design-to-code drift gate, its
base-vs-head delta, remediation projection, routing node and PR-comment renderer; design-source
provenance enforcement, which can only ever *remove* blocking authority from a verdict; and two
named projections (an A2A capability card and a local-check profile).

**`@apatureai/canon-eval`** runs reconciliation over labeled fixtures and reports resolved-fact
precision/recall, conflict-detection recall, and confidence calibration (ECE, Brier, reliability
bins), with a gate that can fail CI on a floor.

**`@apatureai/canon`** covers argument parsing, the bounded directory walk (`scan.ts`), the merge into a
draft snapshot (`genome.ts`), terminal rendering (`format.ts`), and the worker-backed `ConfigLoader`
(`tailwind-config-loader.ts`, which spawns `packages/cli/worker/tailwind-config-worker.mjs`).
`runCli` returns an exit code rather than calling `process.exit`, so the tests drive the same entry
point a terminal does.

Two design decisions are worth reading the code for:

**Approval is revocable without mutating anything.** `ApprovalState` is terminal at `approved` and an
approved snapshot is never edited, but approvals do need to be withdrawn. Authority lives in a
separate append-only, hash-chained event log keyed by `(tenant, repo, dnaVersion)`, where each event
pins its predecessor's hash, so reordering, dropping or backdating an event is detectable. Reads
fail closed and *non-enumerating*: a revoked version is indistinguishable from one that never
existed.

**The drift gate is fair to the PR author.** Given a designer's DTCG export and the snapshot
extracted from code, `computeDesignCodeDrift` treats design as authoritative and classifies every
divergence as `value_mismatch`, `missing_in_code` or `undocumented_in_design`. `diffDrift` then
partitions drift into introduced, resolved and persisting against the base branch and gates on the
*introduced* set only, so a change is never blocked by pre-existing design debt. And
`reviewDesignSourceDrift` refuses to gate at all on a malformed export: an unparseable export yields
an empty design snapshot, and gating that against real code would flag every token as undocumented.
A loud, confidently wrong verdict is worse than an abstention, so it returns a typed refusal.
