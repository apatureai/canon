Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

The full CLI flag reference and the complete library example. The [README Usage section](../README.md#usage)
keeps the four subcommand synopses and the confidence ladder; the per-flag detail and the runnable
library file live here.

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
| `--strict` | Exit 2 when any conflict or diagnostic was raised, **when a bound truncated the walk, or when a candidate design source could not be read**. |

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

**A refused source is never clean either.** A bound is one way to leave part of a design system
unexamined. The other is a candidate file the walk reached, opened and could not parse: a malformed
`tokens.json`, a stylesheet with an unclosed brace, a file over the 2 MiB ceiling. Nothing in
`skipped` ever reaches a resolver, so it raises no diagnostic and joins no conflict, and the same
false green followed: a repository whose only token file was malformed printed `token diagnostics
(0)` / `(none)` and passed `--strict`. It now takes the same treatment as a truncated walk. The
report leads with

```
scan incomplete - 1 candidate design source could not be read
  Each one is listed under "skipped files" below. They were found and never
  parsed, so every count below is a LOWER BOUND over the sources that could be
  read: "conflicts (0)" means "none among the files I could parse", NOT "none exist".
  Fix or exclude them and run again before treating this as a result.
  --strict exits 2 on a refused source for exactly this reason.
```

every count carries `[INCOMPLETE: ...]` (except `skipped files` itself, which is exactly the
refusals and not a lower bound), no parenthetical states an absence, and `--strict` exits 2 naming
each file and why. `--json` carries the list as `skipped`, which a machine consumer has to check
alongside `truncated`. Note that this is stricter than it used to be: a repository with one
unparseable stylesheet anywhere in it now fails a `--strict` gate that previously passed.

**Which files are read.** `*.css` anywhere (a file whose PostCSS parse finds a real `@theme` at-rule
is also read as Tailwind v4); `tokens.json`, `design-tokens.json`, `*.tokens.json` anywhere;
`tailwind.config.{js,cjs,mjs,ts,mts,cts}` anywhere; `package.json` and `.designreview.yml` at the
scan root only. `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`,
`.turbo`, `.cache`, `vendor` and `tmp` are never entered. Files over 2 MiB and unparseable files
(CSS and JSON alike) are listed as `skipped`, never guessed at, and never taken as evidence of what
the repository declares.

There are three equivalent ways to invoke the CLI inside a checkout. `node packages/cli/dist/bin.js`
and `pnpm ui-dna` need no setup. `@apatureai/canon` is published to npm and carries the `ui-dna` bin,
so `npm i -g @apatureai/canon` (or `pnpm dlx @apatureai/canon`) also puts the command on your `PATH`.
To point `PATH` at a local build instead, symlink the built entry point; it has a shebang and works
from any working directory:

```bash
chmod +x packages/cli/dist/bin.js
mkdir -p ~/.local/bin                                       # or any directory already on your PATH
ln -s "$PWD/packages/cli/dist/bin.js" ~/.local/bin/ui-dna
```

`dist/` is gitignored, so neither step dirties the tree.

### `ui-dna approve <genome.json>`

`context --out` writes a **draft** snapshot. Nothing downstream will read a draft:
the store, the read contract, and every consumer projection gate on approval, so
a genome is only usable once a human has signed it off. `approve` runs that
transition (draft → in_review → approved) and stamps the snapshot with its
content-addressed immutable `dnaVersion`.

| Flag | Effect |
|---|---|
| `--out <file>` | Write the approved `DnaSnapshot` as JSON. Parent directories are created. Without it, the snapshot prints to stdout. |

```console
$ node packages/cli/dist/bin.js approve out/genome.json --out out/approved.json
$ node -e "const m=require('./out/approved.json').metadata; console.log(m.approvalState, m.dnaVersion)"
approved abdcf749b0caacc3e97f7b8aafab4382c62c21f3010614f636111cf54c8490c6
```

Sign-off with no per-field decisions confirms the resolved genome as-is; the
per-field accept/edit review lives in the `@apatureai/canon-store` library
(`applyReviewDecisions`). Re-approving an already-approved genome is refused — a
new genome is a new version, not a re-approval. The `dnaVersion` is deterministic:
the same resolved content yields the same version on every machine.

### `ui-dna export <genome.json> --target <consumer>`

Canon's internal `DnaSnapshot` is not the shape any consumer reads. `export`
**projects** an approved genome into one downstream consumer's read contract.
The genome must be approved (run `approve` first); drafts are refused.

| Flag | Effect |
|---|---|
| `--target <consumer>` | Required. One of `verdict`, `lattice`, `pointer`. |
| `--out <file>` | Write the projected profile as JSON. Parent directories are created. Without it, the profile prints to stdout. |

```console
$ node packages/cli/dist/bin.js export out/approved.json --target verdict --out out/verdict.json
$ node packages/cli/dist/bin.js export out/approved.json --target lattice --out out/lattice.json
```

- **`verdict`** — a `snapshot` object carrying `dna_version`, `approval_state`,
  and a flat `items` list (`{ field_id, kind, value, confidence, provenance }`)
  Verdict loads as rules.
- **`lattice`** — `projectionSchemaVersion`, a `dnaContentDigest` to verify
  before mirroring, a `state`, and a `tokens` map keyed by field id
  (`{ value, category, confidence }`).
- **`pointer`** — the Pointer local-check read profile (color tokens, spacing/
  radius/type scales, and WCAG policy defaults).

Each projection keeps the approval gate, validates the snapshot, checks the repo
and version match, and stamps a content digest, so a consumer can verify the
bytes it received. The same projections are available as library functions
(`projectVerdictDnaProfile`, `projectLatticeDnaProfile`,
`projectPointerLocalCheckProfile`) and as store-served reads
(`getVerdictDnaProfile`, `getLatticeDnaProfile`, `getPointerLocalCheckProfile`).

## Using it as a library

The `@apatureai/canon-*` packages are on npm, so you can `pnpm add @apatureai/canon-schema
@apatureai/canon-context @apatureai/canon-reconcile @apatureai/canon-store @apatureai/canon-render`
and import them directly; inside a checkout they resolve to `packages/<name>/dist` after `pnpm build`.
Every extractor takes a **string**, not a path; `@apatureai/canon` is the only package that reads a
disk.

The block below is `examples/library-example.ts`, checked in and runnable once `pnpm build` has run.
It goes extract, reconcile, drift, version, sign off, serve, in one file:

```console
$ node examples/library-example.ts
[
  'tokens.spacing.--spacing-gap: code declares "8px" but it is not observed in rendered reality (dead token)'
]
before approval: null
after approval:  { schemaVersion: '1', storeVersion: '2' } sha256:ef69d6a
verdict profile: approved 7 items
```

```ts
import { emptyDraft } from "@apatureai/canon-schema";
import { extractCssTokens } from "@apatureai/canon-context";
import { computeVisualDistributions, sampleCaptureEvidence } from "@apatureai/canon-render";
import { reconcileTokens, computeDriftHints } from "@apatureai/canon-reconcile";
import {
  inMemorySnapshotStore, commitSnapshot, requestReview, approveSnapshot, getSnapshot,
  projectVerdictDnaProfile,
} from "@apatureai/canon-store";

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

// Project the approved genome into a downstream consumer's read contract.
const verdict = projectVerdictDnaProfile(served!.snapshot, served!.repo, served!.dnaVersion);
console.log("verdict profile:", verdict.snapshot.approval_state, verdict.snapshot.items.length, "items");
```

**Where the `@apatureai/*` specifiers resolve.** Inside this repository they resolve everywhere,
including the root, because the root `package.json` declares the workspace packages as dependencies;
they resolve to `packages/<name>/dist`, so `pnpm build` is a prerequisite. In your own project they
resolve against the versions you installed from npm.

`packages/cli/test/library-example.test.ts` executes this example on every `pnpm test`, so it cannot
rot into a snippet that no longer runs.
