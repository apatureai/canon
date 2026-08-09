# ui-dna

**Archived.** This was part of Apature, a commercial design-review product that has been wound
down. The code is released as-is under the MIT license. It is not actively developed, and issues
and pull requests are unlikely to be reviewed. Everything below describes what the code actually
does, including the parts that were never finished.

---

`ui-dna` is a set of six TypeScript libraries for extracting a codebase's *de facto* design
system — the colors, spacing, type scale, radii, component conventions and brand voice a product
actually uses — into a single typed, versioned data structure, and then serving that structure to
other tools as a stable read contract.

**Read this before you read anything else:** these are composable pure functions, not a program.
There is no CLI, no server, no `bin`, and no orchestrator that points this at a repository and
produces a genome. Nothing in `packages/*/src` reads the filesystem, opens a socket, launches a
browser, or reads an environment variable — you supply the file contents, you get typed facts
back. The orchestration that composed these into a product lived in a private repo that is not
part of this release. See [Limits](#limits-and-what-never-shipped) before investing time.

What is genuinely reusable outside Apature is concentrated in **`packages/context`**: a strict
DTCG Format Module 2025.10 token resolver, Tailwind v3/v4 and CSS custom-property extractors, and
a Next.js changed-files→affected-routes mapper. `packages/store` and `packages/render` are
included for completeness but only made sense inside Apature's multi-repo system.

## What it produces

The output artifact is a **design genome**: a `DnaSnapshot`, an immutable, content-addressed
record of one repository's design standard at one point in time. Extraction draws on two very
different kinds of evidence — static sources in the repo (Tailwind config, CSS custom properties,
DTCG/Style Dictionary token files, `package.json` dependencies, a `.designreview.yml` brand
block) and rendered evidence from a real browser run (DOM geometry, computed styles,
screenshots). Those two disagree constantly. Reconciling them honestly — and recording *how* they
disagreed instead of silently picking a winner — is what this repo is about.

Every inferred field carries a confidence score and a provenance tag saying where it came from
(`code`, `pixels`, `config`, `human`, `feedback`). A genome only becomes readable by downstream
consumers after a human signs it off.

## Why it is technically interesting

The interesting part is not "parse a Tailwind config". It is the set of decisions about what to
do when evidence sources contradict each other, and how to make the result something a team is
willing to be gated on.

**A precedence ladder that splits value from confidence.** When several sources claim a value for
one field, the naive design is "highest-trust source wins" and the rest is discarded.
`reconcileField` instead resolves the *value* by precedence — human sign-off > config > extracted
code > observed pixels, so what a browser renders never silently overwrites a declared token —
while computing *confidence* separately. Agreement between two independent sources reinforces
confidence above what either source alone would justify (bounded below 1.0, which is reserved for
human sign-off). Disagreement keeps the winning value but degrades its confidence in proportion
to how strong the dissent was, and emits a `Conflict` recording every candidate considered. Every
tunable in that ladder lives in one file (`packages/reconcile/src/thresholds.ts`) precisely so
`@uidna/eval` can measure and calibrate them against labeled fixtures rather than leaving them as
taste.

**The conflict trail is the product.** A conflict is not an error to be suppressed. It is
promoted into an advisory `DriftHint` that says, in words, `config says X but pixels show Y`, or
flags a *dead token* — a value the codebase declares but that never appears in anything rendered.
Drift hints never mutate the resolved genome and never canonize the drifting value.

**Determinism as a hard constraint.** The same repository state must produce a byte-identical
genome. Serialization sorts keys and arrays recursively and contains no timestamps; caches are
invalidated by content hash, never by wall-clock TTL. Version identity is the SHA-256 of the
genome content folded with only the *causal* stamps that can legitimately change it (schema
version, extraction version, model version) plus the immutable lifecycle state — and nothing
incidental. Recommitting identical content is idempotent and returns the existing version.

That last clause was learned the hard way, and the fix is worth reading: content-only identity
meant that approving a genome without editing anything produced the same hash as the unapproved
draft, so an approval could collide with, and resolve to, the draft record. Lifecycle state is
now part of identity (`packages/store/src/version-identity.ts`, `STORE_VERSION = "2"`).

**Approval is revocable without mutating anything.** `ApprovalState` is terminal at `approved`
and an approved snapshot is never edited. But approvals do need to be withdrawn — a bad sign-off,
a compromised account, a screenshot anchor that turned out to contain something sensitive. So
authority lives in a separate append-only, hash-chained event log keyed by
`(tenant, repo, dnaVersion)`, where each event pins its predecessor's hash so reordering,
dropping, or backdating an event is detectable. Reads fail closed and *non-enumerating*: a
revoked version is indistinguishable from a version that never existed. A `superseded` version
stays readable when pinned explicitly (so an old review stays reproducible) but is skipped by
`latest`.

**A design↔code drift gate that is fair to the PR author.** Given a designer's DTCG token export
and the genome extracted from code, `computeDesignCodeDrift` treats design as authoritative and
classifies every divergence as `value_mismatch`, `missing_in_code`, or `undocumented_in_design`.
Two things make it usable in CI rather than merely correct. First, `diffDrift` partitions drift
into introduced / resolved / persisting against the base branch, and the verdict gates on the
*introduced* set only — a change is never blocked by pre-existing design debt it did not create.
Second, `reviewDesignSourceDrift` refuses to gate at all on a malformed design export: an
unparseable export yields an empty design genome, and gating an empty design against real code
would flag *every* token as undocumented. A loud, confidently wrong verdict is worse than an
abstention, so it returns a typed refusal.

**A DTCG profile that abstains instead of guessing.** `@uidna/context` implements the Design
Tokens Community Group Format Module 2025.10 profile: chained curly aliases, same-document
RFC 6901 `$ref` including property-level references, `$root`, group `$extends`, inherited types,
deterministic derivation chains. Unresolved, circular, type-mismatched, external, or over-budget
references produce explicit diagnostics and never become facts. The Resolver Module's sets,
modifiers and remote sources are deliberately disabled — enabling them would require an injected
sandboxed allowlisted loader and a versioned profile change. The full profile and its measured
baseline against 20 real public token files are in
[`packages/context/DTCG_PROFILE.md`](packages/context/DTCG_PROFILE.md).

**A hard architectural boundary: this repo never runs a browser.** Rendered evidence enters
through `CaptureEvidence`, a plain serializable input port describing artifacts that some other
process already captured. Everything here is a pure function over data. That is why the entire
test suite runs offline in about two seconds with no browser, no model, no network and no
credentials.

## Where it sat in the Apature stack

Apature was a GitHub-native design reviewer: it screenshotted a pull request's preview deploy,
critiqued the rendered UI against the repo's own design system with a vision-language model, and
posted an annotated review. Its stated boundary was that it judges and verifies but never edits
code or drives the UI — "the eyes, not the hands". `ui-dna` is the component that answers
"against *what* standard?", so that a review cites the team's own design system instead of a
generic opinion.

The other repos in the archive release:

- [judgment-engine](https://github.com/apatureai/judgment-engine) — capture, grounded critique,
  eval and feedback substrate. It **produces** the rendered artifacts that arrive here as
  `CaptureEvidence`, and **consumes** approved genome slices to ground its critique. The static
  extractors in `@uidna/context` were originally built in that repo's `@engine/context` and
  ported here, with `ui-dna` intended as the canonical owner.
- [gate](https://github.com/apatureai/gate) — the GitHub PR review surface; judges a PR against
  an approved genome.
- [mcp-review](https://github.com/apatureai/mcp-review) — the same review, in-loop over MCP for
  coding agents.
- [entropy-engine](https://github.com/apatureai/entropy-engine) — scans a codebase for design
  drift against an approved genome and plans consolidation.
- [ui-graph](https://github.com/apatureai/ui-graph) — a token-efficient, genome-aware scene graph
  of rendered UI for agents.
- [sigil](https://github.com/apatureai/sigil) — an unrelated line of work: a fixture-driven model
  quality/efficiency audit harness.

Nothing here imports any of those repos. The coupling is by data contract only: the
`SnapshotResponse` wire shape is pinned by a golden fixture
(`packages/store/test/fixtures/golden-snapshot-response.json`) so a byte-compat test fails if the
contract changes underneath a consumer. Several other Apature repos referenced in the design
history are **not** part of this release and are not linked here.

## Repo layout

pnpm workspace, six packages, strict TypeScript with NodeNext ESM and `tsc -b` project
references. Dependencies flow strictly downward.

```
packages/
  schema/      @uidna/schema     the contract every other package speaks
  context/     @uidna/context    static extraction from repo sources
  render/      @uidna/render     the rendered-evidence input port
  reconcile/   @uidna/reconcile  merge code/config/pixels into resolved facts
  store/       @uidna/store      versioning, sign-off, authority, read contract, drift gate
  eval/        @uidna/eval       measures whether reconciliation is any good
```

**`@uidna/schema`** — `DnaSnapshot` and its parts: product identity, tokens (color, typography,
spacing, radii, shadows, breakpoints, motion), component conventions, visual distributions,
rendered anchors, exceptions, metadata. `Fact<T>` carries `{ value, confidence, provenance }`.
`Conflict` records a reconciliation disagreement. Plus `fact()`, `emptyDraft()`, `isApproved()`,
`validateSnapshot()` and a shared color canonicalizer so the drift gate and the reconciler agree
on what "the same color" means. `SCHEMA_VERSION = "1"`; evolution is additive-only within a
version.

**`@uidna/context`** — pure extractors, each split into a source-format parser plus a thin
`*-dna.ts` that maps its output onto schema facts. Tailwind v3 via Tailwind's own `resolveConfig`
(behind an injected `ConfigLoader` port, so no customer config is ever evaluated in this
process), Tailwind v4 `@theme` via PostCSS, CSS custom properties including theme-scoped blocks,
DTCG/Style Dictionary token files, component-library detection (shadcn/Radix/MUI/Chakra/Mantine
from `package.json`), the `.designreview.yml` brand block, and changed-file→route mapping for
Next.js App and Pages routers with an import-graph pass that falls back deterministically when
resolution coverage is below threshold. Also `serializeContextBlock`/`buildContextBlock`, the
deterministic content-hash serializer.

The confidence convention these settled on, in descending order: human-authored
`.designreview.yml` 0.9 > config-declared token files and Tailwind config 0.8 > Tailwind v4
`@theme` 0.7 > raw CSS custom properties 0.6 > component detection from a dependency being
present 0.5. 1.0 is reserved for human sign-off.

**`@uidna/render`** — the `CaptureEvidence` port (viewports, DOM geometry rects, computed-style
and a11y facts, screenshot object-storage refs, perceptual hashes), a validator, a fixture
capture source, `computeVisualDistributions` (spacing intervals, type scale, color proportions,
radius patterns, density), and `selectAnchors`, which picks representative screenshot crops and
honors route allow/deny lists. Screenshot *bytes* are never stored in the genome, only refs.

**`@uidna/reconcile`** — `reconcileField`, `reconcileTokens` (declared tokens × observed
distributions: confirm, contradict, or surface a strong pixels-only value that no token
declares), `reconcileComponents` (a detected dependency confirmed or contradicted by observed DOM
roles and class prefixes), `computeDriftHints`, and `thresholds.ts`.

**`@uidna/store`** — the largest package. Content-addressed immutable versions over an injected
`SnapshotStore` port; the draft → in_review → approved state machine, where approval applies
headless JSON `ReviewDecisions` (accept/edit per field path), promotes confirmed facts to
confidence 1.0 with provenance `human`, and commits a new version; route exceptions that suppress
drift on surfaces that intentionally deviate; `diffSnapshots` for change detection between
versions; the versioned `getSnapshot` read contract, which never serves a draft; the append-only
authority log and revocation semantics; `retrieveGenomeSlice`, which returns only the genome
slices relevant to the routes/components/token-groups a PR touches, bounded so a broad query
cannot pull the whole snapshot; a residency/policy layer (tenant entitlement, secret/PII
scrubbing, retention tiers for anchor refs, redacting access log); the design↔code drift gate and
its base-vs-head delta, remediation projection, routing node and PR-comment renderer;
design-source provenance enforcement, which can only ever *remove* blocking authority from a gate
verdict, never add it; and two named projections — an A2A capability card and a local-check
profile.

**`@uidna/eval`** — runs reconciliation over labeled fixtures and reports resolved-fact
precision/recall, conflict-detection recall, and confidence calibration (ECE, Brier, reliability
bins), with a gate that can fail CI on a floor. Offline and deterministic.

## Quickstart

Requires Node `>=24 <25` (`.node-version` pins 24) and pnpm 9.15.0.

```bash
pnpm install --frozen-lockfile
pnpm build       # tsc -b across all six packages
pnpm test        # vitest run
pnpm lint        # eslint . --max-warnings=0
pnpm typecheck   # same as build
```

CI (`.github/workflows/ci.yml`) runs exactly `lint`, `typecheck`, `test` on pull requests and on
pushes to `main`, with `permissions: contents: read`.

Verified on 2026-08-09 against Node v24.14.0 and pnpm 9.15.0: install, lint, typecheck and build
all succeeded, and `pnpm test` passed **424 tests across 48 files in about 2 seconds**. No
network, browser, model or credentials were needed.

One further script exists and is **not** part of the default gate:

- `pnpm eval:dtcg-corpus` — fetches 20 public design-token files from GitHub by immutable blob
  SHA and checks parse determinism and the 100 ms / 64 MiB ceilings. Requires network access to
  `api.github.com`; set `GITHUB_TOKEN` (or `GH_TOKEN`) to avoid the 60-requests/hour anonymous
  rate limit. Deliberately outside CI.

## A worked example

The packages are private workspace packages and were never published to npm, so this is
in-workspace usage against the built `dist/` output. This example was executed on 2026-08-09; the
output below is real.

```ts
import { emptyDraft } from "@uidna/schema";
import { extractCssTokens } from "@uidna/context";
import { computeVisualDistributions, sampleCaptureEvidence } from "@uidna/render";
import { reconcileTokens, computeDriftHints } from "@uidna/reconcile";
import {
  inMemorySnapshotStore, commitSnapshot, requestReview, approveSnapshot, getSnapshot,
} from "@uidna/store";

const draft = emptyDraft("acme", "web", "extractor@1");
draft.tokens = extractCssTokens(":root { --color-brand: #0a0a0a; --spacing-gap: 8px; }");
draft.distributions = computeVisualDistributions(sampleCaptureEvidence());

const { tokens, conflicts } = reconcileTokens(draft.tokens, draft.distributions);
draft.tokens = tokens;
console.log(computeDriftHints(conflicts).map((h) => h.message));
// [ 'tokens.spacing.--spacing-gap: code declares "8px" but it is not observed
//    in rendered reality (dead token)' ]

const store = inMemorySnapshotStore();
const { stored } = await commitSnapshot(store, draft);          // immutable draft version
await approveSnapshot(store, requestReview(stored.snapshot));   // new immutable approved version

const served = await getSnapshot(store, "acme/web");
// { contract: { schemaVersion: "1", storeVersion: "2" },
//   repo, dnaVersion, contentDigest: "sha256:…", snapshot }
```

Calling `getSnapshot` before approval returns `null`. That is the point: a draft genome is never
visible downstream.

Note that you must read the CSS file yourself — `extractCssTokens` takes a string, not a path.
That is true of every extractor in the repo.

## Architecture

```
  repo sources                          rendered evidence (captured elsewhere)
  tailwind.config / @theme              DOM geometry · computed styles
  CSS custom properties                 a11y facts · screenshot refs · phash
  tokens.json (DTCG)                             │
  package.json · .designreview.yml               │
         │                                       │
         ▼                                       ▼
   @uidna/context                          @uidna/render
   Fact<T> @ code|config|human             Fact<T> @ pixels
   confidence 0.5–0.9                      VisualDistributions, RenderedAnchor[]
         └───────────────┬───────────────────────┘
                         ▼
                  @uidna/reconcile
         value by precedence · confidence by agreement
         resolved DnaTokens + Conflict[] → DriftHint[]
                         │
                         ▼
                    @uidna/store
     content-addressed version → draft → in_review → approved
     append-only authority log (effective | superseded | revoked)
                         │
         ┌───────────────┼────────────────┬──────────────────┐
         ▼               ▼                ▼                  ▼
   getSnapshot    retrieveGenomeSlice  drift gate      named projections
   (approved      (only what a PR      (design vs      (agent card,
    only)          touches)             code, delta-    local-check profile)
                                        fair)
```

The schema is the contract; every extractor fills it, every consumer reads it. Cross-package
edges are typed ports (`ConfigLoader`, `CaptureSource`, `SnapshotStore`, `AuthorityStore`,
`AccessLogger`, `AuthorityStatusResolver`) with in-memory or fixture implementations in this
repo, so nothing in the test suite touches real infrastructure.

## Limits and what never shipped

Be clear-eyed about what this is. It is a well-tested set of pure libraries and a set of design
decisions. It is not a running system.

- **No CLI, no server, no HTTP or MCP endpoint, no database, no UI.** There is no entry point
  that points this at a repository and produces a genome, and no filesystem access anywhere in
  the library source. `emptyDraft()` is only ever called from tests. The orchestration lived in a
  private repo that is not part of this release. The design doc's headline goal — "a useful DNA
  draft for a real frontend repo in under ten minutes" — was never demonstrated end to end from
  this repo.
- **All six packages are `private: true` at version `0.0.0`** and were never published to npm.
  The only consumption path is clone → `pnpm install` → `pnpm build` → import from
  `packages/<name>/dist`, or vendor the source you want.
- **The only `SnapshotStore` implementation is in-memory.** Persistent object storage was left as
  a port with no adapter. Restarting the process loses every genome.
- **The Tailwind v3 `ConfigLoader` has no production implementation.** The design assumed a
  sandboxed worker evaluating `tailwind.config.{js,ts}` in isolation; only a test stub exists
  here. A `tailwind.config.js` is executable code — do not wire this to `require()` a third-party
  config without building that sandbox yourself.
- **Nothing captures rendered evidence.** `CaptureEvidence` is an input port and
  `fixtureCaptureSource` is a stub. Every test feeds it fixtures. Without `judgment-engine` or an
  equivalent capture implementation, the `pixels` half of reconciliation has no input and you get
  static extraction only.
- **No sign-off UI.** Human review is a headless JSON `ReviewDecisions` document. Something had
  to render it and collect a human's answer; nothing here does.
- **The local-check profile targets a surface that never shipped.**
  `getPointerLocalCheckProfile` and
  [`docs/pointer-local-check-profile.md`](docs/pointer-local-check-profile.md) describe a
  projection for a planned live design-copilot client. Its component-hint family is deliberately
  empty — the genome never owned a stable rendered component signature — and its target-size and
  contrast entries are marked `policy_default` because they are WCAG defaults, not anything a
  team asserted.
- **The A2A agent card is `draft-unapproved`.** It is a descriptor for contracts that already
  exist, carrying zero new capability, built in anticipation of a registration review that never
  happened.
- **Secret/PII scrubbing in the residency layer is pattern-based.** Treat it as defense in depth,
  not as a guarantee.
- **The DTCG Resolver Module is unsupported by design**, as are external and remote `$ref`s.
  Resolver documents return `unsupported_resolver_module`.
- **The eval harness measures reconciliation against hand-labeled fixtures**, not against real
  repositories. The precedence weights in `thresholds.ts` were never calibrated on production
  data; they remain reasoned defaults with the measurement apparatus built around them.

## Provenance of the code itself

This repo was built largely by an autonomous agent loop over roughly five weeks in mid-2026
(93 commits, 2026-06-15 to 2026-07-23). The loop's runbook and its issue-by-issue progress log
were internal process documents keyed to a private tracker, and were removed when the repo was
prepared for release.

[`docs/DESIGN.md`](docs/DESIGN.md) is the original product spec, trimmed of company-strategy,
buyer, and business-metric sections. It describes intent, including scope that was never built —
read it as the plan, not as a description of this code.

Source comments and historical commit messages carry bare `#N` markers referring to issues in
that private tracker. They cannot be resolved from the public repository and are retained as
provenance rather than rewritten. Two corrections recorded in the code are worth reading if you
want the honest version of how the design moved: the store identity correction in
`packages/store/src/version-identity.ts`, and the DTCG naming and profile correction in
`packages/context/DTCG_PROFILE.md`.

## License

MIT — see [LICENSE](LICENSE).
