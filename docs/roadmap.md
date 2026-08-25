Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

## Status

Verified on 2026-08-24, Node 24.14.0, pnpm 10.34.3: lint clean, typecheck clean,
**519 tests across 60 files passing** in about 5 seconds, all offline.

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
| Consumer projections (`ui-dna export`) | **Works.** Verdict, Lattice, and Pointer read contracts, gated on approval. |
| npm packages | **Published.** The six public `@apatureai/*` packages are on npm (`@apatureai/canon` carries the `ui-dna` bin); a tagged release workflow publishes new versions with provenance. |

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

**4. Ship `@apatureai/canon-eval` too (optional).** The six runtime packages
(`@apatureai/canon`, `@apatureai/canon-schema`, `@apatureai/canon-context`, `@apatureai/canon-reconcile`, `@apatureai/canon-render`, `@apatureai/canon-store`)
are published to npm — `private: false` with `publishConfig.access: public` and a `prepack` build,
released with provenance on a `v*` tag by
[`.github/workflows/release.yml`](../.github/workflows/release.yml) (see
[Releasing](development.md#releasing)). The one remaining decision is the maintainer's: whether
`@apatureai/canon-eval` (kept private today as an internal harness) should also ship.

**5. Serve the read contract.** `getSnapshot` is a function call. An HTTP or MCP server exposing the
versioned read contract and `retrieveGenomeSlice` would let other tools consume approved snapshots
without vendoring the library. The wire shape is already pinned by a golden fixture
(`packages/store/test/fixtures/golden-snapshot-response.json`), so a server has a contract to
implement rather than invent.

**6. DTCG Resolver Module support.** Sets, modifiers, `resolutionOrder`, filesystem and remote
sources currently return `unsupported_resolver_module`; external `$ref` returns
`unsupported_external_reference`. Enabling them needs an injected, sandboxed, allowlisted loader
(the codebase never reads the filesystem outside `@apatureai/canon`, and that rule should hold) plus a
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
reasoned defaults, and `@apatureai/canon-eval` measures precision, recall and calibration (ECE, Brier) against
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
