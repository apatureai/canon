# SPIKE #8 — diff→route import-graph feasibility

**Question (PRD §4.3):** before building the v1.5 import-graph diff→route path
(#9), can a static import graph reliably walk from a changed component up to the
page(s) that render it? Assess against the four hard cases: **tsconfig path
aliases**, **barrel files**, **dynamic imports**, and **monorepos**.

**Probe:** `src/import-graph-spike.ts` — a pure, fixture-driven resolver
(`resolveFileImports`) that parses a file's import/export specifiers and
classifies each as `relative | alias | bare | dynamic`, resolving relative paths
and tsconfig `paths` aliases without touching a filesystem.
`assessImportGraphFeasibility` aggregates per-file results into a
`FeasibilityReport` (counts per kind + a `resolvableFraction`) so the prevalence
of each hard case can be **measured** on a real repo by feeding it source text.

## Findings (per hard case)

- **tsconfig path aliases** — RESOLVABLE. `@/*`→`src/*`-style aliases are a
  deterministic string rewrite given `compilerOptions.baseUrl` + `paths`; the
  probe resolves both wildcard (`@/*`) and exact (`@ui`) forms. This is the
  alias machinery the v3 resolveConfig pass (#1) already needs to read tsconfig,
  so it is shared, not new risk.
- **barrel files (re-export hubs)** — RESOLVABLE BUT COSTLY. `export * from`/
  `export { x } from` are ordinary edges (the probe treats them as such), so the
  graph stays connected. The cost is fan-out: a barrel re-exporting N modules
  makes a component appear "imported by" every page that touches the barrel,
  inflating the affected-route set. Mitigation: cap routes per change (the #7
  `maxPerPr` / `MAX_LAYOUT_CHILD_ROUTES` caps already exist) and prefer the
  nearest page ancestor.
- **dynamic imports** — PARTIAL. `import('literal')` is resolvable (the probe
  flags `dynamic` and still resolves a literal specifier). Computed/templated
  specifiers (`import(\`./\${name}\`)`) are NOT statically resolvable — those
  edges are lost. Measured impact is expected to be small for route-defining
  code; lazy `next/dynamic` boundaries usually wrap a literal path.
- **monorepos** — OUT OF SCOPE for v1.5. Cross-package edges (`@acme/ui`) look
  like bare specifiers and stop the walk. Following them needs workspace
  resolution (package.json `workspaces` + each package's tsconfig). Defer; the
  page-file MVP (#7) already covers the common single-app case.

## Go / No-Go

**GO — but scope v1.5 (#9) narrowly:**

1. Single-app (non-monorepo) repos only; bare/external specifiers terminate the walk.
2. Static `import`/`export … from` + **literal** dynamic imports; skip computed dynamic specifiers.
3. Resolve relative + tsconfig-alias edges (reuse #1's tsconfig reader); no node_modules resolution.
4. **Cap traversal depth at 5** (per #9's title) and cap affected routes, to bound barrel-file fan-out.
5. Gate on **measured need**: run `assessImportGraphFeasibility` on a
   component-heavy customer repo first; only ship #9 if the page-file MVP (#7)
   demonstrably misses routes that the graph recovers at an acceptable
   `resolvableFraction` (target ≥ 0.9 of internal edges).

**No-go conditions:** if measurement on a real repo shows the MVP already
captures the affected routes, or `resolvableFraction` is low because the repo
leans on computed dynamic imports / heavy cross-package edges, do **not** build
#9 — the static graph would be both incomplete and misleading.

## Decision for the loop

#9 stays **gated** behind this measured-need check. The probe + report are the
instrument; the production graph builder is not built until a real
component-heavy repo justifies it.
