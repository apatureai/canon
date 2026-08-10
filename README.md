# ui-dna

A command line and TypeScript libraries that read a codebase's *de facto* design system (colors, spacing, type scale, radii, component conventions, brand voice) out of its own files.

## Why this exists

`ui-dna` was one component of Apature, a GitHub-native design reviewer that critiqued a pull
request's rendered UI against the repository's own design system. It answered the question "against
*what* standard?", so a review could cite the team's own tokens rather than a generic opinion. The
product was wound down; this repository is released under MIT as a working snapshot.

The interesting part was never "parse a Tailwind config". It is what to do when a repository's
design sources contradict each other, and how to produce something a team would agree to be
gated on.

## What it does

- Resolves a **DTCG Format Module 2025.10** token file from disk: chained curly aliases,
  same-document RFC 6901 `$ref` including property-level references, `$root`, group `$extends`,
  inherited types, deterministic derivation chains, plus 11 diagnostic codes for everything it
  refuses to resolve.
- Extracts a design system from a project directory: CSS custom properties (including
  `.dark` / `[data-theme]` / `prefers-color-scheme` scopes), Tailwind v4 `@theme` blocks,
  Tailwind v3 configs, DTCG/Style Dictionary token files, component libraries from
  `package.json`, and a hand-written `.designreview.yml` brand block.
- **Reconciles** sources that disagree: resolves the value by provenance precedence, computes
  confidence separately (agreement reinforces, disagreement degrades), and records every
  candidate it considered instead of silently picking one.
- Emits a content-addressed context block and a schema-valid draft genome as JSON, byte-stable
  across runs.
- Ships all of the above as a library (`@uidna/schema`, `@uidna/context`, `@uidna/render`,
  `@uidna/reconcile`, `@uidna/store`, `@uidna/eval`, `@uidna/cli`) with 472 tests that run offline
  in about two seconds.

## What it does not do

- It never runs a browser, takes a screenshot, or calls a model. Rendered evidence enters as data
  through a typed input port; the capture side lived in another repository.
- It never edits your code. It reads and reports.
- It does not persist anything. The only `SnapshotStore` implementation is in-memory.

Details, with the seam to build against for each gap, are in
[Limitations](#limitations--not-implemented).

## Requirements

| Tool | Floor | Check | Notes |
|---|---|---|---|
| Node | `>=24` | `node -v  # need v24.x` | `.node-version` pins 24. Type stripping and `worker_threads` are both used. |
| pnpm | 9.15.0 | `pnpm -v  # need 9.15.0` | Install with `corepack enable pnpm` or `npm i -g pnpm@9.15.0`. |

Tested on macOS 14 (Darwin 24.6.0). CI runs the same commands on `ubuntu-latest`. Windows is
untested.

No credentials, no network, no browser, no model. Dependencies are pinned and `pnpm-lock.yaml` is
committed, so `--frozen-lockfile` reproduces the tree this was verified on.

## Install

From a clean clone, in the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` is `tsc -b` across the workspace. The CLI runs from `packages/cli/dist`, so the build
is part of installation, not an optional step.

There are three ways to invoke it, all equivalent. Two of them need no setup, and the transcripts
below use the first because it is the one that puts no wrapper in the output:

```bash
node packages/cli/dist/bin.js tokens examples/sample-tokens.json   # explicit
pnpm ui-dna tokens examples/sample-tokens.json                     # root script shortcut
```

Nothing here was published to npm, so there is no `npm i -g ui-dna`. If you want the command on
your `PATH`, symlink the built entry point yourself; it has a shebang and works from any working
directory:

```bash
chmod +x packages/cli/dist/bin.js
mkdir -p ~/.local/bin                                       # or any directory already on your PATH
ln -s "$PWD/packages/cli/dist/bin.js" ~/.local/bin/ui-dna
```

`dist/` is gitignored, so neither of those steps dirties the tree.

## Quickstart

Two commands, no credentials, about a minute. Run both from the repository root.

### 1. Resolve a token file

```console
$ node packages/cli/dist/bin.js tokens examples/sample-tokens.json
ui-dna tokens - examples/sample-tokens.json
profile        DTCG Format Module 2025.10
               aliases=true $ref=same-document-only $extends=true

resolved tokens (22)
  color.brand               color       #2f6fed
  color.brand-strong        color       #2153ba
  color.focus-ring          color       #2f6fed  <- #/color/brand/$value
  color.link                color       #2f6fed  <- color.brand
  color.link-hover          color       #2f6fed  <- color.brand <- color.link
  color.surface             color       #ffffff
  color.text                color       #0a0a0a
  component.base            dimension   4px  <- space
  component.button-padding  dimension   16px  <- space <- space.gutter
  component.gutter          dimension   16px  <- space
  component.section         dimension   48px  <- space
  font.sans                 fontFamily  ["Inter","system-ui","sans-serif"]
  motion.fast               duration    120ms
  motion.slow               duration    320ms
  radius.card               dimension   12px
  radius.control            dimension   6px
  shadow.card               shadow      {"blur":{"unit":"px","value":3},"color":{"alpha":0.08,"colorS... (--json for the exact value)
  space.base                dimension   4px
  space.gutter              dimension   16px
  space.section             dimension   48px
  typography.size-body      dimension   16px
  typography.size-heading   dimension   30px

diagnostics (4)
  invalid_value         broken.typo  A dimension must contain a finite numeric value and unit.
  circular_reference    color.loop-a  Circular token alias: color.loop-a -> color.loop-b -> color.loop-a.
  circular_reference    color.loop-b  Circular token alias: color.loop-b -> color.loop-a -> color.loop-b.
  unresolved_reference  color.missing  Token alias does not resolve: {color.nowhere}.

  A diagnostic means the token was ABSTAINED, not guessed: it is absent from the
  resolved list above rather than promoted with its reference syntax as a value.
```

**Success looks like:** `resolved tokens (22)` and `diagnostics (4)`. The four broken tokens
(`color.missing`, `color.loop-a`, `color.loop-b`, `broken.typo`) are in the diagnostics list and
absent from the resolved list. A resolver that reported 26 tokens would have guessed.

### 2. Extract a design system from a project

`examples/sample-project` is a synthetic front-end project. Nothing in it is installed or built;
only its design-system files are read.

```console
$ node packages/cli/dist/bin.js context examples/sample-project --out out/genome.json
ui-dna context - examples/sample-project

sources (6 of 6 files walked)
  .designreview.yml   brand-identity         -           tone, audience, 2 do, 1 don't
  design.tokens.json  dtcg-tokens            2 tokens    1 diagnostic(s)
  package.json        component-libraries    -           2 library: shadcn/ui, radix
  src/styles.css      css-custom-properties  12 tokens   :root / theme scopes
  src/theme.css       tailwind-v4-theme      5 tokens    @theme block
  tailwind.config.js  tailwind-v3-config     -           not evaluated (pass --exec-tailwind-config)

resolved tokens (16)
  color         7
  typography    1
  spacing       2
  radii         2
  shadows       1
  breakpoints   1
  motion        2

identity facts (5)
component libraries (2)  shadcn/ui, radix

conflicts (2)
  tokens.color.--color-brand  resolved "#2f6fed" (code, confidence 0.49)
      "#0a58ca"  code 0.60  src/styles.css
      "#2f6fed"  code 0.70  src/theme.css
      confidence delta -0.21
  tokens.radii.--radius-card  resolved "12px" (code, confidence 0.49)
      "10px"  code 0.60  src/styles.css
      "12px"  code 0.70  src/theme.css
      confidence delta -0.21

drift hints (2)
  tokens.color.--color-brand: code says "#2f6fed" but code shows "#0a58ca"
  tokens.radii.--radius-card: code says "12px" but code shows "10px"

token diagnostics (1)
  design.tokens.json  unresolved_reference  color.accent  Token alias does not resolve: {color.brand-secondary}.

context block
  contextVersion  1
  contentHash     sha256:da5aa778e56a08caea731d4c69672400c78be88d8008aac5267086ab2b2b0a17
  bytes           2669
  the hash is content-addressed: identical sources produce an identical hash, and
  approving or re-versioning the genome does not change it.

wrote draft genome  out/genome.json
```

**Success looks like:** `sources (6 of 6 files walked)`, `conflicts (2)`, the `sha256:da5aa778…` content hash, and a
file at `out/genome.json`. Run it twice and the hash is identical, because it is computed over
canonicalized extracted content with no timestamps in it.

Read one fact out of the genome to see the shape:

```console
$ node -e "const g=require('./out/genome.json'); console.log(g.tokens.color['--color-brand'], g.identity.tone.value)"
{
  value: '#2f6fed',
  confidence: 0.48999999999999994,
  provenance: 'code'
} precise, quiet, never playful
```

That is the whole idea: every field carries where it came from and how sure the extractor is. The
brand token's confidence sits *below* either source that declared it, because two files disagreed
about it, and both candidate values are still in the report.

### Optional: evaluate the Tailwind config

`tailwind.config.js` is executable code, so it is reported but not run unless you ask:

```console
$ node packages/cli/dist/bin.js context examples/sample-project --exec-tailwind-config | head -12
ui-dna context - examples/sample-project

sources (6 of 6 files walked)
  .designreview.yml   brand-identity         -           tone, audience, 2 do, 1 don't
  design.tokens.json  dtcg-tokens            2 tokens    1 diagnostic(s)
  package.json        component-libraries    -           2 library: shadcn/ui, radix
  src/styles.css      css-custom-properties  12 tokens   :root / theme scopes
  src/theme.css       tailwind-v4-theme      5 tokens    @theme block
  tailwind.config.js  tailwind-v3-config     348 tokens  evaluated in worker

resolved tokens (364)
  color         256
```

The jump from 16 to 364 tokens is Tailwind's default theme, which is part of the project's design
system whether or not anyone wrote it down. The config is evaluated in a worker thread with a
timeout: that bounds *failure* (a config that throws or hangs fails the load instead of taking the
CLI down), not *privilege*. The config runs as ordinary Node code. Only point it at a repository
you would already run `npm install` in.

The `| head -12` is only there to keep the transcript short; the full report continues with the
rest of the group counts, the conflicts, and the context block.

### 3. Point it at your own repository

Read this before you do, because a *correct* run on a real project often finds nothing, and the
report should be the thing that tells you why.

`ui-dna` reads **declared** design tokens. It does not infer a design system from usage: it will
not mine `p-4 rounded-lg text-slate-900` out of your JSX and call it a spacing scale. Concretely,
you get tokens from a `:root`/`html`/`.dark`/`[data-theme]` block of `--custom-properties`, a
literal Tailwind v4 `@theme { … }` block, a DTCG/Style Dictionary token file, or a Tailwind v3
config **with `--exec-tailwind-config`**. Consuming Tailwind v4 as `@import "tailwindcss"` declares
nothing in your repository (that theme lives inside the npm package), and a `package.json` only
contributes component conventions for shadcn/ui, Radix, MUI, Chakra and Mantine.

So a plain Vite/React app that styles entirely in utility classes legitimately reports zero tokens.
`examples/utility-only-project` is exactly that project, and running it shows what an honest empty
result looks like:

```console
$ node packages/cli/dist/bin.js context examples/utility-only-project | head -9
ui-dna context - examples/utility-only-project

sources (3 of 3 files walked)
  package.json   component-libraries    -           no recognised component library (shadcn/ui, radix, mui, chakra, mantine)
  src/App.css    css-custom-properties  -           no custom properties in :root/html or a theme scope
  src/index.css  css-custom-properties  -           no custom properties in :root/html or a theme scope

resolved tokens (0)
  color         0
```

Drop the `| head -9` and the report continues through the remaining group counts, zero identity
facts and component libraries, an empty conflicts, drift and diagnostics section apiece, and the
context block.

Every candidate file the walk opened is listed with the reason it contributed nothing, so `0`
tokens never has to be diagnosed. `sources (0 of N files walked)` is a different statement: it
means no candidate file was found at all, and is worth re-checking the path over. `--json` carries
the same data (`filesWalked`, plus every source including the zero-token ones) for scripts.

If your project *does* declare tokens the report fills in immediately. A Next.js app with the
shadcn/ui `:root` block and Radix in its dependencies, for instance, reports:

```
sources (2 of 2 files walked)
  app/globals.css  css-custom-properties  6 tokens    :root / theme scopes
  package.json     component-libraries    -           2 library: shadcn/ui, radix

resolved tokens (6)
  color         5
  ...
  radii         1
```

## Usage

### `ui-dna tokens <file.json>`

Resolve one DTCG token document.

| Flag | Effect |
|---|---|
| `--json` | Print `{ profile, tokens, diagnostics }` as JSON. Values are exact and unelided; the report elides long composites. |
| `--strict` | Exit 2 when any diagnostic was raised. |

### `ui-dna context <directory>`

Walk a project directory, extract every static design source, reconcile them, and build a context
block.

| Flag | Effect |
|---|---|
| `--json` | Print `filesWalked`, every source (including the ones that declared nothing), conflicts, drift hints, diagnostics, the context block and the full genome as JSON. |
| `--out <file>` | Write the draft `DnaSnapshot` as JSON. Parent directories are created. |
| `--repo <owner/name>` | Repository identity stamped into the genome. Default `local/<directory name>`. It is part of the hashed content. |
| `--exec-tailwind-config` | Evaluate `tailwind.config.*` files in a worker thread. Off by default. |
| `--max-depth <n>` | Directory depth bound. Default 8. |
| `--max-files <n>` | File count bound. Default 5000. |
| `--strict` | Exit 2 when any conflict or diagnostic was raised. |

Exit codes: `0` success · `1` usage or IO failure · `2` `--strict` and the report was not clean.

**Which files are read.** `*.css` anywhere (a file whose PostCSS parse finds a real `@theme`
at-rule is also read as Tailwind v4); `tokens.json`, `design-tokens.json`, `*.tokens.json`
anywhere; `tailwind.config.{js,cjs,mjs,ts,mts,cts}` anywhere; `package.json` and
`.designreview.yml` at the scan root only. `node_modules`, `.git`, `dist`, `build`, `out`,
`coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `vendor` and `tmp` are never entered. Files over
2 MiB and unparseable files are listed as `skipped`, never guessed at.

**Every candidate file is reported, including the ones that declared nothing**, with `0` tokens
and the reason. The header reads `sources (K of N files walked)`, so "your stylesheets declare no
tokens" and "no stylesheet was found" are never the same output. A repository with hundreds of
declaration-free stylesheets gets a bounded sample plus a count in the terminal table; `--json`
always lists every one.

### The confidence ladder

Every extracted fact is a `Fact<T>`: `{ value, confidence, provenance }`. The conventions these
settled on, in descending order:

| Source | Provenance | Confidence |
|---|---|---|
| Human sign-off during review | `human` | 1.0 (reserved) |
| `.designreview.yml` brand block | `human` | 0.9 |
| `tokens.json` / Tailwind config | `config` | 0.8 |
| Tailwind v4 `@theme` block | `code` | 0.7 |
| Raw CSS custom properties | `code` | 0.6 |
| Component library present in `package.json` | `code` | 0.5 |

When several sources claim one field, `reconcileField` resolves the **value** by precedence
(human > config > code > pixels, so what a browser renders never silently overwrites a declared
token) and computes **confidence** separately. Agreement between two independent sources
reinforces confidence above what either alone would justify (bounded below 1.0). Disagreement keeps
the winning value but degrades its confidence in proportion to the strength of the dissent, and
emits a `Conflict` listing every candidate. Every tunable lives in one file,
`packages/reconcile/src/thresholds.ts`, so `@uidna/eval` can measure them against labeled fixtures
instead of leaving them as taste.

Conflicts are then promoted into advisory `DriftHint`s: `config says X but pixels show Y`, or a
*dead token* the codebase declares that nothing rendered ever uses. Drift never mutates the
resolved genome and never canonizes the drifting value.

### The DTCG profile

`resolveTokensJson` implements the stable Design Tokens Community Group
[Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) profile:

- exact JSON token values, inherited types, chained curly aliases, same-document RFC 6901 `$ref`
  including property-level references, `$root`, and group `$extends`;
- deterministic alias/extension derivation chains and byte-stable key/token/diagnostic ordering;
- fail-closed diagnostics for unresolved, circular, type-invalid, malformed, external and
  over-budget references;
- classic Style Dictionary `value` nodes remain an explicit compatibility path; they carry
  `type: null` when undeclared and are not described as DTCG-conformant.

The [Resolver Module](https://www.designtokens.org/TR/2025.10/resolver/)'s sets, modifiers,
`resolutionOrder`, filesystem sources and remote sources are disabled. A resolver document returns
`unsupported_resolver_module`; an external `$ref` returns `unsupported_external_reference`.
Enabling either would require an injected, sandboxed, allowlisted loader and a versioned profile
change.

Resolved composite values stay structured. `projectTokenValue` is the named lossy string
projection: colors prefer their preserved `hex`, dimensions and durations preserve value + unit,
other composites use stable JSON. Invalid reference syntax is never projected into a `Fact`.

Conformance and adversarial goldens in `packages/context/test/fixtures` cover the final 2025.10
examples and the required failure taxonomy. A separate corpus benchmark
(`pnpm eval:dtcg-corpus`) fetches 20 public token files from GitHub by immutable blob SHA;
**it is the only thing in the repository that touches the network** and is deliberately outside
CI. Baseline recorded 2026-07-12 on Node 25.2.1: 20/20 blobs fetched and parsed, repeated output
byte-identical, p95 resolution 2.11 to 3.15 ms, peak heap 17.15 to 17.54 MiB (ceilings 100 ms /
64 MiB); 1,629 raw token-shaped nodes yielded 384 strict-profile tokens and 1,223 diagnostics.
That last number is compatibility evidence, not an accuracy score: most public repositories still
use pre-2025 scalar `$value` shapes or split aliases across files, and this profile abstains
rather than stringify them.

### Using it as a library

The packages are private workspace packages and were never published to npm, so the consumption
path is clone → build → import, or vendor the source you want. Every extractor takes a **string**,
not a path; `@uidna/cli` is the only package that reads a disk.

The block below is `examples/library-example.ts`, checked in and runnable as-is once `pnpm build`
has run. It goes extract → reconcile → drift → version → sign off → serve, in one file:

```console
$ node examples/library-example.ts
[
  'tokens.spacing.--spacing-gap: code declares "8px" but it is not observed in rendered reality (dead token)'
]
before approval: null
after approval:  { schemaVersion: '1', storeVersion: '2' } sha256:ef69d6a
```

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
console.log(computeDriftHints(conflicts).map((hint) => hint.message));

const store = inMemorySnapshotStore();
const { stored } = await commitSnapshot(store, draft);          // immutable draft version

// Reading before sign-off returns null: a draft genome is never served downstream.
console.log("before approval:", await getSnapshot(store, "acme/web"));

await approveSnapshot(store, requestReview(stored.snapshot));   // new immutable approved version

const served = await getSnapshot(store, "acme/web");
console.log("after approval: ", served?.contract, served?.contentDigest.slice(0, 14));
// served: { contract: { schemaVersion: "1", storeVersion: "2" },
//           repo, dnaVersion, contentDigest: "sha256:…", snapshot }
```

That `null` before approval is the point: a draft genome is never visible downstream.

**Where the `@uidna/*` specifiers resolve.** Inside this repository they resolve everywhere,
including the root, because the root `package.json` declares the workspace packages as
dependencies, which is why the file above runs from the repository root with no extra setup. They
resolve to `packages/<name>/dist`, so `pnpm build` is a prerequisite. **Outside** this repository
they resolve nowhere: nothing was published to npm. Copy the file into your own project and you
must rewrite each `@uidna/x` to a path into the built package, e.g.
`import { emptyDraft } from "/abs/path/to/ui-dna/packages/schema/dist/index.js";`.

`packages/cli/test/library-example.test.ts` executes this example on every `pnpm test`, so it
cannot rot into a snippet that no longer runs.

## Configuration

The library and CLI read **no environment variables at all**. The one exception is outside the
default gate:

| Variable | Required | Default | Effect |
|---|---|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | No | unset | Used only by `pnpm eval:dtcg-corpus` to raise GitHub's 60-requests/hour anonymous rate limit while fetching the public token corpus. Nothing else in the repository reads it. |

## How it works

```
  repo sources (read by @uidna/cli)          rendered evidence (captured elsewhere)
  tailwind.config / @theme                   DOM geometry · computed styles
  CSS custom properties                      a11y facts · screenshot refs · phash
  tokens.json (DTCG)                                  │
  package.json · .designreview.yml                    │
         │                                            │
         ▼                                            ▼
   @uidna/context                                @uidna/render
   Fact<T> @ code|config|human                   Fact<T> @ pixels
   confidence 0.5-0.9                            VisualDistributions, RenderedAnchor[]
         └───────────────┬────────────────────────────┘
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

pnpm workspace, seven packages, strict TypeScript with NodeNext ESM and `tsc -b` project
references. Dependencies flow strictly downward.

```
packages/
  schema/      @uidna/schema     the contract every other package speaks
  context/     @uidna/context    static extraction from repo sources
  render/      @uidna/render     the rendered-evidence input port
  reconcile/   @uidna/reconcile  merge code/config/pixels into resolved facts
  store/       @uidna/store      versioning, sign-off, authority, read contract, drift gate
  eval/        @uidna/eval       measures whether reconciliation is any good
  cli/         @uidna/cli        the filesystem entry point (`ui-dna`)
examples/      sample-tokens.json, sample-project/ (a rich synthetic project),
               utility-only-project/ (one that declares nothing), library-example.ts
scripts/       dtcg-corpus-benchmark.mjs, the network-touching corpus check
```

**`@uidna/schema`** holds `DnaSnapshot` and its parts: product identity, tokens (color, typography,
spacing, radii, shadows, breakpoints, motion), component conventions, visual distributions,
rendered anchors, exceptions, metadata. `Fact<T>` carries `{ value, confidence, provenance }`;
`Conflict` records a reconciliation disagreement. Plus `fact()`, `emptyDraft()`, `isApproved()`,
`validateSnapshot()` and a shared color canonicalizer so the drift gate and the reconciler agree on
what "the same color" means. `SCHEMA_VERSION = "1"`; evolution is additive-only within a version.

**`@uidna/context`** holds the pure extractors, each split into a source-format parser plus a thin
`*-dna.ts` that maps its output onto schema facts: Tailwind v3 via Tailwind's own `resolveConfig`
behind an injected `ConfigLoader` port, Tailwind v4 `@theme` via PostCSS, CSS custom properties
including theme-scoped blocks, DTCG/Style Dictionary token files, component-library detection
(shadcn/Radix/MUI/Chakra/Mantine), the `.designreview.yml` brand block, and changed-file → route
mapping for Next.js App and Pages routers with an import-graph pass that falls back
deterministically when resolution coverage is below threshold. Also `buildContextBlock`, the
deterministic content-hash serializer.

**`@uidna/render`** defines the `CaptureEvidence` port (viewports, DOM geometry rects,
computed-style and a11y facts, screenshot object-storage refs, perceptual hashes), a validator, a
fixture capture source, `computeVisualDistributions` and `selectAnchors`. Screenshot *bytes* are
never stored in the genome, only refs.

**`@uidna/reconcile`** contains `reconcileField`, `reconcileTokens` (declared tokens × observed
distributions), `reconcileComponents`, `computeDriftHints`, and `thresholds.ts`.

**`@uidna/store`** is the largest package. Content-addressed immutable versions over an injected
`SnapshotStore` port; the draft → in_review → approved state machine, where approval applies
headless JSON `ReviewDecisions` and promotes confirmed facts to confidence 1.0 with provenance
`human`; route exceptions; `diffSnapshots`; the versioned `getSnapshot` read contract, which never
serves a draft; an append-only hash-chained authority log with revocation semantics;
`retrieveGenomeSlice`, which returns only the genome slices a PR touches; a residency layer
(tenant entitlement, pattern-based scrubbing, retention tiers); the design↔code drift gate, its
base-vs-head delta, remediation projection, routing node and PR-comment renderer; design-source
provenance enforcement, which can only ever *remove* blocking authority from a verdict; and two
named projections (an A2A capability card and a local-check profile).

**`@uidna/eval`** runs reconciliation over labeled fixtures and reports resolved-fact
precision/recall, conflict-detection recall, and confidence calibration (ECE, Brier, reliability
bins), with a gate that can fail CI on a floor.

**`@uidna/cli`** covers argument parsing, the bounded directory walk (`scan.ts`), the merge into a
draft genome (`genome.ts`), terminal rendering (`format.ts`), and the worker-backed `ConfigLoader`
(`tailwind-config-loader.ts`, which spawns `packages/cli/worker/tailwind-config-worker.mjs`).
`runCli` returns an exit code rather than calling `process.exit`, so the tests drive the same
entry point a terminal does.

Three design decisions are worth reading the code for:

**Determinism is a hard constraint.** The same repository state must produce a byte-identical
genome. Serialization sorts keys *and arrays* recursively and contains no timestamps; caches are
invalidated by content hash, never by wall-clock TTL. Version identity is the SHA-256 of the genome
content folded with only the *causal* stamps that can legitimately change it, and nothing
incidental. That last clause was learned the hard way: content-only identity meant approving a
genome without editing it produced the same hash as the unapproved draft, so an approval could
collide with, and resolve to, the draft record. Lifecycle state is now part of identity
(`packages/store/src/version-identity.ts`, `STORE_VERSION = "2"`).

**Approval is revocable without mutating anything.** `ApprovalState` is terminal at `approved` and
an approved snapshot is never edited, but approvals do need to be withdrawn. Authority lives in a
separate append-only, hash-chained event log keyed by `(tenant, repo, dnaVersion)`, where each
event pins its predecessor's hash, so reordering, dropping or backdating an event is detectable.
Reads fail closed and *non-enumerating*: a revoked version is indistinguishable from one that never
existed.

**The drift gate is fair to the PR author.** Given a designer's DTCG export and the genome
extracted from code, `computeDesignCodeDrift` treats design as authoritative and classifies every
divergence as `value_mismatch`, `missing_in_code` or `undocumented_in_design`. `diffDrift` then
partitions drift into introduced / resolved / persisting against the base branch and gates on the
*introduced* set only, so a change is never blocked by pre-existing design debt. And
`reviewDesignSourceDrift` refuses to gate at all on a malformed export: an unparseable export
yields an empty design genome, and gating that against real code would flag every token as
undocumented. A loud, confidently wrong verdict is worse than an abstention, so it returns a typed
refusal.

## Development

```console
$ pnpm test
 Test Files  54 passed (54)
      Tests  472 passed (472)
   Duration  1.92s
```

```bash
pnpm lint         # eslint . --max-warnings=0
pnpm typecheck    # tsc -b (same as pnpm build)
pnpm vitest run packages/cli/test/scan.test.ts    # one file
pnpm vitest run packages/cli                      # one package
```

CI (`.github/workflows/ci.yml`) runs exactly `lint`, `typecheck`, `test` on pull requests and
pushes to `main`, with `permissions: contents: read`.

`pnpm eval:dtcg-corpus` is outside the gate and requires network access to `api.github.com`.

If `node packages/cli/dist/bin.js` reports that it cannot find the module, `pnpm build` has not
been run.

## Limitations / Not implemented

| Component | Status | Notes |
|---|---|---|
| DTCG 2025.10 resolver | Working | `ui-dna tokens`; conformance + adversarial goldens. |
| Static extraction (CSS, Tailwind v3/v4, DTCG, brand, component libs) | Working | `ui-dna context`. |
| Reconciliation + drift hints | Working | Static sources only, unless you supply pixel evidence yourself. |
| Context block + content hashing | Working | `--out` writes a schema-valid draft genome. |
| Tailwind v3 config evaluation | Working | Worker thread + timeout, behind `--exec-tailwind-config`. Isolation bounds failure, not privilege. |
| Rendered evidence capture | Not implemented | `CaptureEvidence` (`packages/render/src/capture-evidence.ts`) is an input port; `fixtureCaptureSource` is a stub. Implement `CaptureSource` to feed the `pixels` half. |
| Snapshot persistence | Not implemented | Only `inMemorySnapshotStore`. The port is `SnapshotStore` in `packages/store/src/store.ts`; restarting loses every genome. |
| Sign-off UI | Not implemented | Human review is a headless JSON `ReviewDecisions` document (`packages/store/src/sign-off.ts`). Nothing renders it. |
| Server / HTTP / MCP endpoint | Out of scope | The read contract is a function call, `getSnapshot`. The service that exposed it lived in a private repo. |
| DTCG Resolver Module, external `$ref` | Out of scope | Returns `unsupported_resolver_module` / `unsupported_external_reference` by design. |
| npm publication | Not implemented | All seven packages are `private: true` at `0.0.0`. Clone and build, or vendor the source. |

### Caveats

Component-library detection infers conventions from a dependency being present, not from how it is
used. Route mapping targets Next.js App and Pages routers and nothing else. The residency layer's
secret and PII scrubbing is pattern-based: defense in depth, not a guarantee. The A2A agent card
(`packages/store/src/agent-card.ts`) is `draft-unapproved`: it describes contracts that exist and
carries no new capability. The local-check profile (`getPointerLocalCheckProfile`) targets a
deterministic offline-check client that never shipped; its component-hint family is deliberately
empty because the genome never owned a stable rendered component signature, and its target-size and
contrast entries are marked `policy_default` because they are WCAG defaults, not team assertions.
The eval harness measures reconciliation against hand-labeled fixtures, not real repositories: the
weights in `thresholds.ts` are reasoned defaults with the measurement apparatus built around them,
never calibrated on production data.

Bare `#N` markers in source comments and commit messages refer to issues in a private tracker that
is not part of this release. They are retained as provenance and cannot be resolved from here.

## The rest of the archive

Nothing here imports any of these; the coupling was by data contract only, and the
`SnapshotResponse` wire shape is pinned by a golden fixture
(`packages/store/test/fixtures/golden-snapshot-response.json`) so a byte-compat test fails if the
contract moves underneath a consumer.

- [judgment-engine](https://github.com/apatureai/judgment-engine) was the capture, grounded
  critique, eval and feedback substrate. It **produced** the artifacts that arrive here as
  `CaptureEvidence` and **consumed** approved genome slices. The static extractors in
  `@uidna/context` were built there first and ported here.
- [gate](https://github.com/apatureai/gate) was the GitHub PR review surface.
- [mcp-review](https://github.com/apatureai/mcp-review) ran the same review, in-loop over MCP.
- [ui-graph](https://github.com/apatureai/ui-graph) is a token-efficient, genome-aware scene graph.
- [sigil](https://github.com/apatureai/sigil) is a fixture-driven model quality/efficiency audit
  harness.

## Contributing

This repository is archived. Pull requests are not accepted and issues are not monitored. Forking
is the intended path: the license permits it and the test suite runs offline, so a fork can be
verified in one command. [CONTRIBUTING.md](CONTRIBUTING.md) documents the conventions the code was
written to, for anyone continuing the history in a fork.

## Security

No credentials, network calls or telemetry exist in the library or CLI code, and the one
network-touching script is opt-in. Do not point `--exec-tailwind-config` at a repository you do not
trust. See [SECURITY.md](SECURITY.md) for the threat boundaries; note that no security updates will
be published for this archived code.

## License

MIT. See [LICENSE](LICENSE).
