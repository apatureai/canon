# canon

[![CI](https://img.shields.io/github/actions/workflow/status/apatureai/canon/ci.yml?branch=main&label=CI)](https://github.com/apatureai/canon/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/apatureai/canon)](https://github.com/apatureai/canon/blob/main/LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://github.com/apatureai/canon/blob/main/.node-version)

> Previously published as `ui-dna`. The npm package scope is still `@uidna/*` and the CLI is still `ui-dna`; only the repository was renamed.

**A strict DTCG 2025.10 design-token resolver, and a scanner that reads a project's declared design
system out of its own files. It abstains and explains instead of guessing.**

**Read this before you point it at your own repo.** `ui-dna` reports the design tokens a repository
*declares*: CSS custom properties in a `:root` / `html` / `.dark` / `[data-theme]` block, a Tailwind
v4 `@theme` block, a Tailwind v3 config (behind `--exec-tailwind-config`), and DTCG or Style
Dictionary token files. It does not infer a design system from rendered output or from utility
classes in your JSX. So a Next.js or Vite app styled entirely in `p-4 rounded-lg text-slate-900`
declares no tokens and correctly reports **`resolved tokens (0)`**, naming every file it read and
why each one contributed nothing.

That zero is the design, not a defect. Mining a de facto scale out of class usage would mean
inventing a design system the team never agreed to, and stamping it with a confidence number that
means nothing. This tool would rather abstain and say so. [Point it at your own
repository](#3-point-it-at-your-own-repository) states the rule in full, and [roadmap item
8](#roadmap) is where usage inference would go if someone designs it properly.

Within that scope it is precise. Point the CLI at a token file and it tells you exactly which
tokens resolve, which ones it refuses to resolve, and why. Point it at a project directory and it
collects every design source it can find (CSS custom properties, Tailwind v3 and v4, DTCG token
files, a brand config, component libraries in `package.json`), reconciles the ones that disagree
with each other, and writes a deterministic, content-addressed JSON snapshot with per-field
confidence and provenance.

It never runs a browser, never calls a model, never edits your code, and needs no credentials or
network access. It reads and it reports.

## Who this is for

- **Design-token tooling authors** (Style Dictionary, Terrazzo, Tokens Studio, Figma variable sync,
  and anything else that has to load somebody else's `tokens.json`): a reference implementation of
  the DTCG Format Module 2025.10 resolution rules, with a diagnostic taxonomy for every way a
  document can fail, and a corpus benchmark that tells you what real-world token files actually
  look like.
- **Design-system maintainers** who want to know, mechanically, where their tokens are declared,
  where two files disagree, and whether the answer changed between two commits.
- **People building tools that need a machine-readable description of a repo's design system**,
  including agent tooling: the output is stable JSON with a content hash, and identical inputs
  always produce identical bytes.

## Why it is interesting

**Abstention is a feature.** A resolver that meets a circular alias, an unresolvable reference or a
malformed dimension has two options: guess, or refuse. `ui-dna` refuses, drops the token from the
resolved set, and emits one of 11 diagnostic codes naming the exact token and reason. Nothing is
silently promoted with its reference syntax as a value.

**Sources that disagree are the normal case.** Real repositories declare `--color-brand` in
`styles.css` and again in a `@theme` block with a different value. `reconcileField` resolves the
value by provenance precedence (`human > config > code > pixels`) and computes confidence
*separately*: agreement between independent sources reinforces it, disagreement keeps the winning
value but degrades its confidence in proportion to the dissent, and every candidate that lost is
still in the report. Every weight lives in one file (`packages/reconcile/src/thresholds.ts`) so
`@uidna/eval` can measure the ladder against labeled fixtures instead of leaving it as taste.

**Determinism is a hard constraint.** Serialization sorts keys and arrays recursively and contains
no timestamps; caches invalidate by content hash, never by wall clock. The same repository state
produces a byte-identical snapshot and the same `sha256:` context hash on every machine.

**A citable datapoint about the ecosystem.** `pnpm eval:dtcg-corpus` fetches 20 public token files
from GitHub by immutable blob SHA and resolves them under the strict 2025.10 profile. Last run
(2026-08-09, Node 24.14.0): **1,629 token-shaped nodes yielded 384 strict-profile tokens and 1,223
diagnostics**, so roughly 24% of what is out there in the wild satisfies the 2025.10 profile
without complaint. Ten of the 20 files resolved zero tokens; exactly one resolved with zero
diagnostics. Most of the rest use pre-2025 scalar `$value` shapes or split aliases across files.
That is compatibility evidence, not an accuracy score, and it is the number to argue with if you
think the profile is too strict.

## Requirements

| Tool | Floor | Check | Notes |
|---|---|---|---|
| Node | `>=24` | `node -v` | `.node-version` pins 24. Type stripping and `worker_threads` are both used. |
| pnpm | 9.15.0 | `pnpm -v` | `corepack enable pnpm`, or `npm i -g pnpm@9.15.0`. |

Verified on macOS 14 (Darwin 24.6.0) with Node 24.14.0. CI runs the same commands on
`ubuntu-latest`. Windows is untested (see [Roadmap](#roadmap)).

No credentials, no network, no browser, no model. `pnpm-lock.yaml` is committed, so
`--frozen-lockfile` reproduces the tree this was verified on.

## Quickstart

Two commands, about a minute, no configuration. Run everything from the repository root.

Steps 1 and 2 run against checked-in fixtures that **do** declare tokens, so a first run shows
resolution working end to end. Step 3 is the one to read before you point it at your own project,
because it covers what a repository with no declared tokens returns and why.

```bash
git clone https://github.com/apatureai/canon.git
cd canon
pnpm install --frozen-lockfile
pnpm build          # tsc -b; the CLI runs from packages/cli/dist, so this is not optional
```

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

**Success looks like** `resolved tokens (22)` and `diagnostics (4)`. The four broken tokens are in
the diagnostics list and absent from the resolved list. A resolver that reported 26 tokens would
have guessed.

Add `--json` for exact, unelided values, or `--strict` to exit 2 when any diagnostic was raised.

### 2. Scan a project

`examples/sample-project` is a synthetic front end that declares tokens three ways at once (a
`:root` block, a Tailwind v4 `@theme` block and a DTCG token file), plus a Tailwind v3 config that
is reported but not evaluated unless you ask. That is why this run resolves tokens instead of
reporting zero. Nothing in it is installed or built; only its design sources are read.

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

**Success looks like** `sources (6 of 6 files walked)`, `conflicts (2)`, the `sha256:da5aa778...`
hash, and a file at `out/genome.json`. Run it twice and the hash is identical.

Read one field out of the snapshot to see the shape:

```console
$ node -e "const g=require('./out/genome.json'); console.log(g.tokens.color['--color-brand'], g.identity.tone.value)"
{
  value: '#2f6fed',
  confidence: 0.48999999999999994,
  provenance: 'code'
} precise, quiet, never playful
```

That is the whole idea. Every field carries where it came from and how sure the extractor is, and
this token's confidence sits *below* either source that declared it, because two files disagreed.

(The CLI calls the aggregate snapshot a *genome*, and the schema type is `DnaSnapshot`. It is a JSON
document of resolved token facts, identity facts and component conventions. Nothing more magic than
that.)

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
timeout, which bounds *failure* (a config that throws or hangs fails the load instead of taking the
CLI down), not *privilege*: it runs as ordinary Node code with your user's rights. Only point it at
a repository you would already run `npm install` in.

### 3. Point it at your own repository

This is the caveat from the top of the README, stated in full, because a *correct* run on a real
project often finds nothing.

`ui-dna` reads **declared** design tokens. It does not infer a design system from usage: it will not
mine `p-4 rounded-lg text-slate-900` out of your JSX and call it a spacing scale. Concretely, you
get tokens from a `:root` / `html` / `.dark` / `[data-theme]` block of custom properties, a literal
Tailwind v4 `@theme { ... }` block, a DTCG or Style Dictionary token file, or a Tailwind v3 config
**with `--exec-tailwind-config`**. Importing Tailwind v4 as `@import "tailwindcss"` declares nothing
in your repository (that theme lives inside the npm package), and `package.json` only contributes
component conventions for shadcn/ui, Radix, MUI, Chakra and Mantine.

So a plain Vite/React app that styles entirely in utility classes legitimately reports zero tokens.
`examples/utility-only-project` is exactly that project, and it shows what an honest empty result
looks like:

```console
$ node packages/cli/dist/bin.js context examples/utility-only-project | head -20
ui-dna context - examples/utility-only-project

sources (3 of 3 files walked)
  package.json   component-libraries    -           no recognised component library (shadcn/ui, radix, mui, chakra, mantine)
  src/App.css    css-custom-properties  -           no custom properties in :root/html or a theme scope
  src/index.css  css-custom-properties  -           no custom properties in :root/html or a theme scope

resolved tokens (0)
  color         0
  typography    0
  spacing       0
  radii         0
  shadows       0
  breakpoints   0
  motion        0
  (none declared. ui-dna reads tokens a repository states outright: a :root/html/.dark/
   [data-theme] custom-property block, a Tailwind v4 @theme block, a DTCG or Style
   Dictionary token file, or a Tailwind v3 config with --exec-tailwind-config. It does
   not infer a scale from utility classes or from rendered output, so it abstains here
   instead of guessing. Each source above states what it contributed.)
```

The report explains its own zero, so nobody has to find this section to interpret one. Every
candidate file the walk opened is listed with the reason it contributed nothing, and the
`(none declared. ...)` note prints whenever files were read but no token was declared.
`sources (0 of N files walked)` is a different statement: no candidate file was found at all, which
usually means the path is wrong, and that case prints its own message instead. And if the walk was
truncated, that message says so too: `(none reached: the walk stopped after N files without finding
a candidate.)`, because a bounded walk is not entitled to claim the repository declares nothing.

## Usage

### `ui-dna tokens <file.json>`

Resolve one DTCG token document.

| Flag | Effect |
|---|---|
| `--json` | Print `{ profile, tokens, diagnostics }` as JSON. Values are exact and unelided. |
| `--strict` | Exit 2 when any diagnostic was raised. |

### `ui-dna context <directory>`

Walk a project directory, extract every static design source, reconcile them, and build a context
block.

| Flag | Effect |
|---|---|
| `--json` | Print `filesWalked`, every source (including the ones that declared nothing), conflicts, drift hints, diagnostics, the context block and the full snapshot as JSON. |
| `--out <file>` | Write the draft `DnaSnapshot` as JSON. Parent directories are created. |
| `--repo <owner/name>` | Repository identity stamped into the snapshot. Default `local/<directory name>`. It is part of the hashed content. |
| `--exec-tailwind-config` | Evaluate `tailwind.config.*` files in a worker thread. Off by default. |
| `--max-depth <n>` | Directory depth bound. Default 8. |
| `--max-files <n>` | File count bound. Default 5000. |
| `--strict` | Exit 2 when any conflict or diagnostic was raised, **or when a bound truncated the walk**. |

Exit codes: `0` success, `1` usage or IO failure, `2` `--strict` and the report was not clean.

**A truncated walk is never clean.** `--max-files` and `--max-depth` bound the walk so a large
repository degrades instead of running away, but a walk that stopped early has only searched part of
the tree. Its counts are lower bounds: `conflicts (0)` then means "none found before I stopped
looking", not "no two sources disagree". `--strict` used to exit 0 in exactly that case, so any
repository past the default 5,000-file bound got a green CI gate over conflicts the scan never
reached. It now exits 2 and prints the bound it hit, and the report leads with

```
walk truncated - THIS SCAN DID NOT FINISH (5000 files walked)
  file-count bound (--max-files 5000) reached
  Every count below is a LOWER BOUND over the part of the tree that was reached.
  "conflicts (0)" here means "none found before the walk stopped", NOT "none exist".
  Raise --max-files / --max-depth and run again before treating this as a result.
  --strict exits 2 on a truncated walk for exactly this reason.
```

before any number, with every count tagged `[INCOMPLETE: ...]` - all of them, because every count in
the report comes from the same bounded walk. No parenthetical states an absence either. A finished
walk prints `drift hints (0)` / `(none)`; a truncated one prints "none among the sources reached
before the walk was truncated ... this is NOT 'this repository has no drift'", because "(none)" is a
conclusion a walk that stopped early did not earn. `--json` carries the same fact as `truncated` plus
a `truncationReasons` array. Raise the bound (`--max-files 50000`) and run again; if the gate then
passes, it passed on a walk that finished.

**Which files are read.** `*.css` anywhere (a file whose PostCSS parse finds a real `@theme` at-rule
is also read as Tailwind v4); `tokens.json`, `design-tokens.json`, `*.tokens.json` anywhere;
`tailwind.config.{js,cjs,mjs,ts,mts,cts}` anywhere; `package.json` and `.designreview.yml` at the
scan root only. `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`,
`.turbo`, `.cache`, `vendor` and `tmp` are never entered. Files over 2 MiB and unparseable files are
listed as `skipped`, never guessed at.

There are three equivalent ways to invoke the CLI. `node packages/cli/dist/bin.js` and
`pnpm ui-dna` need no setup. Nothing is published to npm yet (see [Roadmap](#roadmap)), so if you
want the command on your `PATH`, symlink the built entry point; it has a shebang and works from any
working directory:

```bash
chmod +x packages/cli/dist/bin.js
mkdir -p ~/.local/bin                                       # or any directory already on your PATH
ln -s "$PWD/packages/cli/dist/bin.js" ~/.local/bin/ui-dna
```

`dist/` is gitignored, so neither step dirties the tree.

### The confidence ladder

Every extracted fact is a `Fact<T>`: `{ value, confidence, provenance }`. The defaults, in
descending order:

| Source | Provenance | Confidence |
|---|---|---|
| Human sign-off during review | `human` | 1.0 (reserved) |
| `.designreview.yml` brand block | `human` | 0.9 |
| `tokens.json` / Tailwind config | `config` | 0.8 |
| Tailwind v4 `@theme` block | `code` | 0.7 |
| Raw CSS custom properties | `code` | 0.6 |
| Component library present in `package.json` | `code` | 0.5 |

Conflicts are promoted into advisory `DriftHint`s (`config says X but pixels show Y`, or a *dead
token* the codebase declares that nothing rendered ever uses). Drift never mutates the resolved
output and never canonizes the drifting value.

### The DTCG profile

`resolveTokensJson` implements the stable Design Tokens Community Group
[Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) profile:

- exact JSON token values, inherited types, chained curly aliases, same-document RFC 6901 `$ref`
  including property-level references, `$root`, and group `$extends`;
- deterministic alias and extension derivation chains, byte-stable key/token/diagnostic ordering;
- fail-closed diagnostics for unresolved, circular, type-invalid, malformed, external and
  over-budget references;
- classic Style Dictionary `value` nodes remain an explicit compatibility path; they carry
  `type: null` when undeclared and are not described as DTCG-conformant.

The [Resolver Module](https://www.designtokens.org/TR/2025.10/resolver/) (sets, modifiers,
`resolutionOrder`, filesystem and remote sources) is disabled: a resolver document returns
`unsupported_resolver_module` and an external `$ref` returns `unsupported_external_reference`.
Enabling either needs an injected, sandboxed, allowlisted loader and a versioned profile change,
which is a roadmap item below.

Resolved composite values stay structured. `projectTokenValue` is the named lossy string projection:
colors prefer their preserved `hex`, dimensions and durations preserve value plus unit, other
composites use stable JSON. Invalid reference syntax is never projected into a `Fact`.

Conformance and adversarial goldens in `packages/context/test/fixtures` cover the final 2025.10
examples and the required failure taxonomy.

## Using it as a library

The packages are workspace packages that are not on npm yet, so the consumption path today is clone,
build, import, or vendor the source you want. Every extractor takes a **string**, not a path;
`@uidna/cli` is the only package that reads a disk.

The block below is `examples/library-example.ts`, checked in and runnable once `pnpm build` has run.
It goes extract, reconcile, drift, version, sign off, serve, in one file:

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

// Reading before sign-off returns null: a draft is never served downstream.
console.log("before approval:", await getSnapshot(store, "acme/web"));

await approveSnapshot(store, requestReview(stored.snapshot));   // new immutable approved version

const served = await getSnapshot(store, "acme/web");
console.log("after approval: ", served?.contract, served?.contentDigest.slice(0, 14));
```

**Where the `@uidna/*` specifiers resolve.** Inside this repository they resolve everywhere,
including the root, because the root `package.json` declares the workspace packages as dependencies.
They resolve to `packages/<name>/dist`, so `pnpm build` is a prerequisite. Outside this repository
they do not resolve yet: copy the file into your own project and rewrite each `@uidna/x` to a path
into the built package, for example
`import { emptyDraft } from "/abs/path/to/ui-dna/packages/schema/dist/index.js";`.

`packages/cli/test/library-example.test.ts` executes this example on every `pnpm test`, so it cannot
rot into a snippet that no longer runs.

## How it works

```
  repo sources (read by @uidna/cli)          rendered evidence (supplied by you)
  tailwind.config / @theme                   DOM geometry, computed styles
  CSS custom properties                      a11y facts, screenshot refs, phash
  tokens.json (DTCG)                                  |
  package.json, .designreview.yml                     |
         |                                            |
         v                                            v
   @uidna/context                                @uidna/render
   Fact<T> @ code|config|human                   Fact<T> @ pixels
   confidence 0.5-0.9                            VisualDistributions, RenderedAnchor[]
         +---------------+----------------------------+
                         v
                  @uidna/reconcile
         value by precedence, confidence by agreement
         resolved DnaTokens + Conflict[] -> DriftHint[]
                         |
                         v
                    @uidna/store
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
  schema/      @uidna/schema     the contract every other package speaks
  context/     @uidna/context    static extraction from repo sources
  render/      @uidna/render     the rendered-evidence input port
  reconcile/   @uidna/reconcile  merge code/config/pixels into resolved facts
  store/       @uidna/store      versioning, sign-off, authority, read contract, drift gate
  eval/        @uidna/eval       measures whether reconciliation is any good
  cli/         @uidna/cli        the filesystem entry point (`ui-dna`)
examples/      sample-tokens.json, sample-project/, utility-only-project/, library-example.ts
scripts/       dtcg-corpus-benchmark.mjs, the one network-touching script
```

**`@uidna/schema`** holds `DnaSnapshot` and its parts: product identity, tokens (color, typography,
spacing, radii, shadows, breakpoints, motion), component conventions, visual distributions, rendered
anchors, exceptions, metadata. `Fact<T>` carries `{ value, confidence, provenance }`; `Conflict`
records a reconciliation disagreement. Plus `fact()`, `emptyDraft()`, `isApproved()`,
`validateSnapshot()` and a shared color canonicalizer so the drift gate and the reconciler agree on
what "the same color" means. `SCHEMA_VERSION = "1"`; evolution is additive-only within a version.

**`@uidna/context`** holds the pure extractors, each split into a source-format parser plus a thin
`*-dna.ts` that maps its output onto schema facts: Tailwind v3 via Tailwind's own `resolveConfig`
behind an injected `ConfigLoader` port, Tailwind v4 `@theme` via PostCSS, CSS custom properties
including theme-scoped blocks, DTCG and Style Dictionary token files, component-library detection,
the `.designreview.yml` brand block, and changed-file to route mapping for Next.js App and Pages
routers with an import-graph pass that falls back deterministically when resolution coverage is
below threshold. Also `buildContextBlock`, the deterministic content-hash serializer.

**`@uidna/render`** defines the `CaptureEvidence` port (viewports, DOM geometry rects,
computed-style and a11y facts, screenshot object-storage refs, perceptual hashes), a validator, a
fixture capture source, `computeVisualDistributions` and `selectAnchors`. Screenshot *bytes* are
never stored, only refs.

**`@uidna/reconcile`** contains `reconcileField`, `reconcileTokens` (declared tokens by observed
distributions), `reconcileComponents`, `computeDriftHints`, and `thresholds.ts`.

**`@uidna/store`** is the largest package. Content-addressed immutable versions over an injected
`SnapshotStore` port; the draft to in_review to approved state machine, where approval applies
headless JSON `ReviewDecisions` and promotes confirmed facts to confidence 1.0 with provenance
`human`; route exceptions; `diffSnapshots`; the versioned `getSnapshot` read contract, which never
serves a draft; an append-only hash-chained authority log with revocation semantics;
`retrieveGenomeSlice`, which returns only the slices a PR touches; a residency layer (tenant
entitlement, pattern-based scrubbing, retention tiers); the design-to-code drift gate, its
base-vs-head delta, remediation projection, routing node and PR-comment renderer; design-source
provenance enforcement, which can only ever *remove* blocking authority from a verdict; and two
named projections (an A2A capability card and a local-check profile).

**`@uidna/eval`** runs reconciliation over labeled fixtures and reports resolved-fact
precision/recall, conflict-detection recall, and confidence calibration (ECE, Brier, reliability
bins), with a gate that can fail CI on a floor.

**`@uidna/cli`** covers argument parsing, the bounded directory walk (`scan.ts`), the merge into a
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

## Status

Verified on 2026-08-09, Node 24.14.0, pnpm 9.15.0: lint clean, typecheck clean,
**473 tests across 54 files passing** in about 2 seconds, all offline.

| Area | Status |
|---|---|
| DTCG 2025.10 resolver (`ui-dna tokens`) | **Works.** Conformance and adversarial goldens, 11 diagnostic codes, 20-file public corpus benchmark. |
| Static extraction (CSS, Tailwind v3/v4, DTCG, brand, component libs) | **Works.** `ui-dna context`. |
| Reconciliation, conflicts, drift hints | **Works** for static sources. Pixel evidence works too, if you supply it. |
| Context block and content hashing | **Works.** `--out` writes a schema-valid draft snapshot. |
| Tailwind v3 config evaluation | **Works,** behind `--exec-tailwind-config`. Worker thread plus timeout bounds failure, not privilege. |
| Versioning, sign-off state machine, authority log, drift gate | **Works,** in memory, as a library. |
| Rendered-evidence capture | **Not implemented.** See roadmap. |
| Snapshot persistence | **Not implemented.** In-memory only. See roadmap. |
| Sign-off UI | **Not implemented.** Sign-off is a headless JSON document. See roadmap. |
| npm packages | **Not published yet.** Clone and build, or vendor. See roadmap. |

## Roadmap

These are real gaps, described precisely enough to pick up. Each names the seam you would build
against. Contributions are welcome, and an issue proposing an approach before a large PR is the
fastest path.

**1. A rendered-evidence capture adapter.** `ui-dna` consumes captured evidence, it does not produce
it. The interface is `CaptureSource` in `packages/render/src/capture-source.ts`, and the data shape
is `CaptureEvidence` in `packages/render/src/capture-evidence.ts` (viewports, DOM geometry rects,
computed-style and a11y facts, screenshot refs, perceptual hashes). The only implementation today is
`fixtureCaptureSource`, which replays a fixture. A Playwright-backed adapter in a separate optional
package would light up the whole `pixels` provenance lane, including dead-token detection against
what a browser actually renders. It has to stay optional: the core packages must keep building and
testing with no browser.

**2. A persistent `SnapshotStore`.** The port is `SnapshotStore` in `packages/store/src/store.ts` and
the only implementation is `inMemorySnapshotStore`, so restarting loses everything. A file-backed or
SQLite-backed implementation is self-contained: implement the interface, then reuse the existing
store test suite against it. The content-addressing and authority-log invariants are already tested,
so a new backend has a ready-made conformance suite.

**3. A sign-off surface.** Human review is a headless JSON `ReviewDecisions` document
(`packages/store/src/sign-off.ts`, applied by `applyReviewDecisions`). Nothing renders it. A
`ui-dna review` subcommand that walks the low-confidence and conflicting facts in a terminal and
emits that JSON would be a complete, high-value contribution with no new dependencies.

**4. Publish the packages to npm.** All seven are versioned `0.1.0` but still `private: true`. This
needs a changelog and a release workflow, plus a decision about which packages are public API
(`@uidna/cli` and `@uidna/schema` at minimum). Until then the install path is clone and build.

**5. Serve the read contract.** `getSnapshot` is a function call. An HTTP or MCP server exposing the
versioned read contract and `retrieveGenomeSlice` would let other tools consume approved snapshots
without vendoring the library. The wire shape is already pinned by a golden fixture
(`packages/store/test/fixtures/golden-snapshot-response.json`), so a server has a contract to
implement rather than invent.

**6. DTCG Resolver Module support.** Sets, modifiers, `resolutionOrder`, filesystem and remote
sources currently return `unsupported_resolver_module`; external `$ref` returns
`unsupported_external_reference`. Enabling them needs an injected, sandboxed, allowlisted loader
(the codebase never reads the filesystem outside `@uidna/cli`, and that rule should hold) plus a
versioned profile change so callers can tell which profile resolved their document.

**7. More extractors.** Component-library detection covers shadcn/ui, Radix, MUI, Chakra and Mantine
(`packages/context/src/component-detection.ts`) and infers conventions from a dependency being
present, not from how it is used. Route mapping targets Next.js App and Pages routers and nothing
else (`packages/context/src/routes.ts`, `import-graph-routes.ts`); adapters for Remix, SvelteKit,
Nuxt or Astro would each be a bounded PR. Vanilla Extract, Panda CSS and StyleX are unhandled token
sources.

**8. Inferring tokens from usage.** Today `ui-dna` reads only *declared* tokens, so a project styled
entirely in utility classes reports zero. Mining a de facto scale out of class usage is a genuinely
different problem (it needs a confidence story that does not pollute the declared-token lane) and it
needs a design proposal before code.

**9. Calibrate the thresholds on real repositories.** `packages/reconcile/src/thresholds.ts` holds
reasoned defaults, and `@uidna/eval` measures precision, recall and calibration (ECE, Brier) against
hand-labeled fixtures, not production data. Labeled fixtures drawn from real open-source repos would
turn the weights from taste into measurement. This is the highest-leverage contribution for anyone
who cares about whether the confidence numbers mean anything.

**10. Windows support.** Everything is verified on macOS and Linux, and the path handling in the
directory walk is the obvious suspect. Adding `windows-latest` to the CI matrix and fixing what
falls over is a well-scoped first contribution.

Smaller known caveats, kept honest: the residency layer's secret and PII scrubbing is pattern-based
(defense in depth, not a guarantee); the A2A agent card (`packages/store/src/agent-card.ts`) is
marked `draft-unapproved` and describes contracts that already exist rather than adding capability;
the local-check profile's component-hint family is deliberately empty because the schema never owned
a stable rendered component signature, and its target-size and contrast entries are marked
`policy_default` because they are WCAG defaults, not team assertions. Bare `#N` markers in some
source comments refer to an older private tracker and cannot be resolved from here; treat them as
provenance, not instructions.

## Development

```console
$ pnpm test
 Test Files  54 passed (54)
      Tests  473 passed (473)
```

```bash
pnpm lint         # eslint . --max-warnings=0 (warnings fail)
pnpm typecheck    # tsc -b (same as pnpm build)
pnpm vitest run packages/cli/test/scan.test.ts    # one file
pnpm vitest run packages/cli                      # one package
```

CI (`.github/workflows/ci.yml`) runs exactly `lint`, `typecheck`, `test` on pull requests and pushes
to `main`, with `permissions: contents: read`.

`pnpm eval:dtcg-corpus` is outside the gate and is the only thing in the repository that touches the
network. It fetches 20 public token files from `api.github.com` by immutable blob SHA and asserts
its recorded per-file expectations, so it fails if resolution behaviour drifts. Set `GITHUB_TOKEN`
or `GH_TOKEN` to avoid the 60-requests-per-hour anonymous rate limit. Last run:

```console
$ pnpm eval:dtcg-corpus
{
  "files": 20,
  "deterministic": true,
  "p95Ms": 3.494,
  "peakHeapMiB": 14.76,
  "rawTokens": 1629,
  "resolvedTokens": 384,
  "diagnostics": 1223
}
```

If `node packages/cli/dist/bin.js` reports that it cannot find the module, `pnpm build` has not been
run.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, layout and how pull requests are reviewed.

## Related repositories

Nothing here imports any of these; the coupling is by data contract only, and the
`SnapshotResponse` wire shape is pinned by a golden fixture
(`packages/store/test/fixtures/golden-snapshot-response.json`) so a byte-compat test fails if the
contract moves underneath a consumer.

- [verdict](https://github.com/apatureai/verdict): capture, grounded critique, eval
  and feedback substrate. It produces the artifacts that arrive here as `CaptureEvidence` and
  consumes approved snapshot slices.
- [gate](https://github.com/apatureai/gate): a GitHub PR review surface.
- [bastion](https://github.com/apatureai/bastion): the same review, in-loop over MCP.
- [lattice](https://github.com/apatureai/lattice): a token-efficient scene graph.
- [sigil](https://github.com/apatureai/sigil): a fixture-driven model quality and efficiency audit
  harness.

## Security

No credentials, network calls or telemetry exist in the library or CLI code, and the one
network-touching script is opt-in. Do not point `--exec-tailwind-config` at a repository you do not
trust. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
